package local.multiview.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** yt-dlp 的版本比較與自動更新的判斷（R156）。照搬 iOS 版 YtDlpTests.swift 的 YtDlpUpdateTests。 */
class YtDlpUpdateTest {
    @Test
    fun parseVersion() {
        assertEquals("2026.10.26", YtDlpVersion.parse("2026.10.26"))
        assertEquals("2026.01.05", YtDlpVersion.parse(" 2026.1.5\n"))
        assertEquals("2026.10.26.123456", YtDlpVersion.parse("stable@2026.10.26.123456 from yt-dlp/yt-dlp"))
        assertNull(YtDlpVersion.parse("1.2.3"))
        assertNull(YtDlpVersion.parse("沒有版本"))
        assertNull(YtDlpVersion.parse(""))
    }

    @Test
    fun compareVersion() {
        assertTrue(YtDlpVersion.compare("2026.11.01", "2026.10.26") > 0)
        assertTrue(YtDlpVersion.compare("2026.10.26", "2026.11.01") < 0)
        assertEquals(0, YtDlpVersion.compare("2026.10.26", "2026.10.26"))
        assertTrue(YtDlpVersion.compare("2026.10.26.1", "2026.10.26") > 0)
        assertTrue(YtDlpVersion.compare("2027.01.01", "2026.12.31") > 0)
    }

    @Test
    fun updateRecord() {
        assertEquals(YtDlpUpdateRecord(), YtDlpUpdateRecord.parse(null))
        assertEquals(YtDlpUpdateRecord(), YtDlpUpdateRecord.parse("{ broken"))
        assertEquals(YtDlpUpdateRecord(), YtDlpUpdateRecord.parse("{\"lastCheck\":\"x\",\"appVersion\":3}"))
        val record = YtDlpUpdateRecord(1_794_000_000_000.0, "0.0.9")
        assertEquals(record, YtDlpUpdateRecord.parse(record.encoded()))
    }

    @Test
    fun shouldAutoUpdate() {
        val now = 1_794_000_000_000.0
        val hour = 60.0 * 60 * 1000
        assertTrue(YtDlpUpdateRules.shouldAutoUpdate(YtDlpUpdateRecord(), now))
        assertFalse(YtDlpUpdateRules.shouldAutoUpdate(YtDlpUpdateRecord(now - 23 * hour), now))
        assertTrue(YtDlpUpdateRules.shouldAutoUpdate(YtDlpUpdateRecord(now - 24 * hour), now))
        // 時間被往回調：上次檢查的時間在未來，當作要檢查
        assertTrue(YtDlpUpdateRules.shouldAutoUpdate(YtDlpUpdateRecord(now + hour), now))
    }

    @Test
    fun isOutdatedError() {
        assertTrue(YtDlpUpdateRules.isOutdatedError("ERROR: [youtube] abc: Unable to extract nsig function code"))
        assertTrue(YtDlpUpdateRules.isOutdatedError("ERROR: [youtube] abc: Signature extraction failed: please report this issue"))
        assertFalse(YtDlpUpdateRules.isOutdatedError("ERROR: [youtube] abc: Private video. Sign in if you've been granted access"))
        assertFalse(YtDlpUpdateRules.isOutdatedError("ERROR: [youtube] abc: Video unavailable"))
        assertFalse(YtDlpUpdateRules.isOutdatedError("ERROR: Unable to download API page: timed out; please report this issue"))
        assertFalse(YtDlpUpdateRules.isOutdatedError("ERROR: Unsupported URL: https://example.com/"))
        assertFalse(YtDlpUpdateRules.isOutdatedError("沒有可以播放的格式"))
        // 0.0.4 在 POCO F6 Pro 實測到的錯誤：影片本身的問題，不是 yt-dlp 太舊
        assertFalse(YtDlpUpdateRules.isOutdatedError("ERROR: [youtube] jfKfPfyJRdk: This live stream recording is not available."))
    }

    @Test
    fun checksum() {
        val hash = "ab12".repeat(16)
        val other = "0".repeat(64)
        val sums = "$other  yt-dlp.exe\n${hash.uppercase()}  yt-dlp\n$other *yt-dlp_macos\nbad  yt-dlp.tar.gz\n"
        assertEquals(hash, YtDlpUpdateRules.checksum("yt-dlp", sums))
        assertEquals(other, YtDlpUpdateRules.checksum("yt-dlp_macos", sums))
        assertNull(YtDlpUpdateRules.checksum("yt-dlp.tar.gz", sums))
        assertNull(YtDlpUpdateRules.checksum("missing", sums))
    }

    @Test
    fun channel() {
        assertEquals(YtDlpChannel.STABLE, YtDlpChannel.parse(null))
        assertEquals(YtDlpChannel.NIGHTLY, YtDlpChannel.parse("nightly"))
        assertEquals(
            "https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/download/2026.11.14.232655/",
            YtDlpChannel.NIGHTLY.downloadBase("2026.11.14.232655"),
        )
        // 最新版：只往新的更新
        assertTrue(YtDlpUpdateRules.shouldDownload("2026.10.26", "2026.11.14.232655", YtDlpChannel.NIGHTLY))
        assertFalse(YtDlpUpdateRules.shouldDownload("2026.11.14.232655", "2026.11.14.232655", YtDlpChannel.NIGHTLY))
        // 正式版：比較新才下載；目前是最新版的版本時換回正式版（即使正式版比較舊）
        assertTrue(YtDlpUpdateRules.shouldDownload("2026.10.26", "2026.11.20", YtDlpChannel.STABLE))
        assertFalse(YtDlpUpdateRules.shouldDownload("2026.10.26", "2026.10.26", YtDlpChannel.STABLE))
        assertTrue(YtDlpUpdateRules.shouldDownload("2026.11.14.232655", "2026.10.26", YtDlpChannel.STABLE))
    }
}
