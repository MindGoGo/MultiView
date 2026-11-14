package local.multiview.core

import java.net.URLDecoder

/**
 * 從其他 App 送進來的網址（R150）：`multiview://open?url=<網址>`，以及分享選單送來的文字。
 * 由 iOS 版的 ExternalLink.swift 改寫。
 */
object ExternalLink {
    const val SCHEME = "multiview"

    /**
     * 取出要放進格子的網址；不是 MultiView 的連結、沒有網址時回傳 null。
     * 網址可以有編碼（`https%3A%2F%2F…`），也可以沒有編碼：直接把網址接在後面時，
     * 網址裡的 `&`、`?` 會被當成連結自己的參數，所以取 `url=` 後面的整段，不用一般的參數解析。
     */
    fun target(link: String): String? {
        val text = link.trim()
        if (!text.startsWith("$SCHEME:", ignoreCase = true)) return null
        val query = text.indexOf('?')
        if (query < 0) return null
        val rest = text.substring(query + 1)
        val start = rest.indexOf("url=")
        if (start < 0) return null
        // url= 必須是參數的開頭
        if (start != 0 && rest[start - 1] != '&') return null
        var value = rest.substring(start + 4)
        val lower = value.lowercase()
        if (lower.startsWith("http%3a") || lower.startsWith("https%3a")) {
            value = percentDecode(value)
        }
        value = value.trim()
        return value.ifEmpty { null }
    }

    /**
     * 分享選單送來的文字（ACTION_SEND，R150）：找出第一個 http(s) 網址。
     * 例如 YouTube App 分享的是「影片名稱 https://youtu.be/…」。
     */
    fun firstUrl(text: String): String? =
        // 網址只算 ASCII 的可見字元：中文句子裡網址後面常常直接接中文字或全形標點
        Regex("""https?://[\x21-\x7E&&[^<>"]]+""", RegexOption.IGNORE_CASE).find(text)?.value
            ?.trimEnd('.', ',', ')')
            ?.ifEmpty { null }

    private fun percentDecode(text: String): String = try {
        // URLDecoder 會把 + 當成空白，先保護起來
        URLDecoder.decode(text.replace("+", "%2B"), "UTF-8")
    } catch (_: IllegalArgumentException) {
        text
    }
}
