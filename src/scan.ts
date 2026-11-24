/**
 * 「リンク・QRコードから追加」のパネル。リンクの貼り付け、QRコードをカメラで読む、QRコードの画像を選ぶ、の3通り。
 * （クリップボードを直接読む方法は、ブラウザによって確認待ちのまま止まることがあるので使わない）
 * QRコードの読み取りは jsQR。使う時だけ読み込む。
 */
import { icon } from './icons'
import { openSheet } from './picker'

/** 受け取った文字を処理する。うまくいかなければ、画面に出す理由を返す（成功なら null） */
type Handle = (text: string) => Promise<string | null>

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

export function openAdd(handle: Handle) {
  const { root, close } = openSheet(
    'Add Timetable',
    `<header class="sheet-h"><span class="sheet-t">Add Timetable</span></header>
     <p class="ask-text add-note" role="status">Scan a QR code or paste a link.</p>
     <div class="cam" hidden><video class="cam-v" playsinline muted></video><span class="cam-frame"></span></div>
     <div class="add-ops">
       <button type="button" class="add-op" data-op="cam">${icon.scan}<span>Scan QR Code</span></button>
       <button type="button" class="add-op" data-op="img">${icon.image}<span>Choose Image</span></button>
     </div>
     <input class="add-file" type="file" accept="image/*" hidden>
     <form class="ask-form" novalidate>
       <input class="ask-field" type="text" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false"
         placeholder="https://…/#/dj/…" aria-label="Link">
       <div class="ask-btns">
         <button type="button" class="ask-cancel">Cancel</button>
         <button type="submit" class="ask-ok">Add</button>
       </div>
     </form>`,
  )
  const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!
  const note = $('.add-note')
  const field = $<HTMLInputElement>('.ask-field')
  const scan = $('.cam')
  const video = $<HTMLVideoElement>('.cam-v')
  const camBtn = $<HTMLButtonElement>('[data-op="cam"]')
  const say = (text: string, warn = false) => {
    note.textContent = text
    note.classList.toggle('warn', warn)
  }

  let busy = false
  let finished = false
  const finish = () => {
    if (finished) return
    finished = true
    stopCamera()
    close()
  }
  const submit = async (text: string): Promise<boolean> => {
    if (busy || finished) return false
    busy = true
    say('Adding…')
    const err = await handle(text).catch(() => 'Something went wrong. Try again.')
    busy = false
    if (finished) return false
    if (err) {
      say(err, true)
      return false
    }
    finish()
    return true
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
    if (finished) return stopCamera()
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
        if (!text || finished || busy || (text === seen && t - seenAt < 2500)) return
        seen = text
        seenAt = t
        void submit(text)
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
    void submit(text)
  })
  $('.ask-form').addEventListener('submit', (e) => {
    e.preventDefault()
    const text = field.value.trim()
    if (text) void submit(text)
    else say('Paste the link first.', true)
  })
  $('.ask-cancel').addEventListener('click', finish)
  root.addEventListener('cancel', finish)
}
