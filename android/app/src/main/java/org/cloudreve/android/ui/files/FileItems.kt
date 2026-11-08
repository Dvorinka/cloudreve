package org.cloudreve.android.ui.files

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
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
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.PlayCircle
import androidx.compose.material.icons.outlined.CheckBoxOutlineBlank
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.platform.LocalContext
import coil.compose.SubcomposeAsyncImage
import coil.request.ImageRequest
import org.cloudreve.android.api.FileObject

/** Gestures a row or tile responds to. [onMore] is null for rows without a menu (search hits). */
data class FileActions(
    val onOpen: () -> Unit,
    val onLongPress: () -> Unit,
    val onMore: (() -> Unit)? = null,
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
    /** Show a progress ring over the tile (determinate when a fraction is known). */
    downloading: Boolean = false,
    downloadProgress: Float? = null,
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
                model = ImageRequest.Builder(LocalContext.current).data(thumbUrl).crossfade(180).build(),
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
                loading = { KindIcon(kind, iconSize) },
                error = { KindIcon(kind, iconSize) },
            )
        } else {
            KindIcon(kind, iconSize)
        }
        if (downloading) {
            Box(
                Modifier
                    .fillMaxSize()
                    .background(MaterialTheme.colorScheme.scrim.copy(alpha = 0.45f)),
                contentAlignment = Alignment.Center,
            ) {
                val ring = Modifier.size(iconSize * 1.2f)
                if (downloadProgress != null) {
                    CircularProgressIndicator(progress = { downloadProgress }, modifier = ring, strokeWidth = 3.dp, color = Color.White)
                } else {
                    CircularProgressIndicator(modifier = ring, strokeWidth = 3.dp, color = Color.White)
                }
            }
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
    actions: FileActions,
    downloading: Boolean = false,
    downloadProgress: Float? = null,
    subtitle: String = subtitleFor(file.size, file.updatedAt, file.isFolder),
) {
    val shape = RoundedCornerShape(16.dp)
    val background by animateColorAsState(
        if (selected) MaterialTheme.colorScheme.secondaryContainer else Color.Transparent,
        animationSpec = tween(160), label = "rowBg",
    )
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
        FileThumb(file, thumbUrl, size = 48.dp, downloading = downloading, downloadProgress = downloadProgress)
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
            FileMenuButton(actions)
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
    actions: FileActions,
    downloading: Boolean = false,
    downloadProgress: Float? = null,
    /** Photo-gallery look: edge-to-edge thumbnail, no caption, play badge on videos. */
    gallery: Boolean = false,
) {
    val shape = RoundedCornerShape(if (gallery) 6.dp else 16.dp)
    val background = if (selected) MaterialTheme.colorScheme.secondaryContainer else Color.Transparent
    Column(
        Modifier
            .clip(shape)
            .background(background)
            .combinedClickable(onClick = actions.onOpen, onLongClick = actions.onLongPress)
            .padding(if (gallery) 0.dp else 6.dp),
    ) {
        Box(Modifier.fillMaxWidth().aspectRatio(1f)) {
            FileThumb(
                file, thumbUrl, size = null, modifier = Modifier.fillMaxSize(), corner = if (gallery) 6.dp else 14.dp, iconSize = 44.dp,
                downloading = downloading, downloadProgress = downloadProgress,
            )
            if (FileKind.of(file) == FileKind.VIDEO) {
                Icon(
                    Icons.Default.PlayCircle,
                    contentDescription = "Video",
                    tint = Color.White.copy(alpha = 0.9f),
                    modifier = Modifier
                        .align(if (gallery) Alignment.Center else Alignment.BottomStart)
                        .padding(6.dp)
                        .size(if (gallery) 36.dp else 22.dp),
                )
            }
            // Menu and selection mark sit on the tile so the caption keeps its full width.
            if (selecting) {
                SelectionMark(selected, Modifier.align(Alignment.TopEnd).padding(6.dp))
            } else if (!gallery) {
                Box(
                    Modifier
                        .align(Alignment.TopEnd)
                        .padding(4.dp)
                        .clip(RoundedCornerShape(50))
                        .background(MaterialTheme.colorScheme.surface.copy(alpha = 0.75f)),
                ) {
                    FileMenuButton(actions, compact = true)
                }
            }
        }
        if (!gallery) Column(Modifier.fillMaxWidth().padding(top = 6.dp, start = 4.dp, end = 4.dp)) {
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
private fun FileMenuButton(actions: FileActions, compact: Boolean = false) {
    val onMore = actions.onMore ?: return
    IconButton(onClick = onMore, modifier = if (compact) Modifier.size(36.dp) else Modifier) {
        Icon(Icons.Default.MoreVert, contentDescription = "More", tint = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
