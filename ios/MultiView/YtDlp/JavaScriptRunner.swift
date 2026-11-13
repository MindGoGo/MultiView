import Foundation
import JavaScriptCore

/// 用 iOS 內建的 JavaScriptCore 執行 yt-dlp 的 JS 解題程式（規格 R122）。
/// yt-dlp 原本是另外執行 deno／node，把程式從標準輸入送進去、從標準輸出讀結果；
/// 這裡改成在 App 裡執行同一段程式，把 console.log 的內容當作輸出。
enum JavaScriptRunner {
    struct Failure: Error {
        let message: String
    }

    /// 解題程式要解析很大的 JS 檔，遞迴很深；用大的堆疊，避免「Maximum call stack size exceeded」。
    private static let stackSize = 64 << 20

    private final class Box: @unchecked Sendable {
        var result: Result<String, Failure> = .failure(Failure(message: "沒有執行"))
    }

    /// 執行一段 JS，回傳它用 console.log 輸出的文字。會等到執行完才回傳。
    static func run(_ source: String) -> Result<String, Failure> {
        let box = Box()
        let done = DispatchSemaphore(value: 0)
        let thread = Thread {
            box.result = evaluate(source)
            done.signal()
        }
        thread.name = "multiview.javascript"
        thread.stackSize = stackSize
        thread.start()
        done.wait()
        return box.result
    }

    private static func evaluate(_ source: String) -> Result<String, Failure> {
        guard let context = JSContext() else {
            return .failure(Failure(message: "無法建立 JavaScriptCore 的執行環境"))
        }
        var output: [String] = []
        var failure: String?

        context.exceptionHandler = { _, exception in
            var message = exception?.toString() ?? "JS 發生例外"
            if let stack = exception?.objectForKeyedSubscript("stack"), !stack.isUndefined, !stack.isNull {
                let lines = (stack.toString() ?? "").split(separator: "\n").prefix(4).joined(separator: " ← ")
                if !lines.isEmpty { message += "（" + lines + "）" }
            }
            failure = message
        }
        let log: @convention(block) (String) -> Void = { text in
            output.append(text)
        }
        context.setObject(log, forKeyedSubscript: "__multiViewLog" as NSString)
        context.evaluateScript("""
            var console = {
              log: function () { __multiViewLog(Array.prototype.map.call(arguments, String).join(' ')); }
            };
            console.info = console.warn = console.error = console.debug = console.log;
            """)
        context.evaluateScript(source)

        if let failure {
            return .failure(Failure(message: failure))
        }
        return .success(output.joined(separator: "\n"))
    }
}

/// 給 Python 呼叫（透過 ctypes）：執行一段 JS，回傳 JSON `{"ok": 真假, "output": 文字, "error": 文字}`。
/// 回傳的字串由 Python 呼叫 multiViewFree 釋放。
func multiViewEvaluateJavaScript(_ script: UnsafePointer<CChar>?) -> UnsafeMutablePointer<CChar>? {
    let source = script.map { String(cString: $0) } ?? ""
    var payload: [String: Any]
    switch JavaScriptRunner.run(source) {
    case .success(let output):
        payload = ["ok": true, "output": output]
    case .failure(let failure):
        payload = ["ok": false, "error": failure.message]
    }
    let data = (try? JSONSerialization.data(withJSONObject: payload)) ?? Data("{\"ok\":false,\"error\":\"無法輸出結果\"}".utf8)
    return strdup(String(data: data, encoding: .utf8) ?? "{}")
}
