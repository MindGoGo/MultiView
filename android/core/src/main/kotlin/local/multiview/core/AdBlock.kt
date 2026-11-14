package local.multiview.core

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import local.multiview.core.JsonValues.array
import local.multiview.core.JsonValues.bool
import local.multiview.core.JsonValues.obj
import local.multiview.core.JsonValues.string
import java.util.regex.Pattern

/**
 * 廣告阻擋的比對（Android 版 R157）。
 *
 * 規則來源和 iOS 版相同：`ios/scripts/easylist-to-webkit.mjs` 把 EasyList 轉成的 WebKit 內容阻擋規則（JSON）。
 * iOS 把這些規則交給 WebKit；Android 的 WebView 沒有這個功能，要在 `shouldInterceptRequest` 裡自己比對每一個請求。
 * 約 5 萬條規則不能每個請求都跑一遍正規表示式，所以替每條規則選一個「一定會出現在網址裡的字」當索引，
 * 請求只比對它的網址裡有那個字的規則（廣告阻擋軟體常用的做法）。正規表示式第一次用到時才編譯。
 */
class AdBlockEngine private constructor(
    private val blockIndex: RuleIndex,
    private val exceptionIndex: RuleIndex,
    /** 整個網站不阻擋的網域（`@@||example.com^$document`）。 */
    private val allowedPages: List<String>,
    private val cosmetic: List<CosmeticRule>,
    /** 可以用的網路規則數量（顯示在設定畫面）。 */
    val networkRuleCount: Int,
    val cosmeticRuleCount: Int,
) {
    /** 請求的類型，名稱和 WebKit 的 resource-type 相同。 */
    enum class ResourceType(val raw: String) {
        DOCUMENT("document"), SCRIPT("script"), IMAGE("image"), STYLE("style-sheet"), FETCH("fetch"),
        MEDIA("media"), FONT("font"), PING("ping"), WEBSOCKET("websocket"), OTHER("other"),
    }

    internal class NetworkRule(
        val filter: String,
        val caseSensitive: Boolean,
        /** 只在這些網域的網頁上作用；`*example.com` 表示包括子網域。 */
        val ifDomains: List<String>?,
        val unlessDomains: List<String>?,
        val types: Set<String>?,
        /** `first-party` 或 `third-party`；null 是都可以。 */
        val loadType: String?,
    ) {
        private val pattern: Pattern by lazy(LazyThreadSafetyMode.PUBLICATION) {
            Pattern.compile(filter, if (caseSensitive) 0 else Pattern.CASE_INSENSITIVE)
        }

        fun matches(url: String, pageHost: String?, type: ResourceType?, thirdParty: Boolean?): Boolean {
            if (types != null && type != null && type.raw !in types) return false
            if (loadType != null && thirdParty != null && (loadType == "third-party") != thirdParty) return false
            if (ifDomains != null && (pageHost == null || ifDomains.none { domainMatches(it, pageHost) })) return false
            if (unlessDomains != null && pageHost != null && unlessDomains.any { domainMatches(it, pageHost) }) return false
            return try {
                pattern.matcher(url).find()
            } catch (_: Exception) {
                // 編譯不了的規則當作不符合
                false
            }
        }
    }

    internal class CosmeticRule(val ifDomains: List<String>?, val unlessDomains: List<String>?, val selector: String)

    /** 依網址裡的字找出可能符合的規則。 */
    internal class RuleIndex(rules: List<NetworkRule>) {
        private val byToken = HashMap<String, MutableList<NetworkRule>>()

        /** 找不到可以當索引的字：每個請求都要比對。 */
        val untokenized = ArrayList<NetworkRule>()
        val size = rules.size

        init {
            for (rule in rules) {
                val token = bestToken(rule.filter)
                if (token == null) untokenized += rule else byToken.getOrPut(token) { ArrayList() } += rule
            }
        }

        fun anyMatch(url: String, tokens: Set<String>, pageHost: String?, type: ResourceType?, thirdParty: Boolean?): Boolean {
            for (token in tokens) {
                val bucket = byToken[token] ?: continue
                for (rule in bucket) if (rule.matches(url, pageHost, type, thirdParty)) return true
            }
            for (rule in untokenized) if (rule.matches(url, pageHost, type, thirdParty)) return true
            return false
        }
    }

    /**
     * 這個請求要不要擋。
     * @param pageHost 最上層網頁的網域；不知道時為 null（有網域限制的規則不作用）。
     * @param type 請求的類型；不知道時為 null（不看規則的類型限制）。
     */
    fun shouldBlock(url: String, pageHost: String?, type: ResourceType?): Boolean {
        val page = pageHost?.lowercase()
        if (page != null && allowedPages.any { domainMatches(it, page) }) return false
        val host = hostOf(url)
        val thirdParty = if (page != null && host != null) !sameSite(page, host) else null
        val tokens = urlTokens(url)
        if (!blockIndex.anyMatch(url, tokens, page, type, thirdParty)) return false
        // WebKit 的 ignore-previous-rules：符合例外規則的請求不擋
        return !exceptionIndex.anyMatch(url, tokens, page, type, thirdParty)
    }

    /**
     * 這個網頁要隱藏的元素（元素隱藏規則），寫成 CSS。整個網站不阻擋的網域回傳空字串。
     * 每條規則各自一段：其中一段有瀏覽器不認得的選擇器時，不影響其他段。
     */
    fun cosmeticCss(pageHost: String): String {
        val page = pageHost.lowercase()
        if (allowedPages.any { domainMatches(it, page) }) return ""
        val out = StringBuilder()
        for (rule in cosmetic) {
            if (rule.ifDomains != null && rule.ifDomains.none { domainMatches(it, page) }) continue
            if (rule.unlessDomains != null && rule.unlessDomains.any { domainMatches(it, page) }) continue
            out.append(rule.selector).append("{display:none!important}\n")
        }
        return out.toString()
    }

    /** 每個請求都要比對的規則數量（找不到索引的字）；效能測試用。 */
    internal val untokenizedCount: Int get() = blockIndex.untokenized.size + exceptionIndex.untokenized.size

    companion object {
        /** 沒有規則（規則檔讀不到時用）：什麼都不擋。 */
        val EMPTY = AdBlockEngine(RuleIndex(emptyList()), RuleIndex(emptyList()), emptyList(), emptyList(), 0, 0)

        /** `||` 開頭的規則轉出來的開頭（見 easylist-to-webkit.mjs 的 urlFilter）。 */
        private const val HOST_PREFIX = """^[a-z][a-z0-9+.-]*://([^/]*\.)?"""
        private const val SEPARATOR = "[/:?=&]"

        /** 太常見、不適合當索引的字。 */
        private val commonTokens = setOf(
            "http", "https", "www", "com", "net", "org", "js", "html", "htm", "php", "css", "png", "jpg", "gif",
            "img", "images", "image", "static", "cdn", "api", "v1", "v2", "min", "index", "content", "assets",
        )

        /**
         * 載入規則。每一份是 easylist-to-webkit.mjs 輸出的一個 JSON 檔的內容（network-N.json、cosmetic-N.json）。
         * 例外規則在每一份網路規則後面都重複附上，這裡會去掉重複的。讀不懂的規則略過。
         */
        fun load(lists: List<String>): AdBlockEngine {
            val block = ArrayList<NetworkRule>()
            val exceptions = LinkedHashMap<String, NetworkRule>()
            val allowedPages = LinkedHashSet<String>()
            val cosmetic = ArrayList<CosmeticRule>()
            for (text in lists) {
                for (entry in array(JsonValues.parse(text)).orEmpty()) {
                    val rule = obj(entry) ?: continue
                    val trigger = obj(rule["trigger"]) ?: continue
                    val action = obj(rule["action"]) ?: continue
                    val filter = string(trigger["url-filter"]) ?: continue
                    val ifDomains = strings(trigger["if-domain"])
                    val unlessDomains = strings(trigger["unless-domain"])
                    when (string(action["type"])) {
                        "css-display-none" -> string(action["selector"])?.let { cosmetic += CosmeticRule(ifDomains, unlessDomains, it) }
                        "block", "ignore-previous-rules" -> {
                            val exception = string(action["type"]) != "block"
                            // 整個網站不阻擋
                            if (exception && filter == ".*") {
                                ifDomains?.let(allowedPages::addAll)
                                continue
                            }
                            val network = NetworkRule(
                                filter = filter,
                                caseSensitive = bool(trigger["url-filter-is-case-sensitive"]) == true,
                                ifDomains = ifDomains,
                                unlessDomains = unlessDomains,
                                types = strings(trigger["resource-type"])?.toSet(),
                                loadType = strings(trigger["load-type"])?.firstOrNull(),
                            )
                            if (exception) exceptions.putIfAbsent(trigger.toString(), network) else block += network
                        }
                    }
                }
            }
            return AdBlockEngine(
                RuleIndex(block),
                RuleIndex(exceptions.values.toList()),
                allowedPages.toList(),
                cosmetic,
                block.size + exceptions.size,
                cosmetic.size,
            )
        }

        private fun strings(value: JsonElement?): List<String>? =
            array(value)?.mapNotNull(::string)?.takeIf { it.isNotEmpty() }

        /** 規則的網域（`*example.com`：包括子網域；`example.com`：只有這個網域）符不符合網頁的網域。 */
        internal fun domainMatches(ruleDomain: String, host: String): Boolean {
            if (!ruleDomain.startsWith("*")) return host == ruleDomain
            val domain = ruleDomain.substring(1)
            return host == domain || host.endsWith(".$domain")
        }

        /** 網址的網域（小寫）；不是 http(s)、ws(s) 這類網址時回傳 null。 */
        internal fun hostOf(url: String): String? {
            val start = url.indexOf("://")
            if (start < 0) return null
            var end = start + 3
            while (end < url.length && url[end] != '/' && url[end] != '?' && url[end] != '#') end++
            var host = url.substring(start + 3, end)
            host = host.substringAfterLast('@')
            if (!host.startsWith("[")) host = host.substringBefore(':')
            return host.lowercase().ifEmpty { null }
        }

        /** 常見的兩段式頂級網域（例如 com.tw、co.uk）的第二段。 */
        private val secondLevelLabels = setOf("com", "co", "net", "org", "gov", "edu", "ac", "or", "ne", "idv")

        /** 可註冊的網域（大約）：最後兩段，兩段式頂級網域時是最後三段。 */
        internal fun siteOf(host: String): String {
            val labels = host.split('.')
            if (labels.size <= 2) return host
            val last = labels[labels.size - 1]
            val second = labels[labels.size - 2]
            val count = if (last.length == 2 && second in secondLevelLabels) 3 else 2
            return labels.takeLast(count).joinToString(".")
        }

        internal fun sameSite(a: String, b: String): Boolean = siteOf(a) == siteOf(b)

        /** 網址裡的字：連續的英文字母與數字（小寫）。 */
        internal fun urlTokens(url: String): Set<String> {
            val tokens = HashSet<String>()
            var start = -1
            for (i in 0..url.length) {
                val c = if (i < url.length) url[i] else '/'
                val alnum = c in 'a'..'z' || c in '0'..'9' || c in 'A'..'Z'
                if (alnum) {
                    if (start < 0) start = i
                } else if (start >= 0) {
                    tokens += url.substring(start, i).lowercase()
                    start = -1
                }
            }
            return tokens
        }

        /**
         * 規則裡「一定會完整出現在網址裡」的字：前後都是確定的分隔（非英數的字元、分隔符號、網址的開頭或結尾）。
         * 緊鄰萬用字元或沒有固定開頭、結尾的字可能只是網址裡某個字的一部分，不能當索引。
         */
        internal fun filterTokens(filter: String): List<String> {
            var body = filter
            // 前一個位置是不是確定的分隔
            var boundary = false
            if (body.startsWith(HOST_PREFIX)) {
                body = body.substring(HOST_PREFIX.length)
                boundary = true
            } else if (body.startsWith("^")) {
                body = body.substring(1)
                boundary = true
            }
            var anchoredEnd = false
            if (body.endsWith("$") && !body.endsWith("\\$")) {
                body = body.substring(0, body.length - 1)
                anchoredEnd = true
            }

            val tokens = ArrayList<String>()
            val current = StringBuilder()
            // 目前這個字的開頭是不是確定的分隔
            var startsAtBoundary = false

            fun finish(endsAtBoundary: Boolean) {
                if (current.isNotEmpty() && startsAtBoundary && endsAtBoundary) tokens += current.toString().lowercase()
                current.clear()
            }

            var i = 0
            while (i < body.length) {
                val c = body[i]
                when {
                    body.startsWith(".*", i) -> {
                        finish(false)
                        boundary = false
                        i += 2
                    }
                    body.startsWith(SEPARATOR, i) -> {
                        finish(true)
                        boundary = true
                        i += SEPARATOR.length
                    }
                    c == '\\' && i + 1 < body.length -> {
                        // 跳脫的字元一定不是英數（urlFilter 只跳脫符號）
                        finish(true)
                        boundary = true
                        i += 2
                    }
                    c in 'a'..'z' || c in '0'..'9' || c in 'A'..'Z' -> {
                        if (current.isEmpty()) startsAtBoundary = boundary
                        current.append(c)
                        i++
                    }
                    else -> {
                        finish(true)
                        boundary = true
                        i++
                    }
                }
            }
            finish(anchoredEnd)
            return tokens
        }

        /** 當索引的字：最長的，盡量不用太常見的。沒有可以用的字時回傳 null。 */
        internal fun bestToken(filter: String): String? {
            val tokens = filterTokens(filter).filter { it.length >= 2 }
            return tokens.filter { it !in commonTokens }.maxByOrNull { it.length } ?: tokens.maxByOrNull { it.length }
        }

        /** 從網址與請求標頭猜請求的類型；猜不出來時回傳 null。 */
        fun guessType(url: String, accept: String?): ResourceType? {
            val header = accept?.lowercase().orEmpty()
            when {
                header.startsWith("text/css") -> return ResourceType.STYLE
                header.startsWith("image/") -> return ResourceType.IMAGE
                header.startsWith("text/html") -> return ResourceType.DOCUMENT
            }
            val path = url.substringBefore('?').substringBefore('#').lowercase()
            return when (path.substringAfterLast('.', "")) {
                "js", "mjs" -> ResourceType.SCRIPT
                "css" -> ResourceType.STYLE
                "png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "avif", "bmp" -> ResourceType.IMAGE
                "woff", "woff2", "ttf", "otf", "eot" -> ResourceType.FONT
                "mp4", "m4s", "m3u8", "ts", "webm", "mp3", "aac", "m4a", "mpd" -> ResourceType.MEDIA
                "html", "htm" -> ResourceType.DOCUMENT
                "json", "xml" -> ResourceType.FETCH
                else -> null
            }
        }
    }
}
