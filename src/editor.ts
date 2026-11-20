import QRCode from 'qrcode'
import { encode, fromMin, normalize, resolve, toMin, tzOffsetFor, type EventData, type Slot } from './data'
import { icon } from './icons'
import { pickDate, pickTime } from './picker'
import { esc, fmtHM, store, todayISO } from './util'

const DRAFT_KEY = 'taite:draft'

const defaultEvent = (): EventData => ({
  v: 1,
  t: '',
  d: todayISO(),
  z: new Date().getTimezoneOffset(),
  s: [['21:00', '22:00', '']],
})

function loadDraft(): EventData | null {
  const raw = store.get(DRAFT_KEY)
  if (!raw) return null
  try {
    return normalize(JSON.parse(raw))
  } catch {
    return null
  }
}

export const shareUrl = (ev: EventData): string =>
  `${location.origin}${location.pathname}#${encode(ev)}`

export function renderEditor(root: HTMLElement, init?: EventData): () => void {
  const draft = loadDraft()
  let ev: EventData = init ?? draft ?? defaultEvent()
  // 編集リンクを開いた時、作成中の別の下書きがあれば黙って上書きせずに確認する
  if (init && draft && JSON.stringify(draft.s) !== JSON.stringify(init.s) && draft.s.some(([, , n]) => n.trim())) {
    const label = draft.t || 'Untitled'
    if (!confirm(`Replace your draft "${label}" with the timetable from this link?\n(Cancel to keep editing your draft.)`)) ev = draft
  }

  root.innerHTML = `
  <div class="editor">
    <header class="e-head">
      <h1 class="brand">TAITE</h1>
      <p class="tagline">DJ Set Timer</p>
    </header>

    <h2 class="grp-h">Event</h2>
    <div class="grp">
      <label class="cell">
        <span class="cell-l">Name</span>
        <input id="title" class="cell-in" maxlength="60" placeholder="Event Name" autocomplete="off">
      </label>
      <div class="cell">
        <span class="cell-l">Date</span>
        <button id="date" class="pill" type="button"></button>
      </div>
    </div>

    <h2 class="grp-h">Sets</h2>
    <ol id="slots" class="grp slots"></ol>
    <button id="add" class="add" type="button" aria-label="Add Set" title="Add Set">${icon.plus}</button>
    <ul id="msg" class="msg"></ul>

    <h2 class="grp-h">Share</h2>
    <section class="grp share" aria-label="Share">
      <img id="qr" class="qr" alt="QR code for the share link" width="240" height="240" hidden>
      <div class="share-row">
        <input id="url" class="url" readonly aria-label="Share link">
        <button id="copy" class="ibtn" type="button" aria-label="Copy Link" title="Copy Link">${icon.copy}</button>
        <button id="nshare" class="ibtn" type="button" aria-label="Share" title="Share" hidden>${icon.share}</button>
      </div>
    </section>
    <a id="open" class="go" aria-label="Open Timer">${icon.play}<span>Open Timer</span></a>
  </div>`

  const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>('#' + id)!
  const title = $<HTMLInputElement>('title')
  const date = $<HTMLButtonElement>('date')
  const list = $<HTMLOListElement>('slots')
  const msg = $<HTMLUListElement>('msg')
  const urlInput = $<HTMLInputElement>('url')
  const qr = $<HTMLImageElement>('qr')
  const open = $<HTMLAnchorElement>('open')
  const copy = $<HTMLButtonElement>('copy')
  const nshare = $<HTMLButtonElement>('nshare')

  title.value = ev.t
  const fmtDate = (d: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d)
    if (!m) return 'Choose Date'
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    })
  }
  const showDate = () => (date.textContent = fmtDate(ev.d))
  showDate()

  const renderSlots = () => {
    list.innerHTML = ev.s
      .map(
        ([s, e, n], i) => `
      <li class="slot" data-i="${i}">
        <button type="button" class="grip" aria-label="Drag to Reorder" title="Drag to Reorder">${icon.grip}</button>
        <input class="n" value="${esc(n)}" placeholder="DJ Name" maxlength="40" autocomplete="off" aria-label="DJ Name">
        <button type="button" class="pill t" data-k="0" aria-label="Start">${esc(s) || '--:--'}</button>
        <span class="to" aria-hidden="true">–</span>
        <button type="button" class="pill t" data-k="1" aria-label="End">${esc(e) || '--:--'}</button>
        <button type="button" class="del" data-op="del" aria-label="Delete" title="Delete" ${ev.s.length === 1 ? 'disabled' : ''}>${icon.remove}</button>
      </li>`,
      )
      .join('')
  }

  let qrToken = 0
  const update = () => {
    ev.z = tzOffsetFor(ev.d)
    store.set(DRAFT_KEY, JSON.stringify(ev))

    // バリデーション
    const problems: string[] = []
    const hasDate = /^\d{4}-\d{2}-\d{2}$/.test(ev.d)
    const resolved = resolve(ev)
    if (!hasDate) problems.push('Enter the event date.')
    else if (resolved.length !== ev.s.length) problems.push('Some sets are missing a start or end time.')
    if (ev.s.some(([, , n]) => !n.trim())) problems.push('Some sets are missing a DJ name.')
    for (let k = 1; k < resolved.length; k++) {
      const a = resolved[k - 1]
      const b = resolved[k]
      if (b.start < a.end) problems.push(`${a.name} and ${b.name} overlap.`)
    }
    if (resolved.length) {
      const first = resolved[0]
      const last = resolved[resolved.length - 1]
      problems.unshift(`${resolved.length} ${resolved.length === 1 ? 'Set' : 'Sets'}, ${fmtHM(first.start)}–${fmtHM(last.end)}`)
    }
    msg.innerHTML = problems
      .map((p, k) => `<li class="${k === 0 && resolved.length ? 'ok' : 'warn'}">${esc(p)}</li>`)
      .join('')

    // 開催日がないと時刻を計算できないので、共有させない
    copy.disabled = !hasDate
    nshare.disabled = !hasDate
    open.classList.toggle('disabled', !hasDate)
    open.setAttribute('aria-disabled', String(!hasDate))
    const token = ++qrToken
    if (!hasDate) {
      urlInput.value = ''
      urlInput.placeholder = 'Add a date to get a link'
      open.removeAttribute('href')
      qr.hidden = true
      return
    }

    const url = shareUrl(ev)
    urlInput.value = url
    open.href = url
    QRCode.toDataURL(url, { margin: 1, width: 480, errorCorrectionLevel: 'L' })
      .then((d) => {
        if (token !== qrToken) return
        qr.src = d
        qr.hidden = false
      })
      .catch(() => {
        qr.hidden = true
      })
  }

  title.addEventListener('input', () => {
    ev.t = title.value
    update()
  })
  date.addEventListener('click', async () => {
    const v = await pickDate(ev.d)
    if (v === null) return
    ev.d = v
    showDate()
    update()
  })

  list.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement
    const li = t.closest<HTMLLIElement>('.slot')
    if (!li) return
    ev.s[Number(li.dataset.i)][2] = t.value
    update()
  })

  // 時刻のピル: タップでホイールを開く。開始を動かしたら、セットの長さを保ったまま終了も動かす（カレンダーアプリと同じ）
  list.addEventListener('click', async (e) => {
    const el = e.target as HTMLElement
    const li = el.closest<HTMLLIElement>('.slot')
    if (!li) return
    const i = Number(li.dataset.i)
    if (el.closest('[data-op="del"]')) {
      ev.s.splice(i, 1)
      renderSlots()
      update()
      return
    }
    const pill = el.closest<HTMLButtonElement>('.pill.t')
    if (!pill) return
    const k = Number(pill.dataset.k) as 0 | 1
    const name = ev.s[i][2].trim()
    const v = await pickTime(`${name ? `${name} ` : ''}${k === 0 ? 'Start' : 'End'}`, ev.s[i][k])
    if (v === null) return
    if (k === 0) {
      const oldS = toMin(ev.s[i][0])
      const oldE = toMin(ev.s[i][1])
      const newS = toMin(v)
      if (oldS !== null && oldE !== null && newS !== null) ev.s[i][1] = fromMin(newS + ((oldE - oldS + 1440) % 1440 || 60))
    }
    ev.s[i][k] = v
    renderSlots()
    update()
  })

  // つまみ（≡）をドラッグして並べ替える
  list.addEventListener('pointerdown', (e) => {
    const grip = (e.target as HTMLElement).closest<HTMLElement>('.grip')
    if (!grip) return
    e.preventDefault()
    const rows = [...list.querySelectorAll<HTMLLIElement>('.slot')]
    const li = grip.closest<HTMLLIElement>('.slot')!
    const from = rows.indexOf(li)
    const rects = rows.map((r) => r.getBoundingClientRect())
    const h = rects[from].height
    const startY = e.clientY
    let to = from
    grip.setPointerCapture(e.pointerId)
    list.classList.add('sorting')
    li.classList.add('dragging')
    const onMove = (ev2: PointerEvent) => {
      const dy = Math.max(rects[0].top - rects[from].top, Math.min(rects[rows.length - 1].top - rects[from].top, ev2.clientY - startY))
      li.style.transform = `translateY(${dy}px)`
      const center = rects[from].top + h / 2 + dy
      to = rects.filter((r, k) => k !== from && r.top + r.height / 2 < center).length
      rows.forEach((r, k) => {
        if (k === from) return
        const shift = from < to && k > from && k <= to ? -h : from > to && k >= to && k < from ? h : 0
        r.style.transform = shift ? `translateY(${shift}px)` : ''
      })
    }
    const onUp = () => {
      grip.removeEventListener('pointermove', onMove)
      grip.removeEventListener('pointerup', onUp)
      grip.removeEventListener('pointercancel', onUp)
      list.classList.remove('sorting')
      rows.forEach((r) => (r.style.transform = ''))
      li.classList.remove('dragging')
      if (to !== from) {
        // 並び順を変えたら、各セットの長さを保ったまま、最初の開始時刻から順に時刻を詰め直す
        const base = toMin(ev.s[0][0])
        const [moved] = ev.s.splice(from, 1)
        ev.s.splice(to, 0, moved)
        if (base !== null) {
          let t = base
          for (const slot of ev.s) {
            const a = toMin(slot[0])
            const b = toMin(slot[1])
            const len = a !== null && b !== null ? (b - a + 1440) % 1440 || 60 : 60
            slot[0] = fromMin(t)
            slot[1] = fromMin(t + len)
            t += len
          }
        }
        navigator.vibrate?.(10)
        renderSlots()
        update()
      }
    }
    grip.addEventListener('pointermove', onMove)
    grip.addEventListener('pointerup', onUp)
    grip.addEventListener('pointercancel', onUp)
  })

  $('add').addEventListener('click', () => {
    const last = ev.s[ev.s.length - 1]
    const ls = last ? toMin(last[0]) : null
    const le = last ? toMin(last[1]) : null
    // 直前の枠の終了から、直前と同じ長さ（不明なら60分）で追加
    const dur = ls !== null && le !== null ? (le - ls + 1440) % 1440 || 60 : 60
    const start = le ?? 21 * 60
    const slot: Slot = [fromMin(start), fromMin(start + dur), '']
    ev.s.push(slot)
    renderSlots()
    update()
    list.querySelector<HTMLInputElement>('.slot:last-child .n')?.focus({ preventScroll: false })
  })

  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(urlInput.value)
    } catch {
      urlInput.select()
      document.execCommand('copy')
    }
    copy.innerHTML = icon.check
    copy.classList.add('done')
    setTimeout(() => {
      copy.innerHTML = icon.copy
      copy.classList.remove('done')
    }, 1500)
  })

  if ('share' in navigator) {
    nshare.hidden = false
    nshare.addEventListener('click', () => {
      navigator
        .share({ title: ev.t || 'TAITE', text: `${ev.t || 'TAITE'} timetable`, url: urlInput.value })
        .catch(() => {})
    })
  }

  renderSlots()
  update()
  document.title = 'TAITE – Create'
  return () => {}
}
