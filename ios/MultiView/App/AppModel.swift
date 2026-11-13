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
        // 還原的來源載入後維持暫停（R10 AC1）
        slots = SettingsBridge.restoreSlots(settings.slots)

        configureAudioSession()
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
            return YouTubePlayer(videoID: videoID, source: source)
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
        slots = AudioRules.focus(slots, index)
        syncAudio()
        showControls(for: index)
        scheduleSave()
    }

    func toggleMute(_ index: Int) {
        slots = AudioRules.toggleMute(slots, index)
        syncAudio()
        keepControlsVisible()
        scheduleSave()
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
        settings.slots = SettingsBridge.saveSlots(slots, positions: positions)
        baseSettings = settings
        try? FileStore.saveSettings(settings, to: settingsURL)
    }
}
