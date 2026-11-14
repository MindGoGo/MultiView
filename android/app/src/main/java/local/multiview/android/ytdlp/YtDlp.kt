package local.multiview.android.ytdlp

import android.content.Context
import com.chaquo.python.Python
import com.chaquo.python.android.AndroidPlatform
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.util.concurrent.Executors

/**
 * App 裡內嵌的 Python 與 yt-dlp（R148），對照 iOS 版的 PythonRuntime.swift、YtDlpResolver.swift。
 * 呼叫 iOS 版共用的 mv_bridge.py；JS 交給 [JsRunner]。
 */
object YtDlp {
    /** Python 的執行緒要比預設大的堆疊，yt-dlp 的遞迴比較深（和 iOS 版相同，16MB）。 */
    private const val STACK_SIZE = 16L shl 20

    /** 同時最多解析 2 個（和 iOS 版相同）；Python 同一時間只能跑一段程式（GIL）。 */
    private val dispatcher = Executors.newFixedThreadPool(2) { task ->
        Thread(null, task, "multiview.python", STACK_SIZE)
    }.asCoroutineDispatcher()

    private var runner: JsRunner? = null

    @Synchronized
    private fun start(context: Context): JsRunner {
        runner?.let { return it }
        if (!Python.isStarted()) {
            Python.start(AndroidPlatform(context.applicationContext))
        }
        val jsRunner = JsRunner(context)
        Python.getInstance().getModule("mv_android").callAttr("install", jsRunner)
        runner = jsRunner
        return jsRunner
    }

    /** Python、yt-dlp 等的版本，以及 JS 執行環境的資訊（JSON 文字）。 */
    suspend fun versions(context: Context): String = withContext(dispatcher) {
        val started = System.nanoTime()
        val jsRunner = start(context)
        val startMillis = (System.nanoTime() - started) / 1_000_000
        val text = Python.getInstance().getModule("mv_bridge").callAttr("versions").toString()
        JSONObject(text)
            .put("js_runtime", jsRunner.describe())
            .put("start_ms", startMillis)
            .toString(2)
    }

    /** 解析一個網址，回傳 mv_bridge.resolve 的結果（JSON 文字）。 */
    suspend fun resolve(context: Context, url: String): String = withContext(dispatcher) {
        start(context)
        val request = JSONObject()
            .put("url", url)
            .put("cache_dir", File(context.cacheDir, "yt-dlp").absolutePath)
            .put("timeout", 20)
        Python.getInstance().getModule("mv_bridge").callAttr("resolve", request.toString()).toString()
    }
}
