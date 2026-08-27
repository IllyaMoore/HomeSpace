package io.github.illyamoore.homespace.ui.components

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.MediaItem
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.PlayerView

/**
 * Plays a file straight off the NAS rather than downloading it first — which is
 * the whole point of a media share. The daemon supports Range requests, so
 * ExoPlayer seeks without pulling the file down.
 *
 * The URL already carries the token as a query parameter, because a media
 * player fetching its own bytes is not going through the app's OkHttp
 * interceptor chain.
 */
@OptIn(UnstableApi::class)
@Composable
fun MediaPreview(url: String, isAudio: Boolean, modifier: Modifier = Modifier) {
    val context = LocalContext.current

    val player = remember(url) {
        val dataSourceFactory = DefaultHttpDataSource.Factory()
            .setAllowCrossProtocolRedirects(true)
            .setConnectTimeoutMs(15_000)
            .setReadTimeoutMs(30_000)

        ExoPlayer.Builder(context)
            .setMediaSourceFactory(DefaultMediaSourceFactory(dataSourceFactory))
            .build()
            .apply {
                setMediaItem(MediaItem.fromUri(url))
                prepare()
                playWhenReady = false
            }
    }

    // Releasing matters more than usual here: an un-released ExoPlayer keeps a
    // socket to the NAS and a wake lock alive after the screen is gone.
    DisposableEffect(player) {
        onDispose { player.release() }
    }

    AndroidView(
        factory = { ctx ->
            PlayerView(ctx).apply {
                this.player = player
                useController = true
                // Audio has no video surface; without this the view is a black
                // rectangle with controls floating in it.
                controllerShowTimeoutMs = if (isAudio) 0 else 3_000
                controllerAutoShow = true
            }
        },
        onRelease = { it.player = null },
        modifier = modifier,
    )
}
