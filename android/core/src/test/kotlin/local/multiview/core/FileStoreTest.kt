package local.multiview.core

import org.junit.jupiter.api.io.TempDir
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** 設定檔與清單檔的讀寫（R10、R21、R155）。照搬 iOS 版的 FileStoreTests.swift。 */
class FileStoreTest {
    @TempDir
    lateinit var directory: File

    private val settingsFile get() = File(directory, FileStore.SETTINGS_FILE_NAME)
    private val listsFile get() = File(directory, FileStore.LISTS_FILE_NAME)

    private fun backup(file: File) = File(file.path + ".bak")

    @Test
    fun missingSettingsFileUsesDefaults() {
        assertEquals(Settings(), FileStore.loadSettings(settingsFile))
        assertFalse(settingsFile.exists())
    }

    @Test
    fun settingsRoundTrip() {
        val slots = MutableList<SavedSource?>(9) { null }
        slots[0] = SavedSource(url = "https://youtu.be/jfKfPfyJRdk", volume = 40)
        val settings = Settings(layout = LayoutId.ONE_PLUS_THREE, slots = slots)
        FileStore.saveSettings(settings, settingsFile)
        assertEquals(settings, FileStore.loadSettings(settingsFile))
        // 暫存檔不留下來
        assertEquals(listOf(FileStore.SETTINGS_FILE_NAME), directory.list()?.toList())
    }

    @Test
    fun saveCreatesDirectory() {
        val nested = File(directory, "a/b/settings.json")
        FileStore.saveSettings(Settings(), nested)
        assertTrue(nested.exists())
    }

    @Test
    fun corruptSettingsFileIsKeptAsBackup() {
        settingsFile.writeText("{ broken")
        assertEquals(Settings(), FileStore.loadSettings(settingsFile))
        assertFalse(settingsFile.exists())
        assertEquals("{ broken", backup(settingsFile).readText())
    }

    @Test
    fun corruptFileReplacesOlderBackup() {
        backup(settingsFile).writeText("舊的備份")
        settingsFile.writeText("[]")
        FileStore.loadSettings(settingsFile)
        assertEquals("[]", backup(settingsFile).readText())
    }

    @Test
    fun nonUtf8FileIsCorrupt() {
        settingsFile.writeBytes(byteArrayOf(0xFF.toByte(), 0xFE.toByte(), 0x00, 0x41))
        assertEquals(Settings(), FileStore.loadSettings(settingsFile))
        assertTrue(backup(settingsFile).exists())
    }

    @Test
    fun listsRoundTrip() {
        val lists = Lists(favorites = listOf(ListItem("https://www.twitch.tv/abc", "A", 5.0)))
        FileStore.saveLists(lists, listsFile)
        assertEquals(lists, FileStore.loadLists(listsFile))
    }

    @Test
    fun missingAndCorruptListsFile() {
        assertEquals(Lists(), FileStore.loadLists(listsFile))
        listsFile.writeText("{ broken")
        assertEquals(Lists(), FileStore.loadLists(listsFile))
        assertFalse(listsFile.exists())
        assertTrue(backup(listsFile).exists())
    }

    @Test
    fun settingsAndListsAreIndependent() {
        // 其中一個損毀不影響另一個
        FileStore.saveLists(Lists(favorites = listOf(ListItem("https://example.com/", "E", 1.0))), listsFile)
        settingsFile.writeText("{ broken")
        FileStore.loadSettings(settingsFile)
        assertEquals(1, FileStore.loadLists(listsFile).favorites.size)
    }
}
