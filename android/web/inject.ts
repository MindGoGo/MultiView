// Android 版注入網頁每一個框架的程式（規格 android-app R157）：直接重用桌面版的 electron/webPreload.ts。
// 由 android/scripts/build-web.sh 用 esbuild 打包成一個檔案，`electron` 換成 ./android-shim.ts。
import '../../electron/webPreload'
