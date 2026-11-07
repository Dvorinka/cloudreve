package org.cloudreve.android.ui.files

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.work.WorkInfo
import androidx.work.WorkManager
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import org.cloudreve.android.api.FileObject
import org.cloudreve.android.api.SearchHit
import org.cloudreve.android.data.ApiException
import org.cloudreve.android.data.FavoriteEntry
import org.cloudreve.android.data.FavoritesStore
import org.cloudreve.android.data.FileRepository
import org.cloudreve.android.data.SortBy
import org.cloudreve.android.data.SortOrder
import org.cloudreve.android.data.ViewMode
import org.cloudreve.android.data.ViewPrefs
import org.cloudreve.android.data.ViewSettings
import org.cloudreve.android.util.CrUri
import org.cloudreve.android.work.UploadStatus
import org.cloudreve.android.work.UploadWorker
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.ConcurrentHashMap

data class FilesUiState(
    val currentUri: String = CrUri.MY_PREFIX,
    val files: List<FileObject> = emptyList(),
    val loading: Boolean = false,
    val loadingMore: Boolean = false,
    val nextToken: String? = null,
    val error: String? = null,
    val snackbar: String? = null,
    val view: ViewPrefs = ViewPrefs(),
    /** Paths of files picked in selection mode; empty means not selecting. */
    val selected: Set<String> = emptySet(),
    /** Upload batches still running, newest last. */
    val uploads: List<UploadStatus> = emptyList(),
    /** Files being fetched for open/download: path to fraction (null = size unknown). */
    val downloading: Map<String, Float?> = emptyMap(),
    val searchQuery: String? = null,
    val searchResults: List<SearchHit> = emptyList(),
    val searchTotal: Long = 0,
    val searchLoading: Boolean = false,
    val searchLoadingMore: Boolean = false,
    val searchError: String? = null,
    val favorites: List<FavoriteEntry> = emptyList(),
    val favoriteSaving: Boolean = false,
) {
    val favoritePaths: Set<String> get() = favorites.map { it.path }.toSet()
    val selecting: Boolean get() = selected.isNotEmpty()
    /** Uploads landing in the folder on screen; shown inline above the files. */
    val uploadsHere: List<UploadStatus> get() = uploads.filter { it.parentUri == currentUri }
    val uploadsElsewhere: Int get() = uploads.size - uploadsHere.size
    val selectedFiles: List<FileObject> get() = files.filter { it.path in selected }
    val folderName: String
        get() {
            val path = currentUri.removePrefix(CrUri.MY_PREFIX).trim('/')
            return if (path.isEmpty()) "My files"
            else java.net.URLDecoder.decode(path.substringAfterLast('/'), "UTF-8")
        }
}

class FilesViewModel(
    private val repo: FileRepository,
    private val favorites: FavoritesStore,
    private val viewSettings: ViewSettings,
    private val workManager: WorkManager,
    /** Invoked when the server no longer accepts our session; the caller returns to login. */
    private val onSessionExpired: suspend () -> Unit,
) : ViewModel() {

    private val _state = MutableStateFlow(FilesUiState())
    val state: StateFlow<FilesUiState> = _state

    /** Resolved thumbnail URLs by file id, shared across list/grid recompositions. */
    private val thumbCache = ConcurrentHashMap<String, String>()
    private val noThumb = ConcurrentHashMap.newKeySet<String>()

    private val downloadJobs = ConcurrentHashMap<String, Job>()
    /** Finished upload ids already reported, so a replayed WorkInfo is not announced twice. */
    private val announcedUploads = HashSet<java.util.UUID>()

    init {
        observeUploads()
        viewModelScope.launch {
            favorites.entries.collect { list ->
                _state.value = _state.value.copy(favorites = list)
            }
        }
        viewModelScope.launch {
            var first = true
            viewSettings.prefs.collect { prefs ->
                val sortChanged = prefs.sort != _state.value.view.sort
                _state.value = _state.value.copy(view = prefs)
                // Sorting is done server-side, so a new order means a new listing.
                if (!first && sortChanged) refresh()
                first = false
            }
        }
    }

    fun refresh() {
        val uri = _state.value.currentUri
        _state.value = _state.value.copy(
            loading = true, error = null, files = emptyList(), nextToken = null, selected = emptySet(),
        )
        viewModelScope.launch {
            try {
                val res = list(uri)
                _state.value = _state.value.copy(
                    loading = false,
                    files = sortFiles(res.files),
                    nextToken = res.pagination.nextToken,
                )
            } catch (e: Exception) {
                if (!handleSessionExpiry(e)) {
                    _state.value = _state.value.copy(loading = false, error = e.message)
                }
            }
        }
    }

    fun loadMore() {
        val s = _state.value
        val token = s.nextToken ?: return
        if (s.loadingMore) return
        _state.value = s.copy(loadingMore = true)
        viewModelScope.launch {
            try {
                val res = list(s.currentUri, token)
                _state.value = _state.value.copy(
                    loadingMore = false,
                    files = sortFiles(_state.value.files + res.files),
                    nextToken = res.pagination.nextToken,
                )
            } catch (e: Exception) {
                _state.value = _state.value.copy(loadingMore = false, snackbar = e.message)
            }
        }
    }

    private suspend fun list(uri: String, token: String? = null) =
        repo.list(
            uri,
            pageToken = token,
            orderBy = _state.value.view.sort.by.apiName,
            orderDirection = _state.value.view.sort.apiDirection,
        )

    /** True (and session torn down) when the error means we must log in again. */
    private suspend fun handleSessionExpiry(e: Exception): Boolean {
        if (e is ApiException && e.code == ApiException.CODE_LOGIN_REQUIRED) {
            onSessionExpired()
            return true
        }
        return false
    }

    fun navigateTo(file: FileObject) {
        if (!file.isFolder) return
        _state.value = _state.value.copy(currentUri = file.path)
        refresh()
    }

    fun navigateUp(): Boolean {
        val cur = _state.value.currentUri
        if (CrUri.isRoot(cur)) return false
        _state.value = _state.value.copy(currentUri = CrUri.parent(cur))
        refresh()
        return true
    }

    // ---- transfers --------------------------------------------------------

    private fun observeUploads() {
        viewModelScope.launch {
            workManager.getWorkInfosByTagFlow(UploadWorker.TAG).collect { infos ->
                val statuses = infos.map(UploadStatus::from)
                _state.value = _state.value.copy(uploads = statuses.filter { it.active })
                statuses.filter { !it.active && announcedUploads.add(it.id) }.forEach(::announceUpload)
                if (statuses.any { !it.active }) workManager.pruneWork()
            }
        }
    }

    private fun announceUpload(u: UploadStatus) {
        val message = when {
            u.state == WorkInfo.State.CANCELLED -> "Upload cancelled"
            u.failed == 0 -> "Uploaded ${u.uploaded} file${if (u.uploaded == 1) "" else "s"}"
            u.uploaded == 0 -> "Upload failed" + (u.error?.let { ": $it" } ?: "")
            else -> "Uploaded ${u.uploaded}, ${u.failed} failed"
        }
        _state.value = _state.value.copy(snackbar = message)
        if (u.uploaded > 0 && u.parentUri == _state.value.currentUri) refresh()
    }

    fun cancelUpload(id: java.util.UUID) {
        workManager.cancelWorkById(id)
    }

    /**
     * Fetches [file] into the app cache, reusing a previous copy when the size
     * still matches, and reports progress in [FilesUiState.downloading]. A
     * second call for a file already in flight cancels that download.
     */
    fun fetchForOpen(context: Context, file: FileObject, onReady: (File) -> Unit) {
        downloadJobs.remove(file.path)?.let {
            it.cancel()
            return
        }
        val dest = cacheFileFor(context, file)
        if (dest.exists() && dest.length() == file.size) {
            onReady(dest)
            return
        }
        setDownloading(file.path, null)
        val job = viewModelScope.launch {
            try {
                val url = repo.downloadUrl(file.path)
                repo.downloadToFile(url, dest) { done, total ->
                    setDownloading(file.path, if (total > 0) done.toFloat() / total else null)
                }
                onReady(dest)
            } catch (_: CancellationException) {
                // user cancelled; nothing to say
            } catch (e: Exception) {
                _state.value = _state.value.copy(snackbar = e.message ?: "Download failed")
            } finally {
                downloadJobs.remove(file.path)
                _state.value = _state.value.copy(downloading = _state.value.downloading - file.path)
            }
        }
        downloadJobs[file.path] = job
    }

    private fun setDownloading(path: String, fraction: Float?) {
        _state.value = _state.value.copy(downloading = _state.value.downloading + (path to fraction))
    }

    private fun cacheFileFor(context: Context, file: FileObject): File =
        File(File(context.cacheDir, "downloads"), file.id).resolve(file.name)

    // ---- view preferences -------------------------------------------------

    fun setViewMode(mode: ViewMode) {
        viewModelScope.launch { viewSettings.setMode(mode) }
    }

    fun toggleViewMode() {
        setViewMode(if (_state.value.view.mode == ViewMode.LIST) ViewMode.GRID else ViewMode.LIST)
    }

    /** Picking the active key again flips the direction, like the Files app. */
    fun sortBy(by: SortBy) {
        val cur = _state.value.view.sort
        val next = if (cur.by == by) cur.copy(ascending = !cur.ascending)
        else SortOrder(by, ascending = by == SortBy.NAME)
        viewModelScope.launch { viewSettings.setSort(next) }
    }

    // ---- selection --------------------------------------------------------

    fun toggleSelected(file: FileObject) {
        val cur = _state.value.selected
        _state.value = _state.value.copy(
            selected = if (file.path in cur) cur - file.path else cur + file.path,
        )
    }

    fun selectAll() {
        _state.value = _state.value.copy(selected = _state.value.files.map { it.path }.toSet())
    }

    fun clearSelection() {
        _state.value = _state.value.copy(selected = emptySet())
    }

    fun deleteSelected() {
        val paths = _state.value.selected.toList()
        if (paths.isEmpty()) return
        viewModelScope.launch {
            runCatching { repo.delete(paths) }
                .onSuccess {
                    _state.value = _state.value.copy(
                        snackbar = "${paths.size} item${if (paths.size == 1) "" else "s"} moved to trash",
                    )
                    refresh()
                }
                .onFailure { _state.value = _state.value.copy(snackbar = it.message) }
        }
    }

    // ---- search -----------------------------------------------------------

    fun search(query: String) {
        val q = query.trim()
        if (q.isEmpty()) return
        _state.value = _state.value.copy(
            searchQuery = q,
            searchResults = emptyList(),
            searchTotal = 0,
            searchLoading = true,
            searchError = null,
            selected = emptySet(),
        )
        viewModelScope.launch {
            try {
                val res = repo.search(q, 0)
                _state.value = _state.value.copy(
                    searchLoading = false,
                    searchResults = res.hits,
                    searchTotal = res.total,
                )
            } catch (e: Exception) {
                _state.value = _state.value.copy(searchLoading = false, searchError = e.message)
            }
        }
    }

    fun searchMore() {
        val s = _state.value
        val q = s.searchQuery ?: return
        if (s.searchLoadingMore || s.searchResults.size >= s.searchTotal) return
        _state.value = s.copy(searchLoadingMore = true)
        viewModelScope.launch {
            try {
                val res = repo.search(q, s.searchResults.size)
                _state.value = _state.value.copy(
                    searchLoadingMore = false,
                    searchResults = _state.value.searchResults + res.hits,
                )
            } catch (e: Exception) {
                _state.value = _state.value.copy(searchLoadingMore = false, snackbar = e.message)
            }
        }
    }

    fun clearSearch() {
        _state.value = _state.value.copy(
            searchQuery = null,
            searchResults = emptyList(),
            searchTotal = 0,
            searchLoading = false,
            searchLoadingMore = false,
            searchError = null,
        )
    }

    // ---- file operations --------------------------------------------------

    fun mkdir(name: String) {
        if (name.isBlank()) return
        viewModelScope.launch {
            runCatching { repo.mkdir(CrUri.join(_state.value.currentUri, name)) }
                .onSuccess { refresh() }
                .onFailure { _state.value = _state.value.copy(snackbar = it.message) }
        }
    }

    fun rename(file: FileObject, newName: String) {
        if (newName.isBlank() || newName == file.name) return
        viewModelScope.launch {
            runCatching { repo.rename(file.path, newName) }
                .onSuccess { refresh() }
                .onFailure { _state.value = _state.value.copy(snackbar = it.message) }
        }
    }

    fun delete(file: FileObject) {
        viewModelScope.launch {
            runCatching { repo.delete(listOf(file.path)) }
                .onSuccess { refresh() }
                .onFailure { _state.value = _state.value.copy(snackbar = it.message) }
        }
    }

    /** Saves the file under filesDir/offline and registers it as a favorite. */
    fun toggleFavorite(context: Context, file: FileObject) {
        if (file.isFolder) return
        val existing = _state.value.favorites.firstOrNull { it.path == file.path }
        if (existing != null) {
            removeFavorite(existing)
            return
        }
        if (_state.value.favoriteSaving) return
        _state.value = _state.value.copy(favoriteSaving = true)
        viewModelScope.launch {
            runCatching {
                val local = downloadTo(
                    File(context.filesDir, "offline"),
                    file,
                    "${file.path.hashCode()}_${file.name}",
                )
                favorites.put(
                    FavoriteEntry(
                        path = file.path,
                        name = file.name,
                        size = file.size,
                        localFile = local.absolutePath,
                        savedAt = System.currentTimeMillis(),
                        remoteUpdatedAt = file.updatedAt,
                    )
                )
            }
                .onSuccess { _state.value = _state.value.copy(snackbar = "Saved for offline") }
                .onFailure { _state.value = _state.value.copy(snackbar = it.message) }
            _state.value = _state.value.copy(favoriteSaving = false)
        }
    }

    /** Re-downloads a favorite to refresh its local copy. */
    fun refreshFavorite(context: Context, entry: FavoriteEntry) {
        viewModelScope.launch {
            runCatching {
                val url = repo.downloadUrl(entry.path)
                val resp = repo.download(url)
                if (!resp.isSuccessful) throw Exception("Download failed: HTTP ${resp.code()}")
                val out = File(entry.localFile)
                resp.body()!!.byteStream().use { input ->
                    FileOutputStream(out).use { input.copyTo(it) }
                }
                favorites.put(entry.copy(savedAt = System.currentTimeMillis()))
            }
                .onFailure { _state.value = _state.value.copy(snackbar = it.message) }
        }
    }

    fun removeFavorite(entry: FavoriteEntry) {
        viewModelScope.launch {
            File(entry.localFile).delete()
            favorites.remove(entry.path)
        }
    }

    private suspend fun downloadTo(dir: File, file: FileObject, name: String): File {
        val url = repo.downloadUrl(file.path)
        val resp = repo.download(url)
        if (!resp.isSuccessful) throw Exception("Download failed: HTTP ${resp.code()}")
        dir.mkdirs()
        val out = File(dir, name)
        resp.body()!!.byteStream().use { input ->
            FileOutputStream(out).use { input.copyTo(it) }
        }
        return out
    }

    suspend fun shareLink(file: FileObject): String = repo.createShare(file.path)

    suspend fun thumbUrl(file: FileObject): String? {
        if (!file.mayHaveThumbnail || file.id in noThumb) return null
        thumbCache[file.id]?.let { return it }
        val url = repo.thumbUrl(file.path)
        if (url == null) noThumb.add(file.id) else thumbCache[file.id] = url
        return url
    }

    fun consumeSnackbar() {
        _state.value = _state.value.copy(snackbar = null)
    }

    /**
     * Folders always stay on top like the Files app. The server's name order is
     * case-sensitive (uppercase first), which reads as random to people, so the
     * name sort is redone here case-insensitively; size and date come as-is.
     */
    private fun sortFiles(files: List<FileObject>): List<FileObject> {
        val sort = _state.value.view.sort
        val byType = compareByDescending<FileObject> { it.isFolder }
        if (sort.by != SortBy.NAME) return files.sortedWith(byType)
        val byName = compareBy<FileObject, String>(String.CASE_INSENSITIVE_ORDER) { it.name }
        return files.sortedWith(byType.then(if (sort.ascending) byName else byName.reversed()))
    }
}
