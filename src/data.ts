import LZString from 'lz-string'

/** [開始 "HH:MM", 終了 "HH:MM", DJ名] */
export type Slot = [string, string, string]

export interface EventData {
  v: 1
  /** イベント名 */
  t: string
  /** 開催日 YYYY-MM-DD（最初の枠の日付） */
  d: string
  /** 作成者端末のタイムゾーンオフセット（分, Date#getTimezoneOffset） */
  z: number
  /** 枠 */
  s: Slot[]
}

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

/** 外から来たデータ（リンク・保存した下書き）を EventData の形にそろえる。形が違えば null */
export function normalize(o: unknown): EventData | null {
  const e = o as Partial<Record<keyof EventData, unknown>> | null
  if (!e || e.v !== 1 || !Array.isArray(e.s) || typeof e.d !== 'string') return null
  return {
    v: 1,
    t: String(e.t ?? ''),
    d: e.d,
    z: Number(e.z) || 0,
    s: e.s
      .filter((x: unknown) => Array.isArray(x))
      .map((x: unknown[]) => [String(x[0] ?? ''), String(x[1] ?? ''), String(x[2] ?? '')] as Slot),
  }
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
