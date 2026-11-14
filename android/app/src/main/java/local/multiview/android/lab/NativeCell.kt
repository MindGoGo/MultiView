package local.multiview.android.lab

import androidx.annotation.OptIn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.foundation.layout.fillMaxSize
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import kotlinx.coroutines.delay

/**
 * 原生播放器的一格（R146）。每個 ExoPlayer 都不處理音訊焦點，
 * 否則一格開始出聲時系統會讓其他格暫停（Android 的音訊焦點規則）。
 */
@OptIn(UnstableApi::class)
@Composable
fun NativeCell(url: String, index: Int, controller: LabController) {
    val context = LocalContext.current
    var muted by remember { mutableStateOf(false) }
    var volume by remember { mutableFloatStateOf(1f) }
    var status by remember { mutableStateOf("讀取中") }
    var failure by remember { mutableStateOf<String?>(null) }

    val player = remember {
        ExoPlayer.Builder(context).build().apply {
            setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(C.USAGE_MEDIA)
                    .setContentType(C.AUDIO_CONTENT_TYPE_MOVIE)
                    .build(),
                /* handleAudioFocus = */ false,
            )
            setMediaItem(MediaItem.fromUri(url))
            playWhenReady = true
            prepare()
        }
    }

    DisposableEffect(player) {
        val listener = object : Player.Listener {
            override fun onPlayerError(error: PlaybackException) {
                failure = "錯誤：${error.errorCodeName}"
            }
        }
        val cell = object : LabCell {
            override fun play() {
                if (player.playbackState == Player.STATE_IDLE) player.prepare()
                player.play()
            }

            override fun pause() = player.pause()
        }
        player.addListener(listener)
        controller.register(cell)
        onDispose {
            controller.unregister(cell)
            player.removeListener(listener)
            player.release()
        }
    }

    LaunchedEffect(muted, volume) {
        player.volume = if (muted) 0f else volume
    }

    // 每秒更新一次狀態：播放狀態、解析度、掉格數（R146 AC2 的效能紀錄）
    LaunchedEffect(player) {
        while (true) {
            status = failure ?: describe(player)
            delay(1000)
        }
    }

    AndroidView(
        modifier = Modifier.fillMaxSize(),
        factory = { viewContext ->
            PlayerView(viewContext).apply {
                useController = false
                resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
                this.player = player
            }
        },
        onRelease = { it.player = null },
    )
    CellOverlay(
        index = index,
        status = status,
        muted = muted,
        volume = volume,
        onMutedChange = { muted = it },
        onVolumeChange = { volume = it },
    )
}

@OptIn(UnstableApi::class)
private fun describe(player: ExoPlayer): String {
    val state = when {
        player.isPlaying -> "播放中"
        // 要播放但被系統擋下（例如音訊輸出不能用），顯示原因
        player.playWhenReady && player.playbackSuppressionReason != Player.PLAYBACK_SUPPRESSION_REASON_NONE ->
            "被擋下（${player.playbackSuppressionReason}）"
        player.playbackState == Player.STATE_BUFFERING -> "緩衝中"
        player.playbackState == Player.STATE_ENDED -> "已結束"
        player.playbackState == Player.STATE_IDLE -> "停止"
        else -> "暫停"
    }
    val format = player.videoFormat
    val size = if (format != null && format.height > 0) " ${format.width}×${format.height}" else ""
    val dropped = player.videoDecoderCounters?.droppedBufferCount ?: 0
    return "$state$size 掉格 $dropped"
}
