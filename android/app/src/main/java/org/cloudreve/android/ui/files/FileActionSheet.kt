package org.cloudreve.android.ui.files

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.DriveFileMove
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.FileCopy
import androidx.compose.material.icons.filled.Checklist
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.DriveFileRenameOutline
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.filled.OfflinePin
import androidx.compose.material.icons.outlined.OfflinePin
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import org.cloudreve.android.api.FileObject

/**
 * Per-file actions as a bottom sheet (the Files app pattern): the file's
 * identity on top so the user knows what they are acting on, then the
 * actions in order of how often they are reached for.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FileActionSheet(
    file: FileObject,
    thumbUrl: String?,
    isFavorite: Boolean,
    onDismiss: () -> Unit,
    onOpen: () -> Unit,
    onShare: () -> Unit,
    onDownload: () -> Unit,
    onToggleFavorite: () -> Unit,
    onRename: () -> Unit,
    onDelete: () -> Unit,
    onSelect: () -> Unit,
    onMove: () -> Unit,
    onCopy: () -> Unit,
) {
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            FileThumb(file, thumbUrl, size = 56.dp)
            Column(Modifier.padding(start = 16.dp)) {
                Text(
                    file.name,
                    style = MaterialTheme.typography.titleMedium,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    subtitleFor(file.size, file.updatedAt, file.isFolder).ifEmpty { if (file.isFolder) "Folder" else "" },
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        HorizontalDivider(Modifier.padding(vertical = 8.dp))

        SheetAction(Icons.AutoMirrored.Filled.OpenInNew, if (file.isFolder) "Open folder" else "Open", onOpen)
        SheetAction(Icons.Default.Link, "Copy share link", onShare)
        if (!file.isFolder) {
            SheetAction(Icons.Default.Download, "Download", onDownload)
            SheetAction(
                if (isFavorite) Icons.Default.OfflinePin else Icons.Outlined.OfflinePin,
                if (isFavorite) "Remove offline copy" else "Keep offline",
                onToggleFavorite,
            )
        }
        SheetAction(Icons.Default.Checklist, "Select", onSelect)
        SheetAction(Icons.AutoMirrored.Filled.DriveFileMove, "Move to", onMove)
        SheetAction(Icons.Default.FileCopy, "Copy to", onCopy)
        SheetAction(Icons.Default.DriveFileRenameOutline, "Rename", onRename)
        SheetAction(Icons.Default.Delete, "Delete", onDelete, tint = MaterialTheme.colorScheme.error)
        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun SheetAction(
    icon: ImageVector,
    label: String,
    onClick: () -> Unit,
    tint: Color = MaterialTheme.colorScheme.onSurfaceVariant,
) {
    ListItem(
        modifier = Modifier.clickable(onClick = onClick),
        headlineContent = { Text(label, color = if (tint == MaterialTheme.colorScheme.error) tint else Color.Unspecified) },
        leadingContent = { Icon(icon, contentDescription = null, tint = tint) },
        colors = ListItemDefaults.colors(containerColor = Color.Transparent),
    )
}
