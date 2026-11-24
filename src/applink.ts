/**
 * ホーム画面に追加したアプリと、Safari で開いたリンクの橋渡し。
 *
 * iPhone では、LINE やメールのリンクは必ず Safari で開き、ホーム画面のアプリでは開けない。
 * アプリと Safari は保存場所も別なので、Safari で開いたタイムテーブルはアプリの一覧に入らない。そこで
 *   - アプリのトップに「リンクを貼り付けて追加」を置く（pasteLink）
 *   - Safari でリンクを開いた時に、アプリで使う方法を一度だけ案内する（offerApp）
 */
import { ask, askText } from './picker'
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
 * 「リンクを貼り付けて追加」: 入力欄に貼り付けてもらう。
 * （クリップボードを直接読む方法は、ブラウザによって確認待ちのまま止まることがあるので使わない）
 */
export async function pasteLink() {
  let route: string | null = null
  let note = 'Paste the DJ link or edit link you received.'
  while (!route) {
    const text = await askText({ title: 'Add from Link', text: note, ok: 'Add', placeholder: 'https://…/#/dj/…' })
    if (text === null) return
    route = routeFromText(text)
    note = "That isn't a TAITE link. Paste the DJ link or edit link you received."
  }
  // 自分で貼り付けて開いたリンクには、アプリで使う案内を出さない
  store.set(`taite:hint:${route.split('/')[2]}`, '1')
  location.hash = route
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
        `If you have the app, copy ${what}, open the app, and tap the paste icon (Add from Link). ` +
        `No app yet? Tap Share, then Add to Home Screen.`,
      ok: 'Copy Link',
      cancelLabel: 'Not Now',
      onOk: () => void navigator.clipboard?.writeText(link).catch(() => {}),
    })
  }, 600)
}
