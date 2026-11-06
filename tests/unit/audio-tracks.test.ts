// R95：yt-dlp 播放的聲音軌（語言比對、預設選擇、選單、設定檔）
import { describe, expect, it } from 'vitest'
import { audioKind, audioOptions, currentOption, langKey, pickAudioTrack } from '../../src/lib/audioTracks'
import { defaultSettings, parseSettings } from '../../src/lib/settings'

// 2026-11-06 fg1H4WCdkNI 主清單的聲音軌（hls.js 的 audioTracks：兩個聲音群組各有英文配音與中文原聲）
const TRACKS = [
  { lang: 'en-US', name: 'American English - dubbed-auto' },
  { lang: 'zh-Hant', name: 'zh-Hant - original' }
]
const BOTH_GROUPS = [...TRACKS, ...TRACKS]

describe('聲音軌的種類與語言', () => {
  it('從 YouTube 的名稱取出種類', () => {
    expect(audioKind('zh-Hant - original')).toBe('original')
    expect(audioKind('American English - dubbed-auto')).toBe('dubbed-auto')
    expect(audioKind('日本語 - dubbed')).toBe('dubbed')
    expect(audioKind('Default')).toBeNull()
  })
  it('中文分繁體、簡體；其他語言只看主要語言', () => {
    expect(langKey('zh-TW')).toBe('zh-hant')
    expect(langKey('zh-HK')).toBe('zh-hant')
    expect(langKey('zh-Hant')).toBe('zh-hant')
    expect(langKey('zh-Hant-TW')).toBe('zh-hant')
    expect(langKey('zh-CN')).toBe('zh-hans')
    expect(langKey('zh-Hans')).toBe('zh-hans')
    expect(langKey('zh')).toBe('zh')
    expect(langKey('en-US')).toBe('en')
    expect(langKey('en-GB')).toBe('en')
    expect(langKey(undefined)).toBe('')
  })
})

describe('預設的聲音軌（R95）', () => {
  it('AC1：系統是繁體中文 → 中文原聲，不是排在前面的英文配音', () => {
    expect(pickAudioTrack(TRACKS, null, 'zh-TW')).toBe(1)
  })
  it('記住的語言優先於系統語言', () => {
    expect(pickAudioTrack(TRACKS, 'en-US', 'zh-TW')).toBe(0)
    // 記住的是英式英文，影片只有美式英文也算
    expect(pickAudioTrack(TRACKS, 'en-GB', 'zh-TW')).toBe(0)
  })
  it('AC5：記住的語言影片沒有 → 系統語言 → 原本的聲音', () => {
    expect(pickAudioTrack(TRACKS, 'ja', 'zh-TW')).toBe(1)
    expect(pickAudioTrack(TRACKS, 'ja', 'ko-KR')).toBe(1)
  })
  it('系統是英文 → 英文配音（使用者選擇依系統語言）', () => {
    expect(pickAudioTrack(TRACKS, null, 'en-US')).toBe(0)
  })
  it('簡體中文的系統不會選到繁體中文；沒有時用原本的聲音', () => {
    const tracks = [
      { lang: 'zh-Hans', name: 'zh-Hans - dubbed-auto' },
      { lang: 'ja', name: 'ja - original' },
      { lang: 'zh-Hant', name: 'zh-Hant - dubbed-auto' }
    ]
    expect(pickAudioTrack(tracks, null, 'zh-CN')).toBe(0)
    expect(pickAudioTrack(tracks, null, 'zh-TW')).toBe(2)
    expect(pickAudioTrack(tracks, null, 'fr-FR')).toBe(1)
  })
  it('同一種語言有原本的聲音和配音 → 原本的聲音', () => {
    const tracks = [
      { lang: 'en-US', name: 'English - dubbed' },
      { lang: 'en', name: 'English - original' }
    ]
    expect(pickAudioTrack(tracks, null, 'en-US')).toBe(1)
  })
  it('都沒有標示 → 第一條；沒有聲音軌 → -1', () => {
    expect(pickAudioTrack([{ lang: 'ja', name: 'a' }, { lang: 'ko', name: 'b' }], null, 'zh-TW')).toBe(0)
    expect(pickAudioTrack([], null, 'zh-TW')).toBe(-1)
  })
})

describe('語音選單（R95）', () => {
  it('AC2：兩個聲音群組重複的聲音軌只列一次，名稱是語言加種類', () => {
    const options = audioOptions(BOTH_GROUPS)
    expect(options.map((o) => [o.index, o.label])).toEqual([
      [0, '英文（美國）（AI 配音）'],
      [1, '繁體中文（原本的聲音）']
    ])
  })
  it('目前的聲音軌對應到選單的那一項（另一個群組的同一條也算）', () => {
    const options = audioOptions(BOTH_GROUPS)
    expect(currentOption(BOTH_GROUPS, options, 3)).toBe(1)
    expect(currentOption(BOTH_GROUPS, options, 0)).toBe(0)
    expect(currentOption(BOTH_GROUPS, options, 9)).toBe(-1)
  })
})

describe('設定檔（R95）', () => {
  const slot = { url: 'https://www.youtube.com/watch?v=fg1H4WCdkNI', muted: false, volume: 100 }
  it('AC8：舊的設定檔沒有 audioLang → 自動', () => {
    const s = { ...defaultSettings(), slots: [slot] }
    expect(parseSettings(JSON.stringify(s)).settings.slots[0]?.audioLang).toBeNull()
  })
  it('AC4：記住的語言保存後再讀取不變', () => {
    const s = { ...defaultSettings(), slots: [{ ...slot, audioLang: 'en-US' }] }
    expect(parseSettings(JSON.stringify(s)).settings.slots[0]?.audioLang).toBe('en-US')
  })
})
