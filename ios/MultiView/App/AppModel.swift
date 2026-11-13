import AVFoundation
import MultiViewCore
import Observation
import UIKit

/// App 的狀態：版型、格子、聲音、播放器，以及設定檔與清單檔的保存（R123–R134）。
@MainActor
@Observable
final class AppModel {
    // MARK: 會保存的設定

    /// 設定的版型。小螢幕時實際顯示的版型見 displayedLayout（R124）。
    private(set) var layout: LayoutID
    private(set) var ratios: [LayoutID: Ratios]
    private(set) var slots: Slots
    /// 總亮度（R41、R130）。
    private(set) var masterBrightness: Int
    /// YouTube 直播、一般影片的播放方式（R88、R135）。
    private(set) var youtubeMethods: YouTubeMethods

    // MARK: 畫面狀態（不保存）

    /// App 的畫面是不是大螢幕（規格第 3 節），由畫面回報。
    private(set) var isLarge = true
    /// 每個來源的播放狀態、進度、錯誤訊息，以來源的 id 為索引。
    private(set) var statuses: [Int: PlayStatus] = [:]
    private(set) var progress: [Int: PlaybackProgress] = [:]
    private(set) var errors: [Int: String] = [:]
    /// 正在顯示操作列的格位（R127）。
    private(set) var activeCell: Int?
    private(set) var toolbarVisible = false
    /// 畫面上方的提示文字，幾秒後自動消失。
    private(set) var toast: String?
    /// 目前使用的 yt-dlp 版本；還不知道時為 nil（R136）。
    private(set) var ytdlpVersion: String?
    /// 已經下載、重新開啟 App 後生效的版本。
    private(set) var ytdlpPendingVersion: String?
    private(set) var ytdlpUpdating = false

    // MARK: 內部

    @ObservationIgnored private var players: [Int: CellPlayer] = [:]
    @ObservationIgnored private var titles: [Int: String] = [:]
    /// 設定檔裡這個版本還沒有畫面可以改的欄位，保存時原樣寫回。
    @ObservationIgnored private var baseSettings: Settings
    @ObservationIgnored private var lists: Lists
    private let settingsURL: URL
    private let listsURL: URL
    /// 開啟 App 之後播放過的來源。還沒播放過的來源保留原本的觀看進度（R55）。
    @ObservationIgnored private var everPlayed: Set<Int> = []
    @ObservationIgnored private var saveTask: Task<Void, Never>?
    @ObservationIgnored private var hideTask: Task<Void, Never>?
    @ObservationIgnored private var toastTask: Task<Void, Never>?
    /// 滑桿等彈出視窗開著時，操作列與工具列不自動隱藏。
    @ObservationIgnored private var controlsHeld = false

    /// 操作列與工具列在手指離開後多久隱藏（R127）。
    private static let controlsTimeout: Duration = .seconds(3)
    private static let toastTimeout: Duration = .seconds(3)
    /// 變更後多久寫入設定檔（R10 AC3：最晚 1 秒內）。
    private static let saveDelay: Duration = .milliseconds(300)

    init(directory: URL? = nil) {
        let folder = directory ?? AppModel.defaultDirectory()
        settingsURL = folder.appendingPathComponent(FileStore.settingsFileName)
        listsURL = folder.appendingPathComponent(FileStore.listsFileName)

        let settings = FileStore.loadSettings(at: settingsURL)
        baseSettings = settings
        lists = FileStore.loadLists(at: listsURL)
        layout = settings.layout
        ratios = settings.ratios
        masterBrightness = settings.brightness
        youtubeMethods = AppModel.initialMethods(settings.youtubeMethods)
        // 還原的來源載入後維持暫停（R10 AC1）
        slots = SettingsBridge.restoreSlots(settings.slots)

        configureAudioSession()
        startYtDlpAutoUpdate()
    }

    /// iOS 版預設用 yt-dlp 播放 YouTube（R135：實測拿得到 720p，而且原生播放器才能多格同時出聲）。
    /// 0.0.7 以前的版本沒有這個選項，設定檔裡存的是「內嵌播放器」，所以第一次改成預設值。
    private static func initialMethods(_ saved: YouTubeMethods) -> YouTubeMethods {
        let key = "youtubeMethodsDefaultApplied"
        if UserDefaults.standard.bool(forKey: key) {
            return saved
        }
        UserDefaults.standard.set(true, forKey: key)
        return YouTubeMethods(live: .ytdlp, vod: .ytdlp)
    }

    private static func defaultDirectory() -> URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        return base.appendingPathComponent("MultiView", isDirectory: true)
    }

    /// 多格可以同時出聲，不和其他 App 混音（R120、R128）。
    private func configureAudioSession() {
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .moviePlayback)
        try? session.setActive(true)
    }

    // MARK: 版型

    /// 實際顯示的版型：小螢幕時 `2×2`、`3×3`、`1+3` 暫時用 `2` 顯示（R124）。
    var displayedLayout: LayoutID {
        ScreenRules.displayedLayout(layout, isLarge: isLarge)
    }

    var availableLayouts: [LayoutID] {
        ScreenRules.availableLayouts(isLarge: isLarge)
    }

    func ratios(for layout: LayoutID) -> Ratios {
        ratios[layout] ?? Ratios.defaults(for: layout)
    }

    func setScreen(isLarge: Bool) {
        guard self.isLarge != isLarge else { return }
        self.isLarge = isLarge
        pauseHiddenSources()
    }

    func setLayout(_ layout: LayoutID) {
        guard self.layout != layout else { return }
        self.layout = layout
        pauseHiddenSources()
        if let activeCell, !isVisible(activeCell) {
            self.activeCell = nil
        }
        let hidden = SlotRules.hiddenCount(slots, layout: layout)
        if hidden > 0 {
            showToast("有 \(hidden) 個來源暫時隱藏")
        }
        scheduleSave()
    }

    func moveDivider(layout: LayoutID, axis: TrackAxis, index: Int, to position: Double, min: Double) {
        var current = ratios(for: layout)
        if axis == .cols {
            current.cols = LayoutMath.moveDivider(current.cols, index: index, to: position, min: min)
        } else {
            current.rows = LayoutMath.moveDivider(current.rows, index: index, to: position, min: min)
        }
        ratios[layout] = current
        scheduleSave()
    }

    func resetDivider(layout: LayoutID, axis: TrackAxis, index: Int, min: Double) {
        var current = ratios(for: layout)
        if axis == .cols {
            current.cols = LayoutMath.resetDivider(current.cols, index: index, min: min)
        } else {
            current.rows = LayoutMath.resetDivider(current.rows, index: index, min: min)
        }
        ratios[layout] = current
        scheduleSave()
    }

    /// 格子裡第一個 YouTube 影片的網址（yt-dlp 測試畫面預先填入）。
    var firstYouTubeURL: String? {
        slots.compactMap { $0 }.first { $0.parsed.kind == .youtube }?.url
    }

    func isVisible(_ index: Int) -> Bool {
        SlotRules.isVisible(index, layout: displayedLayout)
    }

    // MARK: 來源

    /// 在格子放入網址（R126）。成功回傳 nil，失敗回傳要顯示的訊息。
    /// 已經有影片的格子是更換網址：保留靜音、音量、亮度（R2 AC8）。
    @discardableResult
    func setSource(_ text: String, at index: Int) -> String? {
        let url = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard slots.indices.contains(index), let parsed = SourceParser.parse(url) else {
            return ListError.unsupported.message
        }
        var source = CellSource(url: url, parsed: parsed, autoplay: true, record: true)
        if let old = slots[index] {
            source.muted = old.muted
            source.volume = old.volume
            source.brightness = old.brightness
            releasePlayer(old.id)
        } else {
            // 已經有顯示中的來源有聲音時，新來源靜音（R7 AC1）
            source.muted = AudioRules.initialMuted(slots, layout: displayedLayout)
        }
        slots = SlotRules.set(slots, index, source)
        scheduleSave()
        return nil
    }

    func removeSource(at index: Int) {
        guard slots.indices.contains(index), let source = slots[index] else { return }
        releasePlayer(source.id)
        slots = SlotRules.set(slots, index, nil)
        if activeCell == index {
            activeCell = nil
        }
        scheduleSave()
    }

    /// 這個來源的播放器；第一次要用時才建立，之後沿用同一個。
    func player(for source: CellSource) -> CellPlayer {
        if let player = players[source.id] {
            return player
        }
        let player = makePlayer(source)
        let id = source.id
        player.onUpdate = { [weak self] update in
            self?.apply(update, id: id)
        }
        players[id] = player
        return player
    }

    private func makePlayer(_ source: CellSource) -> CellPlayer {
        switch source.parsed {
        case .youtube(let videoID):
            let player = YouTubeSourcePlayer(videoID: videoID, source: source, methods: youtubeMethods)
            player.onFallback = { [weak self] reason in
                self?.showToast("yt-dlp 無法播放，已改用內嵌播放器")
                self?.updateYtDlpAfterFailure(reason)
            }
            return player
        case .hls(let href), .mp4(let href):
            if let url = URL(string: href) {
                return NativePlayer(url: url, source: source)
            }
        case .web(let href):
            if let url = URL(string: href) {
                return WebPagePlayer(url: url, source: source)
            }
        }
        // 網址判斷通過但系統無法使用的網址：顯示成空白的網頁
        return WebPagePlayer(url: URL(string: "about:blank") ?? URL(fileURLWithPath: "/"), source: source)
    }

    private func releasePlayer(_ id: Int) {
        players[id]?.shutdown()
        players[id] = nil
        statuses[id] = nil
        progress[id] = nil
        errors[id] = nil
        titles[id] = nil
        everPlayed.remove(id)
    }

    private func apply(_ update: PlayerUpdate, id: Int) {
        guard players[id] != nil else { return }
        if statuses[id] != update.status {
            statuses[id] = update.status
            updateIdleTimer()
        }
        if progress[id] != update.progress {
            progress[id] = update.progress
        }
        if errors[id] != update.errorMessage {
            errors[id] = update.errorMessage
        }
        if let title = update.title {
            titles[id] = title
        }
        if update.status == .playing {
            everPlayed.insert(id)
        }
        if update.status == .playing || update.status == .paused {
            recordHistoryIfNeeded(id: id)
        }
    }

    /// 使用者放入的來源，第一次成功載入時記錄到歷史（R23）。
    private func recordHistoryIfNeeded(id: Int) {
        guard let index = slots.firstIndex(where: { $0?.id == id }), var source = slots[index], source.record else { return }
        source.record = false
        slots[index] = source
        let now = Date().timeIntervalSince1970 * 1000
        lists = ListRules.recordHistory(lists, url: source.url, title: titles[id], now: now)
        try? FileStore.saveLists(lists, to: listsURL)
    }

    // MARK: 聲音（R128）

    /// 點一下有影片的格子：只有這一格有聲音，並顯示操作列與工具列（R127、R128）。
    func tapCell(_ index: Int) {
        guard slots.indices.contains(index), slots[index] != nil else { return }
        let wasPlaying = playingSourceIDs()
        slots = AudioRules.focus(slots, index)
        syncAudio()
        resumeIfInterrupted(wasPlaying)
        showControls(for: index)
        scheduleSave()
    }

    /// 喇叭：只切換這一格，不影響其他格子（多格聲音，R128）。
    func toggleMute(_ index: Int) {
        if AudioRules.unmutingSilencesOthers(slots, index, usesWebAudio: usesWebAudio) {
            showToast("內嵌播放器和網頁的格子同一時間只能有一格有聲音")
        }
        let wasPlaying = playingSourceIDs()
        slots = AudioRules.toggleMute(slots, index, usesWebAudio: usesWebAudio)
        syncAudio()
        resumeIfInterrupted(wasPlaying)
        keepControlsVisible()
        scheduleSave()
    }

    /// 這個來源現在是不是用網頁播放聲音。YouTube 用 yt-dlp 播放時是原生播放器，不算。
    private func usesWebAudio(_ source: CellSource) -> Bool {
        players[source.id]?.usesWebAudio ?? source.usesWebAudio
    }

    // MARK: yt-dlp 的版本與更新（R136）

    /// 開啟 App 後在背景檢查更新（距離上次檢查超過 24 小時才檢查），不顯示訊息。
    func startYtDlpAutoUpdate() {
        Task { [weak self] in
            // 先讓畫面和影片載入
            try? await Task.sleep(for: .seconds(5))
            await self?.refreshYtDlpVersion()
            if let outcome = await YtDlpUpdater.shared.autoUpdateIfNeeded() {
                self?.noteYtDlpUpdate(outcome)
            }
        }
    }

    /// 選單的「檢查更新」。
    func checkYtDlpUpdate() {
        guard !ytdlpUpdating else { return }
        ytdlpUpdating = true
        Task { [weak self] in
            let outcome = await YtDlpUpdater.shared.update(allowConstrainedNetwork: true)
            self?.ytdlpUpdating = false
            self?.noteYtDlpUpdate(outcome)
            self?.showToast(outcome.message)
        }
    }

    /// 解析失敗、看起來是 yt-dlp 太舊：在背景更新，下次開啟 App 生效。
    private func updateYtDlpAfterFailure(_ reason: String) {
        Task { [weak self] in
            if let outcome = await YtDlpUpdater.shared.updateAfterFailure(reason), case .updated = outcome {
                self?.noteYtDlpUpdate(outcome)
                self?.showToast(outcome.message)
            }
        }
    }

    private func noteYtDlpUpdate(_ outcome: YtDlpUpdater.Outcome) {
        if case .updated(let version) = outcome {
            ytdlpPendingVersion = version
        }
    }

    private func refreshYtDlpVersion() async {
        guard let text = try? await PythonRuntime.shared.call("versions"),
              let info = (try? JSONSerialization.jsonObject(with: Data(text.utf8))) as? [String: Any]
        else { return }
        ytdlpVersion = info["yt_dlp"] as? String
        // 有下載的新版、但 Python 沒有用到它：檔案壞了，刪掉之後重新下載
        let usesUpdate = (info["yt_dlp_updated"] as? Bool) == true
        if !usesUpdate, FileManager.default.fileExists(atPath: YtDlpUpdater.archiveURL.path) {
            YtDlpUpdater.discardArchive()
        }
    }

    /// 播放方式的小標示（R109），例如「yt-dlp」。
    func badge(of source: CellSource) -> String? {
        players[source.id]?.badge
    }

    /// 改變 YouTube 的播放方式（R88）：YouTube 格子從目前的位置重新載入。
    func setYouTubeMethods(_ methods: YouTubeMethods) {
        guard methods != youtubeMethods else { return }
        youtubeMethods = methods
        for (index, source) in slots.enumerated() {
            guard var source, source.parsed.kind == .youtube else { continue }
            if players[source.id] != nil {
                source.autoplay = statuses[source.id]?.showsPause ?? false
                source.resume = ProgressRules.resumePosition(progress[source.id]) ?? source.resume
                releasePlayer(source.id)
            }
            slots[index] = source
        }
        keepControlsVisible()
        scheduleSave()
    }

    private func playingSourceIDs() -> Set<Int> {
        Set(statuses.filter { $0.value == .playing }.keys)
    }

    /// 切換聲音時，iOS 可能把另一個網頁播放的格子暫停（實測）。那一格已經靜音，過一下再讓它繼續播。
    private func resumeIfInterrupted(_ wasPlaying: Set<Int>) {
        let candidates = slots.compactMap { $0 }.filter { usesWebAudio($0) && $0.muted && wasPlaying.contains($0.id) }.map(\.id)
        guard !candidates.isEmpty else { return }
        Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(900))
            guard let self else { return }
            for id in candidates where self.statuses[id] == .paused {
                // 這段時間內被使用者靜音以外的操作改動過的就不管
                guard let source = self.slots.compactMap({ $0 }).first(where: { $0.id == id }), source.muted else { continue }
                self.players[id]?.play()
            }
        }
    }

    func setVolume(_ index: Int, _ volume: Double) {
        slots = AudioRules.setVolume(slots, index, volume)
        syncAudio()
        scheduleSave()
    }

    func muteAll() {
        slots = AudioRules.muteAll(slots)
        syncAudio()
        keepControlsVisible()
        scheduleSave()
    }

    private func syncAudio() {
        for source in slots.compactMap({ $0 }) {
            guard let player = players[source.id] else { continue }
            player.setMuted(source.muted)
            player.setVolume(source.volume)
        }
    }

    // MARK: 亮度（R130）

    func setBrightness(_ index: Int, _ value: Double) {
        guard slots.indices.contains(index), var source = slots[index] else { return }
        source.brightness = Brightness.normalize(value)
        slots[index] = source
        scheduleSave()
    }

    func setMasterBrightness(_ value: Double) {
        masterBrightness = Brightness.normalize(value)
        scheduleSave()
    }

    // MARK: 播放（R129）

    func status(of source: CellSource) -> PlayStatus {
        statuses[source.id] ?? .loading
    }

    func togglePlay(_ index: Int) {
        guard slots.indices.contains(index), let source = slots[index], let player = players[source.id] else { return }
        if status(of: source).showsPause {
            player.pause()
        } else {
            player.play()
        }
        keepControlsVisible()
    }

    /// 工具列的全部播放／暫停：只要有任何一格在播放就全部暫停，否則全部播放（R8、R9）。
    var toggleAllAction: PlaybackRules.ToggleAction {
        PlaybackRules.toggleAllAction(slots, layout: displayedLayout, statuses: statuses)
    }

    func toggleAll() {
        let action = toggleAllAction
        for index in PlaybackRules.controllableIndices(slots, layout: displayedLayout, statuses: statuses) {
            guard let source = slots[index], let player = players[source.id] else { continue }
            if action == .play {
                player.play()
            } else {
                player.pause()
            }
        }
        keepControlsVisible()
    }

    func seek(_ index: Int, fraction: Double) {
        guard slots.indices.contains(index), let source = slots[index], let current = progress[source.id] else { return }
        players[source.id]?.seek(to: ProgressRules.seekTarget(current, fraction: fraction))
        keepControlsVisible()
    }

    /// 不在目前版型裡的來源暫停（R4 AC3、R124）。回到版型裡時維持暫停。
    private func pauseHiddenSources() {
        for (index, source) in slots.enumerated() {
            guard let source, !isVisible(index) else { continue }
            players[source.id]?.pause()
        }
    }

    /// 播放中不自動鎖定螢幕（R123）。
    private func updateIdleTimer() {
        UIApplication.shared.isIdleTimerDisabled = statuses.values.contains(.playing)
    }

    // MARK: 操作列與工具列（R127）

    func showControls(for index: Int?) {
        activeCell = index
        toolbarVisible = true
        restartHideTimer()
    }

    func hideControls() {
        hideTask?.cancel()
        activeCell = nil
        toolbarVisible = false
    }

    /// 使用者還在操作：重新計算自動隱藏的時間。
    func keepControlsVisible() {
        if toolbarVisible || activeCell != nil {
            restartHideTimer()
        }
    }

    /// 滑桿等彈出視窗開啟或關閉時呼叫；開著的時候不自動隱藏。
    func holdControls(_ hold: Bool) {
        guard controlsHeld != hold else { return }
        controlsHeld = hold
        if hold {
            hideTask?.cancel()
        } else {
            keepControlsVisible()
        }
    }

    private func restartHideTimer() {
        hideTask?.cancel()
        guard !controlsHeld else { return }
        hideTask = Task { [weak self] in
            try? await Task.sleep(for: AppModel.controlsTimeout)
            guard !Task.isCancelled else { return }
            self?.activeCell = nil
            self?.toolbarVisible = false
        }
    }

    func showToast(_ message: String) {
        toast = message
        toastTask?.cancel()
        toastTask = Task { [weak self] in
            try? await Task.sleep(for: AppModel.toastTimeout)
            guard !Task.isCancelled else { return }
            self?.toast = nil
        }
    }

    // MARK: 保存（R134）

    private func scheduleSave() {
        guard saveTask == nil else { return }
        saveTask = Task { [weak self] in
            try? await Task.sleep(for: AppModel.saveDelay)
            self?.saveNow()
        }
    }

    /// 立刻寫入設定檔。切到背景時也會呼叫（iOS 沒有「關閉程式」的時機）。
    func saveNow() {
        saveTask?.cancel()
        saveTask = nil

        // 觀看進度：直播、播完、太接近開頭或結尾的不保存（R55）
        var positions: [Int: Double] = [:]
        for (index, source) in slots.enumerated() {
            guard let source else { continue }
            if !everPlayed.contains(source.id) {
                // 開啟 App 之後還沒播放過的來源：保留原本的進度（播放前播放器回報的位置是 0）
                if let resume = source.resume { positions[index] = resume }
            } else if let position = ProgressRules.resumePosition(progress[source.id], ended: statuses[source.id] == .ended) {
                positions[index] = position
            }
        }

        var settings = baseSettings
        settings.layout = layout
        settings.ratios = ratios
        settings.brightness = masterBrightness
        settings.youtubeMethods = youtubeMethods
        settings.slots = SettingsBridge.saveSlots(slots, positions: positions)
        baseSettings = settings
        try? FileStore.saveSettings(settings, to: settingsURL)
    }
}
