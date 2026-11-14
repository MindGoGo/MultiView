"""Android 版和 iOS 版共用的 mv_bridge.py 之間的接頭（規格 android-app R148）。

iOS 版用 ctypes 呼叫 App 的 C 函式執行 JS；Android 版由 Kotlin 傳一個物件進來，
它的 run(script) 用 androidx.javascriptengine（手機 WebView 的 V8）執行 JS，回傳 console.log 的內容。
"""
import mv_bridge


def install(runner) -> str:
    def run(script: str) -> str:
        return str(runner.run(script))

    mv_bridge.install_python_eval(run)
    return ''
