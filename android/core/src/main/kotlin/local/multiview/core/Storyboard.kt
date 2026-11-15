package local.multiview.core

/**
 * YouTube 預覽縮圖（桌面版 R50），照搬 src/lib/storyboard.ts。
 * YouTube 網頁裡的縮圖資訊（非公開介面）：`<網址樣板>|<等級 0>|<等級 1>|…`，
 * 每個等級是「寬#高#張數#每列張數#每頁列數#每張間隔毫秒#頁面名稱樣板#簽章」。
 */
data class StoryboardLevel(
    val width: Int,
    val height: Int,
    val count: Int,
    val cols: Int,
    val rows: Int,
    val intervalMs: Double,
    val name: String,
    val sigh: String,
)

data class Storyboard(val base: String, val level: Int, val info: StoryboardLevel)

/** 一張縮圖：在哪一頁圖片的哪個位置（像素）。 */
data class StoryboardFrame(val url: String, val x: Int, val y: Int, val width: Int, val height: Int)

object StoryboardRules {
    /** 縮圖寬度不超過這個值的等級中選最大的。 */
    private const val MAX_WIDTH = 320
    private val specPattern = Regex("\"playerStoryboardSpecRenderer\":\\{\"spec\":\"([^\"]+)\"")

    /** 從 YouTube 網頁的 HTML 取出縮圖資訊；直播或找不到時回傳 null。 */
    fun extractSpec(html: String): String? =
        specPattern.find(html)?.groupValues?.get(1)?.replace("\\u0026", "&")

    fun parse(spec: String): Storyboard? {
        val parts = spec.split('|')
        val base = parts.firstOrNull() ?: return null
        if (!base.startsWith("https://")) return null
        var best: Storyboard? = null
        parts.drop(1).forEachIndexed { level, part ->
            val f = part.split('#')
            if (f.size < 8) return@forEachIndexed
            val ints = f.take(5).map { it.toIntOrNull() }
            val interval = f[5].toDoubleOrNull()
            if (ints.any { it == null || it <= 0 } || interval == null || interval <= 0) return@forEachIndexed
            val info = StoryboardLevel(ints[0]!!, ints[1]!!, ints[2]!!, ints[3]!!, ints[4]!!, interval, f[6], f[7])
            if (info.width > MAX_WIDTH) return@forEachIndexed
            if (best == null || info.width > best!!.info.width) best = Storyboard(base, level, info)
        }
        return best
    }

    /** 秒數對應的縮圖；duration 是影片長度（秒）。 */
    fun frame(sb: Storyboard, seconds: Double, duration: Double): StoryboardFrame {
        val info = sb.info
        val t = seconds.coerceIn(0.0, duration.coerceAtLeast(0.0))
        val index = minOf(info.count - 1, kotlin.math.floor(t * 1000 / info.intervalMs).toInt())
        val perSheet = info.cols * info.rows
        val sheet = index / perSheet
        val pos = index % perSheet
        val name = info.name.replace("\$M", sheet.toString())
        val url = sb.base.replace("\$L", sb.level.toString()).replace("\$N", name) + "&sigh=" + info.sigh
        return StoryboardFrame(url, (pos % info.cols) * info.width, (pos / info.cols) * info.height, info.width, info.height)
    }
}
