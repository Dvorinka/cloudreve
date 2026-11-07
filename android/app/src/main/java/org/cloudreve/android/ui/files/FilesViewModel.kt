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
import kotlinx.coroutines.sync.withPermit
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

/** Files-app style categories, each a server-side search over the whole drive. */
enum class Category(val uri: String, val label: String) {
    RECENT("${CrUri.MY_PREFIX}?type=file", "Recent"),
    IMAGES("${CrUri.MY_PREFIX}?category=image", "Images"),
    VIDEOS("${CrUri.MY_PREFIX}?category=video", "Videos"),
    AUDIO("${CrUri.MY_PREFIX}?category=audio", "Audio"),
    DOCUMENTS("${CrUri.MY_PREFIX}?category=document", "Documents"),
    TRASH("cloudreve://trash", "Trash");

    val gallery: Boolean get() = this == IMAGES || this == VIDEOS

    companion object {
        fun fromUri(uri: String): Category? = entries.firstOrNull { it.uri == uri }
    }
}

data class FilesUiState(
    /** Landing page with Recent and Categories; false while browsing a folder or category. */
    val home: Boolean = true,
    val recent: List<FileObject> = emptyList(),
    val recentLoading: Boolean = false,
    val currentUri: String = CrUri.MY_PREFIX,
    val files: List<FileObject> = emptyList(),
    /** No usable listing yet: show a spinner instead of files. */
    val loading: Boolean = false,
    /** A cached listing is on screen while a fresh one is fetched. */
    val revalidating: Boolean = false,
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
    val category: Category? get() = Category.fromUri(currentUri)
    /** Category listings mix folders; the row subtitle names each file's folder. */
    val virtual: Boolean get() = category != null
    val inTrash: Boolean get() = category == Category.TRASH
    /** Effective display mode: galleries keep their own preference. */
    val effectiveMode: ViewMode get() = if (category?.gallery == true) view.galleryMode else view.mode
    val folderName: String
        get() {
            category?.let { return it.label }
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

    private companion object {
        const val RECENT_COUNT = 12
        const val PREFETCH_THUMBS = 40
        const val PREFETCH_PARALLELISM = 6
    }

    private val downloadJobs = ConcurrentHashMap<String, Job>()
    /** Finished upload ids already reported, so a replayed WorkInfo is not announced twice. */
    private val announcedUploads = HashSet<java.util.UUID>()

    init {
        loadRecent()
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

    /** Last good listing per folder, so going back (or returning) paints instantly. */
    private val listingCache = HashMap<String, Listing>()
    private data class Listing(val files: List<FileObject>, val nextToken: String?, val sortKey: SortOrder)

    fun refresh() {
        val uri = _state.value.currentUri
        val cached = listingCache[uri]?.takeIf { it.sortKey == _state.value.view.sort }
        _state.value = _state.value.copy(
            loading = cached == null,
            revalidating = cached != null,
            error = null,
            files = cached?.files ?: emptyList(),
            nextToken = cached?.nextToken,
            selected = emptySet(),
        )
        viewModelScope.launch {
            try {
                val res = list(uri)
                // The user may have moved on while this was in flight.
                if (_state.value.currentUri != uri) return@launch
                val files = sortFiles(res.files)
                listingCache[uri] = Listing(files, res.pagination.nextToken, _state.value.view.sort)
                _state.value = _state.value.copy(
                    loading = false,
                    revalidating = false,
                    files = files,
                    nextToken = res.pagination.nextToken,
                )
                prefetchThumbs(files)
            } catch (e: Exception) {
                if (_state.value.currentUri != uri) return@launch
                if (!handleSessionExpiry(e)) {
                    // Keep showing the cached files if we had them; only surface the error otherwise.
                    _state.value = _state.value.copy(
                        loading = false,
                        revalidating = false,
                        error = if (cached == null) e.message else null,
                        snackbar = if (cached != null) e.message else null,
                    )
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
                val files = sortFiles(_state.value.files + res.files)
                listingCache[s.currentUri] = Listing(files, res.pagination.nextToken, _state.value.view.sort)
                _state.value = _state.value.copy(
                    loadingMore = false,
                    files = files,
                    nextToken = res.pagination.nextToken,
                )
            } catch (e: Exception) {
                _state.value = _state.value.copy(loadingMore = false, snackbar = e.message)
            }
        }
    }

    private suspend fun list(uri: String, token: String? = null) =
        if (Category.fromUri(uri) != null) {
            // Categories read like a timeline, as in the Files app.
            repo.list(uri, pageToken = token, orderBy = "updated_at", orderDirection = "desc")
        } else {
            repo.list(
                uri,
                pageToken = token,
                orderBy = _state.value.view.sort.by.apiName,
                orderDirection = _state.value.view.sort.apiDirection,
            )
        }

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
        _state.value = _state.value.copy(currentUri = file.path, home = false)
        refresh()
    }

    /** Up one folder; from the root folder or a category back to the home page. */
    fun navigateUp(): Boolean {
        val s = _state.value
        if (s.home) return false
        if (CrUri.isRoot(s.currentUri) || s.virtual) {
            goHome()
            return true
        }
        _state.value = s.copy(currentUri = CrUri.parent(s.currentUri))
        refresh()
        return true
    }

    fun goHome() {
        _state.value = _state.value.copy(home = true, currentUri = CrUri.MY_PREFIX, selected = emptySet())
        loadRecent()
    }

    fun openMyFiles() {
        _state.value = _state.value.copy(home = false, currentUri = CrUri.MY_PREFIX)
        refresh()
    }

    fun openCategory(category: Category) {
        _state.value = _state.value.copy(home = false, currentUri = category.uri)
        refresh()
    }

    /** Newest files across the drive for the home page's Recent strip. */
    fun loadRecent() {
        if (_state.value.recentLoading) return
        _state.value = _state.value.copy(recentLoading = true)
        viewModelScope.launch {
            runCatching {
                repo.list(Category.RECENT.uri, orderBy = "updated_at", orderDirection = "desc", pageSize = RECENT_COUNT)
            }.onSuccess { res ->
                _state.value = _state.value.copy(recent = res.files.filter { !it.isFolder }, recentLoading = false)
            }.onFailure { e ->
                _state.value = _state.value.copy(recentLoading = false)
                if (!handleSessionExpiry(e as? Exception ?: Exception(e))) {
                    _state.value = _state.value.copy(snackbar = e.message)
                }
            }
        }
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
        if (u.uploaded > 0) {
            if (_state.value.home) loadRecent() else if (u.parentUri == _state.value.currentUri) refresh()
        }
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

    /** Signed inline URL for streaming a preview (image, video, audio). */
    suspend fun previewUrl(file: FileObject): String = repo.contentUrl(file.path)

    /** Local copy for renderers that need a file (PDF, text); downloads if missing. */
    suspend fun localCopy(context: Context, file: FileObject, onProgress: (Float?) -> Unit): File {
        val dest = cacheFileFor(context, file)
        if (dest.exists() && dest.length() == file.size) return dest
        val url = repo.downloadUrl(file.path)
        repo.downloadToFile(url, dest) { done, total -> onProgress(if (total > 0) done.toFloat() / total else null) }
        return dest
    }

    /** Files of the folder on screen that open in the in-app viewer, in list order. */
    fun previewableSiblings(file: FileObject): List<FileObject> {
        val kind = FileKind.of(file)
        val gallery = kind == FileKind.IMAGE || kind == FileKind.VIDEO
        return _state.value.files.filter {
            !it.isFolder && if (gallery) FileKind.of(it).let { k -> k == FileKind.IMAGE || k == FileKind.VIDEO } else FileKind.of(it) == kind
        }.ifEmpty { listOf(file) }
    }

    // ---- view preferences -------------------------------------------------

    fun setViewMode(mode: ViewMode) {
        viewModelScope.launch { viewSettings.setMode(mode) }
    }

    fun toggleViewMode() {
        val s = _state.value
        val next = if (s.effectiveMode == ViewMode.LIST) ViewMode.GRID else ViewMode.LIST
        if (s.category?.gallery == true) viewModelScope.launch { viewSettings.setGalleryMode(next) }
        else setViewMode(next)
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

    /** Move or copy [paths] into [dst]; the list refreshes and the cache for both folders is dropped. */
    fun moveTo(paths: List<String>, dst: String, copy: Boolean) {
        if (paths.isEmpty()) return
        viewModelScope.launch {
            runCatching { repo.move(paths, dst, copy) }
                .onSuccess {
                    listingCache.remove(dst)
                    val n = paths.size
                    val what = "$n item${if (n == 1) "" else "s"}"
                    val where = folderLabel(dst)
                    _state.value = _state.value.copy(
                        selected = emptySet(),
                        snackbar = if (copy) "Copied $what to $where" else "Moved $what to $where",
                    )
                    refresh()
                }
                .onFailure { _state.value = _state.value.copy(snackbar = it.message) }
        }
    }

    suspend fun listFolders(uri: String): List<FileObject> = repo.listFolders(uri)

    private fun folderLabel(uri: String): String {
        val path = uri.removePrefix(CrUri.MY_PREFIX).trim('/')
        return if (path.isEmpty()) "My files" else java.net.URLDecoder.decode(path.substringAfterLast('/'), "UTF-8")
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

    fun mkdir(name: String) = mkdirIn(_state.value.currentUri, name)

    /** Creates [name] under [parent]; refreshes if that is the folder on screen. */
    fun mkdirIn(parent: String, name: String) {
        if (name.isBlank()) return
        viewModelScope.launch {
            runCatching { repo.mkdir(CrUri.join(parent, name)) }
                .onSuccess {
                    listingCache.remove(parent)
                    if (parent == _state.value.currentUri) refresh()
                }
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

    suspend fun shareLink(file: FileObject, password: String = "", expireSeconds: Int = 0): String =
        repo.createShare(file.path, password = password, expireSeconds = expireSeconds)

    /** Trash: put items back where they were. */
    fun restore(paths: List<String>) {
        if (paths.isEmpty()) return
        viewModelScope.launch {
            runCatching { repo.restore(paths) }
                .onSuccess {
                    listingCache.clear()
                    _state.value = _state.value.copy(
                        selected = emptySet(),
                        snackbar = "Restored ${paths.size} item${if (paths.size == 1) "" else "s"}",
                    )
                    refresh()
                }
                .onFailure { _state.value = _state.value.copy(snackbar = it.message) }
        }
    }

    /** Trash: remove for good. */
    fun deleteForever(paths: List<String>) {
        if (paths.isEmpty()) return
        viewModelScope.launch {
            runCatching { repo.delete(paths, permanently = true) }
                .onSuccess {
                    _state.value = _state.value.copy(
                        selected = emptySet(),
                        snackbar = "Deleted ${paths.size} item${if (paths.size == 1) "" else "s"} permanently",
                    )
                    refresh()
                }
                .onFailure { _state.value = _state.value.copy(snackbar = it.message) }
        }
    }

    /**
     * Resolve thumbnail URLs for the first screenfuls in parallel right after
     * a listing lands, so rows do not each pay a round trip as they scroll in.
     */
    private fun prefetchThumbs(files: List<FileObject>) {
        val wanted = files.filter { it.mayHaveThumbnail && !thumbCache.containsKey(it.id) && it.id !in noThumb }.take(PREFETCH_THUMBS)
        if (wanted.isEmpty()) return
        viewModelScope.launch {
            val gate = kotlinx.coroutines.sync.Semaphore(PREFETCH_PARALLELISM)
            wanted.forEach { f ->
                launch { gate.withPermit { runCatching { thumbUrl(f) } } }
            }
        }
    }

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
