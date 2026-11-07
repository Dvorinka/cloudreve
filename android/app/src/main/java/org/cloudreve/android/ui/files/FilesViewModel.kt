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
import org.cloudreve.android.work.BackgroundSync
import org.cloudreve.android.work.UploadStatus
import org.cloudreve.android.work.UploadWorker
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.ConcurrentHashMap

/** Files-app style categories, each a server-side search over the whole drive. */
enum class Category(val uri: String, val label: String, val filter: String? = null) {
    RECENT("${CrUri.MY_PREFIX}?type=file", "Recent", "type=file"),
    IMAGES("${CrUri.MY_PREFIX}?category=image", "Images", "category=image"),
    VIDEOS("${CrUri.MY_PREFIX}?category=video", "Videos", "category=video"),
    AUDIO("${CrUri.MY_PREFIX}?category=audio", "Audio", "category=audio"),
    DOCUMENTS("${CrUri.MY_PREFIX}?category=document", "Documents", "category=document"),
    TRASH("cloudreve://trash", "Trash");

    val gallery: Boolean get() = this == IMAGES || this == VIDEOS

    companion object {
        fun fromUri(uri: String): Category? = entries.firstOrNull { it.uri == uri }
    }
}

/** One-off message for the snackbar, optionally with an action such as Undo. */
data class UiMessage(val text: String, val actionLabel: String? = null, val action: (() -> Unit)? = null)

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
    val snackbar: UiMessage? = null,
    val view: ViewPrefs = ViewPrefs(),
    /** Paths of files picked in selection mode; empty means not selecting. */
    val selected: Set<String> = emptySet(),
    /** Upload batches still running, newest last. */
    val uploads: List<UploadStatus> = emptyList(),
    /** Periodic camera backup / folder mirror runs in progress. */
    val backgroundSyncs: List<BackgroundSync.Status> = emptyList(),
    /** Files being fetched for open/download: path to fraction (null = size unknown). */
    val downloading: Map<String, Float?> = emptyMap(),
    /** Non-null while the search UI is open (even with an empty query). */
    val searchQuery: String? = null,
    /** Folder the search is limited to; null = whole drive. */
    val searchScope: String? = null,
    val searchType: Category? = null,
    val searchResults: List<FileObject> = emptyList(),
    val searchNextToken: String? = null,
    val searchLoading: Boolean = false,
    val searchLoadingMore: Boolean = false,
    val searchError: String? = null,
    val favorites: List<FavoriteEntry> = emptyList(),
) {
    val favoritePaths: Set<String> get() = favorites.map { it.path }.toSet()
    val selecting: Boolean get() = selected.isNotEmpty()
    /** Uploads landing in the folder on screen; shown inline above the files. */
    val uploadsHere: List<UploadStatus> get() = uploads.filter { it.parentUri == currentUri }
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
                        snackbar = (if (cached != null) e.message else null).toMessage(),
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
                _state.value = _state.value.copy(loadingMore = false, snackbar = (e.message).toMessage())
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
                    _state.value = _state.value.copy(snackbar = (e.message).toMessage())
                }
            }
        }
    }

    // ---- transfers --------------------------------------------------------

    private fun observeUploads() {
        viewModelScope.launch {
            workManager.getWorkInfosByTagFlow(BackgroundSync.TAG).collect { infos ->
                _state.value = _state.value.copy(backgroundSyncs = infos.mapNotNull(BackgroundSync::statusOf))
            }
        }
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
        _state.value = _state.value.copy(snackbar = (message).toMessage())
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
                _state.value = _state.value.copy(snackbar = (e.message ?: "Download failed").toMessage())
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

    fun deleteSelected() = deletePaths(_state.value.selected.toList())

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
                        snackbar = (if (copy) "Copied $what to $where" else "Moved $what to $where").toMessage(),
                    )
                    refresh()
                }
                .onFailure { _state.value = _state.value.copy(snackbar = it.message.toMessage()) }
        }
    }

    suspend fun listFolders(uri: String): List<FileObject> = repo.listFolders(uri)

    private fun folderLabel(uri: String): String {
        val path = uri.removePrefix(CrUri.MY_PREFIX).trim('/')
        return if (path.isEmpty()) "My files" else java.net.URLDecoder.decode(path.substringAfterLast('/'), "UTF-8")
    }

    // ---- search -----------------------------------------------------------
    //
    // Name search through the listing API's ?name= filter (case-folded), not
    // the /file/search full-text endpoint: that one is off unless the admin
    // enabled FTS, and answered "feature not enabled" on a stock server.

    private var searchJob: Job? = null

    /** Opens search; scoped to the current folder when inside one, otherwise everywhere. */
    fun openSearch() {
        val s = _state.value
        val scope = if (!s.home && !s.virtual && !CrUri.isRoot(s.currentUri)) s.currentUri else null
        _state.value = s.copy(searchQuery = "", searchScope = scope, searchType = null, searchResults = emptyList(), selected = emptySet())
    }

    fun setSearchScope(folder: String?) {
        _state.value = _state.value.copy(searchScope = folder)
        runSearch()
    }

    fun setSearchType(type: Category?) {
        _state.value = _state.value.copy(searchType = type)
        runSearch()
    }

    /** Called as the user types; results are fetched after a short pause. */
    fun search(query: String) {
        _state.value = _state.value.copy(searchQuery = query)
        runSearch(debounceMs = 300)
    }

    private fun searchUri(): String? {
        val s = _state.value
        val q = s.searchQuery?.trim().orEmpty()
        if (q.isEmpty()) return null
        val base = s.searchScope ?: CrUri.MY_PREFIX
        val encoded = java.net.URLEncoder.encode(q, "UTF-8").replace("+", "%20")
        return buildString {
            append(base).append("?name=").append(encoded).append("&case_folding")
            s.searchType?.filter?.let { append('&').append(it) }
        }
    }

    private fun runSearch(debounceMs: Long = 0) {
        searchJob?.cancel()
        val uri = searchUri()
        if (uri == null) {
            _state.value = _state.value.copy(searchResults = emptyList(), searchNextToken = null, searchLoading = false, searchError = null)
            return
        }
        _state.value = _state.value.copy(searchLoading = true, searchError = null)
        searchJob = viewModelScope.launch {
            if (debounceMs > 0) kotlinx.coroutines.delay(debounceMs)
            try {
                val res = repo.list(uri, orderBy = "updated_at", orderDirection = "desc")
                _state.value = _state.value.copy(
                    searchLoading = false,
                    searchResults = res.files,
                    searchNextToken = res.pagination.nextToken,
                )
                prefetchThumbs(res.files)
            } catch (_: CancellationException) {
            } catch (e: Exception) {
                if (!handleSessionExpiry(e)) _state.value = _state.value.copy(searchLoading = false, searchError = e.message)
            }
        }
    }

    fun searchMore() {
        val s = _state.value
        val token = s.searchNextToken ?: return
        val uri = searchUri() ?: return
        if (s.searchLoadingMore || s.searchLoading) return
        _state.value = s.copy(searchLoadingMore = true)
        viewModelScope.launch {
            try {
                val res = repo.list(uri, pageToken = token, orderBy = "updated_at", orderDirection = "desc")
                _state.value = _state.value.copy(
                    searchLoadingMore = false,
                    searchResults = _state.value.searchResults + res.files,
                    searchNextToken = res.pagination.nextToken,
                )
            } catch (e: Exception) {
                _state.value = _state.value.copy(searchLoadingMore = false, snackbar = (e.message).toMessage())
            }
        }
    }

    fun clearSearch() {
        searchJob?.cancel()
        _state.value = _state.value.copy(
            searchQuery = null,
            searchScope = null,
            searchType = null,
            searchResults = emptyList(),
            searchNextToken = null,
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
                .onFailure { _state.value = _state.value.copy(snackbar = it.message.toMessage()) }
        }
    }

    fun rename(file: FileObject, newName: String) {
        if (newName.isBlank() || newName == file.name) return
        viewModelScope.launch {
            runCatching { repo.rename(file.path, newName) }
                .onSuccess { refresh() }
                .onFailure { _state.value = _state.value.copy(snackbar = it.message.toMessage()) }
        }
    }

    fun delete(file: FileObject) = deletePaths(listOf(file.path))

    /** Moves to trash and offers Undo, which restores from the trash by origin path. */
    private fun deletePaths(paths: List<String>) {
        if (paths.isEmpty()) return
        viewModelScope.launch {
            runCatching { repo.delete(paths) }
                .onSuccess {
                    val n = paths.size
                    _state.value = _state.value.copy(
                        snackbar = UiMessage(
                            text = if (n == 1) "${CrUri.fileName(paths[0])} moved to trash" else "$n items moved to trash",
                            actionLabel = "Undo",
                            action = { undoDelete(paths) },
                        ),
                    )
                    refresh()
                }
                .onFailure { _state.value = _state.value.copy(snackbar = it.message.toMessage()) }
        }
    }

    private fun undoDelete(originalPaths: List<String>) {
        viewModelScope.launch {
            runCatching {
                val wanted = originalPaths.toSet()
                val trashed = repo.list(Category.TRASH.uri, orderBy = "updated_at", orderDirection = "desc", pageSize = 200)
                    .files.filter { it.restoreUri in wanted }.map { it.path }
                if (trashed.isEmpty()) error("Couldn't find the items in the trash")
                repo.restore(trashed)
            }
                .onSuccess {
                    listingCache.clear()
                    _state.value = _state.value.copy(snackbar = UiMessage("Restored"))
                    refresh()
                }
                .onFailure { _state.value = _state.value.copy(snackbar = it.message.toMessage()) }
        }
    }

    /** Saves the file under filesDir/offline and registers it as a favorite, with the tile showing progress. */
    fun toggleFavorite(context: Context, file: FileObject) {
        if (file.isFolder) return
        val existing = _state.value.favorites.firstOrNull { it.path == file.path }
        if (existing != null) {
            removeFavorite(existing)
            return
        }
        if (file.path in _state.value.downloading) return
        setDownloading(file.path, null)
        viewModelScope.launch {
            runCatching {
                val dir = File(context.filesDir, "offline").apply { mkdirs() }
                val local = File(dir, "${file.path.hashCode()}_${file.name}")
                val url = repo.downloadUrl(file.path)
                repo.downloadToFile(url, local) { done, total ->
                    setDownloading(file.path, if (total > 0) done.toFloat() / total else null)
                }
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
                .onSuccess { _state.value = _state.value.copy(snackbar = UiMessage("${file.name} available offline")) }
                .onFailure { _state.value = _state.value.copy(snackbar = it.message.toMessage()) }
            _state.value = _state.value.copy(downloading = _state.value.downloading - file.path)
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
                .onFailure { _state.value = _state.value.copy(snackbar = it.message.toMessage()) }
        }
    }

    fun removeFavorite(entry: FavoriteEntry) {
        viewModelScope.launch {
            File(entry.localFile).delete()
            favorites.remove(entry.path)
        }
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
                        snackbar = ("Restored ${paths.size} item${if (paths.size == 1) "" else "s"}").toMessage(),
                    )
                    refresh()
                }
                .onFailure { _state.value = _state.value.copy(snackbar = it.message.toMessage()) }
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
                        snackbar = ("Deleted ${paths.size} item${if (paths.size == 1) "" else "s"} permanently").toMessage(),
                    )
                    refresh()
                }
                .onFailure { _state.value = _state.value.copy(snackbar = it.message.toMessage()) }
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

    private fun String?.toMessage(): UiMessage? = this?.let { UiMessage(it) }

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
