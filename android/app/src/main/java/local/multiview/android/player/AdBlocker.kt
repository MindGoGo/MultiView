package local.multiview.android.player

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import local.multiview.core.AdBlockEngine
import org.json.JSONObject
import kotlin.concurrent.thread

/**
 * 網頁格子的廣告阻擋（R157）：App 裡附的規則（EasyList 在編譯時轉成的 JSON，和 iOS 版相同）
 * 開啟 App 時在背景載入。載入完成前開啟的網頁格子先不擋。
 */
object AdBlocker {
    /** 規則的準備狀態，顯示在設定畫面。 */
    var status by mutableStateOf("準備中…")
        private set

    /** 載入好的規則；還沒載入好、或 App 沒有附規則時是 null。可以在任何執行緒讀。 */
    @Volatile
    var engine: AdBlockEngine? = null
        private set

    /** 注入網頁的程式（編譯時由 android/scripts/build-web.sh 產生）；App 沒有附時是 null。 */
    @Volatile
    var injectedScript: String? = null
        private set

    private var started = false

    /** 開啟 App 時在背景準備（只做一次）。 */
    fun prepare(context: Context) {
        if (started) return
        started = true
        val assets = context.applicationContext.assets
        // 注入的程式很小，馬上讀；第一個網頁格子建立時就要用
        injectedScript = try {
            assets.open("web-inject.js").use { it.readBytes().toString(Charsets.UTF_8) }
        } catch (_: Exception) {
            null
        }
        thread(name = "multiview.adblock", isDaemon = true) {
            val next = try {
                val manifest = JSONObject(assets.open("adblock/manifest.json").use { it.readBytes().toString(Charsets.UTF_8) })
                val lists = manifest.getJSONArray("lists")
                val texts = (0 until lists.length()).map { index ->
                    assets.open("adblock/" + lists.getJSONObject(index).getString("file")).use { it.readBytes().toString(Charsets.UTF_8) }
                }
                val loaded = AdBlockEngine.load(texts)
                engine = loaded
                "約 ${loaded.networkRuleCount} 條網路規則、${loaded.cosmeticRuleCount} 組隱藏規則（EasyList ${manifest.optString("version")}）"
            } catch (_: Exception) {
                "這個版本的 App 沒有附規則"
            }
            status = next
        }
    }
}
