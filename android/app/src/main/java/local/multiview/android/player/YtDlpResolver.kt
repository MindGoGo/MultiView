package local.multiview.android.player

import android.content.Context
import local.multiview.android.ytdlp.YtDlp
import local.multiview.core.ResolveResult
import local.multiview.core.YtDlpRules
import local.multiview.core.YtStream

class ResolveException(message: String) : Exception(message)

/**
 * 用 yt-dlp 解析網址（R148、R156），對照 iOS 版的 YtDlpResolver.swift。
 * 解析過的串流在有效期限內沿用（切換版型、重新放入同一個網址時不用再解析）。只在主執行緒呼叫。
 */
object YtDlpResolver {
    private val cache = mutableMapOf<String, YtStream>()

    suspend fun resolve(context: Context, url: String): YtStream {
        val now = System.currentTimeMillis().toDouble()
        cache[url]?.let { if (YtDlpRules.isUsable(it, now)) return it }
        val output = try {
            YtDlp.resolve(context, url)
        } catch (error: Exception) {
            throw ResolveException("Python 錯誤：${error.message}")
        }
        when (val result = YtDlpRules.streamFromResolveOutput(output, System.currentTimeMillis().toDouble())) {
            is ResolveResult.Success -> {
                cache[url] = result.stream
                return result.stream
            }
            is ResolveResult.Failure -> throw ResolveException(result.message)
        }
    }

    /** 這個網址的串流不能用了（播放失敗、過期）：下次重新解析。 */
    fun forget(url: String) {
        cache.remove(url)
    }
}
