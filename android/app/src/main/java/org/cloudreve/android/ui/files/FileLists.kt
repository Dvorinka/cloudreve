package org.cloudreve.android.ui.files

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import org.cloudreve.android.api.FileObject
import org.cloudreve.android.util.CrUri
import org.cloudreve.android.ui.files.transfers.UploadsCard
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.grid.LazyGridState

// ---- content --------------------------------------------------------------

@Composable
@OptIn(ExperimentalFoundationApi::class)
internal fun FileList(
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
        if (state.virtual && !state.inTrash) {
            // Timeline views read by day, like the Files app's category lists.
            state.files.groupBy { dayKey(it.updatedAt) }.forEach { (day, group) ->
                stickyHeader(key = "day-$day") {
                    DayHeader(
                        label = dayGroupLabel(group.first().updatedAt),
                        allSelected = group.all { it.path in state.selected },
                        onToggle = { viewModel.toggleGroup(group) },
                    )
                }
                items(group, key = { it.id + it.path }) { file ->
                    FileListItem(
                        file = file,
                        thumbUrl = rememberThumbUrl(viewModel, file),
                        selecting = state.selecting,
                        selected = file.path in state.selected,
                        downloadProgress = state.downloading[file.path],
                        downloading = file.path in state.downloading,
                        actions = actionsFor(file),
                        subtitle = "${subtitleFor(file.size, file.updatedAt, file.isFolder)} • ${CrUri.parentDisplayName(file.path)}",
                    )
                }
            }
            if (state.loadingMore) item { LoadingMoreRow() }
            return@LazyColumn
        }
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
                    "Deleted ${formatDate(file.updatedAt)} • from ${file.restoreUri?.let { CrUri.displayName(it) } ?: "unknown"}"
                } else if (state.virtual) {
                    "${subtitleFor(file.size, file.updatedAt, file.isFolder)} • ${CrUri.parentDisplayName(file.path)}"
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
internal fun FileGrid(
    state: FilesUiState,
    viewModel: FilesViewModel,
    gridState: LazyGridState,
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

private fun LazyListScope.uploadItems(state: FilesUiState, viewModel: FilesViewModel) {
    if (state.uploadsHere.isNotEmpty()) {
        item(key = "uploads") { UploadsCard(state.uploadsHere, viewModel::cancelUpload) }
    }
}

/** Day separator with a Files-app style select-all circle at the end. */
@Composable
private fun DayHeader(label: String, allSelected: Boolean, onToggle: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surface)
            .padding(start = 20.dp, end = 12.dp, top = 12.dp, bottom = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
        IconButton(onClick = onToggle, modifier = Modifier.size(36.dp)) {
            Icon(
                if (allSelected) Icons.Default.CheckCircle else Icons.Outlined.CheckCircle,
                contentDescription = if (allSelected) "Clear selection for $label" else "Select all from $label",
                tint = if (allSelected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
internal fun LoadingMoreRow() {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(12.dp),
        horizontalArrangement = Arrangement.Center,
    ) { CircularProgressIndicator(Modifier.size(28.dp)) }
}

@Composable
internal fun EmptyState(
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
