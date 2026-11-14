package local.multiview.android.ytdlp

import android.content.Context
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.async
import kotlinx.coroutines.withContext
import local.multiview.android.BuildConfig
import local.multiview.core.YtDlpUpdateRecord
import local.multiview.core.YtDlpUpdateRules
import local.multiview.core.YtDlpVersion
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * yt-dlp 的自動更新（R156），對照 iOS 版的 YtDlpUpdater.swift。
 * App 內附一份 yt-dlp；這裡從 yt-dlp 的 GitHub Releases 下載最新穩定版的 `yt-dlp` 檔（zip 格式的 Python 程式），
 * 用官方的 SHA2-256SUMS 驗證後放在 App 資料夾。已經載入的 yt-dlp 不能在執行中換掉，新版在下次開啟 App 時生效。
 * 除了 [archivePathForLaunch]、[discardArchive]，其他只在主執行緒呼叫。
 */
object YtDlpUpdater {
    sealed class Outcome {
        /** 下載了新版；重新開啟 App 後生效。 */
        data class Updated(val version: String) : Outcome()

        /** 已經是最新版。 */
        data class Latest(val version: String) : Outcome()
        data class Failed(val reason: String) : Outcome()

        /** 手動更新完成後的提示（R93）。 */
        val message: String
            get() = when (this) {
                is Updated -> "yt-dlp 已下載 $version，重新開啟 App 後生效"
                is Latest -> "yt-dlp 已經是最新版"
                is Failed -> "yt-dlp 更新失敗：$reason"
            }
    }

    private const val LATEST_RELEASE_URL = "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest"
    private const val ASSET_NAME = "yt-dlp"
    private const val SUMS_NAME = "SHA2-256SUMS"

    private val scope = MainScope()
    private var running: Deferred<Outcome>? = null
    private var lastFailureUpdate = 0.0

    // 檔案位置

    private fun directory(context: Context) = File(context.filesDir, "bin")

    /** 下載的新版 yt-dlp。 */
    private fun archiveFile(context: Context) = File(directory(context), "yt-dlp.zip")

    private fun recordFile(context: Context) = File(directory(context), "update.json")

    private fun now() = System.currentTimeMillis().toDouble()

    private fun loadRecord(context: Context): YtDlpUpdateRecord = YtDlpUpdateRecord.parse(
        try {
            recordFile(context).readText()
        } catch (_: Exception) {
            null
        },
    )

    private fun save(context: Context, record: YtDlpUpdateRecord) {
        try {
            directory(context).mkdirs()
            recordFile(context).writeText(record.encoded())
        } catch (_: Exception) {
        }
    }

    /**
     * 啟動 Python 之後、第一次載入 yt-dlp 之前呼叫：回傳要優先載入的新版 yt-dlp 的路徑，沒有時回傳 null。
     * App 的版本換了的時候，內附的 yt-dlp 可能比較新，所以丟掉下載的那一份，之後再重新檢查更新。
     */
    fun archivePathForLaunch(context: Context): String? {
        val record = loadRecord(context)
        if (record.appVersion != BuildConfig.VERSION_NAME) {
            archiveFile(context).delete()
            save(context, YtDlpUpdateRecord(0.0, BuildConfig.VERSION_NAME))
        }
        return archiveFile(context).takeIf { it.exists() }?.absolutePath
    }

    /** 下載的新版載入失敗（Python 回報沒有用到它）：刪掉，下次重新下載。 */
    fun discardArchive(context: Context) {
        if (!archiveFile(context).delete()) return
        save(context, loadRecord(context).copy(lastCheck = 0.0))
    }

    // 更新

    /** 開啟 App 時：距離上次檢查超過 24 小時才檢查（R92 時機 1）。 */
    suspend fun autoUpdateIfNeeded(context: Context): Outcome? {
        if (!YtDlpUpdateRules.shouldAutoUpdate(loadRecord(context), now())) return null
        return update(context)
    }

    /** 解析失敗、而且看起來是 yt-dlp 太舊時：10 分鐘內只更新一次（R92 時機 2）。 */
    suspend fun updateAfterFailure(context: Context, message: String): Outcome? {
        if (!YtDlpUpdateRules.isOutdatedError(message)) return null
        if (now() - lastFailureUpdate < YtDlpUpdateRules.FAILURE_UPDATE_INTERVAL) return null
        lastFailureUpdate = now()
        return update(context)
    }

    /** 檢查並下載新版。同一時間只進行一個更新，同時的要求共用同一次的結果。 */
    suspend fun update(context: Context): Outcome {
        running?.let { return it.await() }
        val appContext = context.applicationContext
        val task = scope.async {
            try {
                perform(appContext)
            } catch (error: Exception) {
                Outcome.Failed(error.message ?: error.javaClass.simpleName)
            }
        }
        running = task
        return try {
            task.await()
        } finally {
            running = null
        }
    }

    private suspend fun perform(context: Context): Outcome {
        // 目前用的版本
        val current = JSONObject(YtDlp.versions(context)).optString("yt_dlp").let(YtDlpVersion::parse)
            ?: return Outcome.Failed("讀不到目前的版本")

        return withContext(Dispatchers.IO) {
            // 最新的穩定版
            val tag = JSONObject(String(fetch(LATEST_RELEASE_URL), Charsets.UTF_8)).optString("tag_name")
            val latest = YtDlpVersion.parse(tag) ?: return@withContext Outcome.Failed("讀不到最新的版本")

            val record = loadRecord(context).copy(lastCheck = now(), appVersion = BuildConfig.VERSION_NAME)
            if (YtDlpVersion.compare(latest, current) <= 0) {
                save(context, record)
                return@withContext Outcome.Latest(current)
            }

            // 下載並用官方的雜湊值驗證
            val base = "https://github.com/yt-dlp/yt-dlp/releases/download/$tag/"
            val sums = String(fetch(base + SUMS_NAME), Charsets.UTF_8)
            val expected = YtDlpUpdateRules.checksum(ASSET_NAME, sums) ?: return@withContext Outcome.Failed("找不到雜湊值")
            val archive = fetch(base + ASSET_NAME)
            val actual = MessageDigest.getInstance("SHA-256").digest(archive).joinToString("") { "%02x".format(it) }
            if (actual != expected) return@withContext Outcome.Failed("下載的檔案雜湊值不符")

            // 先寫暫存檔再改名，避免留下寫到一半的檔案
            directory(context).mkdirs()
            val temp = File(directory(context), "yt-dlp.zip.tmp")
            temp.writeBytes(archive)
            if (!temp.renameTo(archiveFile(context))) {
                temp.delete()
                return@withContext Outcome.Failed("無法寫入檔案")
            }
            save(context, record)
            Outcome.Updated(latest)
        }
    }

    private fun fetch(address: String): ByteArray {
        val connection = URL(address).openConnection() as HttpURLConnection
        try {
            connection.connectTimeout = 30_000
            connection.readTimeout = 30_000
            connection.instanceFollowRedirects = true
            connection.setRequestProperty("User-Agent", "MultiView-Android")
            connection.setRequestProperty("Accept", "application/vnd.github+json, */*")
            if (connection.responseCode != 200) throw java.io.IOException("HTTP ${connection.responseCode}")
            return connection.inputStream.use { it.readBytes() }
        } finally {
            connection.disconnect()
        }
    }
}
