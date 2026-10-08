/// <reference types="vite/client" />
import type { MultiviewApi } from '../electron/preload'

declare global {
  interface Window {
    multiview: MultiviewApi
  }
}

export {}
