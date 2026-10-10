// 最愛與歷史清單面板（R21–R23）；分成 YouTube 和其他網站（R58）
import { useState } from 'react'
import { formatListTime, groupOf, type ListGroup, type ListItem, type ListKind, type Lists } from '../lib/lists'
import { SubscriptionList } from './SubscriptionList'

/** 面板的那一邊和分頁（R58）；訂閱只在 YouTube 那一邊（R59） */
export interface ListTab {
  group: ListGroup
  tab: ListKind | 'subscriptions'
}

interface Props {
  lists: Lists
  /** 上次的那一邊和分頁（R58 AC6） */
  initialTab: ListTab
  onTabChange(tab: ListTab): void
  onClose(): void
  /** 回傳錯誤訊息，成功時回傳 null */
  onAddFavorite(url: string, name: string): string | null
  onEdit(kind: ListKind, index: number, url: string, name: string): string | null
  onDelete(kind: ListKind, index: number): void
  onClearHistory(group: ListGroup): void
  /** 點一下：放進第一個顯示中的空格 */
  onPick(item: ListItem): void
  /** 拖曳中游標下的格子；不在任何格子上時為 null */
  onDragOver(cell: number | null): void
  /** 放開：cell 為游標下的格子，不在任何格子上時為 null */
  onDrop(item: ListItem, cell: number | null): void
  /** 游標下的格子編號（不含被面板蓋住的部分） */
  cellAt(x: number, y: number): number | null
  /** 視窗上方的短暫提示 */
  onToast(message: string): void
  /** 訂閱頻道（R59）：回傳錯誤訊息，成功時回傳 null */
  onAddChannel(input: string): Promise<string | null>
  onRemoveChannel(id: string): void
  isFavorite(url: string): boolean
  onToggleFavoriteUrl(url: string, name: string): void
}

/** 按下後移動超過這個距離才算拖曳，否則算點一下 */
const DRAG_THRESHOLD_PX = 5

const GROUP_LABEL: Record<ListGroup, string> = { youtube: 'YouTube', other: '其他網站' }
/** 放在句子中間的名稱（中英文之間留空格） */
const GROUP_IN_TEXT: Record<ListGroup, string> = { youtube: ' YouTube ', other: '其他網站' }

/** 「開啟 YouTube」放入的頁面（R57 AC4） */
export const YOUTUBE_HOME: ListItem = { url: 'https://www.youtube.com/', name: 'YouTube', time: 0 }

export function ListPanel(props: Props) {
  const { lists } = props
  const [group, setGroup] = useState<ListGroup>(props.initialTab.group)
  const [tab, setTab] = useState<ListTab['tab']>(props.initialTab.tab)
  const [editing, setEditing] = useState<{ kind: ListKind; index: number; url: string; name: string; error: string | null } | null>(null)
  const [adding, setAdding] = useState<{ url: string; name: string; error: string | null } | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const [press, setPress] = useState<{ key: string; x: number; y: number; dragging: boolean } | null>(null)

  const choose = (wanted: ListTab) => {
    // 其他網站沒有訂閱分頁
    const next: ListTab = wanted.group === 'other' && wanted.tab === 'subscriptions' ? { ...wanted, tab: 'favorites' } : wanted
    setGroup(next.group)
    setTab(next.tab)
    setEditing(null)
    setAdding(null)
    props.onTabChange(next)
  }

  /** 這一邊的項目，附上在完整清單中的位置（編輯、刪除用） */
  const items =
    tab === 'subscriptions'
      ? []
      : lists[tab].map((item, index) => ({ item, index })).filter((x) => groupOf(x.item.url) === group)

  const saveEdit = () => {
    if (!editing) return
    const error = props.onEdit(editing.kind, editing.index, editing.url, editing.name)
    if (error) setEditing({ ...editing, error })
    else setEditing(null)
  }

  const saveAdd = () => {
    if (!adding) return
    const error = props.onAddFavorite(adding.url, adding.name)
    if (error) {
      setAdding({ ...adding, error })
      return
    }
    setAdding(null)
    // 網址屬於另一邊時加到那一邊並提示（R58 AC5）
    const g = groupOf(adding.url)
    if (g !== group) props.onToast(`已加入${GROUP_IN_TEXT[g]}的最愛`)
  }

  // 編輯框中 Enter 儲存、Esc 放棄（R21）
  const keys = (save: () => void, cancel: () => void) => (e: React.KeyboardEvent) => {
    e.stopPropagation()
    if (e.key === 'Enter') save()
    else if (e.key === 'Escape') cancel()
  }

  /** 點一下放進空格、拖曳放到格子（R21）；清單項目和「開啟 YouTube」共用 */
  const pickHandlers = (key: string, item: ListItem) => ({
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      // 按到項目裡的「編輯」「刪除」等按鈕時不算
      const button = (e.target as HTMLElement).closest('button')
      if (button && button !== e.currentTarget) return
      e.currentTarget.setPointerCapture(e.pointerId)
      setPress({ key, x: e.clientX, y: e.clientY, dragging: false })
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      if (!press || press.key !== key || !e.currentTarget.hasPointerCapture(e.pointerId)) return
      const dragging = press.dragging || Math.hypot(e.clientX - press.x, e.clientY - press.y) > DRAG_THRESHOLD_PX
      if (dragging !== press.dragging) setPress({ ...press, dragging })
      if (dragging) props.onDragOver(props.cellAt(e.clientX, e.clientY))
    },
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => {
      if (!press || press.key !== key || !e.currentTarget.hasPointerCapture(e.pointerId)) return
      e.currentTarget.releasePointerCapture(e.pointerId)
      if (press.dragging) props.onDrop(item, props.cellAt(e.clientX, e.clientY))
      else props.onPick(item)
      setPress(null)
    },
    onPointerCancel: () => {
      setPress(null)
      props.onDragOver(null)
    }
  })

  const tabs: { kind: ListTab['tab']; label: string }[] = [
    ...(group === 'youtube' ? [{ kind: 'subscriptions' as const, label: '訂閱' }] : []),
    { kind: 'favorites', label: '最愛' },
    { kind: 'history', label: '歷史' }
  ]

  return (
    <div className="list-panel">
      <div className="list-groups">
        {(['youtube', 'other'] as const).map((g) => (
          <button key={g} className={group === g ? 'active' : ''} onClick={() => choose({ group: g, tab })}>
            {GROUP_LABEL[g]}
          </button>
        ))}
        <div className="list-head-spacer" />
        <button title="關閉清單" onClick={props.onClose}>
          ✕
        </button>
      </div>
      <div className="list-head">
        {tabs.map((t) => (
          <button key={t.kind} className={tab === t.kind ? 'active' : ''} onClick={() => choose({ group, tab: t.kind })}>
            {t.label}
          </button>
        ))}
        <div className="list-head-spacer" />
        {group === 'youtube' && (
          <button title="在空格開啟 YouTube 首頁，或拖到要放的格子" {...pickHandlers('youtube-home', YOUTUBE_HOME)}>
            開啟 YouTube
          </button>
        )}
        {tab === 'favorites' && (
          <button title="新增最愛" onClick={() => setAdding({ url: '', name: '', error: null })}>
            ＋ 新增
          </button>
        )}
        {tab === 'history' && (
          <button
            title={`清除全部${GROUP_IN_TEXT[group]}的歷史紀錄`}
            disabled={items.length === 0}
            onClick={() => setConfirmClear(true)}
          >
            全部清除
          </button>
        )}
      </div>

      {tab === 'favorites' && adding && (
        <div className="list-form">
          <input
            className="url-input"
            autoFocus
            placeholder="網址"
            value={adding.url}
            onChange={(e) => setAdding({ ...adding, url: e.target.value, error: null })}
            onKeyDown={keys(saveAdd, () => setAdding(null))}
          />
          <input
            className="url-input"
            placeholder="名稱（可以空白）"
            value={adding.name}
            onChange={(e) => setAdding({ ...adding, name: e.target.value, error: null })}
            onKeyDown={keys(saveAdd, () => setAdding(null))}
          />
          {adding.error && <div className="url-error">{adding.error}</div>}
          <div className="list-form-buttons">
            <button onClick={saveAdd}>儲存</button>
            <button className="link" onClick={() => setAdding(null)}>
              取消
            </button>
          </div>
        </div>
      )}

      {tab === 'subscriptions' && (
        <SubscriptionList
          channels={lists.channels}
          pick={pickHandlers}
          onAdd={props.onAddChannel}
          onRemove={props.onRemoveChannel}
          isFavorite={props.isFavorite}
          onToggleFavorite={props.onToggleFavoriteUrl}
        />
      )}

      {tab !== 'subscriptions' && (
        <ul className="list-items">
          {items.length === 0 && (
            <li className="list-empty">{tab === 'favorites' ? '還沒有最愛的影片，按格子上的 ☆ 加入' : '還沒有歷史紀錄'}</li>
          )}
          {items.map(({ item, index }) =>
            editing && editing.kind === tab && editing.index === index ? (
              <li key={item.url} className="list-item editing">
                <input
                  className="url-input"
                  autoFocus
                  placeholder="名稱"
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value, error: null })}
                  onKeyDown={keys(saveEdit, () => setEditing(null))}
                />
                <input
                  className="url-input"
                  placeholder="網址"
                  value={editing.url}
                  onChange={(e) => setEditing({ ...editing, url: e.target.value, error: null })}
                  onKeyDown={keys(saveEdit, () => setEditing(null))}
                />
                {editing.error && <div className="url-error">{editing.error}</div>}
                <div className="list-form-buttons">
                  <button onClick={saveEdit}>儲存</button>
                  <button className="link" onClick={() => setEditing(null)}>
                    取消
                  </button>
                </div>
              </li>
            ) : (
              <li
                key={item.url}
                className="list-item"
                title="點一下放進空格，或拖到要放的格子"
                {...pickHandlers(`${tab}:${item.url}`, item)}
              >
                <div className="list-text">
                  <div className="list-name">{item.name}</div>
                  <div className="list-url">{item.url}</div>
                  {tab === 'history' && <div className="list-time">{formatListTime(item.time)}</div>}
                </div>
                <div className="list-actions">
                  <button
                    title="編輯名稱和網址"
                    onClick={() => setEditing({ kind: tab, index, url: item.url, name: item.name, error: null })}
                  >
                    編輯
                  </button>
                  <button title="刪除" onClick={() => props.onDelete(tab, index)}>
                    刪除
                  </button>
                </div>
              </li>
            )
          )}
        </ul>
      )}

      {confirmClear && (
        <div className="list-confirm">
          <div className="list-confirm-box">
            <div>確定要清除全部{GROUP_IN_TEXT[group]}的歷史紀錄？</div>
            <div className="list-form-buttons">
              <button
                className="danger"
                onClick={() => {
                  props.onClearHistory(group)
                  setConfirmClear(false)
                }}
              >
                清除
              </button>
              <button onClick={() => setConfirmClear(false)}>取消</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
