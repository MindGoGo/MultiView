"""MultiView iOS 版和 yt-dlp 之間的橋接（規格 ios-app R122、R135）。

App 啟動內嵌的 Python 之後，從 Swift 呼叫這裡的函式；參數和回傳值都是 JSON 字串。
yt-dlp 解析 YouTube 需要執行 JS，iOS 上沒有 Node／Deno，改成呼叫 App 提供的函式，
由 iOS 內建的 JavaScriptCore 執行（見 mv_jsc.py）。
"""
import ctypes
import json
import sys
import traceback

# App 提供的函式：執行一段 JS，回傳 JSON 字串 {"ok": bool, "output": str, "error": str}
_eval_js = None
_free = None


def install(eval_address: int, free_address: int) -> None:
    """記下 App 提供的 C 函式位址。位址是 0 表示沒有提供。"""
    global _eval_js, _free
    if eval_address and free_address:
        _eval_js = ctypes.CFUNCTYPE(ctypes.c_void_p, ctypes.c_char_p)(eval_address)
        _free = ctypes.CFUNCTYPE(None, ctypes.c_void_p)(free_address)


def install_python_eval(function) -> None:
    """測試用：直接用 Python 函式執行 JS（function(script) -> 輸出的文字）。"""
    global _eval_js, _free
    _eval_js = function
    _free = None


def can_eval_js() -> bool:
    return _eval_js is not None


def eval_js(script: str) -> str:
    """執行 JS，回傳它用 console.log 輸出的文字；失敗時丟出 RuntimeError。"""
    if _eval_js is None:
        raise RuntimeError('App 沒有提供 JS 執行環境')
    if _free is None:
        return _eval_js(script)
    pointer = _eval_js(script.encode('utf-8'))
    if not pointer:
        raise RuntimeError('JS 執行環境沒有回傳結果')
    try:
        raw = ctypes.string_at(pointer).decode('utf-8')
    finally:
        _free(pointer)
    result = json.loads(raw)
    if not result.get('ok'):
        raise RuntimeError(result.get('error') or 'JS 執行失敗')
    return result.get('output') or ''


def _json(value) -> str:
    return json.dumps(value, ensure_ascii=False)


def versions(_argument: str = '') -> str:
    """Python、yt-dlp 和相關套件的版本。"""
    out = {'python': sys.version.split()[0], 'platform': sys.platform}
    try:
        import yt_dlp.version
        out['yt_dlp'] = yt_dlp.version.__version__
    except Exception as error:  # noqa: BLE001
        out['yt_dlp_error'] = repr(error)
    try:
        import yt_dlp_ejs
        out['yt_dlp_ejs'] = getattr(yt_dlp_ejs, 'version', '?')
    except Exception as error:  # noqa: BLE001
        out['yt_dlp_ejs_error'] = repr(error)
    try:
        import certifi
        out['certifi'] = certifi.__version__
    except Exception as error:  # noqa: BLE001
        out['certifi_error'] = repr(error)
    try:
        import ssl
        out['openssl'] = ssl.OPENSSL_VERSION
    except Exception as error:  # noqa: BLE001
        out['ssl_error'] = repr(error)
    out['js'] = can_eval_js()
    return _json(out)


def js_selftest(_argument: str = '') -> str:
    """確認 JS 執行環境能用：算一個簡單的式子，再載入 yt-dlp 的解題程式。"""
    out = {}
    try:
        out['simple'] = eval_js('console.log(JSON.stringify({sum: 1 + 2, text: "ok"}))').strip()
    except Exception as error:  # noqa: BLE001
        out['simple_error'] = str(error)
    try:
        import yt_dlp_ejs.yt.solver as solver
        script = f'{solver.lib()}\nObject.assign(globalThis, lib);\n{solver.core()}\nconsole.log(typeof jsc);\n'
        out['solver'] = eval_js(script).strip()
    except Exception as error:  # noqa: BLE001
        out['solver_error'] = str(error)
    return _json(out)


class _Logger:
    """收集 yt-dlp 的訊息，連同結果一起回傳給 App 顯示。"""

    def __init__(self, verbose: bool):
        self.lines = []
        self.verbose = verbose

    def debug(self, message):
        # yt-dlp 把一般訊息也送到 debug；開頭是 [debug] 的才是除錯訊息
        if message.startswith('[debug] ') and not self.verbose:
            return
        self.lines.append(message)

    def info(self, message):
        self.lines.append(message)

    def warning(self, message):
        self.lines.append(f'WARNING: {message}')

    def error(self, message):
        self.lines.append(f'ERROR: {message}')


# 回傳給 App 的格式欄位（和桌面版 src/lib/ytdlp.ts 的 pickStream 用到的相同）
_FORMAT_KEYS = ('format_id', 'protocol', 'url', 'manifest_url', 'vcodec', 'acodec', 'height', 'width', 'ext',
                'http_headers', 'format_note', 'tbr', 'language')
_INFO_KEYS = ('id', 'title', 'fulltitle', 'is_live', 'live_status', 'duration', 'extractor', 'webpage_url',
              'http_headers')


def _slim(info: dict) -> dict:
    out = {key: info.get(key) for key in _INFO_KEYS if info.get(key) is not None}
    if info.get('_type'):
        out['_type'] = info['_type']
    if isinstance(info.get('formats'), list):
        out['formats'] = [{key: f.get(key) for key in _FORMAT_KEYS if f.get(key) is not None}
                          for f in info['formats'] if isinstance(f, dict)]
    if isinstance(info.get('entries'), list):
        out['entries'] = [_slim(entry) for entry in info['entries'] if isinstance(entry, dict)]
    return out


def resolve(argument: str) -> str:
    """解析一個網址。argument 是 JSON：{"url": ..., "cache_dir": ..., "verbose": bool, "timeout": 秒}。

    回傳 JSON：成功 {"ok": true, "info": {...}, "log": [...]}；失敗 {"ok": false, "error": ..., "log": [...]}。
    """
    logger = _Logger(False)
    try:
        request = json.loads(argument)
        logger.verbose = bool(request.get('verbose'))
        import yt_dlp
        import mv_jsc  # noqa: F401  註冊用 JavaScriptCore 解題的外掛

        options = {
            'logger': logger,
            'quiet': True,
            'verbose': logger.verbose,
            'noplaylist': True,
            'noprogress': True,
            'ignoreconfig': True,
            'skip_download': True,
            'socket_timeout': float(request.get('timeout') or 20),
            'color': 'never',
        }
        if request.get('cache_dir'):
            options['cachedir'] = request['cache_dir']
        with yt_dlp.YoutubeDL(options) as downloader:
            info = downloader.extract_info(request['url'], download=False)
            info = downloader.sanitize_info(info)
        return _json({'ok': True, 'info': _slim(info), 'log': logger.lines})
    except Exception as error:  # noqa: BLE001
        lines = logger.lines + traceback.format_exc().splitlines()[-12:]
        return _json({'ok': False, 'error': str(error), 'log': lines})
