/**
 * リンクとQRコードの共有まわり（作成画面と、トップの「リンク発行」で共通）
 */
import QRCode from 'qrcode'
import { icon } from './icons'
import { ask, openSheet } from './picker'
import { esc } from './util'

const base = () => `${location.origin}${location.pathname}`
export const links = (id: string, key = '') => ({
  dj: `${base()}#/dj/${id}`,
  public: `${base()}#/t/${id}`,
  edit: `${base()}#/edit/${id}/${key}`,
})

export type Tab = 'dj' | 'public'

export const shareNote = (tab: Tab) =>
  tab === 'dj'
    ? 'For DJs. Opens the timetable and their set timer. Ask them to open it once before the show, so it works without signal.'
    : 'For everyone. Shows the timetable only.'

/** 古い方法でのコピー（http で開いた時など、navigator.clipboard が使えない時）。押した直後に同期で呼ぶこと */
function legacyCopy(text: string): boolean {
  const t = document.createElement('textarea')
  t.value = text
  t.setAttribute('readonly', '')
  // 16px 未満だと iPhone が画面を拡大する
  t.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;font-size:16px'
  document.body.append(t)
  t.select()
  t.setSelectionRange(0, text.length)
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  t.remove()
  return ok
}

/** クリップボードへコピー。どの方法でもできない時だけ、手でコピーできるようリンクを表示する */
export async function copyText(text: string) {
  if (!navigator.clipboard?.writeText) {
    if (!legacyCopy(text)) void ask({ title: 'Copy This Link', field: text, ok: 'Done', cancel: false })
    return
  }
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    if (!legacyCopy(text)) void ask({ title: 'Copy This Link', field: text, ok: 'Done', cancel: false })
  }
}

/** QRコードを画像（PNG）で書き出す。スマホは共有シート（写真に保存など）、それ以外はダウンロード */
export async function saveQrPng(url: string, title: string, tab: Tab) {
  const dataUrl = await QRCode.toDataURL(url, { margin: 4, width: 1024, errorCorrectionLevel: 'M' })
  const safe = (title || 'timetable').replace(/[^\w\-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'timetable'
  const name = `taite-${safe}-${tab}-qr.png`
  const blob = await (await fetch(dataUrl)).blob()
  const file = new File([blob], name, { type: 'image/png' })
  if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title: name }).catch(() => {})
    return
  }
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = name
  a.click()
}

/** トップの「リンク発行」: DJ用・一般用のリンクとQRコードを、パネルで表示してコピー・共有できるようにする */
export function openLinks(id: string, title: string) {
  const url = links(id)
  let tab: Tab = 'dj'
  const { root, close } = openSheet(
    'Links',
    `<header class="sheet-h">
       <span class="sheet-t">${esc(title || 'Untitled')}</span>
       <button type="button" class="sheet-done">Done</button>
     </header>
     <div class="seg share-tabs" role="tablist" aria-label="Share With">
       <button type="button" role="tab" data-tab="dj" aria-selected="true">DJ</button>
       <button type="button" role="tab" data-tab="public" aria-selected="false">Public</button>
     </div>
     <p class="share-note"></p>
     <div class="ls-qr"><img class="qr" alt="QR code" width="200" height="200" hidden></div>
     <div class="ask-btns">
       <button type="button" data-op="copy">${icon.copy}<span>Copy Link</span></button>
       <button type="button" data-op="share" hidden>${icon.share}<span>Share</span></button>
       <button type="button" data-op="qr">${icon.download}<span>Save QR</span></button>
     </div>`,
  )
  const qr = root.querySelector<HTMLImageElement>('.qr')!
  const note = root.querySelector('.share-note')!
  let token = 0
  const show = () => {
    root.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)))
    note.textContent = shareNote(tab)
    const mine = ++token
    QRCode.toDataURL(url[tab], { margin: 1, width: 400, errorCorrectionLevel: 'M' })
      .then((d) => {
        if (mine !== token) return
        qr.src = d
        qr.hidden = false
      })
      .catch(() => (qr.hidden = true))
  }
  if ('share' in navigator) root.querySelector<HTMLElement>('[data-op="share"]')!.hidden = false
  root.addEventListener('cancel', close)
  root.querySelector('.sheet-done')!.addEventListener('click', close)
  root.addEventListener('click', (e) => {
    const el = e.target as HTMLElement
    const t = el.closest<HTMLElement>('[data-tab]')
    if (t) {
      tab = t.dataset.tab as Tab
      show()
      return
    }
    const op = el.closest<HTMLElement>('[data-op]')?.dataset.op
    if (op === 'copy') void copyText(url[tab])
    else if (op === 'share')
      void navigator
        .share({ title: title || 'TAITE', text: `${title || 'TAITE'} ${tab === 'dj' ? 'timetable for DJs' : 'timetable'}`, url: url[tab] })
        .catch(() => {})
    else if (op === 'qr') void saveQrPng(url[tab], title, tab)
  })
  show()
}
