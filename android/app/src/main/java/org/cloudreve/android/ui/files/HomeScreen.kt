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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import org.cloudreve.android.api.FileObject
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
    onMenu: () -> Unit,
    onOpenFile: (FileObject) -> Unit,
    onOpenMyFiles: () -> Unit,
    onOpenRecent: () -> Unit,
    onOpenCategory: (Category) -> Unit,
    onOpenOffline: () -> Unit,
    onFileMore: (FileObject) -> Unit,
) {
    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(bottom = 96.dp),
    ) {
        SearchField(onSearch, onMenu)

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
        Surface(
            onClick = onOpenOffline,
            shape = RoundedCornerShape(20.dp),
            color = MaterialTheme.colorScheme.surfaceContainer,
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp),
        ) {
            Row(Modifier.padding(horizontal = 20.dp, vertical = 18.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    Icons.Default.Star, contentDescription = null,
                    tint = if (state.favorites.isEmpty()) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(26.dp),
                )
                Column(Modifier.padding(start = 20.dp)) {
                    Text("Offline files", style = MaterialTheme.typography.titleMedium)
                    Text(
                        if (state.favorites.isEmpty()) "Nothing saved yet"
                        else "${state.favorites.size} file${if (state.favorites.size == 1) "" else "s"} available offline",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

@Composable
private fun SearchField(onSearch: () -> Unit, onMenu: () -> Unit) {
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
            IconButton(onClick = onMenu) {
                Icon(Icons.Default.MoreVert, contentDescription = "Menu", tint = MaterialTheme.colorScheme.onSurfaceVariant)
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
            CrUri.fileName(CrUri.parent(file.path)).ifEmpty { "My files" }.let { if (it == "my") "My files" else it },
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(start = 4.dp, end = 4.dp),
        )
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
