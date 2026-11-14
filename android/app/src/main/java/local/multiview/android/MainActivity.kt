package local.multiview.android

import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import local.multiview.android.lab.LabController
import local.multiview.android.lab.LabScreen

/**
 * 技術驗證版（R146、R147）：多格原生播放器、多格 YouTube 內嵌播放器的測試畫面。
 * 正式的主畫面在第 4 步（R149）取代這個畫面。
 */
class MainActivity : ComponentActivity() {
    private val controller = LabController()

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        // 播放中不自動關螢幕（R149）
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        setContent { LabScreen(controller) }
    }

    override fun onStop() {
        super.onStop()
        // 背景播放是 R154 的範圍；技術驗證版切到背景時全部暫停
        controller.pauseAll()
    }
}
