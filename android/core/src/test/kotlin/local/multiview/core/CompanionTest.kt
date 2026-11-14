package local.multiview.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** YouTube 小視窗的連結處理（R79、R80、R158）。照搬 iOS 版的 CompanionTests.swift。 */
class CompanionTest {
    private val id = "jfKfPfyJRdk"

    @Test
    fun parseTime() {
        assertEquals(195.0, CompanionRules.parseTime("195"))
        assertEquals(195.0, CompanionRules.parseTime("195s"))
        assertEquals(195.0, CompanionRules.parseTime("3m15s"))
        assertEquals(3723.0, CompanionRules.parseTime("1h2m3s"))
        assertEquals(120.0, CompanionRules.parseTime("2m"))
        assertEquals(3600.0, CompanionRules.parseTime(" 1H "))
        assertNull(CompanionRules.parseTime(null))
        assertNull(CompanionRules.parseTime(""))
        assertNull(CompanionRules.parseTime("abc"))
        assertNull(CompanionRules.parseTime("3s2m")) // 順序不對
        assertNull(CompanionRules.parseTime("1m2"))
        assertNull(CompanionRules.parseTime("m"))
    }

    @Test
    fun linkAction() {
        // 其他影片 → 播放
        assertEquals(
            CompanionAction.Play("https://www.youtube.com/watch?v=aaaaaaaaaaa"),
            CompanionRules.linkAction("https://www.youtube.com/watch?v=aaaaaaaaaaa&pp=xyz", id),
        )
        assertEquals(
            CompanionAction.Play("https://www.youtube.com/watch?v=aaaaaaaaaaa"),
            CompanionRules.linkAction("https://youtu.be/aaaaaaaaaaa", null),
        )
        // 同一部影片帶時間 → 跳到那個時間（留言裡的時間連結）
        assertEquals(
            CompanionAction.Seek(195.0),
            CompanionRules.linkAction("https://www.youtube.com/watch?v=$id&t=3m15s", id),
        )
        // 同一部影片不帶時間 → 不做事
        assertNull(CompanionRules.linkAction("https://www.youtube.com/watch?v=$id", id))
        // 不是影片
        assertNull(CompanionRules.linkAction("https://www.youtube.com/@channel", id))
        assertNull(CompanionRules.linkAction("https://example.com/", id))
    }

    @Test
    fun headerAndUrls() {
        assertEquals("第 2 格：標題", CompanionRules.header(1, "標題"))
        assertEquals("第 1 格", CompanionRules.header(0, null))
        assertTrue(CompanionRules.header(null, "x").contains("點一下"))
        assertEquals("https://www.youtube.com/live_chat?v=$id&is_popout=1", CompanionRules.liveChatUrl(id))
        assertEquals(listOf("搜尋", "推薦", "留言", "聊天室"), CompanionTab.entries.map { it.label })
    }
}
