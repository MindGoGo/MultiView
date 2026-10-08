// 最愛與歷史清單面板（R21–R23）
import { useState } from 'react'
import { formatListTime, type ListItem, type ListKind, type Lists } from '../lib/lists'

interface Props {
  lists: Lists
  onClose(): void
  /** 回傳錯誤訊息，成功時回傳 null */
  onAddFavorite(url: string, name: string): string | null
  onEdit(kind: ListKind, index: number, url: string, name: string): string | null
  onDelete(kind: ListKind, index: number): void
  onClearHistory(): void
  /** 點一下：放進第一個顯示中的空格 */
  onPick(item: ListItem): void
  /** 拖曳中游標下的格子；不在任何格子上時為 null */
  onDragOver(cell: number | null): void
  /** 放開：cell 為游標下的格子，不在任何格子上時為 null */
  onDrop(item: ListItem, cell: number | null): void
  /** 游標下的格子編號（不含被面板蓋住的部分） */
  cellAt(x: number, y: number): number | null
}

/** 按下後移動超過這個距離才算拖曳，否則算點一下 */
const DRAG_THRESHOLD_PX = 5

export function ListPanel(props: Props) {
  const { lists } = props
  const [tab, setTab] = useState<ListKind>('favorites')
  const [editing, setEditing] = useState<{ kind: ListKind; index: number; url: string; name: string; error: string | null } | null>(null)
  const [adding, setAdding] = useState<{ url: string; name: string; error: string | null } | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const [press, setPress] = useState<{ x: number; y: number; dragging: boolean } | null>(null)

  const items = lists[tab]

  const saveEdit = () => {
    if (!editing) return
    const error = props.onEdit(editing.kind, editing.index, editing.url, editing.name)
    if (error) setEditing({ ...editing, error })
    else setEditing(null)
  }

  const saveAdd = () => {
    if (!adding) return
    const error = props.onAddFavorite(adding.url, adding.name)
    if (error) setAdding({ ...adding, error })
    else setAdding(null)
  }

  // 編輯框中 Enter 儲存、Esc 放棄（R21）
  const keys = (save: () => void, cancel: () => void) => (e: React.KeyboardEvent) => {
    e.stopPropagation()
    if (e.key === 'Enter') save()
    else if (e.key === 'Escape') cancel()
  }

  return (
    <div className="list-panel">
      <div className="list-head">
        <button className={tab === 'favorites' ? 'active' : ''} onClick={() => setTab('favorites')}>
          最愛
        </button>
        <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>
          歷史
        </button>
        <div className="list-head-spacer" />
        {tab === 'favorites' && (
          <button title="新增最愛" onClick={() => setAdding({ url: '', name: '', error: null })}>
            ＋ 新增
          </button>
        )}
        {tab === 'history' && (
          <button title="清除全部歷史紀錄" disabled={lists.history.length === 0} onClick={() => setConfirmClear(true)}>
            全部清除
          </button>
        )}
        <button title="關閉清單" onClick={props.onClose}>
          ✕
        </button>
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

      <ul className="list-items">
        {items.length === 0 && (
          <li className="list-empty">{tab === 'favorites' ? '還沒有最愛的影片，按格子上的 ☆ 加入' : '還沒有歷史紀錄'}</li>
        )}
        {items.map((item, index) =>
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
              onPointerDown={(e) => {
                if ((e.target as HTMLElement).closest('button')) return
                e.currentTarget.setPointerCapture(e.pointerId)
                setPress({ x: e.clientX, y: e.clientY, dragging: false })
              }}
              onPointerMove={(e) => {
                if (!press || !e.currentTarget.hasPointerCapture(e.pointerId)) return
                const dragging = press.dragging || Math.hypot(e.clientX - press.x, e.clientY - press.y) > DRAG_THRESHOLD_PX
                if (dragging !== press.dragging) setPress({ ...press, dragging })
                if (dragging) props.onDragOver(props.cellAt(e.clientX, e.clientY))
              }}
              onPointerUp={(e) => {
                if (!press || !e.currentTarget.hasPointerCapture(e.pointerId)) return
                e.currentTarget.releasePointerCapture(e.pointerId)
                if (press.dragging) props.onDrop(item, props.cellAt(e.clientX, e.clientY))
                else props.onPick(item)
                setPress(null)
              }}
              onPointerCancel={() => {
                setPress(null)
                props.onDragOver(null)
              }}
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

      {confirmClear && (
        <div className="list-confirm">
          <div className="list-confirm-box">
            <div>確定要清除全部歷史紀錄？</div>
            <div className="list-form-buttons">
              <button
                className="danger"
                onClick={() => {
                  props.onClearHistory()
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
