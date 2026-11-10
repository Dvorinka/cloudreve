package org.cloudreve.android.ui.files

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.DriveFileMove
import androidx.compose.material.icons.filled.DeleteForever
import androidx.compose.material.icons.filled.FileCopy
import androidx.compose.material.icons.filled.RestoreFromTrash
import androidx.compose.material.icons.automirrored.filled.Sort
import androidx.compose.material.icons.filled.ArrowDownward
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Checklist
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.GridView
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.SelectAll
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.automirrored.filled.ViewList
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import org.cloudreve.android.data.SortBy
import org.cloudreve.android.data.ViewMode
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue

// ---- top bars -------------------------------------------------------------

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun FolderTopBar(
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
                    if (viewMode == ViewMode.LIST) Icons.Default.GridView else Icons.AutoMirrored.Filled.ViewList,
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
internal fun SelectionTopBar(
    count: Int,
    total: Int,
    inTrash: Boolean,
    onClose: () -> Unit,
    onSelectAll: () -> Unit,
    onMove: () -> Unit,
    onCopy: () -> Unit,
    onDelete: () -> Unit,
    onRestore: () -> Unit,
) {
    TopAppBar(
        title = { Text("$count of $total selected") },
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
