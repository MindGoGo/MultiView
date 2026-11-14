package local.multiview.core

import java.io.File
import java.io.IOException
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.nio.ByteBuffer

/**
 * 設定檔與清單檔的讀寫（桌面版 R10、R21；Android 版 R155）。
 * 寫入先寫暫存檔再改名，避免寫到一半被系統結束造成檔案損毀。
 */
object FileStore {
    const val SETTINGS_FILE_NAME = "settings.json"
    const val LISTS_FILE_NAME = "lists.json"

    /** 沒有設定檔時用預設值；損毀時改名成 `.bak` 保留，用預設值（R10 AC2）。 */
    fun loadSettings(file: File): Settings {
        val text = read(file) ?: return Settings()
        val result = SettingsCodec.parse(text)
        if (result.corrupt) keepAsBackup(file)
        return result.settings
    }

    @Throws(IOException::class)
    fun saveSettings(settings: Settings, file: File) = write(SettingsCodec.encode(settings), file)

    /** 沒有清單檔時是空的；損毀時改名成 `.bak` 保留，清單從空的開始（R21 AC11）。 */
    fun loadLists(file: File): Lists {
        val text = read(file) ?: return Lists()
        val result = ListsCodec.parse(text)
        if (result.corrupt) keepAsBackup(file)
        return result.lists
    }

    @Throws(IOException::class)
    fun saveLists(lists: Lists, file: File) = write(ListsCodec.encode(lists), file)

    internal fun read(file: File): String? {
        val bytes = try {
            file.readBytes()
        } catch (_: IOException) {
            return null
        }
        // 不是 UTF-8 的檔案也當作有內容（之後會被判定為損毀）
        return try {
            Charsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(bytes)).toString()
        } catch (_: CharacterCodingException) {
            ""
        }
    }

    @Throws(IOException::class)
    internal fun write(text: String, file: File) {
        file.absoluteFile.parentFile?.mkdirs()
        val temp = File(file.absoluteFile.parentFile, file.name + ".tmp")
        temp.writeText(text, Charsets.UTF_8)
        try {
            Files.move(temp.toPath(), file.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
        } catch (_: AtomicMoveNotSupportedException) {
            Files.move(temp.toPath(), file.toPath(), StandardCopyOption.REPLACE_EXISTING)
        }
    }

    /** 損毀的檔案改名保留。改名失敗也不影響啟動，下次寫入會覆蓋。 */
    internal fun keepAsBackup(file: File) {
        val backup = File(file.path + ".bak")
        try {
            Files.move(file.toPath(), backup.toPath(), StandardCopyOption.REPLACE_EXISTING)
        } catch (_: IOException) {
        }
    }
}
