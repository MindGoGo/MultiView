// 整頁模式的右鍵選單（R27）。不依賴 Electron，方便測試。

export type PageMenuAction = 'cut' | 'copy' | 'paste' | 'selectAll' | 'back' | 'forward' | 'reload' | 'copyLink'

export type PageMenuItem = { type: 'separator' } | { type: 'item'; action: PageMenuAction; label: string; enabled: boolean }

export interface PageMenuContext {
  /** 網頁回報的編輯狀態（Electron 的 context-menu 事件 params.editFlags） */
  editFlags: { canCut: boolean; canCopy: boolean; canPaste: boolean; canSelectAll: boolean }
  /** 在連結上按右鍵時是連結網址，否則是空字串 */
  linkURL: string
  canGoBack: boolean
  canGoForward: boolean
}

/** 剪下、複製、貼上、全選｜上一頁、下一頁、重新整理｜複製連結網址（只有在連結上） */
export function pageMenuItems(c: PageMenuContext): PageMenuItem[] {
  const item = (action: PageMenuAction, label: string, enabled: boolean): PageMenuItem => ({
    type: 'item',
    action,
    label,
    enabled
  })
  const items: PageMenuItem[] = [
    item('cut', '剪下', c.editFlags.canCut),
    item('copy', '複製', c.editFlags.canCopy),
    item('paste', '貼上', c.editFlags.canPaste),
    item('selectAll', '全選', c.editFlags.canSelectAll),
    { type: 'separator' },
    item('back', '上一頁', c.canGoBack),
    item('forward', '下一頁', c.canGoForward),
    item('reload', '重新整理', true)
  ]
  if (c.linkURL) items.push({ type: 'separator' }, item('copyLink', '複製連結網址', true))
  return items
}
