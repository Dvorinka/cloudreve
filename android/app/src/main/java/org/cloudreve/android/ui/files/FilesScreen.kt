package org.cloudreve.android.ui.files

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.DriveFileMove
import androidx.compose.material.icons.filled.DeleteForever
import androidx.compose.material.icons.filled.FileCopy
import androidx.compose.material.icons.filled.RestoreFromTrash
import androidx.compose.material.icons.automirrored.filled.Sort
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowDownward
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Checklist
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.CreateNewFolder
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.GridView
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.SelectAll
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.UploadFile
import androidx.compose.material.icons.filled.ViewList
import androidx.compose.material.icons.outlined.FolderOpen
import androidx.compose.material.icons.outlined.SearchOff
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.zIndex
import androidx.core.content.FileProvider
import kotlinx.coroutines.launch
import org.cloudreve.android.api.FileObject
import org.cloudreve.android.data.FavoriteEntry
import org.cloudreve.android.data.SortBy
import org.cloudreve.android.data.ViewMode
import org.cloudreve.android.util.CrUri
import org.cloudreve.android.work.UploadWorker
import org.cloudreve.android.ui.files.transfers.PendingUpload
import org.cloudreve.android.ui.files.transfers.UploadConflictDialog
import org.cloudreve.android.ui.files.transfers.UploadsCard
import org.cloudreve.android.ui.preview.PreviewScreen
import org.cloudreve.android.ui.preview.previewKindOf
import java.io.File

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
        state.snackbar?.let {
            snackbar.showSnackbar(it)
            viewModel.consumeSnackbar()
        }
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
    var homeMenuOpen by remember { mutableStateOf(false) }

    Scaffold(
        topBar = {
            when {
                state.selecting -> SelectionTopBar(
                    count = state.selected.size,
                    inTrash = state.inTrash,
                    onClose = { viewModel.clearSelection() },
                    onSelectAll = { viewModel.selectAll() },
                    onMove = { movePick = state.selected.toList() to false },
                    onCopy = { movePick = state.selected.toList() to true },
                    onDelete = { if (state.inTrash) deleteForeverTarget = state.selected.toList() else deleteSelectedOpen = true },
                    onRestore = { viewModel.restore(state.selected.toList()) },
                )
                inSearch -> SearchTopBar(
                    text = state.searchQuery.orEmpty(),
                    onTextChange = { viewModel.search(it) },
                    onClose = { closeSearch() },
                    focus = searchFocus,
                )
                state.home -> Unit
                else -> FolderTopBar(
                    title = state.folderName,
                    subtitle = when {
                        state.inTrash -> "Items are kept for 7 days"
                        state.virtual -> "Across all folders"
                        CrUri.isRoot(state.currentUri) -> null
                        else -> pathLabel(CrUri.parent(state.currentUri))
                    },
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
            }
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
            when {
                state.home && !inSearch -> Box {
                    HomeScreen(
                        state = state,
                        viewModel = viewModel,
                        onSearch = { openSearch() },
                        onMenu = { homeMenuOpen = true },
                        onOpenFile = { openFile(it) },
                        onOpenMyFiles = { viewModel.openMyFiles() },
                        onOpenRecent = { viewModel.openCategory(Category.RECENT) },
                        onOpenCategory = { viewModel.openCategory(it) },
                        onOpenOffline = { favoritesOpen = true },
                        onOpenTrash = { viewModel.openCategory(Category.TRASH) },
                        onFileMore = { sheetTarget = it },
                    )
                    DropdownMenu(expanded = homeMenuOpen, onDismissRequest = { homeMenuOpen = false }, modifier = Modifier.padding(start = 16.dp)) {
                        DropdownMenuItem(
                            text = { Text("Settings") },
                            leadingIcon = { Icon(Icons.Default.Settings, null) },
                            onClick = { homeMenuOpen = false; onOpenSettings() },
                        )
                    }
                }
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
                state.files.isEmpty() && state.uploadsHere.isEmpty() -> EmptyState(
                    icon = Icons.Outlined.FolderOpen,
                    title = "This folder is empty",
                    detail = "Upload files or create a folder with the + button",
                )
                state.effectiveMode == ViewMode.GRID -> FileGrid(state, viewModel, gridState, ::actionsFor)
                else -> FileList(state, viewModel, listState, ::actionsFor)
            }
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

    preview?.let { (files, index) ->
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

    movePick?.let { (paths, copy) ->
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

    if (favoritesOpen) {
        FavoritesDialog(
            favorites = state.favorites,
            onDismiss = { favoritesOpen = false },
            onOpen = { entry -> openWithSystem(context, File(entry.localFile)) },
            onRefresh = { entry -> viewModel.refreshFavorite(context, entry) },
            onRemove = { entry -> viewModel.removeFavorite(entry) },
        )
    }
}

// ---- top bars -------------------------------------------------------------

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun FolderTopBar(
    title: String,
    subtitle: String?,
    showBack: Boolean,
    showSort: Boolean,
    viewMode: ViewMode,
    sort: org.cloudreve.android.data.SortOrder,
    hasFavorites: Boolean,
    onBack: () -> Unit,
    onSearch: () -> Unit,
    onToggleView: () -> Unit,
    onSort: (SortBy) -> Unit,
    onSelect: () -> Unit,
    onRefresh: () -> Unit,
    onFavorites: () -> Unit,
    onSettings: () -> Unit,
) {
    var menuOpen by remember { mutableStateOf(false) }
    var sortOpen by remember { mutableStateOf(false) }
    TopAppBar(
        title = {
            Column {
                Text(title, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (subtitle != null) {
                    Text(
                        subtitle,
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        },
        navigationIcon = {
            if (showBack) {
                IconButton(onClick = onBack) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Up")
                }
            }
        },
        actions = {
            IconButton(onClick = onSearch) {
                Icon(Icons.Default.Search, contentDescription = "Search")
            }
            IconButton(onClick = onToggleView) {
                Icon(
                    if (viewMode == ViewMode.LIST) Icons.Default.GridView else Icons.Default.ViewList,
                    contentDescription = if (viewMode == ViewMode.LIST) "Grid view" else "List view",
                )
            }
            Box {
                IconButton(onClick = { menuOpen = true }) {
                    Icon(Icons.Default.MoreVert, contentDescription = "More options")
                }
                DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                    if (showSort) DropdownMenuItem(
                        text = { Text("Sort by") },
                        leadingIcon = { Icon(Icons.AutoMirrored.Filled.Sort, null) },
                        onClick = { menuOpen = false; sortOpen = true },
                    )
                    DropdownMenuItem(
                        text = { Text("Select") },
                        leadingIcon = { Icon(Icons.Default.Checklist, null) },
                        onClick = { menuOpen = false; onSelect() },
                    )
                    DropdownMenuItem(
                        text = { Text("Refresh") },
                        leadingIcon = { Icon(Icons.Default.Refresh, null) },
                        onClick = { menuOpen = false; onRefresh() },
                    )
                    HorizontalDivider()
                    DropdownMenuItem(
                        text = { Text("Offline files") },
                        leadingIcon = {
                            Icon(
                                Icons.Default.Star, null,
                                tint = if (hasFavorites) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        },
                        onClick = { menuOpen = false; onFavorites() },
                    )
                    DropdownMenuItem(
                        text = { Text("Settings") },
                        leadingIcon = { Icon(Icons.Default.Settings, null) },
                        onClick = { menuOpen = false; onSettings() },
                    )
                }
                DropdownMenu(expanded = sortOpen, onDismissRequest = { sortOpen = false }) {
                    SortBy.entries.forEach { by ->
                        val active = sort.by == by
                        DropdownMenuItem(
                            text = {
                                Text(
                                    when (by) {
                                        SortBy.NAME -> "Name"
                                        SortBy.SIZE -> "Size"
                                        SortBy.UPDATED -> "Date modified"
                                    },
                                )
                            },
                            leadingIcon = {
                                if (active) Icon(Icons.Default.Check, null, tint = MaterialTheme.colorScheme.primary)
                                else Box(Modifier.size(24.dp))
                            },
                            trailingIcon = {
                                if (active) Icon(
                                    if (sort.ascending) Icons.Default.ArrowUpward else Icons.Default.ArrowDownward,
                                    contentDescription = if (sort.ascending) "Ascending" else "Descending",
                                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                    modifier = Modifier.size(18.dp),
                                )
                            },
                            onClick = { sortOpen = false; onSort(by) },
                        )
                    }
                }
            }
        },
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SelectionTopBar(
    count: Int,
    inTrash: Boolean,
    onClose: () -> Unit,
    onSelectAll: () -> Unit,
    onMove: () -> Unit,
    onCopy: () -> Unit,
    onDelete: () -> Unit,
    onRestore: () -> Unit,
) {
    TopAppBar(
        title = { Text("$count selected") },
        navigationIcon = {
            IconButton(onClick = onClose) {
                Icon(Icons.Default.Close, contentDescription = "Clear selection")
            }
        },
        actions = {
            IconButton(onClick = onSelectAll) {
                Icon(Icons.Default.SelectAll, contentDescription = "Select all")
            }
            if (inTrash) {
                IconButton(onClick = onRestore) {
                    Icon(Icons.Default.RestoreFromTrash, contentDescription = "Restore")
                }
                IconButton(onClick = onDelete) {
                    Icon(Icons.Default.DeleteForever, contentDescription = "Delete forever")
                }
            } else {
                IconButton(onClick = onMove) {
                    Icon(Icons.AutoMirrored.Filled.DriveFileMove, contentDescription = "Move to")
                }
                IconButton(onClick = onCopy) {
                    Icon(Icons.Default.FileCopy, contentDescription = "Copy to")
                }
                IconButton(onClick = onDelete) {
                    Icon(Icons.Default.Delete, contentDescription = "Delete")
                }
            }
        },
        colors = TopAppBarDefaults.topAppBarColors(
            containerColor = MaterialTheme.colorScheme.secondaryContainer,
        ),
    )
}

// ---- content --------------------------------------------------------------

@Composable
private fun FileList(
    state: FilesUiState,
    viewModel: FilesViewModel,
    listState: LazyListState,
    actionsFor: (FileObject) -> FileActions,
) {
    LazyColumn(
        state = listState,
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(bottom = 88.dp),
    ) {
        uploadItems(state, viewModel)
        items(state.files, key = { it.id + it.path }) { file ->
            FileListItem(
                file = file,
                thumbUrl = rememberThumbUrl(viewModel, file),
                selecting = state.selecting,
                selected = file.path in state.selected,
                downloadProgress = state.downloading[file.path],
                downloading = file.path in state.downloading,
                actions = actionsFor(file),
                subtitle = if (state.inTrash) {
                    "Deleted ${formatDate(file.updatedAt)} • from ${file.restoreUri?.let { folderLabelOf(FileObject(path = it)) } ?: "unknown"}"
                } else if (state.virtual) {
                    "${subtitleFor(file.size, file.updatedAt, file.isFolder)} • ${folderLabelOf(file)}"
                } else {
                    subtitleFor(file.size, file.updatedAt, file.isFolder)
                },
            )
        }
        if (state.loadingMore) {
            item { LoadingMoreRow() }
        }
    }
}

@Composable
private fun FileGrid(
    state: FilesUiState,
    viewModel: FilesViewModel,
    gridState: androidx.compose.foundation.lazy.grid.LazyGridState,
    actionsFor: (FileObject) -> FileActions,
) {
    val gallery = state.category?.gallery == true
    LazyVerticalGrid(
        columns = GridCells.Adaptive(minSize = if (gallery) 118.dp else 110.dp),
        state = gridState,
        modifier = Modifier.fillMaxSize(),
        contentPadding = if (gallery) PaddingValues(start = 3.dp, end = 3.dp, top = 3.dp, bottom = 88.dp)
        else PaddingValues(start = 10.dp, end = 10.dp, top = 4.dp, bottom = 88.dp),
        horizontalArrangement = Arrangement.spacedBy(if (gallery) 3.dp else 4.dp),
        verticalArrangement = Arrangement.spacedBy(if (gallery) 3.dp else 4.dp),
    ) {
        if (state.uploadsHere.isNotEmpty()) {
            item(span = { GridItemSpan(maxLineSpan) }, key = "uploads") { UploadsCard(state.uploadsHere, viewModel::cancelUpload) }
        }
        items(state.files, key = { it.id + it.path }) { file ->
            FileGridItem(
                file = file,
                thumbUrl = rememberThumbUrl(viewModel, file),
                selecting = state.selecting,
                selected = file.path in state.selected,
                downloadProgress = state.downloading[file.path],
                downloading = file.path in state.downloading,
                actions = actionsFor(file),
                gallery = gallery,
            )
        }
        if (state.loadingMore) {
            item(span = { GridItemSpan(maxLineSpan) }) { LoadingMoreRow() }
        }
    }
}

private fun androidx.compose.foundation.lazy.LazyListScope.uploadItems(state: FilesUiState, viewModel: FilesViewModel) {
    if (state.uploadsHere.isNotEmpty()) {
        item(key = "uploads") { UploadsCard(state.uploadsHere, viewModel::cancelUpload) }
    }
}

@Composable
private fun LoadingMoreRow() {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(12.dp),
        horizontalArrangement = Arrangement.Center,
    ) { CircularProgressIndicator(Modifier.size(28.dp)) }
}

@Composable
private fun EmptyState(
    icon: ImageVector,
    title: String,
    detail: String? = null,
    action: Pair<String, () -> Unit>? = null,
) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.padding(32.dp)) {
            Icon(
                icon,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(64.dp),
            )
            Text(
                title,
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.padding(top = 16.dp),
            )
            if (detail != null) {
                Text(
                    detail,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 4.dp),
                )
            }
            if (action != null) {
                TextButton(onClick = action.second, modifier = Modifier.padding(top = 8.dp)) { Text(action.first) }
            }
        }
    }
}

// ---- dialogs --------------------------------------------------------------

@Composable
private fun FavoritesDialog(
    favorites: List<FavoriteEntry>,
    onDismiss: () -> Unit,
    onOpen: (FavoriteEntry) -> Unit,
    onRefresh: (FavoriteEntry) -> Unit,
    onRemove: (FavoriteEntry) -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Offline files") },
        text = {
            if (favorites.isEmpty()) {
                Text(
                    "Nothing saved for offline use yet. Use a file's menu → Keep offline.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            } else {
                LazyColumn {
                    items(favorites, key = { it.path }) { entry ->
                        ListItem(
                            modifier = Modifier.clickable { onOpen(entry) },
                            headlineContent = { Text(entry.name, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                            supportingContent = {
                                Text(
                                    "${formatSize(entry.size)} • saved " +
                                        java.text.DateFormat.getDateInstance(java.text.DateFormat.SHORT)
                                            .format(java.util.Date(entry.savedAt)),
                                    style = MaterialTheme.typography.labelMedium,
                                )
                            },
                            trailingContent = {
                                Row {
                                    IconButton(onClick = { onRefresh(entry) }) {
                                        Icon(Icons.Default.Refresh, contentDescription = "Re-download")
                                    }
                                    IconButton(onClick = { onRemove(entry) }) {
                                        Icon(Icons.Default.Delete, contentDescription = "Remove", tint = MaterialTheme.colorScheme.error)
                                    }
                                }
                            },
                        )
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("Done") } },
    )
}

@Composable
private fun ConfirmDeleteDialog(title: String, onConfirm: () -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { Text("Items are moved to the trash and can be restored from the web app.") },
        confirmButton = {
            TextButton(onClick = onConfirm) { Text("Delete", color = MaterialTheme.colorScheme.error) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

@Composable
fun NameDialog(
    title: String,
    label: String,
    confirm: String,
    initial: String = "",
    selectEnd: Int = initial.length,
    onConfirm: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    var value by remember {
        mutableStateOf(TextFieldValue(initial, selection = TextRange(0, selectEnd.coerceIn(0, initial.length))))
    }
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            OutlinedTextField(
                value = value,
                onValueChange = { value = it },
                label = { Text(label) },
                singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { if (value.text.isNotBlank()) onConfirm(value.text.trim()) }),
                modifier = Modifier.focusRequester(focus),
            )
        },
        confirmButton = {
            TextButton(onClick = { onConfirm(value.text.trim()) }, enabled = value.text.isNotBlank()) { Text(confirm) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
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

/** Name of the folder a file lives in, "My files" at the root. */
private fun folderLabelOf(file: FileObject): String {
    val parent = CrUri.parent(file.path)
    return if (CrUri.isRoot(parent)) "My files" else CrUri.fileName(parent)
}

private fun pathLabel(uri: String): String {
    val path = uri.removePrefix(CrUri.MY_PREFIX).trim('/')
    return if (path.isEmpty()) "My files" else "My files / " + java.net.URLDecoder.decode(path, "UTF-8").replace("/", " / ")
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
