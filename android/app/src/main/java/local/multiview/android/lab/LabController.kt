package local.multiview.android.lab

/** 測試畫面裡每一格的播放器，讓「全部播放／全部暫停」和切到背景時能控制所有格子。 */
interface LabCell {
    fun play()
    fun pause()
}

class LabController {
    private val cells = mutableSetOf<LabCell>()

    fun register(cell: LabCell) {
        cells += cell
    }

    fun unregister(cell: LabCell) {
        cells -= cell
    }

    fun playAll() = cells.toList().forEach { it.play() }

    fun pauseAll() = cells.toList().forEach { it.pause() }
}
