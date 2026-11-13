import Foundation

enum PythonError: LocalizedError {
    case failed(String)

    var errorDescription: String? {
        switch self {
        case .failed(let message): return message
        }
    }
}

/// App 裡內嵌的 Python（規格 R122）。iOS 不能另外執行程式，yt-dlp 是在 App 自己的程序裡、用另外的執行緒執行。
final class PythonRuntime: @unchecked Sendable {
    static let shared = PythonRuntime()

    /// Python 的執行緒要比預設（512KB）大的堆疊，yt-dlp 的遞迴比較深。
    private static let stackSize = 16 << 20

    private let lock = NSLock()
    private var started = false
    private var startError: String?

    /// 呼叫 `mv_bridge` 裡的函式。參數和回傳值都是字串（通常是 JSON）。
    func call(_ function: String, argument: String = "", module: String = "mv_bridge") async throws -> String {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<String, Error>) in
            let thread = Thread {
                do {
                    try self.startIfNeeded()
                    var ok: Int32 = 0
                    let raw = mv_python_call(module, function, argument, &ok)
                    let text = String(cString: raw)
                    free(raw)
                    if ok != 0 {
                        continuation.resume(returning: text)
                    } else {
                        continuation.resume(throwing: PythonError.failed(text))
                    }
                } catch {
                    continuation.resume(throwing: error)
                }
            }
            thread.name = "multiview.python"
            thread.stackSize = PythonRuntime.stackSize
            thread.start()
        }
    }

    private func startIfNeeded() throws {
        lock.lock()
        defer { lock.unlock() }
        if started { return }
        if let startError { throw PythonError.failed(startError) }

        do {
            try start()
            started = true
        } catch {
            startError = error.localizedDescription
            throw error
        }
    }

    private func start() throws {
        guard let resources = Bundle.main.resourcePath else {
            throw PythonError.failed("找不到 App 的資源資料夾")
        }
        let home = resources + "/python"
        guard FileManager.default.fileExists(atPath: home + "/lib") else {
            throw PythonError.failed("這個版本的 App 沒有內附 Python")
        }
        // mv_bridge.py、mv_jsc.py 在資源資料夾；yt-dlp 等套件在 site-packages
        let searchPaths = [resources, resources + "/site-packages"].joined(separator: "\n")
        if let error = mv_python_start(home, searchPaths) {
            throw PythonError.failed("Python 啟動失敗：" + PythonRuntime.take(error))
        }

        let evaluate: @convention(c) (UnsafePointer<CChar>?) -> UnsafeMutablePointer<CChar>? = multiViewEvaluateJavaScript
        let release: @convention(c) (UnsafeMutableRawPointer?) -> Void = multiViewFree
        if let error = mv_python_install_js(
            unsafeBitCast(evaluate, to: UnsafeMutableRawPointer.self),
            unsafeBitCast(release, to: UnsafeMutableRawPointer.self)
        ) {
            throw PythonError.failed("無法載入 mv_bridge：" + PythonRuntime.take(error))
        }
    }

    private static func take(_ pointer: UnsafeMutablePointer<CChar>) -> String {
        let text = String(cString: pointer)
        free(pointer)
        return text
    }
}

/// 給 Python 呼叫：釋放 multiViewEvaluateJavaScript 回傳的字串。
private func multiViewFree(_ pointer: UnsafeMutableRawPointer?) {
    free(pointer)
}
