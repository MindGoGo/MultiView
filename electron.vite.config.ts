import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'electron/main.ts') } }
    }
  },
  preload: {
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'electron/preload.ts'),
          // 注入網頁來源的偵測程式（R13）
          web: resolve(__dirname, 'electron/webPreload.ts')
        }
      }
    }
  },
  renderer: {
    root: '.',
    plugins: [react()],
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'index.html') } }
    }
  }
})
