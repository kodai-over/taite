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

/** セットの長さ（例: 60 Min / 1 H 30 Min ではなく分で統一） */
function durText(s: string, e: string): string {
  const a = toMin(s)
  const b = toMin(e)
  if (a === null || b === null) return ''
  return `${(b - a + 1440) % 1440 || 1440} Min`
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
      <label class="cell">
        <span class="cell-l">Date</span>
        <input id="date" class="pill" type="date">
      </label>
    </div>

    <h2 class="grp-h">Sets</h2>
    <ol id="slots" class="grp slots"></ol>
    <button id="add" class="add" type="button">${icon.plus}<span>Add Set</span></button>
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
        <div class="slot-top">
          <input class="n" value="${esc(n)}" placeholder="DJ Name" maxlength="40" autocomplete="off" aria-label="DJ Name">
          <div class="ops">
            <button type="button" data-op="up" aria-label="Move Up" ${i === 0 ? 'disabled' : ''}>${icon.up}</button>
            <button type="button" data-op="down" aria-label="Move Down" ${i === ev.s.length - 1 ? 'disabled' : ''}>${icon.down}</button>
            <button type="button" data-op="del" aria-label="Delete" ${ev.s.length === 1 ? 'disabled' : ''}>${icon.remove}</button>
          </div>
        </div>
        <div class="slot-time">
          <input type="time" class="pill s" value="${esc(s)}" step="300" aria-label="Start">
          <span class="to" aria-hidden="true">–</span>
          <input type="time" class="pill e" value="${esc(e)}" step="300" aria-label="End">
          <span class="dur">${durText(s, e)}</span>
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
    if (k === 0) {
      // 開始を動かしたら、セットの長さを保ったまま終了も動かす（カレンダーアプリと同じ）
      const oldS = toMin(ev.s[i][0])
      const oldE = toMin(ev.s[i][1])
      const newS = toMin(t.value)
      if (oldS !== null && oldE !== null && newS !== null) {
        const len = (oldE - oldS + 1440) % 1440 || 60
        ev.s[i][1] = fromMin(newS + len)
        li.querySelector<HTMLInputElement>('.e')!.value = ev.s[i][1]
      }
    }
    ev.s[i][k] = t.value
    li.querySelector('.dur')!.textContent = durText(ev.s[i][0], ev.s[i][1])
    update()
  })

  // 時刻・日付をタップしたら、その場でピッカーを開く（iPhone はホイール、PC は時計の一覧）
  root.addEventListener('click', (e) => {
    const t = e.target as HTMLInputElement
    if (t.matches?.('input.pill')) {
      try {
        t.showPicker?.()
      } catch {
        /* 対応していないブラウザは通常の入力 */
      }
    }
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
