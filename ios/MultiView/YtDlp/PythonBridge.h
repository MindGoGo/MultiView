// 內嵌 Python 的 C 介面（規格 ios-app R122）。Swift 透過 Bridging Header 呼叫。
// 回傳的字串都是 malloc 出來的，呼叫的人要用 free() 釋放。
#ifndef MultiViewPythonBridge_h
#define MultiViewPythonBridge_h

#pragma clang assume_nonnull begin

/// 啟動 Python。home 是 App 裡放標準函式庫的資料夾；search_paths 是要加到 sys.path 的路徑，用換行分隔。
/// 成功回傳 NULL，失敗回傳錯誤訊息。已經啟動時直接回傳 NULL。
char *_Nullable mv_python_start(const char *home, const char *search_paths);

/// 把 App 執行 JS 的函式交給 mv_bridge。成功回傳 NULL，失敗回傳錯誤訊息。
char *_Nullable mv_python_install_js(void *eval_function, void *free_function);

/// 呼叫 module.function(argument)，參數和回傳值都是字串。
/// 成功時 *ok 是 1，回傳函式的結果；失敗時 *ok 是 0，回傳 Python 的錯誤訊息。可以從任何執行緒呼叫。
char *mv_python_call(const char *module, const char *function, const char *argument, int *ok);

#pragma clang assume_nonnull end

#endif
