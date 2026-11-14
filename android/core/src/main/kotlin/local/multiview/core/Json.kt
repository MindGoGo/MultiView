package local.multiview.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull

/**
 * 寬鬆地讀 JSON（對照 iOS 版的 JSON.swift）：欄位型別不對時當作沒有，不整份丟掉。
 * 字串、數字、true／false 分得清楚（對應 JS 的 typeof）。
 */
internal object JsonValues {
    fun parse(text: String): JsonElement? = try {
        Json.parseToJsonElement(text)
    } catch (_: Exception) {
        null
    }

    fun obj(value: JsonElement?): JsonObject? = value as? JsonObject

    fun array(value: JsonElement?): JsonArray? = value as? JsonArray

    fun string(value: JsonElement?): String? = (value as? JsonPrimitive)?.takeIf { it.isString }?.content

    fun nonEmptyString(value: JsonElement?): String? = string(value)?.takeIf { it.isNotEmpty() }

    /** JSON 的 true／false；字串 "true" 不算。 */
    fun bool(value: JsonElement?): Boolean? = (value as? JsonPrimitive)?.takeIf { !it.isString }?.booleanOrNull

    /** 有限的數字；true／false、字串不算。 */
    fun number(value: JsonElement?): Double? {
        val primitive = value as? JsonPrimitive ?: return null
        if (primitive.isString) return null
        return primitive.doubleOrNull?.takeIf { it.isFinite() }
    }
}
