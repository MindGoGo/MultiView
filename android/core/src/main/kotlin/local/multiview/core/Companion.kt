package local.multiview.core

/** YouTube 小視窗的純邏輯（桌面版 R78–R83；Android 版 R158）。由 iOS 版的 Companion.swift 改寫。 */
enum class CompanionTab(val raw: String, val label: String) {
    SEARCH("search", "搜尋"),
    RELATED("related", "推薦"),
    COMMENTS("comments", "留言"),
    CHAT("chat", "聊天室"),
}

sealed class CompanionAction {
    /** 連結的格子跳到這個時間。 */
    data class Seek(val seconds: Double) : CompanionAction()

    /** 播放這部影片。 */
    data class Play(val url: String) : CompanionAction()
}

object CompanionRules {
    const val MOBILE_HOME = "https://m.youtube.com/"

    /** 推薦、留言、聊天室用桌面版的 YouTube 網頁（樣式是針對桌面版寫的）。 */
    const val DESKTOP_USER_AGENT =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"

    fun watchPageUrl(videoId: String): String = SourceParser.watchPageUrl(videoId)

    fun liveChatUrl(videoId: String): String = "https://www.youtube.com/live_chat?v=$videoId&is_popout=1"

    /** YouTube 連結的 t 參數（例如 195、195s、3m15s、1h2m3s）換成秒數；不是時間時回傳 null。 */
    fun parseTime(raw: String?): Double? {
        val text = raw?.trim()?.lowercase() ?: return null
        if (text.isEmpty()) return null
        val digits = text.removeSuffix("s")
        if (digits.isNotEmpty() && digits.all { it in '0'..'9' }) return digits.toDoubleOrNull()
        // 1h2m3s：單位要依 h、m、s 的順序，各出現最多一次
        var total = 0.0
        var number = ""
        var units = "hms"
        for (character in text) {
            if (character in '0'..'9') {
                number += character
                continue
            }
            val position = units.indexOf(character)
            val value = number.toDoubleOrNull()
            if (position < 0 || value == null) return null
            total += value * when (character) {
                'h' -> 3600
                'm' -> 60
                else -> 1
            }
            units = units.substring(position + 1)
            number = ""
        }
        return if (number.isEmpty()) total else null
    }

    /**
     * 推薦、留言分頁裡點了 YouTube 影片連結（R79、R80）：同一部影片帶時間 → 跳到那個時間；
     * 同一部影片不帶時間 → 不做事；其他影片 → 播放那部影片。不是 YouTube 影片時回傳 null。
     */
    fun linkAction(href: String, currentVideoId: String?): CompanionAction? {
        val videoId = (SourceParser.parse(href) as? ParsedSource.YouTube)?.videoId ?: return null
        if (videoId == currentVideoId) {
            val seconds = parseTime(WebUrl.parse(href)?.queryValue("t")) ?: return null
            return CompanionAction.Seek(seconds)
        }
        return CompanionAction.Play(watchPageUrl(videoId))
    }

    /** 小視窗上方的影片名稱（R78；R165 拿掉「第 N 格：」）。還不知道名稱時顯示「第 N 格」。 */
    fun header(cell: Int?, title: String?): String {
        if (cell == null) return "點一下 YouTube 的格子，這裡會顯示它的推薦影片、留言和聊天室"
        if (title.isNullOrEmpty()) return "第 ${cell + 1} 格"
        return title
    }
}
