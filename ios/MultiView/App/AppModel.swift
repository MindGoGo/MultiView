import AVFoundation
import MediaPlayer
import MultiViewCore
import Observation
import UIKit
import WebKit

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
    /// 最愛、歷史、訂閱頻道（R141、R142）；存在清單檔，和設定檔分開。
    private(set) var lists: Lists
    /// 清單面板上次的那一邊和分頁（R58）。
    private(set) var listTab: ListTab

    // MARK: 畫面狀態（不保存）

    /// App 的畫面是不是大螢幕（規格第 3 節），由畫面回報。
    private(set) var isLarge = true
    /// 每個來源的播放狀態、進度、錯誤訊息，以來源的 id 為索引。
    private(set) var statuses: [Int: PlayStatus] = [:]
    private(set) var progress: [Int: PlaybackProgress] = [:]
    private(set) var errors: [Int: String] = [:]
    /// 正在顯示操作列的格位（R127）。
    private(set) var activeCell: Int?
    /// 單格全螢幕時放大的格位（R20、R129）；不保存。
    private(set) var solo: Int?
    /// 拖曳換位中：被拖的格位，以及手指目前所在的格位（R125）。
    private(set) var swapFrom: Int?
    private(set) var swapOver: Int?
    private(set) var toolbarVisible = false
    /// 畫面上方的提示文字，幾秒後自動消失。
    private(set) var toast: String?
    /// 目前使用的 yt-dlp 版本；還不知道時為 nil（R136）。
    private(set) var ytdlpVersion: String?
    /// 已經下載、重新開啟 App 後生效的版本。
    private(set) var ytdlpPendingVersion: String?
    private(set) var ytdlpUpdating = false
    /// 清單面板、設定畫面是不是開著。
    var listPanelOpen = false
    var settingsOpen = false
    /// 從清單點了一筆、但沒有空格：等使用者選擇要取代哪一格（R64）。
    var pendingReplaceURL: String?

    // MARK: 內部

    @ObservationIgnored private var players: [Int: CellPlayer] = [:]
    @ObservationIgnored private var titles: [Int: String] = [:]
    /// 設定檔裡這個版本還沒有畫面可以改的欄位，保存時原樣寫回。
    @ObservationIgnored private var baseSettings: Settings
    private let settingsURL: URL
    private let listsURL: URL
    /// 開啟 App 之後播放過的來源。還沒播放過的來源保留原本的觀看進度（R55）。
    @ObservationIgnored private var everPlayed: Set<Int> = []
    @ObservationIgnored private var saveTask: Task<Void, Never>?
    @ObservationIgnored private var hideTask: Task<Void, Never>?
    @ObservationIgnored private var toastTask: Task<Void, Never>?
    /// 滑桿等彈出視窗開著時，操作列與工具列不自動隱藏。
    @ObservationIgnored private var controlsHeld = false
    /// 進入單格全螢幕時因此暫停的來源；離開時恢復播放。
    @ObservationIgnored private var soloPaused: Set<Int> = []
    /// 切到背景、或被其他 App 的聲音打斷時因此暫停的來源；回來時恢復播放。
    @ObservationIgnored private var backgroundPaused: Set<Int> = []
    @ObservationIgnored private var interruptionPaused: Set<Int> = []
    @ObservationIgnored private var inBackground = false
    /// 格子區域的大小與 `2` 版型是不是上下排列，由畫面回報（拖曳換位時用來找手指在哪一格）。
    @ObservationIgnored private var gridSize: CGSize = .zero
    @ObservationIgnored private var gridStacked = false
    @ObservationIgnored private var observers: [NSObjectProtocol] = []

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
        listTab = settings.listTab
        // 還原的來源載入後維持暫停（R10 AC1）
        slots = SettingsBridge.restoreSlots(settings.slots)

        configureAudioSession()
        observeAudioSession()
        configureRemoteCommands()
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
        // 單格全螢幕時按版型：先回到分割畫面，再切換版型（R20 AC6）
        exitSolo()
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
        SlotRules.isVisible(index, layout: displayedLayout, solo: solo)
    }

    // MARK: 單格全螢幕（R20、R129）

    /// 這一格占滿畫面，其他顯示中、正在播放的來源暫停。
    func enterSolo(_ index: Int) {
        guard solo == nil, slots.indices.contains(index), slots[index] != nil, isVisible(index) else { return }
        soloPaused = []
        for (position, source) in slots.enumerated() {
            guard let source, position != index, isVisible(position), statuses[source.id] == .playing else { continue }
            soloPaused.insert(source.id)
            players[source.id]?.pause()
        }
        solo = index
        cancelSwap()
        showControls(for: index)
        updatePictureInPicture()
    }

    /// 回到分割畫面；只有進入時正在播放的其他來源恢復播放。
    func exitSolo() {
        guard solo != nil else { return }
        solo = nil
        for id in soloPaused {
            players[id]?.play()
        }
        soloPaused = []
        keepControlsVisible()
        updatePictureInPicture()
    }

    func toggleSolo(_ index: Int) {
        if solo == nil {
            enterSolo(index)
        } else {
            exitSolo()
        }
    }

    // MARK: 拖曳換位（R125）

    /// 可不可以換位：`1` 版型、小螢幕的暫時版型、單格全螢幕時不行。
    var canSwap: Bool {
        solo == nil && displayedLayout == layout && layout != .one
    }

    func setGrid(size: CGSize, stacked: Bool) {
        gridSize = size
        gridStacked = stacked
    }

    func beginSwap(from index: Int) {
        guard canSwap, slots.indices.contains(index), slots[index] != nil else { return }
        swapFrom = index
        swapOver = index
        holdControls(true)
    }

    /// location：手指在格子區域裡的位置。
    func updateSwap(location: CGPoint) {
        guard swapFrom != nil, gridSize.width > 0, gridSize.height > 0 else { return }
        let x = location.x / gridSize.width
        let y = location.y / gridSize.height
        let rects = LayoutMath.cellRects(displayedLayout, ratios(for: displayedLayout), stacked: gridStacked)
        let over = rects.firstIndex { x >= $0.x && x < $0.x + $0.w && y >= $0.y && y < $0.y + $0.h }
        if swapOver != over {
            swapOver = over
        }
    }

    /// 放開：和手指所在的格子互換。放開在原本的格子或格子以外不發生變化（R6 AC3）。
    func endSwap() {
        defer { cancelSwap() }
        guard let from = swapFrom, let over = swapOver, from != over else { return }
        slots = SlotRules.swap(slots, from, over)
        if activeCell == from {
            activeCell = over
        }
        scheduleSave()
    }

    func cancelSwap() {
        guard swapFrom != nil else { return }
        swapFrom = nil
        swapOver = nil
        holdControls(false)
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
        // 單格全螢幕時移除：回到分割畫面（R20 AC7）
        if solo == index {
            exitSolo()
        }
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
            updatePictureInPicture()
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
        saveLists()
    }

    // MARK: 清單（R141）

    private func saveLists() {
        try? FileStore.saveLists(lists, to: listsURL)
    }

    func setListTab(_ tab: ListTab) {
        guard listTab != tab else { return }
        listTab = tab
        scheduleSave()
    }

    func isFavorite(_ source: CellSource) -> Bool {
        ListRules.isFavorite(lists, url: source.url)
    }

    /// 操作列的星號：加入或移出最愛（R22）。名稱用影片的標題。
    func toggleFavorite(_ index: Int) {
        guard slots.indices.contains(index), let source = slots[index] else { return }
        if ListRules.isFavorite(lists, url: source.url) {
            lists = ListRules.removeFavorite(lists, url: source.url)
            showToast("已從最愛移除")
        } else {
            let name = ListRules.defaultName(url: source.url, title: titles[source.id])
            switch ListRules.addFavorite(lists, url: source.url, name: name, now: Date().timeIntervalSince1970 * 1000) {
            case .success(let next):
                lists = next
                showToast("已加入最愛")
            case .failure(let error):
                showToast(error.message)
            }
        }
        saveLists()
        keepControlsVisible()
    }

    /// 點清單的一筆：放進第一個顯示中的空格；沒有空格時讓使用者選擇要取代哪一格（R21、R64）。
    func openFromList(_ url: String) {
        if let index = SlotRules.firstEmptyVisible(slots, layout: displayedLayout, solo: solo) {
            if let message = setSource(url, at: index) {
                showToast(message)
            } else {
                listPanelOpen = false
            }
        } else {
            pendingReplaceURL = url
        }
    }

    /// 目前顯示中、可以被取代的格位。
    var visibleSlotIndices: [Int] {
        slots.indices.filter { isVisible($0) }
    }

    func replaceSlot(_ index: Int, with url: String) {
        if let message = setSource(url, at: index) {
            showToast(message)
        } else {
            listPanelOpen = false
        }
    }

    /// 編輯清單的一筆；失敗時回傳要顯示的訊息（R21）。
    func editListItem(kind: ListKind, index: Int, url: String, name: String) -> String? {
        switch ListRules.editItem(lists, kind: kind, index: index, url: url, name: name) {
        case .success(let next):
            lists = next
            saveLists()
            return nil
        case .failure(let error):
            return error.message
        }
    }

    func deleteListItem(kind: ListKind, index: Int) {
        lists = ListRules.deleteItem(lists, kind: kind, index: index)
        saveLists()
    }

    func clearHistory(group: ListGroup) {
        lists = ListRules.clearHistory(lists, group: group)
        saveLists()
    }

    // MARK: 匯入桌面版的設定與清單（R144）

    /// 用匯入的設定取代目前的版型、格子、聲音、亮度、播放方式。匯入後所有格子維持暫停。
    func importSettings(_ settings: Settings) {
        exitSolo()
        for source in slots.compactMap({ $0 }) {
            releasePlayer(source.id)
        }
        activeCell = nil
        layout = settings.layout
        ratios = settings.ratios
        masterBrightness = settings.brightness
        youtubeMethods = settings.youtubeMethods
        listTab = settings.listTab
        slots = SettingsBridge.restoreSlots(settings.slots)
        var base = settings
        base.slots = SettingsBridge.saveSlots(slots)
        baseSettings = base
        saveNow()
    }

    /// 把匯入的清單合併進目前的清單，回傳新增了幾筆。
    func importLists(_ imported: Lists) -> ListsImport.Summary {
        let result = ListsImport.merge(current: lists, imported: imported)
        lists = result.lists
        saveLists()
        return result.summary
    }

    /// 清除網站資料（Cookie、登入狀態，R139）。
    func clearWebsiteData() async {
        let store = WKWebsiteDataStore.default()
        await store.removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast)
        showToast("已清除網站資料")
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
        updatePictureInPicture()
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
        PlaybackRules.toggleAllAction(slots, layout: displayedLayout, statuses: statuses, solo: solo)
    }

    func toggleAll() {
        let action = toggleAllAction
        for index in PlaybackRules.controllableIndices(slots, layout: displayedLayout, statuses: statuses, solo: solo) {
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

    /// 快轉（正數）或倒轉（負數）。直播和沒有進度條的格子不作用，回傳 false（R51、R129）。
    @discardableResult
    func skip(_ index: Int, seconds: Double) -> Bool {
        guard slots.indices.contains(index), let source = slots[index], let current = progress[source.id],
              let target = ProgressRules.skipTarget(current, seconds: seconds)
        else { return false }
        players[source.id]?.seek(to: target)
        return true
    }

    // MARK: 背景播放、子母畫面、被其他聲音打斷（R128、R132）

    /// 顯示中、有聲音、正在播放的來源。
    private func audiblePlayingSources() -> [CellSource] {
        slots.enumerated().compactMap { index, source in
            guard let source, isVisible(index), source.isAudible, statuses[source.id] == .playing else { return nil }
            return source
        }
    }

    /// 只有一格有聲音、而且是原生播放器在播放時，回到主畫面自動用子母畫面繼續播這一格。
    private func updatePictureInPicture() {
        let audible = audiblePlayingSources()
        let candidate = audible.count == 1 ? audible[0].id : nil
        for (id, player) in players {
            player.setAutomaticPictureInPicture(id == candidate && !player.usesWebAudio)
        }
        updateNowPlaying(audible)
    }

    func startPictureInPicture(_ index: Int) {
        guard slots.indices.contains(index), let source = slots[index] else { return }
        players[source.id]?.startPictureInPicture()
    }

    func supportsPictureInPicture(_ source: CellSource) -> Bool {
        players[source.id]?.supportsPictureInPicture ?? false
    }

    /// 回到主畫面或鎖定螢幕：原生播放器中有聲音、正在播放的格子繼續播聲音，其他暫停。
    func didEnterBackground() {
        guard !inBackground else { return }
        inBackground = true
        saveNow()
        backgroundPaused = []
        for source in slots.compactMap({ $0 }) {
            guard let player = players[source.id] else { continue }
            let playing = statuses[source.id] == .playing
            let keepAudio = playing && source.isAudible && !player.usesWebAudio
            if playing, !keepAudio {
                backgroundPaused.insert(source.id)
            }
            player.didEnterBackground(keepAudio: keepAudio)
        }
    }

    /// 回到 App：因為切到背景而暫停的格子恢復播放。
    func willEnterForeground() {
        guard inBackground else { return }
        inBackground = false
        for player in players.values {
            player.willEnterForeground()
        }
        for id in backgroundPaused {
            players[id]?.play()
        }
        backgroundPaused = []
    }

    private func observeAudioSession() {
        let center = NotificationCenter.default
        observers.append(center.addObserver(
            forName: AVAudioSession.interruptionNotification, object: nil, queue: .main
        ) { [weak self] notification in
            let info = notification.userInfo
            let type = (info?[AVAudioSessionInterruptionTypeKey] as? UInt).flatMap { AVAudioSession.InterruptionType(rawValue: $0) }
            let options = (info?[AVAudioSessionInterruptionOptionKey] as? UInt).map { AVAudioSession.InterruptionOptions(rawValue: $0) }
            Task { @MainActor [weak self] in
                self?.handleInterruption(type: type, shouldResume: options?.contains(.shouldResume) ?? false)
            }
        })
        observers.append(center.addObserver(
            forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main
        ) { [weak self] notification in
            let raw = notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt
            let reason = raw.flatMap { AVAudioSession.RouteChangeReason(rawValue: $0) }
            Task { @MainActor [weak self] in
                // 拔掉耳機時全部暫停（R128）
                if reason == .oldDeviceUnavailable {
                    self?.pauseAll()
                }
            }
        })
    }

    /// 其他 App 開始播放聲音（例如來電）時全部暫停；結束後系統表示可以恢復時，恢復原本在播的格子（R128）。
    private func handleInterruption(type: AVAudioSession.InterruptionType?, shouldResume: Bool) {
        switch type {
        case .began:
            interruptionPaused = Set(statuses.filter { $0.value == .playing }.keys)
            pauseAll()
        case .ended:
            if shouldResume {
                try? AVAudioSession.sharedInstance().setActive(true)
                for id in interruptionPaused {
                    players[id]?.play()
                }
            }
            interruptionPaused = []
        default:
            break
        }
    }

    private func pauseAll() {
        for player in players.values {
            player.pause()
        }
    }

    // MARK: 鎖定畫面與控制中心（R132）

    private func configureRemoteCommands() {
        let commands = MPRemoteCommandCenter.shared()
        commands.playCommand.addTarget { [weak self] _ in
            Task { @MainActor [weak self] in self?.remotePlay() }
            return .success
        }
        commands.pauseCommand.addTarget { [weak self] _ in
            Task { @MainActor [weak self] in self?.remotePause() }
            return .success
        }
        commands.togglePlayPauseCommand.addTarget { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self else { return }
                if self.statuses.values.contains(.playing) {
                    self.remotePause()
                } else {
                    self.remotePlay()
                }
            }
            return .success
        }
    }

    /// 鎖定畫面按暫停：記下正在播放的格子，按播放時恢復它們。
    @ObservationIgnored private var remotePaused: Set<Int> = []

    private func remotePause() {
        remotePaused = Set(statuses.filter { $0.value == .playing }.keys)
        pauseAll()
    }

    private func remotePlay() {
        let targets = remotePaused.isEmpty ? Set(audibleSourceIDs()) : remotePaused
        for id in targets {
            players[id]?.play()
        }
        remotePaused = []
    }

    private func audibleSourceIDs() -> [Int] {
        slots.enumerated().compactMap { index, source in
            guard let source, isVisible(index), source.isAudible else { return nil }
            return source.id
        }
    }

    /// 只有一格有聲音時，鎖定畫面和控制中心顯示那一格的名稱。
    private func updateNowPlaying(_ audible: [CellSource]) {
        guard audible.count == 1, let source = audible.first else {
            if audible.isEmpty, !statuses.values.contains(.playing) { return }
            MPNowPlayingInfoCenter.default().nowPlayingInfo = [MPMediaItemPropertyTitle: "MultiView"]
            return
        }
        let title = titles[source.id] ?? ListRules.defaultName(url: source.url)
        MPNowPlayingInfoCenter.default().nowPlayingInfo = [MPMediaItemPropertyTitle: title]
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
        settings.listTab = listTab
        settings.slots = SettingsBridge.saveSlots(slots, positions: positions)
        baseSettings = settings
        try? FileStore.saveSettings(settings, to: settingsURL)
    }
}
