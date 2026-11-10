package org.cloudreve.android.ui.preview

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import org.cloudreve.android.api.FileObject
import org.cloudreve.android.ui.files.FilesViewModel

/**
 * Streams video or audio straight from the signed content URL with
 * ExoPlayer; nothing is downloaded up front. Audio shows the default
 * controls over an artwork-less surface, which is enough for a quick listen.
 * A failed signed URL or an ExoPlayer error used to leave a silent black
 * player — both surface via [FullWidthError] so the user can act on it.
 */
@androidx.annotation.OptIn(UnstableApi::class)
@Composable
fun MediaPreview(file: FileObject, viewModel: FilesViewModel, onTap: () -> Unit) {
    val context = LocalContext.current
    val url by produceState<Result<String>?>(initialValue = null, file.id) {
        value = runCatching { viewModel.previewUrl(file) }
    }
    var playerError by remember(file.id) { mutableStateOf<String?>(null) }
    val player = remember(file.id) {
        ExoPlayer.Builder(context).build().also { p ->
            p.addListener(object : Player.Listener {
                override fun onPlayerError(error: androidx.media3.common.PlaybackException) {
                    playerError = error.errorCodeName
                }
            })
        }
    }

    DisposableEffect(player) { onDispose { player.release() } }

    LaunchedEffect(url) {
        val u = url?.getOrNull() ?: return@LaunchedEffect
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
        val failure = playerError ?: url?.exceptionOrNull()?.message
        when {
            failure != null -> FullWidthError("Couldn't load the preview ($failure)")
            url == null -> LoadingOverlay(null)
            else -> AndroidView(
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
