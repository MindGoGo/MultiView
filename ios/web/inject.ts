// iOS 版注入網頁每一個框架的程式（規格 ios-app R137）：直接重用桌面版的 electron/webPreload.ts。
// 由 ios/scripts/build-web.sh 用 esbuild 打包成一個檔案，`electron` 換成 ./electron-shim.ts。
import '../../electron/webPreload'
