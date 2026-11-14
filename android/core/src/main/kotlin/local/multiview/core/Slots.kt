package local.multiview.core

import java.util.concurrent.atomic.AtomicInteger

/** 格子裡的一個來源（對照 iOS 版的 Slots.swift）。 */
data class CellSource(
    /** 每次放入新網址都換一個 id；畫面以 id 對應播放器，id 不變就不會重新載入。 */
    val id: Int = SourceId.next(),
    val url: String,
    val parsed: ParsedSource,
    val muted: Boolean = false,
    val volume: Int = Volume.DEFAULT,
    /** 載入後是否自動播放；從設定檔還原的來源為 false（R10 AC1）。 */
    val autoplay: Boolean = true,
    /** 廣告阻擋，只用於網頁來源（R17）；跟著來源移動和保存。 */
    val adblock: Boolean = true,
    /** 使用者放入的來源，第一次成功載入時記錄到歷史（R23）；自動還原時為 false。不保存。 */
    val record: Boolean = false,
    /** 畫質（R24）；跟著來源移動和保存。 */
    val quality: Quality = Quality.Auto,
    /** 字幕的選擇，只用於 YouTube；null 為關閉（R31）。 */
    val captions: String? = null,
    /** yt-dlp 播放時記住的語音語言；null 為自動（R95）。 */
    val audioLang: String? = null,
    /** 亮度 20–100（%）。 */
    val brightness: Int = Brightness.DEFAULT,
    /** 改用 YouTube 網頁播放（R48）。 */
    val youtubeWeb: Boolean = false,
    /** 載入時要跳到的位置（秒）：上次的觀看進度（R55）；從頭開始時為 null。 */
    val resume: Double? = null,
    /** 從 YouTube 網站開啟時的來源頁面網址（R63）。 */
    val backUrl: String? = null,
    /** YouTube 網頁模式的廣告阻擋（R70）。 */
    val pageAdblock: Boolean = true,
) {
    /** 取消靜音而且音量大於 0。 */
    val isAudible: Boolean get() = !muted && volume > 0

    /**
     * 用網頁播放的來源（YouTube 內嵌播放器、網頁）。Android 的 WebView 和 iOS 一樣不讓兩個網頁同時出聲：
     * 這類來源同一時間只有一格有聲音（R147 的實測結果、R152）。
     * 這是只看來源種類的判斷；YouTube 改用 yt-dlp 播放時是原生播放器，由 App 另外判斷。
     */
    val usesWebAudio: Boolean get() = parsed.kind == ParsedSource.Kind.YOUTUBE || parsed.kind == ParsedSource.Kind.WEB
}

/** 來源的 id：每次呼叫都給一個新的數字。 */
object SourceId {
    private val last = AtomicInteger(0)

    fun next(): Int = last.incrementAndGet()
}

/** 9 個固定格位（R4、R6）。移除來源時不往前遞補。 */
typealias Slots = List<CellSource?>

object SlotRules {
    const val COUNT = 9

    fun empty(): Slots = List(COUNT) { null }

    /**
     * 是否為顯示中的格位。單格全螢幕時（solo 為放大的格位）只有那一格顯示中，
     * 其他都視為隱藏的來源（R20 共用定義）。
     */
    fun isVisible(index: Int, layout: LayoutId, solo: Int? = null): Boolean =
        if (solo != null) index == solo else index < layout.cellCount

    fun set(slots: Slots, index: Int, source: CellSource?): Slots {
        if (index !in slots.indices) return slots
        return slots.toMutableList().also { it[index] = source }
    }

    /** 互換兩個格位的內容（R6）。 */
    fun swap(slots: Slots, a: Int, b: Int): Slots {
        if (a == b || a !in slots.indices || b !in slots.indices) return slots
        return slots.toMutableList().also {
            it[a] = slots[b]
            it[b] = slots[a]
        }
    }

    /** 不在目前版型中、但有來源的格位數（R4 AC4）。 */
    fun hiddenCount(slots: Slots, layout: LayoutId): Int =
        slots.withIndex().count { (index, source) -> source != null && !isVisible(index, layout) }

    /** 第一個顯示中的空格（R21、R150）；沒有時回傳 null。 */
    fun firstEmptyVisible(slots: Slots, layout: LayoutId, solo: Int? = null): Int? =
        slots.indices.firstOrNull { slots[it] == null && isVisible(it, layout, solo) }
}

/** 聲音規則（R7、R8、R152）。 */
object AudioRules {
    /** 新來源是否靜音：已經有顯示中的來源有聲音時就靜音（R7 AC1）。 */
    fun initialMuted(slots: Slots, layout: LayoutId, solo: Int? = null): Boolean =
        slots.withIndex().any { (index, source) ->
            source != null && SlotRules.isVisible(index, layout, solo) && source.isAudible
        }

    /** 獨占聲音：只有第 index 格取消靜音，其他全部靜音（R7 AC2）。點空白格不影響聲音。 */
    fun focus(slots: Slots, index: Int): Slots {
        if (slots.getOrNull(index) == null) return slots
        return map(slots) { source, position -> source.copy(muted = position != index) }
    }

    /**
     * 喇叭按鈕：只切換這一格（R7 AC3）。
     * 例外：用網頁播放的來源取消靜音時，其他用網頁播放的來源會靜音（WebView 的限制，R152）。
     * usesWebAudio：這個來源現在是不是用網頁播放；不給時只看來源的種類。
     */
    fun toggleMute(
        slots: Slots,
        index: Int,
        usesWebAudio: (CellSource) -> Boolean = { it.usesWebAudio },
    ): Slots {
        val target = slots.getOrNull(index) ?: return slots
        val exclusive = target.muted && usesWebAudio(target)
        return map(slots) { source, position ->
            when {
                position == index -> source.copy(muted = !source.muted)
                exclusive && usesWebAudio(source) -> source.copy(muted = true)
                else -> source
            }
        }
    }

    /** 按喇叭取消靜音時，會不會讓其他格子跟著靜音（用來顯示提示）。 */
    fun unmutingSilencesOthers(
        slots: Slots,
        index: Int,
        usesWebAudio: (CellSource) -> Boolean = { it.usesWebAudio },
    ): Boolean {
        val target = slots.getOrNull(index) ?: return false
        if (!target.muted || !usesWebAudio(target)) return false
        return slots.withIndex().any { (position, source) ->
            source != null && position != index && usesWebAudio(source) && !source.muted
        }
    }

    /** 音量 0–100。 */
    fun setVolume(slots: Slots, index: Int, volume: Double): Slots {
        val value = Volume.clamp(volume)
        return map(slots) { source, position -> if (position == index) source.copy(volume = value) else source }
    }

    /** 全部靜音，音量設定不變（R8 AC3）。 */
    fun muteAll(slots: Slots): Slots = map(slots) { source, _ -> source.copy(muted = true) }

    private fun map(slots: Slots, transform: (CellSource, Int) -> CellSource): Slots =
        slots.mapIndexed { index, source -> source?.let { transform(it, index) } }
}
