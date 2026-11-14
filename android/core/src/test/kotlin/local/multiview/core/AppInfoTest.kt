package local.multiview.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

// 照搬 iOS 版的 AppInfoTests.swift
class AppInfoTest {
    @Test
    fun versionLabel() {
        assertEquals("MultiView Android 0.1.0", AppInfo.versionLabel("0.1.0"))
        assertEquals(
            "MultiView Android 0.1.0（yt-dlp 2026.11.01）",
            AppInfo.versionLabel("0.1.0", ytDlpVersion = "2026.11.01"),
        )
    }

    @Test
    fun versionLabelWithoutVersion() {
        assertEquals("MultiView Android", AppInfo.versionLabel(null))
        assertEquals("MultiView Android", AppInfo.versionLabel("  "))
        assertEquals("MultiView Android 0.1.0", AppInfo.versionLabel("0.1.0", ytDlpVersion = ""))
    }

    @Test
    fun versionFromTag() {
        assertEquals("0.1.0", AppInfo.versionFromTag("android-v0.1.0"))
        assertEquals("12.3.45", AppInfo.versionFromTag("android-v12.3.45"))
    }

    @Test
    fun versionFromOtherTags() {
        assertNull(AppInfo.versionFromTag("v0.8.3"))
        assertNull(AppInfo.versionFromTag("ios-v0.1.0"))
        assertNull(AppInfo.versionFromTag("android-v0.1"))
        assertNull(AppInfo.versionFromTag("android-v0.1.x"))
        assertNull(AppInfo.versionFromTag("android-v0..1"))
        assertNull(AppInfo.versionFromTag("android-v"))
    }
}
