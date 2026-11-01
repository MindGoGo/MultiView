/// <reference types="vite/client" />
import type { MultiviewApi } from '../electron/preload'
import type { CompanionApi } from '../electron/companionPreload'

declare global {
  interface Window {
    multiview: MultiviewApi
    /** 只在 YouTube 小視窗（R78） */
    companion: CompanionApi
  }
}

export {}
