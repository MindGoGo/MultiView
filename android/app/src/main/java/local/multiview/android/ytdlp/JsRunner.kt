package local.multiview.android.ytdlp

import android.content.Context
import androidx.javascriptengine.IsolateStartupParameters
import androidx.javascriptengine.JavaScriptSandbox
import java.util.concurrent.ExecutionException
import java.util.concurrent.TimeUnit

/**
 * 執行 yt-dlp 的 JS 解題程式（R148），對照 iOS 版的 JavaScriptRunner.swift。
 * yt-dlp 原本另外執行 deno／node，把程式從標準輸入送進去、從標準輸出讀結果；
 * 這裡改成交給 androidx.javascriptengine（手機 WebView 的 V8，在獨立的沙箱程序裡），把 console.log 的內容當作輸出。
 * 由 Python 的執行緒呼叫（會等到執行完才回傳），不能在主執行緒呼叫。
 */
class JsRunner(context: Context) {
    private val context = context.applicationContext
    private var sandbox: JavaScriptSandbox? = null

    /** 沙箱支援的功能，顯示在測試畫面（R148 AC2）。 */
    @Synchronized
    fun describe(): String = try {
        val sandbox = sandbox()
        val features = listOf(
            JavaScriptSandbox.JS_FEATURE_ISOLATE_MAX_HEAP_SIZE to "heap",
            JavaScriptSandbox.JS_FEATURE_EVALUATE_WITHOUT_TRANSACTION_LIMIT to "large",
            JavaScriptSandbox.JS_FEATURE_CONSOLE_MESSAGING to "console",
        ).filter { sandbox.isFeatureSupported(it.first) }.joinToString(",") { it.second }
        "JavaScriptSandbox（$features）"
    } catch (error: Exception) {
        "JavaScriptSandbox 不能用：${error.message}"
    }

    @Synchronized
    private fun sandbox(): JavaScriptSandbox {
        sandbox?.let { return it }
        if (!JavaScriptSandbox.isSupported()) {
            throw IllegalStateException("這支手機的 WebView 不支援 JavaScriptSandbox，請更新 Android System WebView")
        }
        return JavaScriptSandbox.createConnectedInstanceAsync(context).get(30, TimeUnit.SECONDS).also { sandbox = it }
    }

    /** 執行一段 JS，回傳它用 console.log 輸出的文字；失敗時丟出例外（Python 那邊會變成解題失敗）。 */
    fun run(script: String): String {
        val sandbox = synchronized(this) { sandbox() }
        if (!sandbox.isFeatureSupported(JavaScriptSandbox.JS_FEATURE_EVALUATE_WITHOUT_TRANSACTION_LIMIT) &&
            script.length > SMALL_SCRIPT_LIMIT
        ) {
            throw IllegalStateException("JS 太大（${script.length / 1024}KB），這支手機的 WebView 不支援執行大的 JS")
        }
        val parameters = IsolateStartupParameters()
        if (sandbox.isFeatureSupported(JavaScriptSandbox.JS_FEATURE_ISOLATE_MAX_HEAP_SIZE)) {
            parameters.maxHeapSizeBytes = MAX_HEAP
        }
        parameters.maxEvaluationReturnSizeBytes = MAX_RETURN
        val isolate = sandbox.createIsolate(parameters)
        try {
            val code = PRELUDE + "\n" + script + "\n;__multiViewOut.join('\\n')"
            return isolate.evaluateJavaScriptAsync(code).get(TIMEOUT_SECONDS, TimeUnit.SECONDS)
        } catch (error: ExecutionException) {
            throw IllegalStateException(error.cause?.message ?: error.message ?: "JS 執行失敗", error)
        } finally {
            isolate.close()
        }
    }

    private companion object {
        const val MAX_HEAP = 512L * 1024 * 1024
        const val MAX_RETURN = 4 * 1024 * 1024
        const val TIMEOUT_SECONDS = 120L
        const val SMALL_SCRIPT_LIMIT = 500 * 1024

        /** 和 iOS 版相同：console.log 的內容收集起來當作輸出。 */
        const val PRELUDE = """
var __multiViewOut = [];
var console = {
  log: function () { __multiViewOut.push(Array.prototype.map.call(arguments, String).join(' ')); }
};
console.info = console.warn = console.error = console.debug = console.log;
"""
    }
}
