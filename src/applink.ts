/**
 * ホーム画面に追加したアプリと、Safari で開いたリンクの橋渡し。
 *
 * iPhone では、LINE やメールのリンクは必ず Safari で開き、ホーム画面のアプリでは開けない。
 * アプリと Safari は保存場所も別なので、Safari で開いたタイムテーブルはアプリの一覧に入らない。そこで
 *   - アプリのトップに「リンク・QRコードから追加」を置く（addFromText と scan.ts のパネル）
 *   - Safari でリンクを開いた時に、アプリで使う方法を一度だけ案内する（offerApp）
 */
import { cache, fetchEvent, gigs, type Snapshot } from './api'
import { ask } from './picker'
import { store } from './util'

const ID = '[A-Za-z0-9_-]{1,40}'
const DJ = new RegExp(`#/(?:dj|t)/(${ID})(?![A-Za-z0-9_-])`)
const EDIT = new RegExp(`#/edit/(${ID})/(${ID})(?![A-Za-z0-9_-])`)

/** ホーム画面に追加したアプリの中で動いているか */
export const standalone = (): boolean =>
  matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true

/** 貼り付けた文字から TAITE のリンクを探し、開く画面（#/…）を返す。一般用リンクは DJ 用の画面で開く（一覧に入れるため） */
export function routeFromText(text: string): string | null {
  const e = EDIT.exec(text)
  if (e) return `#/edit/${e[1]}/${e[2]}`
  const d = DJ.exec(text)
  return d ? `#/dj/${d[1]}` : null
}

/**
 * 貼り付けた・QRコードから読んだ文字を、この端末のアプリに登録する。うまくいかなければ理由（画面に出す文）を返す。
 *   DJ用・一般用のリンク: トップの一覧に加える（その場で開かず、トップに残る）
 *   編集リンク: 編集画面を開く（開くと一覧に入る）
 */
export async function addFromText(text: string): Promise<string | null> {
  const route = routeFromText(text)
  if (!route) return "That isn't a TAITE link. Use the DJ link or edit link you received."
  const [, kind, id] = route.split('/')
  if (kind === 'edit') {
    // 自分で貼り付けて開いたリンクには、アプリで使う案内を出さない
    store.set(`taite:hint:${id}`, '1')
    location.hash = route
    return null
  }
  let snap: Snapshot | null | undefined
  try {
    snap = await fetchEvent(id)
  } catch {
    snap = undefined // つながらない時は、名前は後で取り直す
  }
  if (snap === null) return 'Timetable not found. The link may be wrong, or the timetable was deleted.'
  gigs.put({ id, t: snap?.data.t ?? '', d: snap?.data.d ?? '' })
  if (snap) cache.put(id, snap)
  return null
}

/**
 * タイムテーブルは、リンクで開いた時はそのイベントだけを見せる（一覧には戻れない）。
 * アプリの一覧から開いた時だけ一覧に戻れるよう、開く前に印を付ける（読み込み直しても残るよう、タブごとの保存を使う）
 */
export const markFromApp = (id: string) => {
  try {
    sessionStorage.setItem(`taite:from:${id}`, '1')
  } catch {
    /* 保存できない時は、一覧に戻れないだけ */
  }
}
export const openedFromApp = (id: string): boolean => {
  try {
    return sessionStorage.getItem(`taite:from:${id}`) === '1'
  } catch {
    return false
  }
}

/** iPhone・iPad か（リンクがホーム画面のアプリで開かないのは iOS。Android の Chrome はアプリで開けることがある） */
const ios = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

const pending = new Set<string>()

/**
 * iPhone の Safari などでタイムテーブルのリンクを開いた時に、アプリで使う方法を案内する（リンクごとに一度だけ）。
 * 表示する時にまだ同じ画面にいる時だけ出し、出した後で既読にする。
 */
export function offerApp(id: string, kind: 'dj' | 'edit') {
  if (standalone() || !ios()) return
  const seen = `taite:hint:${id}`
  if (store.get(seen) || pending.has(id)) return
  pending.add(id)
  const link = location.href
  const what = kind === 'edit' ? 'this edit link' : 'this link'
  setTimeout(() => {
    pending.delete(id)
    // 別の画面へ移った・タイマーを開いた（タイマーの上には重ねない）
    const timer = (history.state as { taite?: string } | null)?.taite === 'timer'
    if (location.href !== link || timer || store.get(seen)) return
    store.set(seen, '1')
    void ask({
      title: 'Use the TAITE App',
      text:
        `Links open in Safari, not in the TAITE app on your Home Screen. ` +
        `If you have the app, copy ${what}, open the app, and tap the scan icon to add it. ` +
        `No app yet? Tap Share, then Add to Home Screen.`,
      ok: 'Copy Link',
      cancelLabel: 'Not Now',
      onOk: () => void navigator.clipboard?.writeText(link).catch(() => {}),
    })
  }, 600)
}
