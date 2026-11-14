package local.multiview.core

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive

/** 每格亮度與總亮度（桌面版 R40、R41；Android 版 R153）。最高 100%：原生播放器的畫面不能直接調亮。 */
object Brightness {
    const val MIN = 20
    const val MAX = 100
    const val STEP = 5
    const val DEFAULT = 100

    /** 設定檔中的亮度：限制在 20–100、以 5 為單位；不合法或沒有欄位時為 100。桌面版超過 100 的值當作 100。 */
    fun normalize(raw: JsonElement?): Int {
        val value = JsonValues.number(raw) ?: return DEFAULT
        val stepped = JsonValues.jsRound(value / STEP) * STEP
        return stepped.coerceIn(MIN.toDouble(), MAX.toDouble()).toInt()
    }

    /** 實際亮度（%）＝ 格子亮度 × 總亮度。 */
    fun effective(cell: Int, master: Int): Double = (cell * master).toDouble() / 100

    /** 蓋在畫面上的黑色遮罩的不透明度（0–1）；100% 時是 0。 */
    fun dimOpacity(cell: Int, master: Int): Double = (1 - effective(cell, master) / 100).coerceIn(0.0, 1.0)
}

/** 音量（桌面版 R7、R42；Android 版 R152）。最高 100%。 */
object Volume {
    const val DEFAULT = 100
    const val MAX = 100

    /** 保存的音量：0–100 的整數；不合法時用預設值。桌面版超過 100 的值當作 100。 */
    fun normalize(raw: JsonElement?): Int = JsonValues.number(raw)?.let(::clamp) ?: DEFAULT

    fun clamp(value: Double): Int = JsonValues.jsRound(value.coerceIn(0.0, MAX.toDouble())).toInt()

    /** 播放器用的音量（0–1）。 */
    fun fraction(volume: Int): Double = volume.coerceIn(0, MAX).toDouble() / MAX
}

/** 畫質的選擇（桌面版 R24、R32；Android 版 R153）：自動，或畫面高度（例如 720）。 */
sealed class Quality {
    data object Auto : Quality()
    data class Height(val height: Int) : Quality()

    /** 選單與按鈕上的名稱。 */
    val label: String
        get() = when (this) {
            Auto -> "自動"
            is Height -> "${height}p"
        }

    /** 寫進設定檔的值：`"auto"` 或數字。 */
    internal val jsonValue: JsonElement
        get() = when (this) {
            Auto -> JsonPrimitive("auto")
            is Height -> JsonPrimitive(height)
        }

    companion object {
        private const val MIN_HEIGHT = 100.0
        private const val MAX_HEIGHT = 10000.0

        /** 設定檔中的畫質：舊版的「高」是 1080p，合理範圍內的整數是畫面高度，其他都是自動。 */
        fun normalize(raw: JsonElement?): Quality {
            if (JsonValues.string(raw) == "high") return Height(1080)
            val value = JsonValues.number(raw)
            if (value != null && value == Math.rint(value) && value in MIN_HEIGHT..MAX_HEIGHT) return Height(value.toInt())
            return Auto
        }
    }
}
