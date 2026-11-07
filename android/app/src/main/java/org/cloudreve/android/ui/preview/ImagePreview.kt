package org.cloudreve.android.ui.preview

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.rememberTransformableState
import androidx.compose.foundation.gestures.transformable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import coil.compose.SubcomposeAsyncImage
import coil.request.ImageRequest
import org.cloudreve.android.api.FileObject
import org.cloudreve.android.ui.files.FilesViewModel
import org.cloudreve.android.ui.files.rememberThumbUrl

/**
 * Full-resolution image with pinch zoom, drag when zoomed, double-tap to
 * toggle 1x/2.5x. The thumbnail (usually already cached by the list) is
 * shown while the original downloads, so the viewer never opens blank.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun ImagePreview(file: FileObject, viewModel: FilesViewModel, onTap: () -> Unit) {
    val thumb = rememberThumbUrl(viewModel, file)
    val fullUrl by produceState<String?>(initialValue = null, file.id) {
        value = runCatching { viewModel.previewUrl(file) }.getOrNull()
    }

    var scale by remember(file.id) { mutableFloatStateOf(1f) }
    var offset by remember(file.id) { mutableStateOf(Offset.Zero) }

    Box(
        Modifier
            .fillMaxSize()
            .pointerInput(file.id) {
                detectTapGestures(
                    onTap = { onTap() },
                    onDoubleTap = {
                        if (scale > 1f) {
                            scale = 1f; offset = Offset.Zero
                        } else {
                            scale = 2.5f
                        }
                    },
                )
            }
            // Pan only while zoomed in, so at 1x a horizontal drag reaches the pager.
            .transformable(
                state = rememberTransformableState { zoom, pan, _ ->
                    val next = (scale * zoom).coerceIn(1f, 6f)
                    scale = next
                    offset = if (next == 1f) Offset.Zero else offset + pan
                },
                canPan = { scale > 1f },
            ),
        contentAlignment = Alignment.Center,
    ) {
        val model = fullUrl ?: thumb
        if (model != null) {
            SubcomposeAsyncImage(
                model = ImageRequest.Builder(androidx.compose.ui.platform.LocalContext.current)
                    .data(model)
                    .placeholderMemoryCacheKey(thumb)
                    .crossfade(true)
                    .build(),
                contentDescription = file.name,
                contentScale = ContentScale.Fit,
                modifier = Modifier
                    .fillMaxSize()
                    .graphicsLayer {
                        scaleX = scale
                        scaleY = scale
                        translationX = offset.x
                        translationY = offset.y
                    },
                loading = { LoadingOverlay(null) },
                error = { FullWidthError("Couldn't load image") },
            )
        } else {
            LoadingOverlay(null)
        }
    }
}
