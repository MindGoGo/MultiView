package local.multiview.android

import android.app.Application

/** App 的狀態跟著程序存在，不跟著畫面（Activity）重建。 */
class MultiViewApplication : Application() {
    val model: AppModel by lazy { AppModel(this) }
}
