package local.multiview.android

import android.content.Context
import android.content.Intent
import android.content.pm.ActivityInfo
import android.content.res.Configuration
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.core.view.WindowCompat
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

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        model.host = this
        hideSystemBars()
        setContent { RootScreen(model) }
        if (savedInstanceState == null) handleIntent(intent)
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
        // 背景播放是 R154 的範圍；目前切到背景時保存並全部暫停，回來時恢復
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
