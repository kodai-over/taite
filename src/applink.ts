/**
 * ホーム画面に追加したアプリと、Safari で開いたリンクの橋渡し。
 *
 * iPhone では、LINE やメールのリンクは必ず Safari で開き、ホーム画面のアプリでは開けない。
 * アプリと Safari は保存場所も別なので、Safari で開いたタイムテーブルはアプリの一覧に入らない。そこで
 *   - アプリのトップに「リンク・QRコードから追加」を置く（lookUp・addFound と scan.ts のパネル）
 *   - Safari でリンクを開いた画面に「アプリで開く」ボタン（openInApp）。iPhone の Safari では最初に一度だけ自動で出す（offerApp）
 *   - リンクのページからホーム画面に追加したアプリでも、トップに戻れるようにする（main.ts）
 */
import { cache, fetchEvent, gigs, mine, type Snapshot } from './api'
import { icon } from './icons'
import { openSheet } from './picker'
import type { Found } from './scan'
import { copyText } from './share'
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

/** 貼り付けた・QRコードから読んだ文字から、タイムテーブルを探す（まだ登録しない。プレビューに出す）。見つからなければ理由を返す */
export async function lookUp(text: string): Promise<Found | string> {
  const route = routeFromText(text)
  if (!route) return "That isn't a TAITE link. Use the DJ link or edit link you received."
  const [, kind, id] = route.split('/') as [string, 'dj' | 'edit', string]
  let snap: Snapshot | null | undefined
  try {
    snap = await fetchEvent(id)
  } catch {
    snap = undefined // つながらない時は、中身なしで追加できる（名前は後で取り直す）
  }
  if (snap === null) return 'Timetable not found. The link may be wrong, or the timetable was deleted.'
  const listed = !!mine.get(id) || gigs.all().some((g) => g.id === id)
  return { kind, id, route, snap: snap ?? null, listed }
}

/**
 * プレビューで「追加」を選んだ時に、この端末のアプリに登録する。
 *   DJ用・一般用のリンク: トップの一覧に加える（その場で開かず、トップに残る）
 *   編集リンク: 編集画面を開く（開くと一覧に入る）
 */
export function addFound(f: Found) {
  if (f.kind === 'edit') {
    // 自分で貼り付けて開いたリンクには、アプリで使う案内を出さない
    store.set(`taite:hint:${f.id}`, '1')
    location.hash = f.route
    return
  }
  gigs.put({ id: f.id, t: f.snap?.data.t ?? '', d: f.snap?.data.d ?? '' })
  if (f.snap) cache.put(f.id, f.snap)
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
export const ios = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

/**
 * 「アプリで開く」パネル（Safari などでリンクを開いた時）。
 * iPhone では、ページからホーム画面のアプリを起動できない。そこで、リンクをコピーして、アプリのスキャンボタンから貼り付けてもらう。
 * アプリがまだない人には、このタイムテーブルを一覧に入れたトップを開き、そこでホーム画面に追加してもらう（追加した時のURLの一覧がアプリに引き継がれる）
 */
export function openInApp(id: string, kind: 'dj' | 'edit') {
  const link = location.href
  // 編集リンクは鍵が要るので、一覧の引き継ぎ（?l=）では渡せない
  const get = kind === 'dj' ? `${location.origin}${location.pathname}?l=${encodeURIComponent(id)}#/` : ''
  const how = 'open TAITE from your Home Screen, tap the scan icon, and paste the link.'
  const { root, close } = openSheet(
    'Open in the TAITE App',
    `<header class="sheet-h"><span class="sheet-t">Open in the TAITE App</span></header>
     <p class="ask-text in-note">${ios() ? 'Links open in Safari, not in the app. ' : ''}To add this timetable to the app, copy the link, then ${how}</p>
     ${get ? `<p class="ask-text in-get">No app yet? Tap Get the App, then add TAITE to your Home Screen. This timetable will be in its list.</p>` : ''}
     <div class="ask-btns">
       ${get ? '<button type="button" class="ask-cancel" data-op="get">Get the App</button>' : '<button type="button" class="ask-cancel" data-op="close">Not Now</button>'}
       <button type="button" class="ask-ok" data-op="copy">${icon.copy}<span>Copy Link</span></button>
     </div>`,
  )
  root.addEventListener('cancel', close)
  root.addEventListener('click', (e) => {
    const op = (e.target as HTMLElement).closest<HTMLElement>('[data-op]')?.dataset.op
    if (op === 'close') close()
    else if (op === 'get') {
      close()
      location.href = get
    } else if (op === 'copy') {
      void copyText(link)
      root.querySelector('.in-note')!.textContent = `Copied. Now ${how}`
      root.querySelector('.in-get')?.remove()
      const ok = root.querySelector<HTMLElement>('.ask-ok')!
      ok.dataset.op = 'close'
      ok.innerHTML = `${icon.check}<span>Done</span>`
    }
  })
}

const pending = new Set<string>()

/**
 * iPhone の Safari などでタイムテーブルのリンクを開いた時に、「アプリで開く」パネルを一度だけ出す（リンクごと）。
 * 表示する時にまだ同じ画面にいる時だけ出し、出した後で既読にする。
 */
export function offerApp(id: string, kind: 'dj' | 'edit') {
  if (standalone() || !ios()) return
  const seen = `taite:hint:${id}`
  if (store.get(seen) || pending.has(id)) return
  pending.add(id)
  const link = location.href
  setTimeout(() => {
    pending.delete(id)
    // 別の画面へ移った・タイマーを開いた（タイマーの上には重ねない）
    const timer = (history.state as { taite?: string } | null)?.taite === 'timer'
    if (location.href !== link || timer || store.get(seen)) return
    store.set(seen, '1')
    openInApp(id, kind)
  }, 600)
}
