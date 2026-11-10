package org.cloudreve.android.ui.files

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import org.cloudreve.android.api.FileObject
import org.cloudreve.android.ui.files.transfers.PhotoBackupCard
import org.cloudreve.android.util.CrUri

/**
 * Landing page modelled on the system Files app: a search field, a Recent
 * strip of the newest files anywhere in the drive, category tiles, then
 * the storage entry (My files) and collections (offline files).
 */
@Composable
fun HomeScreen(
    state: FilesUiState,
    viewModel: FilesViewModel,
    onSearch: () -> Unit,
    onOpenSettings: () -> Unit,
    onOpenFile: (FileObject) -> Unit,
    onOpenMyFiles: () -> Unit,
    onOpenRecent: () -> Unit,
    onOpenCategory: (Category) -> Unit,
    onOpenOffline: () -> Unit,
    onOpenTrash: () -> Unit,
    onFileMore: (FileObject) -> Unit,
    onBackUpNow: () -> Unit,
    onRetryFailedBackups: () -> Unit,
    onOpenFolder: (String) -> Unit,
) {
    // Home has no top app bar, so the Scaffold gives it no top inset: take the
    // status bar height here or the search field draws under the clock.
    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .statusBarsPadding()
            .padding(bottom = 96.dp),
    ) {
        SearchField(onSearch, onOpenSettings)

        // Background work the user did not start right now still deserves a line.
        if (state.uploads.isNotEmpty() || state.backgroundSyncs.isNotEmpty()) {
            ActivityCard(state, onOpenUploads = onOpenRecent)
        }
        state.backupStats?.let { stats ->
            PhotoBackupCard(
                stats = stats,
                running = state.backupRunning,
                onSyncNow = onBackUpNow,
                onRetryFailed = onRetryFailedBackups,
                onOpenFolder = { onOpenFolder(stats.remoteFolder) },
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
            )
        }

        SectionHeader("Recent", action = if (state.recent.isNotEmpty()) "See all" to onOpenRecent else null)
        when {
            state.recent.isEmpty() && state.recentLoading -> Box(
                Modifier
                    .fillMaxWidth()
                    .height(150.dp),
                contentAlignment = Alignment.Center,
            ) { CircularProgressIndicator(Modifier.size(28.dp)) }
            state.recent.isEmpty() -> Text(
                "Files you upload or change show up here",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 24.dp),
            )
            else -> LazyRow(
                contentPadding = PaddingValues(horizontal = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                items(state.recent, key = { it.id }) { file ->
                    RecentCard(file, rememberThumbUrl(viewModel, file), { onOpenFile(file) }, { onFileMore(file) })
                }
            }
        }

        SectionHeader("Categories")
        Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                CategoryTile(Category.IMAGES, Icons.Default.Image, Modifier.weight(1f)) { onOpenCategory(Category.IMAGES) }
                CategoryTile(Category.VIDEOS, Icons.Default.Videocam, Modifier.weight(1f)) { onOpenCategory(Category.VIDEOS) }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                CategoryTile(Category.AUDIO, Icons.Default.MusicNote, Modifier.weight(1f)) { onOpenCategory(Category.AUDIO) }
                CategoryTile(Category.DOCUMENTS, Icons.Default.Description, Modifier.weight(1f)) { onOpenCategory(Category.DOCUMENTS) }
            }
        }

        SectionHeader("Storage")
        Surface(
            onClick = onOpenMyFiles,
            shape = RoundedCornerShape(20.dp),
            color = MaterialTheme.colorScheme.surfaceContainer,
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp),
        ) {
            Row(Modifier.padding(horizontal = 20.dp, vertical = 18.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.Folder, contentDescription = null, tint = FileKind.FOLDER.tint, modifier = Modifier.size(26.dp))
                Column(Modifier.padding(start = 20.dp)) {
                    Text("My files", style = MaterialTheme.typography.titleMedium)
                    Text("Browse all folders", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }

        SectionHeader("Collections")
        Row(Modifier.padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            CollectionTile(
                "Offline files",
                if (state.favorites.isEmpty()) "Nothing saved yet" else "${state.favorites.size} saved",
                Icons.Default.Star,
                Modifier.weight(1f),
                onOpenOffline,
            )
            CollectionTile("Trash", "Kept for 7 days", Icons.Default.Delete, Modifier.weight(1f), onOpenTrash)
        }
    }
}

@Composable
private fun ActivityCard(state: FilesUiState, onOpenUploads: () -> Unit) {
    Surface(
        shape = RoundedCornerShape(20.dp),
        color = MaterialTheme.colorScheme.surfaceContainerHigh,
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 4.dp),
    ) {
        Column(Modifier.padding(horizontal = 20.dp, vertical = 14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            state.uploads.forEach { u ->
                ActivityRow(
                    title = if (u.total > 1) "Uploading ${u.index + 1} of ${u.total}" else "Uploading",
                    detail = u.name.ifEmpty { "Waiting…" } + " • to " + CrUri.displayName(u.parentUri),
                    fraction = u.fraction,
                )
            }
            state.backgroundSyncs.forEach { b ->
                ActivityRow(
                    title = "${b.kind.label} • ${b.index + 1} of ${b.total}",
                    detail = b.name,
                    fraction = b.fraction,
                )
            }
        }
    }
}

@Composable
private fun ActivityRow(title: String, detail: String, fraction: Float?) {
    Column {
        Text(title, style = MaterialTheme.typography.bodyLarge)
        Text(detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (fraction != null) {
            LinearProgressIndicator(progress = { fraction }, modifier = Modifier.fillMaxWidth().padding(top = 8.dp))
        } else {
            LinearProgressIndicator(modifier = Modifier.fillMaxWidth().padding(top = 8.dp))
        }
    }
}

@Composable
private fun SearchField(onSearch: () -> Unit, onOpenSettings: () -> Unit) {
    var menuOpen by remember { mutableStateOf(false) }
    Surface(
        onClick = onSearch,
        shape = RoundedCornerShape(28.dp),
        color = MaterialTheme.colorScheme.surfaceContainerHigh,
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 12.dp)
            .height(56.dp),
    ) {
        Row(Modifier.fillMaxSize(), verticalAlignment = Alignment.CenterVertically) {
            // The menu lives inside this Box so it drops down from the button it belongs to.
            Box {
                IconButton(onClick = { menuOpen = true }) {
                    Icon(Icons.Default.MoreVert, contentDescription = "Menu", tint = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                    DropdownMenuItem(
                        text = { Text("Settings") },
                        leadingIcon = { Icon(Icons.Default.Settings, contentDescription = null) },
                        onClick = { menuOpen = false; onOpenSettings() },
                    )
                }
            }
            Text(
                "Search files",
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.weight(1f),
            )
            Icon(
                Icons.Default.Search, contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(end = 16.dp),
            )
        }
    }
}

@Composable
private fun SectionHeader(title: String, action: Pair<String, () -> Unit>? = null) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(start = 20.dp, end = 12.dp, top = 20.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(title, style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
        if (action != null) {
            TextButton(onClick = action.second) { Text(action.first) }
        }
    }
}

@Composable
private fun RecentCard(file: FileObject, thumbUrl: String?, onClick: () -> Unit, onMore: () -> Unit) {
    Column(Modifier.width(132.dp)) {
        Box(
            Modifier
                .size(132.dp)
                .clip(RoundedCornerShape(16.dp))
                .clickable(onClick = onClick),
        ) {
            FileThumb(file, thumbUrl, size = null, modifier = Modifier.fillMaxSize(), corner = 16.dp, iconSize = 44.dp)
            Box(
                Modifier
                    .align(Alignment.TopEnd)
                    .padding(4.dp)
                    .clip(RoundedCornerShape(50))
                    .background(MaterialTheme.colorScheme.surface.copy(alpha = 0.75f)),
            ) {
                IconButton(onClick = onMore, modifier = Modifier.size(32.dp)) {
                    Icon(Icons.Default.MoreVert, contentDescription = "More", modifier = Modifier.size(18.dp))
                }
            }
        }
        Text(
            file.name,
            style = MaterialTheme.typography.bodyMedium,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(top = 6.dp, start = 4.dp, end = 4.dp),
        )
        Text(
            CrUri.parentDisplayName(file.path),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(start = 4.dp, end = 4.dp),
        )
    }
}

@Composable
private fun CollectionTile(title: String, subtitle: String, icon: ImageVector, modifier: Modifier, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(20.dp),
        color = MaterialTheme.colorScheme.surfaceContainer,
        modifier = modifier.height(84.dp),
    ) {
        Row(Modifier.padding(horizontal = 18.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(24.dp))
            Spacer(Modifier.width(16.dp))
            Column {
                Text(title, style = MaterialTheme.typography.titleMedium)
                Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

@Composable
private fun CategoryTile(category: Category, icon: ImageVector, modifier: Modifier, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(20.dp),
        color = MaterialTheme.colorScheme.surfaceContainer,
        modifier = modifier.height(84.dp),
    ) {
        Row(Modifier.padding(horizontal = 18.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(24.dp))
            Spacer(Modifier.width(16.dp))
            Text(category.label, style = MaterialTheme.typography.titleMedium)
        }
    }
}
