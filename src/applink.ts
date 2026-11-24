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
  location.hash = route
}

/**
 * Safari などのブラウザでタイムテーブルのリンクを開いた時に、アプリで使う方法を案内する（リンクごとに一度だけ）。
 * パソコンでは出さない（ホーム画面に追加して使うのはスマホ）。
 */
export function offerApp(id: string, kind: 'dj' | 'edit') {
  if (standalone() || !matchMedia('(pointer: coarse)').matches) return
  const seen = `taite:hint:${id}`
  if (store.get(seen)) return
  store.set(seen, '1')
  const link = location.href
  const what = kind === 'edit' ? 'this edit link' : 'this link'
  setTimeout(() => {
    void ask({
      title: 'Use the TAITE App',
      text:
        `Links open in the browser, not in the TAITE app on your Home Screen. ` +
        `If you have the app, copy ${what}, open the app, and tap Paste Link. ` +
        `No app yet? Tap Share, then Add to Home Screen.`,
      ok: 'Copy Link',
      cancelLabel: 'Not Now',
      onOk: () => void navigator.clipboard?.writeText(link).catch(() => {}),
    })
  }, 600)
}
