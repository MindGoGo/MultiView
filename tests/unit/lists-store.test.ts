// R21：清單檔的讀寫、損毀處理、延遲寫入
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createListsSaver, loadLists, writeLists } from '../../electron/listsStore'
import { emptyLists, recordHistory } from '../../src/lib/lists'

const YT = 'https://www.youtube.com/watch?v=aqz-KE-bpKQ'

describe('清單檔讀寫（R21）', () => {
  let dir: string
  let file: string
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'multiview-lists-'))
    file = path.join(dir, 'lists.json')
  })
  afterEach(() => {
    vi.useRealTimers()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('沒有清單檔時是空的', () => {
    expect(loadLists(file)).toEqual(emptyLists())
  })

  it('AC10：寫入後可以讀回', () => {
    const l = recordHistory(emptyLists(), YT, 'Bunny', 1)
    writeLists(file, l)
    expect(loadLists(file)).toEqual(l)
  })

  it('AC11：損毀的清單檔改名成 lists.json.bak 保留，清單是空的', () => {
    fs.writeFileSync(file, '{ broken')
    expect(loadLists(file)).toEqual(emptyLists())
    expect(fs.existsSync(`${file}.bak`)).toBe(true)
    expect(fs.readFileSync(`${file}.bak`, 'utf8')).toBe('{ broken')
  })

  it('變更後 1 秒內寫入，多次變更合併成一次', () => {
    vi.useFakeTimers()
    const saver = createListsSaver(file)
    saver.schedule(recordHistory(emptyLists(), YT, 'A', 1))
    saver.schedule(recordHistory(emptyLists(), YT, 'B', 2))
    expect(fs.existsSync(file)).toBe(false)
    vi.advanceTimersByTime(1000)
    expect(loadLists(file).history[0].name).toBe('B')
  })

  it('flush 立即寫入（關閉程式時）', () => {
    const saver = createListsSaver(file)
    saver.schedule(recordHistory(emptyLists(), YT, 'C', 3))
    saver.flush()
    expect(loadLists(file).history[0].name).toBe('C')
  })
})
