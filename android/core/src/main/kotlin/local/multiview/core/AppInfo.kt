package local.multiview.core

/** App 的名稱與版本文字（規格 android-app R159，對照 iOS 版的 AppInfo.swift）。 */
object AppInfo {
    const val NAME = "MultiView Android"

    private const val TAG_PREFIX = "android-v"
    private val versionPattern = Regex("""\d+\.\d+\.\d+""")

    /**
     * 設定畫面顯示的版本文字，例如「MultiView Android 0.1.0（yt-dlp 2026.11.01）」。
     * 版本號是空的時候只顯示名稱；還沒有 yt-dlp 時不顯示括號。
     */
    fun versionLabel(version: String?, ytDlpVersion: String? = null): String {
        var label = NAME
        clean(version)?.let { label += " $it" }
        clean(ytDlpVersion)?.let { label += "（yt-dlp $it）" }
        return label
    }

    /** 發佈用的標籤（`android-v0.1.0`）對應的版本號；不是 Android 版的標籤時回傳 null（R145）。 */
    fun versionFromTag(tag: String): String? {
        if (!tag.startsWith(TAG_PREFIX)) return null
        val version = tag.removePrefix(TAG_PREFIX)
        return if (versionPattern.matches(version)) version else null
    }

    private fun clean(text: String?): String? = text?.trim()?.takeIf { it.isNotEmpty() }
}
