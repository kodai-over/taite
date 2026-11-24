import { icon } from './icons'
import { esc } from './util'

/* ==========================================================================
   画面下からせり上がる、時刻（ホイール）と日付（カレンダー）の選択パネル
   ブラウザ標準の選択画面は見た目が古く、端末ごとにばらつくため自前で作る
   ========================================================================== */

const ITEM = 44 // ホイール1行の高さ（px）。style.css の .wheel-item と揃える
const p2 = (n: number) => String(n).padStart(2, '0')

/** 下からせり上がるパネルを開く。閉じると remove される */
function openSheet(label: string, body: string): { root: HTMLElement; close: () => void } {
  const root = document.createElement('div')
  root.className = 'sheet-root'
  root.innerHTML = `
    <div class="sheet-bg"></div>
    <div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(label)}">${body}</div>`
  document.body.append(root)
  requestAnimationFrame(() => root.classList.add('open'))
  const close = () => {
    root.classList.remove('open')
    document.removeEventListener('keydown', onKey)
    setTimeout(() => root.remove(), 220)
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') root.dispatchEvent(new Event('cancel'))
  }
  document.addEventListener('keydown', onKey)
  root.querySelector('.sheet-bg')!.addEventListener('click', () => root.dispatchEvent(new Event('cancel')))
  return { root, close }
}

/** ホイール（縦にスクロールして中央の値を選ぶ）を作る */
function wheel(values: number[], selected: number, label: string): string {
  return `<div class="wheel" role="listbox" aria-label="${label}" tabindex="0" data-sel="${selected}">
    ${values.map((v, i) => `<div class="wheel-item" role="option" data-i="${i}">${p2(v)}</div>`).join('')}
  </div>`
}

function setupWheel(el: HTMLElement, onChange: () => void): () => number {
  const items = [...el.querySelectorAll<HTMLElement>('.wheel-item')]
  const read = () => Math.min(items.length - 1, Math.max(0, Math.round(el.scrollTop / ITEM)))
  const paint = () => {
    const i = read()
    items.forEach((it, k) => it.classList.toggle('on', k === i))
    onChange()
  }
  el.scrollTop = Number(el.dataset.sel) * ITEM
  paint()
  let raf = 0
  el.addEventListener('scroll', () => {
    cancelAnimationFrame(raf)
    raf = requestAnimationFrame(paint)
  })
  // マウスのドラッグ（タッチは標準のスクロールに任せる）。ドラッグ中はスナップを切り、離したら一番近い値へ。少し勢いも残す
  let drag: { y: number; top: number; last: number; v: number; t: number; moved: boolean } | null = null
  let justDragged = false
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return
    drag = { y: e.clientY, top: el.scrollTop, last: e.clientY, v: 0, t: e.timeStamp, moved: false }
    el.setPointerCapture(e.pointerId)
    el.classList.add('dragging')
  })
  el.addEventListener('pointermove', (e) => {
    if (!drag) return
    if (Math.abs(e.clientY - drag.y) > 3) drag.moved = true
    const dt = Math.max(1, e.timeStamp - drag.t)
    drag.v = (drag.last - e.clientY) / dt // px/ms（上にドラッグ = 正 = 下の値へ）
    drag.last = e.clientY
    drag.t = e.timeStamp
    el.scrollTop = drag.top + (drag.y - e.clientY)
  })
  const endDrag = (e: PointerEvent) => {
    if (!drag) return
    const d = drag
    drag = null
    el.classList.remove('dragging')
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
    if (!d.moved) return
    justDragged = true
    setTimeout(() => (justDragged = false), 0)
    // 勢いのぶんだけ先へ（最大3つ。離す直前に止まっていたら勢いなし）
    const moving = e.timeStamp - d.t < 80 && Math.abs(d.v) > 0.3
    const fling = moving ? Math.max(-3 * ITEM, Math.min(3 * ITEM, d.v * 180)) : 0
    const i = Math.min(items.length - 1, Math.max(0, Math.round((el.scrollTop + fling) / ITEM)))
    el.scrollTo({ top: i * ITEM, behavior: 'smooth' })
  }
  el.addEventListener('pointerup', endDrag)
  el.addEventListener('pointercancel', endDrag)
  // マウスのホイールは1回で1つずつ進める
  el.addEventListener(
    'wheel',
    (e) => {
      if (e.deltaMode === 0 && Math.abs(e.deltaY) < 4) return
      e.preventDefault()
      el.scrollTo({ top: (read() + Math.sign(e.deltaY)) * ITEM, behavior: 'smooth' })
    },
    { passive: false },
  )
  el.addEventListener('click', (e) => {
    if (justDragged) return
    const it = (e.target as HTMLElement).closest<HTMLElement>('.wheel-item')
    if (it) el.scrollTo({ top: Number(it.dataset.i) * ITEM, behavior: 'smooth' })
  })
  el.addEventListener('keydown', (e) => {
    const d = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0
    if (!d) return
    e.preventDefault()
    el.scrollTo({ top: (read() + d) * ITEM, behavior: 'smooth' })
  })
  return read
}

/** 時刻を選ぶ（5分刻み）。キャンセルなら null */
export function pickTime(label: string, value: string): Promise<string | null> {
  const [h0 = 21, m0 = 0] = value.split(':').map(Number)
  const hours = Array.from({ length: 24 }, (_, i) => i)
  // 5分刻み。今の値が5分刻みでなければ、その分も選択肢に入れる（開いて Done しただけで値が変わらないように）
  const mins = [...new Set([...Array.from({ length: 12 }, (_, i) => i * 5), m0])].sort((a, b) => a - b)
  const mi = mins.indexOf(m0)

  return new Promise((resolve) => {
    const { root, close } = openSheet(
      label,
      `<header class="sheet-h">
        <span class="sheet-t">${esc(label)}</span>
        <span class="sheet-v" aria-live="polite"></span>
        <button type="button" class="sheet-done">Done</button>
      </header>
      <div class="wheels">
        <div class="wheel-band" aria-hidden="true"></div>
        ${wheel(hours, h0, 'Hour')}
        <span class="wheel-colon" aria-hidden="true">:</span>
        ${wheel(mins, mi, 'Minute')}
      </div>`,
    )
    const [hEl, mEl] = [...root.querySelectorAll<HTMLElement>('.wheel')]
    const preview = root.querySelector<HTMLElement>('.sheet-v')!
    let readH = () => h0
    let readM = () => mi
    const show = () => (preview.textContent = `${p2(hours[readH()])}:${p2(mins[readM()])}`)
    requestAnimationFrame(() => {
      readH = setupWheel(hEl, show)
      readM = setupWheel(mEl, show)
      hEl.focus({ preventScroll: true })
    })
    root.querySelector('.sheet-done')!.addEventListener('click', () => {
      close()
      resolve(`${p2(hours[readH()])}:${p2(mins[readM()])}`)
    })
    root.addEventListener('cancel', () => {
      close()
      resolve(null)
    })
  })
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const iso = (y: number, m: number, d: number) => `${y}-${p2(m + 1)}-${p2(d)}`

/** 日付を選ぶ（月のカレンダー。日をタップで決定）。キャンセルなら null */
export function pickDate(value: string): Promise<string | null> {
  const now = new Date()
  const today = iso(now.getFullYear(), now.getMonth(), now.getDate())
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  let y = m ? Number(m[1]) : now.getFullYear()
  let mo = m ? Number(m[2]) - 1 : now.getMonth()

  return new Promise((resolve) => {
    const { root, close } = openSheet(
      'Date',
      `<header class="sheet-h cal-h">
        <button type="button" class="ibtn cal-nav" data-d="-1" aria-label="Previous Month">${icon.back}</button>
        <span class="sheet-t cal-t"></span>
        <button type="button" class="ibtn cal-nav cal-next" data-d="1" aria-label="Next Month">${icon.back}</button>
      </header>
      <div class="cal-w" aria-hidden="true"><span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span></div>
      <div class="cal" role="grid"></div>`,
    )
    const grid = root.querySelector<HTMLElement>('.cal')!
    const titleEl = root.querySelector<HTMLElement>('.cal-t')!
    const render = () => {
      titleEl.textContent = `${MONTHS[mo]} ${y}`
      const first = new Date(y, mo, 1).getDay()
      const days = new Date(y, mo + 1, 0).getDate()
      grid.innerHTML =
        '<span></span>'.repeat(first) +
        Array.from({ length: days }, (_, i) => {
          const d = iso(y, mo, i + 1)
          const cls = ['cal-d', d === value ? 'sel' : '', d === today ? 'today' : ''].join(' ')
          return `<button type="button" class="${cls}" data-v="${d}" aria-label="${MONTHS[mo]} ${i + 1}, ${y}"${d === value ? ' aria-selected="true"' : ''}>${i + 1}</button>`
        }).join('')
    }
    render()
    root.querySelectorAll<HTMLButtonElement>('.cal-nav').forEach((b) =>
      b.addEventListener('click', () => {
        mo += Number(b.dataset.d)
        if (mo < 0) (mo = 11), y--
        if (mo > 11) (mo = 0), y++
        render()
      }),
    )
    grid.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('.cal-d')
      if (!b) return
      close()
      resolve(b.dataset.v!)
    })
    root.addEventListener('cancel', () => {
      close()
      resolve(null)
    })
  })
}

/**
 * 確認・お知らせのパネル（ブラウザ標準の confirm / alert は、埋め込み画面などで表示されず
 * すぐ「いいえ」になることがあるため使わない）。
 * 確認: OK で true、キャンセル・外側タップ・Esc で false。お知らせ（cancel: false）は閉じると false。
 */
export function ask(o: {
  title: string
  text?: string
  ok: string
  danger?: boolean
  cancel?: boolean
  /** 取り消しボタンの文言（既定は Cancel） */
  cancelLabel?: string
  field?: string
  /** OK を押した時にその場で実行する（クリップボードへのコピーなど、押した直後でないと動かない処理） */
  onOk?: () => void
}): Promise<boolean> {
  return new Promise((resolve) => {
    const { root, close } = openSheet(
      o.title,
      `<header class="sheet-h"><span class="sheet-t">${esc(o.title)}</span></header>
       ${o.text ? `<p class="ask-text">${esc(o.text)}</p>` : ''}
       ${o.field ? `<input class="ask-field" readonly value="${esc(o.field)}" aria-label="${esc(o.title)}">` : ''}
       <div class="ask-btns">
         ${o.cancel === false ? '' : `<button type="button" class="ask-cancel">${esc(o.cancelLabel ?? 'Cancel')}</button>`}
         <button type="button" class="ask-ok${o.danger ? ' danger-fill' : ''}">${esc(o.ok)}</button>
       </div>`,
    )
    const done = (v: boolean) => {
      close()
      resolve(v)
    }
    root.addEventListener('cancel', () => done(false))
    root.querySelector('.ask-ok')!.addEventListener('click', () => {
      o.onOk?.()
      done(true)
    })
    root.querySelector('.ask-cancel')?.addEventListener('click', () => done(false))
    const f = root.querySelector<HTMLInputElement>('.ask-field')
    if (f) setTimeout(() => (f.focus(), f.select()), 250)
  })
}

/** 1行の文字を入力してもらう（入力欄つきのシート）。取り消したら null */
export function askText(o: { title: string; text?: string; ok: string; placeholder?: string; value?: string }): Promise<string | null> {
  return new Promise((resolve) => {
    const { root, close } = openSheet(
      o.title,
      `<header class="sheet-h"><span class="sheet-t">${esc(o.title)}</span></header>
       ${o.text ? `<p class="ask-text">${esc(o.text)}</p>` : ''}
       <form class="ask-form" novalidate>
         <input class="ask-field" type="text" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false"
           value="${esc(o.value ?? '')}" placeholder="${esc(o.placeholder ?? '')}" aria-label="${esc(o.title)}">
         <div class="ask-btns">
           <button type="button" class="ask-cancel">Cancel</button>
           <button type="submit" class="ask-ok">${esc(o.ok)}</button>
         </div>
       </form>`,
    )
    const f = root.querySelector<HTMLInputElement>('.ask-field')!
    const done = (v: string | null) => {
      close()
      resolve(v)
    }
    root.addEventListener('cancel', () => done(null))
    root.querySelector('.ask-form')!.addEventListener('submit', (e) => {
      e.preventDefault()
      done(f.value.trim())
    })
    root.querySelector('.ask-cancel')!.addEventListener('click', () => done(null))
    setTimeout(() => f.focus(), 250)
  })
}
