package org.cloudreve.android.ui.preview

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import org.cloudreve.android.api.FileObject
import org.cloudreve.android.ui.files.FilesViewModel

/**
 * Streams video or audio straight from the signed content URL with
 * ExoPlayer; nothing is downloaded up front. Audio shows the default
 * controls over an artwork-less surface, which is enough for a quick listen.
 */
@androidx.annotation.OptIn(UnstableApi::class)
@Composable
fun MediaPreview(file: FileObject, viewModel: FilesViewModel, onTap: () -> Unit) {
    val context = LocalContext.current
    val url by produceState<String?>(initialValue = null, file.id) {
        value = runCatching { viewModel.previewUrl(file) }.getOrNull()
    }
    val player = remember(file.id) { ExoPlayer.Builder(context).build() }

    DisposableEffect(player) { onDispose { player.release() } }

    LaunchedEffect(url) {
        val u = url ?: return@LaunchedEffect
        player.setMediaItem(
            MediaItem.Builder()
                .setUri(u)
                .setMediaMetadata(MediaMetadata.Builder().setTitle(file.name).build())
                .build()
        )
        player.prepare()
        player.playWhenReady = true
    }

    Box(Modifier.fillMaxSize()) {
        if (url == null) {
            LoadingOverlay(null)
        } else {
            AndroidView(
                factory = { ctx ->
                    PlayerView(ctx).apply {
                        this.player = player
                        setShowBuffering(PlayerView.SHOW_BUFFERING_WHEN_PLAYING)
                        setControllerVisibilityListener(
                            PlayerView.ControllerVisibilityListener { onTap() }
                        )
                    }
                },
                modifier = Modifier.fillMaxSize(),
            )
        }
    }
}
