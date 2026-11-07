package org.cloudreve.android.ui.files

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.DriveFileRenameOutline
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.StarBorder
import androidx.compose.material.icons.outlined.CheckBoxOutlineBlank
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import coil.compose.SubcomposeAsyncImage
import org.cloudreve.android.api.FileObject

/** What a row or tile can do; null callbacks hide the matching menu entry. */
data class FileActions(
    val onOpen: () -> Unit,
    val onLongPress: () -> Unit,
    val onRename: (() -> Unit)? = null,
    val onDelete: (() -> Unit)? = null,
    val onShare: (() -> Unit)? = null,
    val onDownload: (() -> Unit)? = null,
    val onToggleFavorite: (() -> Unit)? = null,
)

@Composable
fun rememberThumbUrl(viewModel: FilesViewModel, file: FileObject): String? {
    val url by produceState<String?>(initialValue = null, file.id) {
        value = viewModel.thumbUrl(file)
    }
    return url
}

/**
 * Thumbnail when the server has one, otherwise the file-kind icon on a soft
 * tinted tile. Same shape in both cases so list rows stay aligned.
 */
@Composable
fun FileThumb(
    file: FileObject,
    thumbUrl: String?,
    /** Fixed square size, or null to fill the parent (icon then sized by [iconSize]). */
    size: Dp?,
    modifier: Modifier = Modifier,
    corner: Dp = 12.dp,
    iconSize: Dp = (size ?: 48.dp) / 2,
) {
    val kind = FileKind.of(file)
    val shape = RoundedCornerShape(corner)
    Box(
        modifier
            .then(if (size != null) Modifier.size(size) else Modifier)
            .clip(shape)
            .background(kind.tint.copy(alpha = 0.18f)),
        contentAlignment = Alignment.Center,
    ) {
        if (thumbUrl != null) {
            SubcomposeAsyncImage(
                model = thumbUrl,
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
                loading = { KindIcon(kind, iconSize) },
                error = { KindIcon(kind, iconSize) },
            )
        } else {
            KindIcon(kind, iconSize)
        }
    }
}

@Composable
private fun KindIcon(kind: FileKind, size: Dp) {
    Icon(kind.icon, contentDescription = null, tint = kind.tint, modifier = Modifier.size(size))
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun FileListItem(
    file: FileObject,
    thumbUrl: String?,
    selecting: Boolean,
    selected: Boolean,
    isFavorite: Boolean,
    actions: FileActions,
    subtitle: String = subtitleFor(file.size, file.updatedAt, file.isFolder),
) {
    val shape = RoundedCornerShape(16.dp)
    val background = if (selected) MaterialTheme.colorScheme.secondaryContainer else Color.Transparent
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 8.dp, vertical = 2.dp)
            .clip(shape)
            .background(background)
            .combinedClickable(onClick = actions.onOpen, onLongClick = actions.onLongPress)
            .padding(start = 12.dp, top = 8.dp, bottom = 8.dp, end = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        FileThumb(file, thumbUrl, size = 48.dp)
        Column(
            Modifier
                .weight(1f)
                .padding(horizontal = 16.dp),
        ) {
            Text(
                file.name,
                style = MaterialTheme.typography.bodyLarge,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (subtitle.isNotEmpty()) {
                Text(
                    subtitle,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        if (selecting) {
            SelectionMark(selected, Modifier.padding(12.dp))
        } else {
            FileMenuButton(file, isFavorite, actions)
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun FileGridItem(
    file: FileObject,
    thumbUrl: String?,
    selecting: Boolean,
    selected: Boolean,
    isFavorite: Boolean,
    actions: FileActions,
) {
    val shape = RoundedCornerShape(16.dp)
    val background = if (selected) MaterialTheme.colorScheme.secondaryContainer else Color.Transparent
    Column(
        Modifier
            .clip(shape)
            .background(background)
            .combinedClickable(onClick = actions.onOpen, onLongClick = actions.onLongPress)
            .padding(6.dp),
    ) {
        Box(Modifier.fillMaxWidth().aspectRatio(1f)) {
            FileThumb(file, thumbUrl, size = null, modifier = Modifier.fillMaxSize(), corner = 14.dp, iconSize = 44.dp)
            // Menu and selection mark sit on the tile so the caption keeps its full width.
            if (selecting) {
                SelectionMark(selected, Modifier.align(Alignment.TopEnd).padding(6.dp))
            } else {
                Box(
                    Modifier
                        .align(Alignment.TopEnd)
                        .padding(4.dp)
                        .clip(RoundedCornerShape(50))
                        .background(MaterialTheme.colorScheme.surface.copy(alpha = 0.75f)),
                ) {
                    FileMenuButton(file, isFavorite, actions, compact = true)
                }
            }
        }
        Column(Modifier.fillMaxWidth().padding(top = 6.dp, start = 4.dp, end = 4.dp)) {
            Text(
                file.name,
                style = MaterialTheme.typography.bodyMedium,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            val subtitle = subtitleFor(file.size, file.updatedAt, file.isFolder)
            if (subtitle.isNotEmpty()) {
                Text(
                    subtitle,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

@Composable
private fun SelectionMark(selected: Boolean, modifier: Modifier = Modifier) {
    if (selected) {
        Icon(
            Icons.Default.CheckCircle,
            contentDescription = "Selected",
            tint = MaterialTheme.colorScheme.primary,
            modifier = modifier.size(24.dp),
        )
    } else {
        Icon(
            Icons.Outlined.CheckBoxOutlineBlank,
            contentDescription = "Not selected",
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = modifier.size(24.dp),
        )
    }
}

@Composable
private fun FileMenuButton(
    file: FileObject,
    isFavorite: Boolean,
    actions: FileActions,
    compact: Boolean = false,
) {
    var open by remember { mutableStateOf(false) }
    Box {
        IconButton(onClick = { open = true }, modifier = if (compact) Modifier.size(36.dp) else Modifier) {
            Icon(Icons.Default.MoreVert, contentDescription = "More", tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            if (!file.isFolder) {
                actions.onDownload?.let {
                    DropdownMenuItem(
                        text = { Text("Download") },
                        leadingIcon = { Icon(Icons.Default.Download, null) },
                        onClick = { open = false; it() },
                    )
                }
                actions.onToggleFavorite?.let {
                    DropdownMenuItem(
                        text = { Text(if (isFavorite) "Remove offline copy" else "Keep offline") },
                        leadingIcon = { Icon(if (isFavorite) Icons.Default.Star else Icons.Default.StarBorder, null) },
                        onClick = { open = false; it() },
                    )
                }
            }
            actions.onShare?.let {
                DropdownMenuItem(
                    text = { Text("Share link") },
                    leadingIcon = { Icon(Icons.Default.Share, null) },
                    onClick = { open = false; it() },
                )
            }
            actions.onRename?.let {
                DropdownMenuItem(
                    text = { Text("Rename") },
                    leadingIcon = { Icon(Icons.Default.DriveFileRenameOutline, null) },
                    onClick = { open = false; it() },
                )
            }
            actions.onDelete?.let {
                DropdownMenuItem(
                    text = { Text("Delete") },
                    leadingIcon = { Icon(Icons.Default.Delete, null) },
                    onClick = { open = false; it() },
                )
            }
        }
    }
}
