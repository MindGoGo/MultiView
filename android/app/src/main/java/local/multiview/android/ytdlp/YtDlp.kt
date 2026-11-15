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

    /** 啟動 Python 時有下載的新版 yt-dlp（已經要求優先載入）。 */
    @Volatile
    private var archiveAtLaunch = false

    @Synchronized
    private fun start(context: Context): JsRunner {
        runner?.let { return it }
        if (!Python.isStarted()) {
            Python.start(AndroidPlatform(context.applicationContext))
        }
        val jsRunner = JsRunner(context)
        Python.getInstance().getModule("mv_android").callAttr("install", jsRunner)
        // 有下載的新版 yt-dlp 時優先載入（R156）；要在第一次載入 yt-dlp 之前
        YtDlpUpdater.archivePathForLaunch(context.applicationContext)?.let { archive ->
            Python.getInstance().getModule("mv_bridge").callAttr("use_update_archive", archive)
            archiveAtLaunch = true
        }
        runner = jsRunner
        return jsRunner
    }

    /** Python、yt-dlp 等的版本，以及 JS 執行環境的資訊（JSON 文字）。 */
    suspend fun versions(context: Context): String = withContext(dispatcher) {
        val started = System.nanoTime()
        val jsRunner = start(context)
        val startMillis = (System.nanoTime() - started) / 1_000_000
        val text = Python.getInstance().getModule("mv_bridge").callAttr("versions").toString()
        val info = JSONObject(text)
        // 有下載的新版、但 Python 沒有用到它：檔案壞了，刪掉之後重新下載
        // （只看啟動時就有的那一份；這次開啟之後才下載的還沒載入，不能刪）
        if (archiveAtLaunch && !info.optBoolean("yt_dlp_updated")) {
            archiveAtLaunch = false
            YtDlpUpdater.discardArchive(context.applicationContext)
        }
        info
            .put("js_runtime", jsRunner.describe())
            .put("start_ms", startMillis)
            .toString(2)
    }

    /** 頻道的最新影片（R158），回傳 mv_bridge.channel_videos 的結果（JSON 文字）。 */
    suspend fun channelVideos(context: Context, channelId: String, count: Int): String = withContext(dispatcher) {
        start(context)
        val request = JSONObject()
            .put("channel_id", channelId)
            .put("count", count)
            .put("cache_dir", File(context.cacheDir, "yt-dlp").absolutePath)
        Python.getInstance().getModule("mv_bridge").callAttr("channel_videos", request.toString()).toString()
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
