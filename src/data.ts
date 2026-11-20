import LZString from 'lz-string'
import { normalize, type EventData } from './model'

export { normalize, type EventData, type Slot } from './model'

export interface ResolvedSlot {
  i: number
  name: string
  start: number
  end: number
  /** 入力された表示用時刻 */
  label: string
}

const PREFIX = 'v1.'

export function encode(ev: EventData): string {
  return PREFIX + LZString.compressToEncodedURIComponent(JSON.stringify(ev))
}

export function decode(payload: string): EventData | null {
  if (!payload.startsWith(PREFIX)) return null
  try {
    const json = LZString.decompressFromEncodedURIComponent(payload.slice(PREFIX.length))
    if (!json) return null
    return normalize(JSON.parse(json))
  } catch {
    return null
  }
}

/**
 * 開催日の時点での端末のタイムゾーンオフセット（分）。
 * 作成日ではなく開催日で求めるので、夏時間の切り替えをまたいでもずれない。
 */
export function tzOffsetFor(date: string): number {
  const [y, mo, d] = date.split('-').map(Number)
  if (!y || !mo || !d) return new Date().getTimezoneOffset()
  return new Date(y, mo - 1, d, 12).getTimezoneOffset()
}


export const toMin = (hm: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm)
  if (!m) return null
  return Number(m[1]) * 60 + Number(m[2])
}

export const fromMin = (min: number): string => {
  const m = ((min % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/**
 * 入力（時刻のみ）を絶対時刻に変換する。
 * 開始時刻が前の枠より早くなったら翌日とみなす（23:00 → 01:00 の日付またぎ対応）。
 */
export function resolve(ev: EventData): ResolvedSlot[] {
  const [y, mo, d] = ev.d.split('-').map(Number)
  if (!y || !mo || !d) return []
  const base = Date.UTC(y, mo - 1, d) + ev.z * 60_000
  const out: ResolvedSlot[] = []
  let day = 0
  let prevStart = -1
  ev.s.forEach(([s, e, n], i) => {
    const sm = toMin(s)
    const em = toMin(e)
    if (sm === null || em === null) return
    if (prevStart >= 0 && sm < prevStart) day++
    prevStart = sm
    const start = base + (day * 1440 + sm) * 60_000
    const endDay = em <= sm ? day + 1 : day
    const end = base + (endDay * 1440 + em) * 60_000
    out.push({ i, name: n.trim() || `DJ ${i + 1}`, start, end, label: `${s}–${e}` })
  })
  return out
}
