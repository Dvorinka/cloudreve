package org.cloudreve.android.ui.preview

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import org.cloudreve.android.api.FileObject
import org.cloudreve.android.ui.files.FileKind
import org.cloudreve.android.ui.files.FilesViewModel
import org.cloudreve.android.ui.files.subtitleFor

/** Which viewer to use; anything else is handed to the system. */
enum class PreviewKind { IMAGE, VIDEO, AUDIO, PDF, TEXT }

fun previewKindOf(file: FileObject): PreviewKind? = when (FileKind.of(file)) {
    FileKind.IMAGE -> if (file.name.substringAfterLast('.', "").lowercase() in RASTER) PreviewKind.IMAGE else null
    FileKind.VIDEO -> PreviewKind.VIDEO
    FileKind.AUDIO -> PreviewKind.AUDIO
    FileKind.PDF -> PreviewKind.PDF
    FileKind.DOCUMENT, FileKind.CODE, FileKind.SPREADSHEET ->
        if (file.name.substringAfterLast('.', "").lowercase() in PLAIN_TEXT && file.size <= TEXT_LIMIT) PreviewKind.TEXT else null
    else -> null
}

private val RASTER = setOf("jpg", "jpeg", "png", "gif", "webp", "bmp", "heic", "heif", "avif")
private val PLAIN_TEXT = setOf(
    "txt", "md", "markdown", "csv", "tsv", "json", "xml", "yaml", "yml", "toml", "ini", "cfg", "conf", "log",
    "kt", "kts", "java", "rs", "go", "py", "js", "ts", "tsx", "jsx", "c", "h", "cpp", "hpp", "cs", "swift", "rb",
    "php", "sh", "zsh", "fish", "html", "htm", "css", "scss", "sql", "gradle", "lock", "tex",
)
private const val TEXT_LIMIT = 2L * 1024 * 1024

/**
 * Full-screen viewer over the files of the current folder that share the
 * tapped file's media group. Swipe between them; tap to toggle the chrome.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PreviewScreen(
    files: List<FileObject>,
    startIndex: Int,
    viewModel: FilesViewModel,
    onClose: () -> Unit,
    onShare: (FileObject) -> Unit,
    onDownload: (FileObject) -> Unit,
    onOpenWith: (FileObject) -> Unit,
    onDelete: (FileObject) -> Unit,
) {
    val pager = rememberPagerState(initialPage = startIndex.coerceIn(0, files.lastIndex)) { files.size }
    var chromeVisible by remember { mutableStateOf(true) }
    var menuOpen by remember { mutableStateOf(false) }
    val current = files[pager.currentPage]
    val dark = previewKindOf(current).let { it == PreviewKind.IMAGE || it == PreviewKind.VIDEO }

    BackHandler(onBack = onClose)

    // Surface (not Box) so LocalContentColor matches the background; the
    // viewer sits outside the Scaffold and would otherwise inherit black text.
    Surface(
        modifier = Modifier.fillMaxSize(),
        color = if (dark) Color.Black else MaterialTheme.colorScheme.surface,
        contentColor = if (dark) Color.White else MaterialTheme.colorScheme.onSurface,
    ) {
      Box(Modifier.fillMaxSize()) {
        HorizontalPager(state = pager, beyondViewportPageCount = 1, modifier = Modifier.fillMaxSize()) { page ->
            PreviewPage(
                file = files[page],
                viewModel = viewModel,
                onTap = { chromeVisible = !chromeVisible },
                onOpenWith = { onOpenWith(files[page]) },
                onDismiss = onClose,
            )
        }

        AnimatedVisibility(visible = chromeVisible, enter = fadeIn(), exit = fadeOut()) {
            TopAppBar(
                title = {
                    Column {
                        Text(current.name, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(
                            buildString {
                                append(subtitleFor(current.size, current.updatedAt, false))
                                if (files.size > 1) append("  •  ${pager.currentPage + 1} of ${files.size}")
                            },
                            style = MaterialTheme.typography.labelMedium,
                            color = if (dark) Color.White.copy(alpha = 0.7f) else MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onClose) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") }
                },
                actions = {
                    IconButton(onClick = { onShare(current) }) { Icon(Icons.Default.Link, contentDescription = "Copy share link") }
                    Box {
                        IconButton(onClick = { menuOpen = true }) { Icon(Icons.Default.MoreVert, contentDescription = "More") }
                        DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                            DropdownMenuItem(
                                text = { Text("Open with another app") },
                                leadingIcon = { Icon(Icons.AutoMirrored.Filled.OpenInNew, null) },
                                onClick = { menuOpen = false; onOpenWith(current) },
                            )
                            DropdownMenuItem(
                                text = { Text("Download") },
                                leadingIcon = { Icon(Icons.Default.Download, null) },
                                onClick = { menuOpen = false; onDownload(current) },
                            )
                            DropdownMenuItem(
                                text = { Text("Delete") },
                                leadingIcon = { Icon(Icons.Default.Delete, null) },
                                onClick = { menuOpen = false; onDelete(current) },
                            )
                        }
                    }
                },
                colors = if (dark) TopAppBarDefaults.topAppBarColors(
                    containerColor = Color.Black.copy(alpha = 0.55f),
                    titleContentColor = Color.White,
                    navigationIconContentColor = Color.White,
                    actionIconContentColor = Color.White,
                ) else TopAppBarDefaults.topAppBarColors(),
            )
        }
      }
    }
}

/** Space the floating top bar occupies: status bar inset plus the 64 dp bar, with a little air. */
@Composable
internal fun chromeTopPadding(): androidx.compose.ui.unit.Dp =
    WindowInsets.statusBars.asPaddingValues().calculateTopPadding() + 64.dp + 8.dp

@Composable
private fun PreviewPage(
    file: FileObject,
    viewModel: FilesViewModel,
    onTap: () -> Unit,
    onOpenWith: () -> Unit,
    onDismiss: () -> Unit,
) {
    when (previewKindOf(file)) {
        PreviewKind.IMAGE -> ImagePreview(file, viewModel, onTap, onDismiss)
        PreviewKind.VIDEO, PreviewKind.AUDIO -> MediaPreview(file, viewModel, onTap)
        PreviewKind.PDF -> PdfPreview(file, viewModel, onTap)
        PreviewKind.TEXT -> TextPreview(file, viewModel)
        null -> NoPreview(file, onOpenWith)
    }
}

@Composable
private fun NoPreview(file: FileObject, onOpenWith: () -> Unit) {
    val kind = FileKind.of(file)
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.padding(32.dp)) {
            Icon(kind.icon, contentDescription = null, tint = kind.tint, modifier = Modifier.size(72.dp))
            Text("No preview for this file type", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 16.dp))
            Button(onClick = onOpenWith, modifier = Modifier.padding(top = 16.dp)) { Text("Open with another app") }
        }
    }
}

/** Centered progress used by the loaders below. */
@Composable
internal fun LoadingOverlay(progress: Float?, modifier: Modifier = Modifier) {
    Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        if (progress != null) CircularProgressIndicator(progress = { progress }) else CircularProgressIndicator()
    }
}

/** Load a file's local copy, reporting progress; null until ready. */
@Composable
internal fun rememberLocalCopy(file: FileObject, viewModel: FilesViewModel): Pair<java.io.File?, Float?> {
    val context = androidx.compose.ui.platform.LocalContext.current
    var local by remember(file.id) { mutableStateOf<java.io.File?>(null) }
    var progress by remember(file.id) { mutableStateOf<Float?>(null) }
    LaunchedEffect(file.id) {
        runCatching { viewModel.localCopy(context, file) { progress = it } }
            .onSuccess { local = it }
    }
    return local to progress
}

@Composable
internal fun FullWidthError(message: String) {
    Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) {
        Text(message, color = MaterialTheme.colorScheme.error)
    }
}
