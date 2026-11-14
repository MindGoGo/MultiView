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


# App 下載的新版 yt-dlp（zip 檔）的路徑；沒有時是空字串（R136）
_update_archive = ''
# 新版載入失敗、已經改用內附的版本
_update_broken = False


def use_update_archive(path: str) -> str:
    """App 啟動 Python 後呼叫：優先載入下載的新版 yt-dlp。要在第一次 import yt_dlp 之前呼叫。"""
    global _update_archive
    _update_archive = path
    if path and path not in sys.path:
        # 放在 App 自己的程式（sys.path[0]）後面、內附的 site-packages 前面
        sys.path.insert(1, path)
    return ''


def _load_yt_dlp():
    """載入 yt-dlp。下載的新版壞掉時，改用 App 內附的版本。"""
    global _update_broken
    try:
        import yt_dlp
        import yt_dlp.version
        return yt_dlp
    except Exception:  # noqa: BLE001
        if not _update_archive or _update_archive not in sys.path:
            raise
        sys.path.remove(_update_archive)
        for name in [name for name in sys.modules if name == 'yt_dlp' or name.startswith(('yt_dlp.', 'yt_dlp_ejs'))]:
            del sys.modules[name]
        _update_broken = True
        import yt_dlp
        import yt_dlp.version
        return yt_dlp


def versions(_argument: str = '') -> str:
    """Python、yt-dlp 和相關套件的版本。"""
    out = {'python': sys.version.split()[0], 'platform': sys.platform}
    try:
        yt_dlp = _load_yt_dlp()
        out['yt_dlp'] = yt_dlp.version.__version__
        # 用的是下載的新版，還是 App 內附的
        out['yt_dlp_updated'] = bool(_update_archive) and (yt_dlp.__file__ or '').startswith(_update_archive)
    except Exception as error:  # noqa: BLE001
        out['yt_dlp_error'] = repr(error)
    out['update_broken'] = _update_broken
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


def channel_videos(argument: str) -> str:
    """頻道的最新影片（規格 ios-app R142）。argument 是 JSON：{"channel_id": ..., "count": 15, "cache_dir": ...}。

    YouTube 的 RSS 摘要對 App 回傳 404 時改用這個。發布時間由「3 天前」這類文字推算（yt-dlp 的 approximate_date），
    所以只是大約的時間。回傳 JSON：{"ok": true, "videos": [{"id", "title", "timestamp"}]}，失敗時 {"ok": false, "error"}。
    """
    logger = _Logger(False)
    try:
        request = json.loads(argument)
        channel_id = str(request['channel_id'])
        if not (channel_id.startswith('UC') and len(channel_id) == 24):
            raise ValueError('頻道代碼不正確')
        count = max(1, min(int(request.get('count') or 15), 50))
        yt_dlp = _load_yt_dlp()
        import mv_jsc  # noqa: F401

        options = {
            'logger': logger,
            'quiet': True,
            'noprogress': True,
            'ignoreconfig': True,
            'skip_download': True,
            'extract_flat': 'in_playlist',
            'playlistend': count,
            'socket_timeout': 20,
            'color': 'never',
            # 用英文介面，「3 days ago」才推算得出時間
            'extractor_args': {'youtubetab': {'approximate_date': ['']}, 'youtube': {'lang': ['en']}},
        }
        if request.get('cache_dir'):
            options['cachedir'] = request['cache_dir']
        with yt_dlp.YoutubeDL(options) as downloader:
            info = downloader.extract_info(f'https://www.youtube.com/channel/{channel_id}/videos', download=False)
            info = downloader.sanitize_info(info)
        videos = []
        for entry in (info or {}).get('entries') or []:
            if not isinstance(entry, dict) or not entry.get('id'):
                continue
            videos.append({
                'id': entry['id'],
                'title': entry.get('title') or '',
                'timestamp': entry.get('timestamp') or entry.get('release_timestamp'),
            })
        return _json({'ok': True, 'videos': videos[:count]})
    except Exception as error:  # noqa: BLE001
        return _json({'ok': False, 'error': str(error), 'log': logger.lines[-8:]})


def resolve(argument: str) -> str:
    """解析一個網址。argument 是 JSON：{"url": ..., "cache_dir": ..., "verbose": bool, "timeout": 秒}。

    回傳 JSON：成功 {"ok": true, "info": {...}, "log": [...]}；失敗 {"ok": false, "error": ..., "log": [...]}。
    """
    logger = _Logger(False)
    try:
        request = json.loads(argument)
        logger.verbose = bool(request.get('verbose'))
        yt_dlp = _load_yt_dlp()
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
            # 新版 yt-dlp 需要的解題程式和 App 內附的版本不同時，允許從 yt-dlp 的 GitHub 下載（yt-dlp 會檢查雜湊值）
            'remote_components': ['ejs:github'],
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
