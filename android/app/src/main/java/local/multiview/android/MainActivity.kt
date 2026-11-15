package local.multiview.android

import android.content.Context
import android.app.PictureInPictureParams
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ActivityInfo
import android.content.res.Configuration
import android.os.Build
import android.os.Bundle
import android.os.Looper
import android.util.Rational
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.activity.addCallback
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.core.view.WindowCompat
import androidx.lifecycle.Lifecycle
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import local.multiview.android.ui.RootScreen

/** 主畫面（R149）。App 的狀態在 [AppModel]，跟著程序存在；這裡只負責視窗、旋轉、從其他 App 送進來的網址。 */
class MainActivity : ComponentActivity(), AppModel.Host {
    private val model: AppModel get() = (application as MultiViewApplication).model

    override val context: Context get() = this

    override val isPortrait: Boolean
        get() = resources.configuration.orientation == Configuration.ORIENTATION_PORTRAIT

    /** 固定方向（關了自動旋轉也可以轉）；null 是跟著裝置旋轉。 */
    override fun lockOrientation(landscape: Boolean?) {
        requestedOrientation = when (landscape) {
            true -> ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
            false -> ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT
            null -> ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
        }
    }

    /** 回到主畫面時自動進入子母畫面（Android 12 以上由系統處理；之前的版本在 onUserLeaveHint 進入）。 */
    private var autoPictureInPicture = false

    private fun pictureInPictureParams(): PictureInPictureParams {
        val builder = PictureInPictureParams.Builder().setAspectRatio(Rational(16, 9))
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            builder.setAutoEnterEnabled(autoPictureInPicture)
            builder.setSeamlessResizeEnabled(true)
        }
        return builder.build()
    }

    override fun setAutoPictureInPicture(enabled: Boolean) {
        if (autoPictureInPicture == enabled) return
        autoPictureInPicture = enabled
        try {
            setPictureInPictureParams(pictureInPictureParams())
        } catch (_: Exception) {
        }
    }

    override fun enterPictureInPicture(): Boolean = try {
        packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE) &&
            enterPictureInPictureMode(pictureInPictureParams())
    } catch (_: Exception) {
        false
    }

    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        // Android 11 以下沒有自動進入子母畫面，按 Home 鍵時自己進入
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S && autoPictureInPicture) enterPictureInPicture()
    }

    override fun onPictureInPictureModeChanged(isInPictureInPictureMode: Boolean, newConfig: Configuration) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
        if (isInPictureInPictureMode) {
            model.enterPip()
        } else {
            // 回到完整的畫面時 Activity 還在執行中；子母畫面被關掉時 Activity 已經停止
            model.leavePip(resumed = lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED))
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        model.host = this
        hideSystemBars()
        setContent { RootScreen(model) }
        // 返回鍵：先讓 App 處理（關面板、網頁回上一頁、離開全螢幕）；都沒有時照系統的行為離開
        onBackPressedDispatcher.addCallback(this) {
            if (!model.handleBack()) {
                isEnabled = false
                onBackPressedDispatcher.onBackPressed()
                isEnabled = true
            }
        }
        if (savedInstanceState == null) handleIntent(intent)
        warmUpWebView()
    }

    /**
     * 先把瀏覽器引擎載入好。App 裡第一次建立 WebView 時要載入整個引擎，會卡住畫面幾百毫秒；
     * 如果等到打開 YouTube 小視窗才載入，整個畫面會先黑一下（0.0.10 實測）。
     * 等畫面先顯示出來、主執行緒有空時才做。
     */
    private fun warmUpWebView() {
        Looper.myQueue().addIdleHandler {
            try {
                WebView(this).destroy()
            } catch (_: Exception) {
            }
            false
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    /** 從其他 App 送進來的網址（R150）：分享選單（ACTION_SEND）或 multiview://open?url=…。 */
    private fun handleIntent(intent: Intent?) {
        when (intent?.action) {
            Intent.ACTION_SEND -> intent.getStringExtra(Intent.EXTRA_TEXT)?.let(model::openExternal)
            Intent.ACTION_VIEW -> intent.dataString?.let(model::openExternal)
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        // 對話框、鍵盤關掉之後系統列可能跑出來，再隱藏一次
        if (hasFocus) hideSystemBars()
    }

    /** 沉浸模式：隱藏狀態列與導覽列，影片畫到螢幕邊緣；從邊緣滑動時暫時顯示（R149）。 */
    private fun hideSystemBars() {
        WindowCompat.getInsetsController(window, window.decorView).apply {
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            hide(WindowInsetsCompat.Type.systemBars())
        }
    }

    override fun onStart() {
        super.onStart()
        model.willEnterForeground()
    }

    override fun onStop() {
        super.onStop()
        // 回到主畫面或關螢幕：有聲音的原生播放器繼續播聲音，其他暫停（R154）
        model.didEnterBackground()
    }

    override fun onDestroy() {
        if (model.host === this) {
            // 播放器的畫面屬於這個 Activity：畫面結束時全部釋放，格子留著
            model.releaseAllPlayers()
            model.host = null
        }
        super.onDestroy()
    }
}
