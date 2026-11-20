import QRCode from 'qrcode'
import { encode, fromMin, normalize, resolve, toMin, tzOffsetFor, type EventData, type Slot } from './data'
import { icon } from './icons'
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
      <p class="tagline">DJ set timer</p>
    </header>

    <div class="fields">
      <input id="title" class="fld" maxlength="60" placeholder="Event name" aria-label="Event name" autocomplete="off">
      <label class="fld fld-date" title="Date of the first set">${icon.calendar}
        <input id="date" type="date" aria-label="Date of the first set">
      </label>
    </div>

    <ol id="slots" class="slots"></ol>
    <button id="add" class="add" type="button">${icon.plus}<span>Add set</span></button>
    <ul id="msg" class="msg"></ul>

    <section class="share" aria-label="Share">
      <img id="qr" class="qr" alt="QR code for the share link" width="240" height="240" hidden>
      <div class="share-row">
        <input id="url" class="fld" readonly aria-label="Share link">
        <button id="copy" class="ibtn" type="button" aria-label="Copy link" title="Copy link">${icon.copy}</button>
        <button id="nshare" class="ibtn" type="button" aria-label="Share" title="Share" hidden>${icon.share}</button>
      </div>
      <a id="open" class="go" aria-label="Open timer">${icon.play}<span>Open timer</span></a>
    </section>
  </div>`

  const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>('#' + id)!
  const title = $<HTMLInputElement>('title')
  const date = $<HTMLInputElement>('date')
  const list = $<HTMLOListElement>('slots')
  const msg = $<HTMLUListElement>('msg')
  const urlInput = $<HTMLInputElement>('url')
  const qr = $<HTMLImageElement>('qr')
  const open = $<HTMLAnchorElement>('open')
  const copy = $<HTMLButtonElement>('copy')
  const nshare = $<HTMLButtonElement>('nshare')

  title.value = ev.t
  date.value = ev.d

  const renderSlots = () => {
    list.innerHTML = ev.s
      .map(
        ([s, e, n], i) => `
      <li class="slot" data-i="${i}">
        <input class="n" value="${esc(n)}" placeholder="DJ name" maxlength="40" autocomplete="off" aria-label="DJ name">
        <div class="times">
          <input type="time" class="s" value="${esc(s)}" aria-label="Start">
          <span class="dash" aria-hidden="true"></span>
          <input type="time" class="e" value="${esc(e)}" aria-label="End">
        </div>
        <div class="ops">
          <button type="button" data-op="up" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>${icon.up}</button>
          <button type="button" data-op="down" aria-label="Move down" ${i === ev.s.length - 1 ? 'disabled' : ''}>${icon.down}</button>
          <button type="button" data-op="del" aria-label="Delete" ${ev.s.length === 1 ? 'disabled' : ''}>${icon.remove}</button>
        </div>
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
    if (!hasDate) problems.push('Enter the event date')
    else if (resolved.length !== ev.s.length) problems.push('Some sets are missing a start or end time')
    if (ev.s.some(([, , n]) => !n.trim())) problems.push('Some sets are missing a DJ name')
    for (let k = 1; k < resolved.length; k++) {
      const a = resolved[k - 1]
      const b = resolved[k]
      if (b.start < a.end) problems.push(`${a.name} and ${b.name} overlap`)
    }
    if (resolved.length) {
      const first = resolved[0]
      const last = resolved[resolved.length - 1]
      problems.unshift(`Total: ${fmtHM(first.start)} – ${fmtHM(last.end)} (${resolved.length} ${resolved.length === 1 ? 'set' : 'sets'})`)
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
      urlInput.placeholder = 'Enter the date to create a share link'
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
  date.addEventListener('input', () => {
    ev.d = date.value
    update()
  })

  list.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement
    const li = t.closest<HTMLLIElement>('.slot')
    if (!li) return
    const i = Number(li.dataset.i)
    const k = t.classList.contains('s') ? 0 : t.classList.contains('e') ? 1 : 2
    ev.s[i][k] = t.value
    update()
  })

  list.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-op]')
    if (!b) return
    const i = Number(b.closest<HTMLLIElement>('.slot')!.dataset.i)
    const op = b.dataset.op
    if (op === 'del') ev.s.splice(i, 1)
    if (op === 'up' && i > 0) [ev.s[i - 1], ev.s[i]] = [ev.s[i], ev.s[i - 1]]
    if (op === 'down' && i < ev.s.length - 1) [ev.s[i + 1], ev.s[i]] = [ev.s[i], ev.s[i + 1]]
    renderSlots()
    update()
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
    list.querySelector<HTMLInputElement>('.slot:last-child .n')?.focus()
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
