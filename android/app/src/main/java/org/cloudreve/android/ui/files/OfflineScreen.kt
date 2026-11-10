package org.cloudreve.android.ui.files

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.outlined.OfflinePin
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.SubcomposeAsyncImage
import org.cloudreve.android.api.FileObject
import org.cloudreve.android.data.FavoriteEntry
import java.io.File
import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneId

/**
 * Files kept on the device. Same row shape as a folder listing, but the
 * thumbnail comes from the local copy and the menu is about the copy:
 * re-download, or remove it from the device.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun OfflineScreen(
    favorites: List<FavoriteEntry>,
    onBack: () -> Unit,
    onOpen: (FavoriteEntry) -> Unit,
    onRefresh: (FavoriteEntry) -> Unit,
    onRemove: (FavoriteEntry) -> Unit,
) {
    BackHandler(onBack = onBack)
    Surface(Modifier.fillMaxSize()) {
        Scaffold(
            topBar = {
                TopAppBar(
                    title = {
                        Column {
                            Text("Offline files")
                            Text(
                                if (favorites.isEmpty()) "Nothing saved yet"
                                else "${favorites.size} file${if (favorites.size == 1) "" else "s"} • ${formatSize(favorites.sumOf { it.size })} on this device",
                                style = MaterialTheme.typography.labelMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    },
                    navigationIcon = {
                        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") }
                    },
                )
            },
        ) { padding ->
            if (favorites.isEmpty()) {
                Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.padding(32.dp)) {
                        Icon(Icons.Outlined.OfflinePin, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(64.dp))
                        Text("No offline files", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 16.dp))
                        Text(
                            "Open a file's menu and choose Keep offline to have it here without a connection.",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(top = 4.dp),
                        )
                    }
                }
            } else {
                LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(bottom = 24.dp)) {
                    items(favorites, key = { it.path }) { entry ->
                        OfflineRow(entry, { onOpen(entry) }, { onRefresh(entry) }, { onRemove(entry) })
                    }
                }
            }
        }
    }
}

@Composable
private fun OfflineRow(entry: FavoriteEntry, onOpen: () -> Unit, onRefresh: () -> Unit, onRemove: () -> Unit) {
    var menuOpen by remember { mutableStateOf(false) }
    val file = FileObject(name = entry.name, path = entry.path, size = entry.size, updatedAt = entry.remoteUpdatedAt)
    val kind = FileKind.of(file)
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 8.dp, vertical = 2.dp)
            .clip(RoundedCornerShape(16.dp))
            .clickable(onClick = onOpen)
            .padding(start = 12.dp, top = 8.dp, bottom = 8.dp, end = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier
                .size(48.dp)
                .clip(RoundedCornerShape(12.dp))
                .background(kind.tint.copy(alpha = 0.18f)),
            contentAlignment = Alignment.Center,
        ) {
            if (kind == FileKind.IMAGE || kind == FileKind.VIDEO) {
                SubcomposeAsyncImage(
                    model = File(entry.localFile),
                    contentDescription = null,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxSize(),
                    error = { Icon(kind.icon, null, tint = kind.tint, modifier = Modifier.size(24.dp)) },
                    loading = { Icon(kind.icon, null, tint = kind.tint, modifier = Modifier.size(24.dp)) },
                )
            } else {
                Icon(kind.icon, contentDescription = null, tint = kind.tint, modifier = Modifier.size(24.dp))
            }
        }
        Column(Modifier.weight(1f).padding(horizontal = 16.dp)) {
            Text(entry.name, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(
                "${formatSize(entry.size)} • saved ${formatDate(OffsetDateTime.ofInstant(Instant.ofEpochMilli(entry.savedAt), ZoneId.systemDefault()).toString())}",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        Box {
            IconButton(onClick = { menuOpen = true }) {
                Icon(Icons.Default.MoreVert, contentDescription = "More", tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                DropdownMenuItem(
                    text = { Text("Update copy") },
                    leadingIcon = { Icon(Icons.Default.Refresh, null) },
                    onClick = { menuOpen = false; onRefresh() },
                )
                DropdownMenuItem(
                    text = { Text("Remove from device") },
                    leadingIcon = { Icon(Icons.Default.Delete, null, tint = MaterialTheme.colorScheme.error) },
                    onClick = { menuOpen = false; onRemove() },
                )
            }
        }
    }
}
