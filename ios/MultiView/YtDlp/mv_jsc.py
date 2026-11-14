"""yt-dlp 的 JS 解題外掛：用 App 提供的 JavaScriptCore 執行解題程式（規格 ios-app R122）。

yt-dlp 內建的做法是另外執行 deno／node／bun／quickjs，iOS 不能執行其他程式，
所以把同一段 JS 交給 App，由 iOS 內建的 JavaScriptCore 執行。
"""
from yt_dlp.extractor.youtube.jsc._builtin.ejs import EJSBaseJCP
from yt_dlp.extractor.youtube.jsc.provider import (
    JsChallengeProviderError,
    register_preference,
    register_provider,
)

import mv_bridge


@register_provider
class MultiViewJCP(EJSBaseJCP):
    PROVIDER_NAME = 'multiview'
    PROVIDER_VERSION = '1'
    BUG_REPORT_LOCATION = 'https://github.com/MindGoGo/MultiView/issues'
    JS_RUNTIME_NAME = 'javascriptcore'

    @property
    def runtime_info(self):
        # 不是 yt-dlp 認識的外部 JS 執行環境
        return None

    def is_available(self, /) -> bool:
        return self._available and mv_bridge.can_eval_js()

    def _run_js_runtime(self, stdin: str, /) -> str:
        try:
            return mv_bridge.eval_js(stdin)
        except Exception as error:  # noqa: BLE001
            raise JsChallengeProviderError(f'JavaScriptCore 執行失敗：{error}') from error


@register_preference(MultiViewJCP)
def _preference(provider, requests) -> int:
    # 比內建的 deno（1000）、node 等都優先
    return 2000
