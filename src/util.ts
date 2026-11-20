/** デバッグ用: ?now=2026-11-21T21:55 で現在時刻をずらせる */
const debugOffset = (() => {
  const q = new URLSearchParams(location.search).get('now')
  if (!q) return 0
  const t = new Date(q).getTime()
  return Number.isNaN(t) ? 0 : t - Date.now()
})()

export const now = (): number => Date.now() + debugOffset

const p2 = (n: number) => String(n).padStart(2, '0')

export const fmtClock = (t: number): string => {
  const d = new Date(t)
  return `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`
}

export const fmtHM = (t: number): string => {
  const d = new Date(t)
  return `${p2(d.getHours())}:${p2(d.getMinutes())}`
}

/** 残り時間表示。1時間以上は H:MM:SS、それ未満は MM:SS */
export const fmtDur = (ms: number): string => {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h > 0 ? `${h}:${p2(m)}:${p2(s)}` : `${p2(m)}:${p2(s)}`
}

export const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

export const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  },
  set(key: string, value: string | null) {
    try {
      if (value === null) localStorage.removeItem(key)
      else localStorage.setItem(key, value)
    } catch {
      /* プライベートモード等は無視 */
    }
  },
}

export const todayISO = (): string => {
  const d = new Date()
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
}
