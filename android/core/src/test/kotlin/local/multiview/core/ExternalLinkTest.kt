package local.multiview.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** 從其他 App 送進來的網址（R150）。照搬 iOS 版的 ExternalLinkTests.swift，加上分享選單的文字。 */
class ExternalLinkTest {
    @Test
    fun encodedUrl() {
        assertEquals(
            "https://youtu.be/jfKfPfyJRdk?si=abc&t=10",
            ExternalLink.target("multiview://open?url=https%3A%2F%2Fyoutu.be%2FjfKfPfyJRdk%3Fsi%3Dabc%26t%3D10"),
        )
    }

    @Test
    fun unencodedUrlKeepsItsOwnQuery() {
        assertEquals(
            "https://www.youtube.com/watch?v=jfKfPfyJRdk&t=42s",
            ExternalLink.target("multiview://open?url=https://www.youtube.com/watch?v=jfKfPfyJRdk&t=42s"),
        )
        assertEquals("https://example.com/a.m3u8", ExternalLink.target("MULTIVIEW://open?url=https://example.com/a.m3u8"))
        assertEquals("https://example.com/", ExternalLink.target("multiview://open?x=1&url=https://example.com/"))
    }

    @Test
    fun notMultiViewLinks() {
        assertNull(ExternalLink.target("https://example.com/?url=https://youtu.be/x"))
        assertNull(ExternalLink.target("multiview://open"))
        assertNull(ExternalLink.target("multiview://open?url="))
        assertNull(ExternalLink.target("multiview://open?xurl=https://example.com/"))
        assertNull(ExternalLink.target("not a link"))
    }

    // Android 版：分享選單送來的文字（ACTION_SEND）

    @Test
    fun firstUrlInSharedText() {
        assertEquals("https://youtu.be/jfKfPfyJRdk?si=abc", ExternalLink.firstUrl("https://youtu.be/jfKfPfyJRdk?si=abc"))
        assertEquals(
            "https://youtu.be/jfKfPfyJRdk?si=abc",
            ExternalLink.firstUrl("lofi hip hop radio 📚 beats to relax/study to\nhttps://youtu.be/jfKfPfyJRdk?si=abc"),
        )
        assertEquals("https://example.com/a", ExternalLink.firstUrl("看這個 https://example.com/a。還有 https://example.com/b"))
        assertEquals("HTTP://Example.com/x", ExternalLink.firstUrl("（HTTP://Example.com/x）"))
        assertNull(ExternalLink.firstUrl("沒有網址的文字"))
        assertNull(ExternalLink.firstUrl(""))
    }
}
