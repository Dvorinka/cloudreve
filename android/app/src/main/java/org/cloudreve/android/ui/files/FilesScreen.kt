package org.cloudreve.android.ui.files

import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import kotlinx.coroutines.launch
import org.cloudreve.android.api.FileObject
import org.cloudreve.android.data.FavoriteEntry
import org.cloudreve.android.data.SortBy
import org.cloudreve.android.data.ViewMode
import org.cloudreve.android.util.CrUri
import org.cloudreve.android.work.UploadWorker
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
    var renameTarget by remember { mutableStateOf<FileObject?>(null) }
    var deleteTarget by remember { mutableStateOf<FileObject?>(null) }
    var deleteSelectedOpen by remember { mutableStateOf(false) }
    var searchOpen by remember { mutableStateOf(false) }
    var searchText by remember { mutableStateOf("") }
    var favoritesOpen by remember { mutableStateOf(false) }
    val searchFocus = remember { FocusRequester() }

    val inSearch = state.searchQuery != null

    val uploadLauncher = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        if (uris.isNotEmpty()) {
            UploadWorker.enqueue(context, uris, state.currentUri)
            scope.launch { snackbar.showSnackbar("Uploading ${uris.size} file${if (uris.size > 1) "s" else ""}") }
        }
    }

    LaunchedEffect(Unit) { viewModel.refresh() }

    LaunchedEffect(state.snackbar) {
        state.snackbar?.let {
            snackbar.showSnackbar(it)
            viewModel.consumeSnackbar()
        }
    }

    // Infinite scroll: load the next page when the end comes into view.
    LaunchedEffect(listState, gridState, state.view.mode) {
        val lastVisible = if (state.view.mode == ViewMode.GRID) {
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

    LaunchedEffect(searchOpen) {
        if (searchOpen) searchFocus.requestFocus()
    }

    fun closeSearch() {
        viewModel.clearSearch()
        searchOpen = false
        searchText = ""
    }

    fun openFile(file: FileObject) {
        scope.launch {
            runCatching { viewModel.downloadToCache(context, file) }
                .onSuccess { local -> openWithSystem(context, local) }
                .onFailure { snackbar.showSnackbar(it.message ?: "Download failed") }
        }
    }

    fun shareLink(file: FileObject) {
        scope.launch {
            runCatching { viewModel.shareLink(file) }
                .onSuccess { link ->
                    val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                    cm.setPrimaryClip(ClipData.newPlainText("share", link))
                    snackbar.showSnackbar("Share link copied")
                }
                .onFailure { snackbar.showSnackbar(it.message ?: "Share failed") }
        }
    }

    fun actionsFor(file: FileObject): FileActions = FileActions(
        onOpen = {
            when {
                state.selecting -> viewModel.toggleSelected(file)
                file.isFolder -> viewModel.navigateTo(file)
                else -> openFile(file)
            }
        },
        onLongPress = { viewModel.toggleSelected(file) },
        onRename = { renameTarget = file },
        onDelete = { deleteTarget = file },
        onShare = { shareLink(file) },
        onDownload = {
            scope.launch {
                runCatching { viewModel.downloadToCache(context, file) }
                    .onSuccess { snackbar.showSnackbar("Saved ${it.name}") }
                    .onFailure { snackbar.showSnackbar(it.message ?: "Download failed") }
            }
        },
        onToggleFavorite = { viewModel.toggleFavorite(context, file) },
    )

    BackHandler(enabled = state.selecting || inSearch || searchOpen || !CrUri.isRoot(state.currentUri)) {
        when {
            state.selecting -> viewModel.clearSelection()
            inSearch || searchOpen -> closeSearch()
            else -> viewModel.navigateUp()
        }
    }

    Scaffold(
        topBar = {
            when {
                state.selecting -> SelectionTopBar(
                    count = state.selected.size,
                    onClose = { viewModel.clearSelection() },
                    onSelectAll = { viewModel.selectAll() },
                    onDelete = { deleteSelectedOpen = true },
                )
                inSearch || searchOpen -> SearchTopBar(
                    text = searchText,
                    onTextChange = { searchText = it },
                    onSearch = { viewModel.search(searchText) },
                    onClose = { closeSearch() },
                    focus = searchFocus,
                )
                else -> FolderTopBar(
                    title = state.folderName,
                    subtitle = if (CrUri.isRoot(state.currentUri)) null else pathLabel(CrUri.parent(state.currentUri)),
                    showBack = !CrUri.isRoot(state.currentUri),
                    viewMode = state.view.mode,
                    sort = state.view.sort,
                    hasFavorites = state.favorites.isNotEmpty(),
                    onBack = { viewModel.navigateUp() },
                    onSearch = { searchOpen = true },
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
            if (!state.selecting && !inSearch && !searchOpen) {
                FloatingActionButton(onClick = { addSheetOpen = true }) {
                    Icon(Icons.Default.Add, contentDescription = "Add")
                }
            }
        },
        snackbarHost = { SnackbarHost(snackbar) },
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = state.loading,
            onRefresh = { viewModel.refresh() },
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
        ) {
            when {
                inSearch -> SearchResults(
                    state = state,
                    viewModel = viewModel,
                    listState = listState,
                    onOpenFolder = { file ->
                        closeSearch()
                        viewModel.navigateTo(file)
                    },
                    onOpenFile = { openFile(it) },
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
                state.files.isEmpty() -> EmptyState(
                    icon = Icons.Outlined.FolderOpen,
                    title = "This folder is empty",
                    detail = "Upload files or create a folder with the + button",
                )
                state.view.mode == ViewMode.GRID -> FileGrid(state, viewModel, gridState, ::actionsFor)
                else -> FileList(state, viewModel, listState, ::actionsFor)
            }
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

    if (mkdirOpen) {
        TextFieldDialog(
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
        TextFieldDialog(
            title = "Rename",
            label = "New name",
            initial = file.name,
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
                    DropdownMenuItem(
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
    onClose: () -> Unit,
    onSelectAll: () -> Unit,
    onDelete: () -> Unit,
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
            IconButton(onClick = onDelete) {
                Icon(Icons.Default.Delete, contentDescription = "Delete")
            }
        },
        colors = TopAppBarDefaults.topAppBarColors(
            containerColor = MaterialTheme.colorScheme.secondaryContainer,
        ),
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SearchTopBar(
    text: String,
    onTextChange: (String) -> Unit,
    onSearch: () -> Unit,
    onClose: () -> Unit,
    focus: FocusRequester,
) {
    TopAppBar(
        title = {
            OutlinedTextField(
                value = text,
                onValueChange = onTextChange,
                modifier = Modifier
                    .fillMaxWidth()
                    .focusRequester(focus),
                placeholder = { Text("Search files") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                keyboardActions = KeyboardActions(onSearch = { onSearch() }),
            )
        },
        navigationIcon = {
            IconButton(onClick = onClose) {
                Icon(Icons.Default.Close, contentDescription = "Close search")
            }
        },
        actions = {
            IconButton(onClick = onSearch) {
                Icon(Icons.Default.Search, contentDescription = "Search")
            }
        },
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
        items(state.files, key = { it.id + it.path }) { file ->
            FileListItem(
                file = file,
                thumbUrl = rememberThumbUrl(viewModel, file),
                selecting = state.selecting,
                selected = file.path in state.selected,
                isFavorite = file.path in state.favoritePaths,
                actions = actionsFor(file),
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
    LazyVerticalGrid(
        columns = GridCells.Adaptive(minSize = 110.dp),
        state = gridState,
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = 10.dp, end = 10.dp, top = 4.dp, bottom = 88.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        items(state.files, key = { it.id + it.path }) { file ->
            FileGridItem(
                file = file,
                thumbUrl = rememberThumbUrl(viewModel, file),
                selecting = state.selecting,
                selected = file.path in state.selected,
                isFavorite = file.path in state.favoritePaths,
                actions = actionsFor(file),
            )
        }
        if (state.loadingMore) {
            item(span = { GridItemSpan(maxLineSpan) }) { LoadingMoreRow() }
        }
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

@Composable
private fun SearchResults(
    state: FilesUiState,
    viewModel: FilesViewModel,
    listState: LazyListState,
    onOpenFolder: (FileObject) -> Unit,
    onOpenFile: (FileObject) -> Unit,
) {
    when {
        state.searchLoading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator()
        }
        state.searchError != null -> EmptyState(
            icon = Icons.Outlined.SearchOff,
            title = "Search failed",
            detail = state.searchError,
            action = "Retry" to { viewModel.search(state.searchQuery ?: "") },
        )
        state.searchResults.isEmpty() -> EmptyState(
            icon = Icons.Outlined.SearchOff,
            title = "No results for \"${state.searchQuery}\"",
        )
        else -> LazyColumn(state = listState, modifier = Modifier.fillMaxSize()) {
            items(state.searchResults, key = { it.file.id + it.file.path }) { hit ->
                val file = hit.file
                val where = pathLabel(CrUri.parent(file.path))
                val snippet = hit.content.trim()
                FileListItem(
                    file = file,
                    thumbUrl = rememberThumbUrl(viewModel, file),
                    selecting = false,
                    selected = false,
                    isFavorite = file.path in state.favoritePaths,
                    subtitle = if (snippet.isEmpty()) where else "$where • $snippet",
                    actions = FileActions(
                        onOpen = { if (file.isFolder) onOpenFolder(file) else onOpenFile(file) },
                        onLongPress = {},
                    ),
                )
            }
            if (state.searchLoadingMore) {
                item { LoadingMoreRow() }
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
private fun TextFieldDialog(
    title: String,
    label: String,
    confirm: String,
    initial: String = "",
    onConfirm: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    var value by remember { mutableStateOf(initial) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            OutlinedTextField(
                value = value,
                onValueChange = { value = it },
                label = { Text(label) },
                singleLine = true,
            )
        },
        confirmButton = { TextButton(onClick = { onConfirm(value) }) { Text(confirm) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

// ---- helpers --------------------------------------------------------------

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
