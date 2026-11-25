/**
 * 「リンク・QRコードから追加」のパネル。リンクの貼り付け、QRコードをカメラで読む、QRコードの画像を選ぶ、の3通り。
 * 読み取ったら、すぐには追加せず、中身（イベント名・日付・セット）を見せてから追加するか選んでもらう。
 * （クリップボードを直接読む方法は、ブラウザによって確認待ちのまま止まることがあるので使わない）
 * QRコードの読み取りは jsQR。使う時だけ読み込む。
 */
import type { Snapshot } from './api'
import { resolve } from './data'
import { fmtDate } from './editor'
import { icon } from './icons'
import { openSheet } from './picker'
import { esc, fmtHM } from './util'

/** 読み取ったリンクの中身。プレビューに出し、追加するかを選んでもらう */
export interface Found {
  kind: 'dj' | 'edit'
  id: string
  /** 開く画面（#/…） */
  route: string
  /** 中身（電波がなく取れなかった時は null） */
  snap: Snapshot | null
  /** もう一覧に入っているか */
  listed: boolean
}
/** 受け取った文字からタイムテーブルを探す。見つからなければ、画面に出す理由を返す */
type LookUp = (text: string) => Promise<Found | string>

const readCanvas = async (ctx: CanvasRenderingContext2D, w: number, h: number, both: boolean): Promise<string | null> => {
  const { default: jsQR } = await import('jsqr')
  const r = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: both ? 'attemptBoth' : 'dontInvert' })
  return r?.data ?? null
}

/** QRコードの画像（スクリーンショットや写真）から文字を読む。大きさを変えて2回試す */
async function readImage(file: File): Promise<string | null> {
  let bmp: ImageBitmap
  try {
    bmp = await createImageBitmap(file)
  } catch {
    return null
  }
  try {
    for (const max of [1600, 800]) {
      const k = Math.min(1, max / Math.max(bmp.width, bmp.height))
      const w = Math.max(1, Math.round(bmp.width * k))
      const h = Math.max(1, Math.round(bmp.height * k))
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      const ctx = c.getContext('2d', { willReadFrequently: true })!
      ctx.drawImage(bmp, 0, 0, w, h)
      const text = await readCanvas(ctx, w, h, true)
      if (text) return text
    }
    return null
  } finally {
    bmp.close()
  }
}

/** プレビューに出すセットの数（これより多い時は残りの数だけ出す） */
const PREVIEW_SETS = 6

function previewHtml(f: Found): string {
  const data = f.snap?.data
  const slots = data ? resolve(data) : []
  const more = slots.length - PREVIEW_SETS
  return `
    <div class="pv-head">
      <span class="pv-t">${esc(data ? data.t || 'Untitled' : 'Timetable')}</span>
      <span class="pv-d">${esc(data?.d ? fmtDate(data.d) : data ? '' : "Can't load the details offline. You can still add it.")}</span>
    </div>
    ${slots.length ? `<ol class="pv-list">${slots
      .slice(0, PREVIEW_SETS)
      .map((x) => `<li><span class="li-time">${fmtHM(x.start)}–${fmtHM(x.end)}</span><span class="li-name">${esc(x.name)}</span></li>`)
      .join('')}${more > 0 ? `<li class="pv-more">+${more} more</li>` : ''}</ol>` : data ? '<p class="pv-none">No sets yet.</p>' : ''}`
}

export function openAdd(look: LookUp, add: (f: Found) => void) {
  const { root, close } = openSheet(
    'Add Timetable',
    `<header class="sheet-h"><span class="sheet-t">Add Timetable</span></header>
     <p class="ask-text add-note" role="status">Scan a QR code or paste a link.</p>
     <div class="add-in">
       <div class="cam" hidden><video class="cam-v" playsinline muted></video><span class="cam-frame"></span></div>
       <div class="add-ops">
         <button type="button" class="add-op" data-op="cam">${icon.scan}<span>Scan QR Code</span></button>
         <button type="button" class="add-op" data-op="img">${icon.image}<span>Choose Image</span></button>
       </div>
       <input class="add-file" type="file" accept="image/*" hidden>
       <form class="ask-form" novalidate>
         <div class="add-field">
           <input class="ask-field" type="text" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false"
             placeholder="https://…/#/dj/…" aria-label="Link">
           <button type="button" class="add-clear" aria-label="Clear" title="Clear" hidden>${icon.remove}</button>
         </div>
         <div class="ask-btns">
           <button type="button" class="ask-cancel">Cancel</button>
           <button type="submit" class="ask-ok">Next</button>
         </div>
       </form>
     </div>
     <div class="add-pv" hidden>
       <div class="pv-body"></div>
       <div class="ask-btns">
         <button type="button" class="ask-cancel" data-op="back">Back</button>
         <button type="button" class="ask-ok" data-op="add">Add</button>
       </div>
     </div>`,
  )
  const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!
  const note = $('.add-note')
  const field = $<HTMLInputElement>('.ask-field')
  const clear = $<HTMLButtonElement>('.add-clear')
  const inPane = $('.add-in')
  const pvPane = $('.add-pv')
  const addBtn = $<HTMLButtonElement>('[data-op="add"]')
  const scan = $('.cam')
  const video = $<HTMLVideoElement>('.cam-v')
  const camBtn = $<HTMLButtonElement>('[data-op="cam"]')
  const say = (text: string, warn = false) => {
    note.textContent = text
    note.classList.toggle('warn', warn)
  }

  let busy = false
  let finished = false
  let found: Found | null = null
  const finish = () => {
    if (finished) return
    finished = true
    stopCamera()
    close()
  }

  /** 読み取った文字を調べて、プレビューを出す */
  const check = async (text: string): Promise<boolean> => {
    if (busy || finished || found) return false
    busy = true
    say('Looking up…')
    const r = await look(text).catch(() => 'Something went wrong. Try again.')
    busy = false
    if (finished) return false
    if (typeof r === 'string') {
      say(r, true)
      return false
    }
    stopCamera()
    found = r
    $('.pv-body').innerHTML = previewHtml(r)
    say(r.kind === 'edit' ? 'This is an edit link. Open the editor?' : r.listed ? 'This timetable is already in your list.' : 'Add this timetable to your list?')
    addBtn.textContent = r.kind === 'edit' ? 'Open Editor' : r.listed ? 'Done' : 'Add'
    inPane.hidden = true
    pvPane.hidden = false
    return true
  }
  const back = () => {
    found = null
    pvPane.hidden = true
    inPane.hidden = false
    say('Scan a QR code or paste a link.')
  }

  /* ---------- カメラ ---------- */
  let stream: MediaStream | null = null
  let raf = 0
  function stopCamera() {
    cancelAnimationFrame(raf)
    stream?.getTracks().forEach((t) => t.stop())
    stream = null
    video.srcObject = null
    scan.hidden = true
    camBtn.querySelector('span')!.textContent = 'Scan QR Code'
  }
  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) return say("This browser can't use the camera. Choose an image or paste the link.", true)
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
    } catch {
      return say('Camera access is off. Allow it in Settings, or choose an image or paste the link.', true)
    }
    if (finished || found) return stopCamera()
    video.srcObject = stream
    video.muted = true
    await video.play().catch(() => {})
    scan.hidden = false
    camBtn.querySelector('span')!.textContent = 'Stop Camera'
    say('Point the camera at the QR code.')
    const c = document.createElement('canvas')
    const ctx = c.getContext('2d', { willReadFrequently: true })!
    let last = 0
    let seen = ''
    let seenAt = 0
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop)
      if (t - last < 120 || busy || video.readyState < 2 || !video.videoWidth) return
      last = t
      const k = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight))
      c.width = Math.round(video.videoWidth * k)
      c.height = Math.round(video.videoHeight * k)
      ctx.drawImage(video, 0, 0, c.width, c.height)
      void readCanvas(ctx, c.width, c.height, false).then((text) => {
        // 同じ（TAITEのものではない）QRコードを続けて読んでも、案内を点滅させない
        if (!text || finished || busy || found || (text === seen && t - seenAt < 2500)) return
        seen = text
        seenAt = t
        void check(text)
      })
    }
    raf = requestAnimationFrame(loop)
  }

  camBtn.addEventListener('click', () => (stream ? (stopCamera(), say('Scan a QR code or paste a link.')) : void startCamera()))
  $('[data-op="img"]').addEventListener('click', () => $<HTMLInputElement>('.add-file').click())
  $<HTMLInputElement>('.add-file').addEventListener('change', async (e) => {
    const input = e.target as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    say('Reading…')
    const text = await readImage(file)
    if (text === null) return say('No QR code found in that image. Try a clearer one, or paste the link.', true)
    void check(text)
  })

  /* ---------- 貼り付け ---------- */
  const syncClear = () => (clear.hidden = !field.value)
  field.addEventListener('input', syncClear)
  clear.addEventListener('click', () => {
    field.value = ''
    syncClear()
    field.focus()
    say('Scan a QR code or paste a link.')
  })
  // 貼り付けたら、そのまま中身を調べてプレビューを出す（追加はプレビューで選ぶ）
  field.addEventListener('paste', () =>
    setTimeout(() => {
      syncClear()
      const text = field.value.trim()
      if (text) void check(text)
    }),
  )
  $('.ask-form').addEventListener('submit', (e) => {
    e.preventDefault()
    const text = field.value.trim()
    if (text) void check(text)
    else say('Paste the link first.', true)
  })

  /* ---------- プレビュー ---------- */
  $('[data-op="back"]').addEventListener('click', back)
  addBtn.addEventListener('click', () => {
    const f = found
    if (!f) return
    finish()
    if (f.kind === 'edit' || !f.listed) add(f)
  })

  $('.add-in .ask-cancel').addEventListener('click', finish)
  root.addEventListener('cancel', finish)
}
