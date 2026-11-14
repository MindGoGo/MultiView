package local.multiview.android

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Handler
import android.os.Looper

/**
 * App 自己處理音訊焦點（R152）。每個 ExoPlayer 都不處理音訊焦點（否則多格不能同時出聲），
 * 所以由這裡替整個 App 要一次：其他 App 開始播放（來電、音樂）時通知 App 全部暫停，結束後恢復。
 */
class AudioFocus(
    context: Context,
    /** 失去焦點。transient：暫時的（例如來電、導航語音），之後會還回來。 */
    private val onLoss: (transient: Boolean) -> Unit,
    private val onGain: () -> Unit,
) {
    private val manager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager

    /** 目前有沒有拿著焦點（或暫時失去、等著拿回來）。 */
    var held = false
        private set

    private val listener = AudioManager.OnAudioFocusChangeListener { change ->
        when (change) {
            AudioManager.AUDIOFOCUS_GAIN -> onGain()
            AudioManager.AUDIOFOCUS_LOSS -> {
                held = false
                onLoss(false)
            }
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> onLoss(true)
            // 可以降低音量繼續播的情況（通知音效）：系統會自動降低音量，不用暫停
            else -> {}
        }
    }

    private val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
        .setAudioAttributes(
            AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_MOVIE)
                .build(),
        )
        .setOnAudioFocusChangeListener(listener, Handler(Looper.getMainLooper()))
        .build()

    fun request() {
        if (held) return
        held = manager.requestAudioFocus(request) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
    }

    /** 放掉焦點，或是焦點被 App 自己的網頁格子拿走了（不算被打斷）。 */
    fun abandon() {
        if (!held) return
        held = false
        manager.abandonAudioFocusRequest(request)
    }
}
