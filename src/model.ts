/**
 * タイムテーブルのデータの形と検査。アプリとサーバー（worker/）の両方で使う。
 * 外部ライブラリに依存させないこと（サーバーにそのまま同梱するため）。
 */

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

/** 1つのタイムテーブルに入れられる量の上限（サーバーに保存する時の検査にも使う） */
export const LIMITS = { title: 80, name: 60, slots: 60 }

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

/** 外から来たデータ（リンク・保存した下書き）を EventData の形にそろえる。形が違えば null */
export function normalize(o: unknown): EventData | null {
  const e = o as Partial<Record<keyof EventData, unknown>> | null
  if (!e || e.v !== 1 || !Array.isArray(e.s) || typeof e.d !== 'string') return null
  return {
    v: 1,
    t: String(e.t ?? '').slice(0, LIMITS.title),
    d: /^\d{4}-\d{2}-\d{2}$/.test(e.d) ? e.d : '',
    z: Math.max(-840, Math.min(840, Math.round(Number(e.z) || 0))),
    s: e.s
      .filter((x: unknown) => Array.isArray(x))
      .slice(0, LIMITS.slots)
      .map((x: unknown[]) => {
        const t = (v: unknown) => (TIME.test(String(v ?? '')) ? String(v) : '')
        return [t(x[0]), t(x[1]), String(x[2] ?? '').slice(0, LIMITS.name)] as Slot
      }),
  }
}
