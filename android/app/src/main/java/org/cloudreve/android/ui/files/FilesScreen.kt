package org.cloudreve.android.ui.files

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CreateNewFolder
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.UploadFile
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.FolderOpen
import androidx.compose.material.icons.outlined.History
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material.icons.outlined.MusicNote
import androidx.compose.material.icons.outlined.Videocam
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.zIndex
import androidx.core.content.FileProvider
import kotlinx.coroutines.launch
import org.cloudreve.android.api.FileObject
import org.cloudreve.android.data.ViewMode
import org.cloudreve.android.util.CrUri
import org.cloudreve.android.work.UploadWorker
import org.cloudreve.android.ui.files.transfers.PendingUpload
import org.cloudreve.android.ui.files.transfers.UploadConflictDialog
import org.cloudreve.android.ui.preview.PreviewScreen
import org.cloudreve.android.ui.preview.previewKindOf
import java.io.File
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FilesScreen(
    viewModel: FilesViewModel,
    onOpenSettings: () -> Unit,
) {
    val state by viewModel.state.collectAsState()
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    val listState = rememberLazyListState()
    val gridState = rememberLazyGridState()

    var mkdirOpen by remember { mutableStateOf(false) }
    var addSheetOpen by remember { mutableStateOf(false) }
    var sheetTarget by remember { mutableStateOf<FileObject?>(null) }
    var preview by remember { mutableStateOf<Pair<List<FileObject>, Int>?>(null) }
    var renameTarget by remember { mutableStateOf<FileObject?>(null) }
    var deleteTarget by remember { mutableStateOf<FileObject?>(null) }
    var deleteSelectedOpen by remember { mutableStateOf(false) }
    var deleteForeverTarget by remember { mutableStateOf<List<String>?>(null) }
    /** Paths to move/copy and whether it is a copy; non-null shows the folder picker. */
    var movePick by remember { mutableStateOf<Pair<List<String>, Boolean>?>(null) }
    /** Folder the search was opened from (scope chip), null when opened at root/home. */
    var searchOpenedFrom by remember { mutableStateOf<String?>(null) }
    var favoritesOpen by remember { mutableStateOf(false) }
    val searchFocus = remember { FocusRequester() }

    val inSearch = state.searchQuery != null
    val searchOpen = inSearch

    var pendingUpload by remember { mutableStateOf<PendingUpload?>(null) }
    val haptics = LocalHapticFeedback.current

    val uploadLauncher = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        if (uris.isEmpty()) return@rememberLauncherForActivityResult
        val names = uris.map { UploadWorker.displayName(context, it) }
        val existing = state.files.map { it.name }.toSet()
        val pending = PendingUpload(uris, names, state.currentUri, existing)
        if (pending.conflicts.isEmpty()) {
            // The transfer card above the files shows the batch as soon as it is queued.
            UploadWorker.enqueue(context, uris, state.currentUri, names)
        } else {
            pendingUpload = pending
        }
    }

    LaunchedEffect(Unit) { if (!state.home) viewModel.refresh() }

    LaunchedEffect(state.snackbar) {
        val msg = state.snackbar ?: return@LaunchedEffect
        // Consume only after showing: clearing first would change this effect's
        // key and cancel it before the snackbar appears.
        val result = snackbar.showSnackbar(
            message = msg.text,
            actionLabel = msg.actionLabel,
            duration = if (msg.action != null) SnackbarDuration.Long else SnackbarDuration.Short,
        )
        viewModel.consumeSnackbar()
        if (result == SnackbarResult.ActionPerformed) msg.action?.invoke()
    }

    // Infinite scroll: load the next page when the end comes into view.
    LaunchedEffect(listState, gridState, state.effectiveMode) {
        val lastVisible = if (state.effectiveMode == ViewMode.GRID) {
            snapshotFlow { gridState.layoutInfo.visibleItemsInfo.lastOrNull()?.index }
        } else {
            snapshotFlow { listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index }
        }
        lastVisible.collect { last ->
            if (last == null) return@collect
            if (inSearch) {
                if (last >= state.searchResults.size - 5) viewModel.searchMore()
            } else if (last >= state.files.size - 5) {
                viewModel.loadMore()
            }
        }
    }

    LaunchedEffect(inSearch) {
        if (inSearch) runCatching { searchFocus.requestFocus() }
    }

    fun openSearch() {
        val s = state
        searchOpenedFrom = if (!s.home && !s.virtual && !CrUri.isRoot(s.currentUri)) s.currentUri else null
        viewModel.openSearch()
    }

    fun closeSearch() {
        viewModel.clearSearch()
        searchOpenedFrom = null
    }

    fun openWithSystemApp(file: FileObject) {
        viewModel.fetchForOpen(context, file) { local -> openWithSystem(context, local) }
    }

    /** In-app viewer for media, PDFs and text; everything else goes to the system. */
    fun openFile(file: FileObject) {
        if (previewKindOf(file) == null) {
            openWithSystemApp(file)
            return
        }
        val siblings = if (inSearch || state.home) listOf(file) else viewModel.previewableSiblings(file)
        preview = siblings to siblings.indexOfFirst { it.path == file.path }.coerceAtLeast(0)
    }

    var shareTarget by remember { mutableStateOf<FileObject?>(null) }
    var detailsTarget by remember { mutableStateOf<FileObject?>(null) }
    fun shareLink(file: FileObject) { shareTarget = file }

    fun actionsFor(file: FileObject): FileActions = FileActions(
        onOpen = {
            when {
                state.selecting -> viewModel.toggleSelected(file)
                state.inTrash -> sheetTarget = file
                file.isFolder -> viewModel.navigateTo(file)
                else -> openFile(file)
            }
        },
        onLongPress = {
            haptics.performHapticFeedback(HapticFeedbackType.LongPress)
            viewModel.toggleSelected(file)
        },
        onMore = { sheetTarget = file },
    )

    BackHandler(enabled = state.selecting || inSearch || searchOpen || !state.home) {
        when {
            state.selecting -> viewModel.clearSelection()
            inSearch || searchOpen -> closeSearch()
            else -> viewModel.navigateUp()
        }
    }

    Scaffold(
        topBar = {
            val barMode = when {
                state.selecting -> "select"
                inSearch -> "search"
                state.home -> "home"
                else -> "folder"
            }
            AnimatedContent(
                targetState = barMode,
                transitionSpec = { fadeIn(tween(180)) togetherWith fadeOut(tween(120)) },
                label = "topBar",
            ) { mode -> when (mode) {
                "select" -> SelectionTopBar(
                    count = state.selected.size,
                    total = state.files.size,
                    inTrash = state.inTrash,
                    onClose = { viewModel.clearSelection() },
                    onSelectAll = { viewModel.selectAll() },
                    onMove = { movePick = state.selected.toList() to false },
                    onCopy = { movePick = state.selected.toList() to true },
                    onDelete = { if (state.inTrash) deleteForeverTarget = state.selected.toList() else deleteSelectedOpen = true },
                    onRestore = { viewModel.restore(state.selected.toList()) },
                )
                "search" -> SearchTopBar(
                    text = state.searchQuery.orEmpty(),
                    onTextChange = { viewModel.search(it) },
                    onClose = { closeSearch() },
                    focus = searchFocus,
                )
                "home" -> Unit
                else -> FolderTopBar(
                    title = state.folderName,
                    subtitle = listOfNotNull(
                        when {
                            state.inTrash -> "Kept for 7 days"
                            state.virtual -> "Across all folders"
                            CrUri.isRoot(state.currentUri) -> null
                            else -> CrUri.displayPath(CrUri.parent(state.currentUri))
                        },
                        state.itemCountLabel,
                    ).joinToString(" • ").ifEmpty { null },
                    showBack = true,
                    showSort = !state.virtual,
                    viewMode = state.effectiveMode,
                    sort = state.view.sort,
                    hasFavorites = state.favorites.isNotEmpty(),
                    onBack = { viewModel.navigateUp() },
                    onSearch = { openSearch() },
                    onToggleView = { viewModel.toggleViewMode() },
                    onSort = { viewModel.sortBy(it) },
                    onSelect = { state.files.firstOrNull()?.let { viewModel.toggleSelected(it) } },
                    onRefresh = { viewModel.refresh() },
                    onFavorites = { favoritesOpen = true },
                    onSettings = onOpenSettings,
                )
            } }
        },
        floatingActionButton = {
            val scrollingDown = rememberScrollingDown(listState, gridState)
            AnimatedVisibility(
                visible = !state.home && !state.virtual && !state.selecting && !inSearch && !searchOpen && !scrollingDown,
                enter = scaleIn() + fadeIn(),
                exit = scaleOut() + fadeOut(),
            ) {
                FloatingActionButton(onClick = { addSheetOpen = true }) {
                    Icon(Icons.Default.Add, contentDescription = "Add")
                }
            }
        },
        snackbarHost = { SnackbarHost(snackbar) },
    ) { padding ->
        // Spin the pull indicator only for a pull the user made; initial and
        // background loads have their own, quieter indicators.
        var pulled by remember { mutableStateOf(false) }
        val busy = if (state.home) state.recentLoading else state.loading || state.revalidating
        LaunchedEffect(busy) { if (!busy) pulled = false }
        PullToRefreshBox(
            isRefreshing = pulled && busy,
            onRefresh = {
                pulled = true
                if (state.home) viewModel.loadRecent() else viewModel.refresh()
            },
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
        ) {
            // Cached folder shown while the fresh listing arrives: a thin bar, no spinner.
            if (state.revalidating && !inSearch) {
                LinearProgressIndicator(
                    Modifier
                        .fillMaxWidth()
                        .height(2.dp)
                        .zIndex(1f),
                )
            }
            // One fade per place (home, a folder, a category, search); state changes within a
            // place (loading, empty, revalidating) swap without animation so nothing flickers.
            val place = when {
                inSearch -> "search"
                state.home -> "home"
                else -> state.currentUri
            }
            AnimatedContent(
                targetState = place,
                transitionSpec = { fadeIn(tween(220)) togetherWith fadeOut(tween(160)) },
                label = "content",
            ) { shownPlace -> when {
                shownPlace != place -> Box(Modifier.fillMaxSize()) // outgoing frame: fade on empty surface
                state.home && !inSearch -> HomeScreen(
                    state = state,
                    viewModel = viewModel,
                    onSearch = { openSearch() },
                    onOpenSettings = onOpenSettings,
                    onOpenFile = { openFile(it) },
                    onOpenMyFiles = { viewModel.openMyFiles() },
                    onOpenRecent = { viewModel.openCategory(Category.RECENT) },
                    onOpenCategory = { viewModel.openCategory(it) },
                    onOpenOffline = { favoritesOpen = true },
                    onOpenTrash = { viewModel.openCategory(Category.TRASH) },
                    onFileMore = { sheetTarget = it },
                    onBackUpNow = { viewModel.backUpNow(context) },
                    onRetryFailedBackups = { viewModel.retryFailedBackups(context) },
                    onOpenFolder = { viewModel.openFolder(it) },
                )
                inSearch -> SearchResults(
                    state = state,
                    viewModel = viewModel,
                    listState = listState,
                    openedFrom = searchOpenedFrom,
                    actionsFor = { file ->
                        FileActions(
                            onOpen = {
                                if (file.isFolder) {
                                    closeSearch()
                                    viewModel.navigateTo(file)
                                } else {
                                    openFile(file)
                                }
                            },
                            onLongPress = {},
                            onMore = { sheetTarget = file },
                        )
                    },
                )
                state.loading && state.files.isEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
                state.error != null -> EmptyState(
                    icon = Icons.Outlined.FolderOpen,
                    title = "Couldn't load this folder",
                    detail = state.error,
                    action = "Retry" to { viewModel.refresh() },
                )
                state.files.isEmpty() && state.uploadsHere.isEmpty() -> when (state.category) {
                    null -> EmptyState(
                        icon = Icons.Outlined.FolderOpen,
                        title = "This folder is empty",
                        detail = "Upload files or create a folder with the + button",
                    )
                    Category.TRASH -> EmptyState(icon = Icons.Outlined.Delete, title = "Trash is empty", detail = "Deleted items stay here for 7 days")
                    Category.RECENT -> EmptyState(icon = Icons.Outlined.History, title = "Nothing recent", detail = "Files you upload or change show up here")
                    Category.IMAGES -> EmptyState(icon = Icons.Outlined.Image, title = "No images yet")
                    Category.VIDEOS -> EmptyState(icon = Icons.Outlined.Videocam, title = "No videos yet")
                    Category.AUDIO -> EmptyState(icon = Icons.Outlined.MusicNote, title = "No audio files yet")
                    Category.DOCUMENTS -> EmptyState(icon = Icons.Outlined.Description, title = "No documents yet")
                }
                state.effectiveMode == ViewMode.GRID -> FileGrid(state, viewModel, gridState, ::actionsFor)
                else -> FileList(state, viewModel, listState, ::actionsFor)
            } }
        }
    }

    pendingUpload?.let { pending ->
        UploadConflictDialog(
            pending = pending,
            onResolve = { r ->
                pendingUpload = null
                UploadWorker.enqueue(context, r.uris, pending.parentUri, r.names, r.overwrite)
            },
            onDismiss = { pendingUpload = null },
        )
    }

    var lastPreview by remember { mutableStateOf(preview) }
    if (preview != null) lastPreview = preview
    AnimatedVisibility(
        visible = preview != null,
        enter = fadeIn(tween(220)) + scaleIn(tween(260), initialScale = 0.94f),
        exit = fadeOut(tween(180)) + scaleOut(tween(200), targetScale = 0.96f),
    ) {
      lastPreview?.let { (files, index) ->
        PreviewScreen(
            files = files,
            startIndex = index,
            viewModel = viewModel,
            onClose = { preview = null },
            onShare = { shareLink(it) },
            onDownload = { f -> viewModel.fetchForOpen(context, f) { scope.launch { snackbar.showSnackbar("Saved ${it.name}") } } },
            onOpenWith = { openWithSystemApp(it) },
            onDelete = { preview = null; deleteTarget = it },
        )
      }
    }

    if (addSheetOpen) {
        ModalBottomSheet(onDismissRequest = { addSheetOpen = false }) {
            ListItem(
                modifier = Modifier.clickable {
                    addSheetOpen = false
                    uploadLauncher.launch(arrayOf("*/*"))
                },
                headlineContent = { Text("Upload files") },
                supportingContent = { Text("Into ${state.folderName}") },
                leadingContent = { Icon(Icons.Default.UploadFile, contentDescription = null) },
            )
            ListItem(
                modifier = Modifier.clickable {
                    addSheetOpen = false
                    mkdirOpen = true
                },
                headlineContent = { Text("New folder") },
                leadingContent = { Icon(Icons.Default.CreateNewFolder, contentDescription = null) },
            )
            Box(Modifier.height(24.dp))
        }
    }

    detailsTarget?.let { file ->
        DetailsSheet(file = file, thumbUrl = rememberThumbUrl(viewModel, file), onDismiss = { detailsTarget = null })
    }

    shareTarget?.let { file ->
        ShareLinkSheet(
            file = file,
            thumbUrl = rememberThumbUrl(viewModel, file),
            createLink = { pw, exp -> viewModel.shareLink(file, pw, exp) },
            onDismiss = { shareTarget = null },
            onMessage = { msg -> scope.launch { snackbar.showSnackbar(msg) } },
        )
    }

    sheetTarget?.let { file ->
        FileActionSheet(
            file = file,
            thumbUrl = rememberThumbUrl(viewModel, file),
            isFavorite = file.path in state.favoritePaths,
            onDismiss = { sheetTarget = null },
            onOpen = { sheetTarget = null; if (file.isFolder) viewModel.navigateTo(file) else openFile(file) },
            onShare = { sheetTarget = null; shareLink(file) },
            onDownload = {
                sheetTarget = null
                viewModel.fetchForOpen(context, file) { scope.launch { snackbar.showSnackbar("Saved ${it.name}") } }
            },
            onToggleFavorite = { sheetTarget = null; viewModel.toggleFavorite(context, file) },
            onRename = { sheetTarget = null; renameTarget = file },
            onDelete = { sheetTarget = null; deleteTarget = file },
            onSelect = { sheetTarget = null; viewModel.toggleSelected(file) },
            onMove = { sheetTarget = null; movePick = listOf(file.path) to false },
            onCopy = { sheetTarget = null; movePick = listOf(file.path) to true },
            onDetails = { sheetTarget = null; detailsTarget = file },
            inTrash = state.inTrash,
            onRestore = { sheetTarget = null; viewModel.restore(listOf(file.path)) },
            onDeleteForever = { sheetTarget = null; deleteForeverTarget = listOf(file.path) },
            onShowInFolder = if (!state.inTrash && (state.home || state.virtual || inSearch)) ({
                sheetTarget = null
                if (inSearch) closeSearch()
                viewModel.navigateTo(FileObject(type = 1, path = CrUri.parent(file.path)))
            }) else null,
        )
    }

    var lastPick by remember { mutableStateOf(movePick) }
    if (movePick != null) lastPick = movePick
    AnimatedVisibility(
        visible = movePick != null,
        enter = slideInVertically(tween(260)) { it / 4 } + fadeIn(tween(200)),
        exit = slideOutVertically(tween(200)) { it / 4 } + fadeOut(tween(160)),
    ) {
      lastPick?.let { (paths, copy) ->
        FolderPicker(
            title = if (copy) "Copy to" else "Move to",
            confirmLabel = if (copy) "Copy to" else "Move to",
            startUri = state.currentUri,
            excluded = if (copy) emptySet() else paths.toSet(),
            loadFolders = { viewModel.listFolders(it) },
            onCreateFolder = { parent, name -> viewModel.mkdirIn(parent, name) },
            onPick = { dst ->
                movePick = null
                viewModel.moveTo(paths, dst, copy)
            },
            onDismiss = { movePick = null },
        )
      }
    }

    if (mkdirOpen) {
        NameDialog(
            title = "New folder",
            label = "Folder name",
            confirm = "Create",
            onConfirm = {
                viewModel.mkdir(it)
                mkdirOpen = false
            },
            onDismiss = { mkdirOpen = false },
        )
    }

    renameTarget?.let { file ->
        NameDialog(
            title = "Rename",
            label = "New name",
            initial = file.name,
            // Select the stem so typing replaces the name and keeps the extension.
            selectEnd = if (file.isFolder) file.name.length else file.name.lastIndexOf('.').takeIf { it > 0 } ?: file.name.length,
            confirm = "Rename",
            onConfirm = {
                viewModel.rename(file, it)
                renameTarget = null
            },
            onDismiss = { renameTarget = null },
        )
    }

    deleteTarget?.let { file ->
        ConfirmDeleteDialog(
            title = "Delete ${file.name}?",
            onConfirm = {
                viewModel.delete(file)
                deleteTarget = null
            },
            onDismiss = { deleteTarget = null },
        )
    }

    deleteForeverTarget?.let { paths ->
        val n = paths.size
        AlertDialog(
            onDismissRequest = { deleteForeverTarget = null },
            title = { Text("Delete $n item${if (n == 1) "" else "s"} forever?") },
            text = { Text("This can't be undone.") },
            confirmButton = {
                TextButton(onClick = { viewModel.deleteForever(paths); deleteForeverTarget = null }) {
                    Text("Delete forever", color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = { TextButton(onClick = { deleteForeverTarget = null }) { Text("Cancel") } },
        )
    }

    if (deleteSelectedOpen) {
        val n = state.selected.size
        ConfirmDeleteDialog(
            title = "Delete $n item${if (n == 1) "" else "s"}?",
            onConfirm = {
                viewModel.deleteSelected()
                deleteSelectedOpen = false
            },
            onDismiss = { deleteSelectedOpen = false },
        )
    }

    AnimatedVisibility(
        visible = favoritesOpen,
        enter = slideInHorizontally(tween(260)) { it / 3 } + fadeIn(tween(200)),
        exit = slideOutHorizontally(tween(200)) { it / 3 } + fadeOut(tween(160)),
    ) {
        OfflineScreen(
            favorites = state.favorites,
            onBack = { favoritesOpen = false },
            onOpen = { entry -> openWithSystem(context, File(entry.localFile)) },
            onRefresh = { entry -> viewModel.refreshFavorite(context, entry) },
            onRemove = { entry -> viewModel.removeFavorite(entry) },
        )
    }
}

// ---- helpers --------------------------------------------------------------

/**
 * True while the user scrolls away from the top (content moving up), so the
 * FAB gets out of the way like in Gmail and Files; false again on any scroll
 * back or at rest near the top.
 */
@Composable
private fun rememberScrollingDown(listState: LazyListState, gridState: androidx.compose.foundation.lazy.grid.LazyGridState): Boolean {
    var down by remember { mutableStateOf(false) }
    LaunchedEffect(listState, gridState) {
        var lastIndex = 0
        var lastOffset = 0
        snapshotFlow {
            val l = listState.layoutInfo.totalItemsCount > 0
            if (l) listState.firstVisibleItemIndex to listState.firstVisibleItemScrollOffset
            else gridState.firstVisibleItemIndex to gridState.firstVisibleItemScrollOffset
        }.collect { (index, offset) ->
            val movingDown = index > lastIndex || (index == lastIndex && offset > lastOffset + 4)
            val movingUp = index < lastIndex || (index == lastIndex && offset < lastOffset - 4)
            if (movingDown) down = true else if (movingUp || (index == 0 && offset == 0)) down = false
            lastIndex = index
            lastOffset = offset
        }
    }
    return down
}

private fun openWithSystem(context: Context, local: File) {
    val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", local)
    val intent = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(uri, context.contentResolver.getType(uri) ?: "*/*")
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    try {
        context.startActivity(intent)
    } catch (_: ActivityNotFoundException) {
        // No handler; the file stays in cache.
    }
}
