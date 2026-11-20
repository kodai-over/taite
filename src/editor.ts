import QRCode from 'qrcode'
import { cache, createEvent, deleteEvent, EditKeyError, forget, mine, saveEvent } from './api'
import { fromMin, resolve, toMin, tzOffsetFor, type EventData, type Slot } from './data'
import { icon } from './icons'
import { pickDate, pickTime } from './picker'
import { esc, fmtHM, todayISO } from './util'

/** 新しいタイムテーブルの初期値 */
export const newEventData = (): EventData => ({
  v: 1,
  t: '',
  d: todayISO(),
  z: new Date().getTimezoneOffset(),
  s: [['21:00', '22:00', '']],
})

const base = () => `${location.origin}${location.pathname}`
export const links = (id: string, key: string) => ({
  dj: `${base()}#/dj/${id}`,
  public: `${base()}#/t/${id}`,
  edit: `${base()}#/edit/${id}/${key}`,
})

export const fmtDate = (d: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d)
  if (!m) return 'Choose Date'
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  })
}

/**
 * 作成・編集画面。
 * - 新規（id なし）: 入力して Create を押すとサーバーに登録し、編集画面に切り替わる
 * - 編集: 変更は自動でサーバーに保存され、DJ用・一般用リンクを開いている全員に数秒で反映される
 */
export function renderEditor(root: HTMLElement, ctx: { id?: string; key?: string; data: EventData }): () => void {
  const id = ctx.id ?? ''
  const key = ctx.key ?? ''
  const draft = !id
  const ev: EventData = structuredClone(ctx.data)
  const url = links(id, key)
  let tab: 'dj' | 'public' = 'dj'

  root.innerHTML = `
  <div class="editor">
    <header class="e-head">
      <a class="ibtn" href="#/" aria-label="All Timetables" title="All Timetables">${icon.back}</a>
      <h1 class="brand">TAITE</h1>
      <span id="save" class="save" role="status"></span>
    </header>

    <div class="grp">
      <label class="cell">
        <span class="cell-l">Event</span>
        <input id="title" class="cell-in" maxlength="80" placeholder="Event Name" autocomplete="off">
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

    ${
      draft
        ? `<button id="create" class="go" type="button">Create Timetable</button>`
        : `
    <h2 class="grp-h">Share</h2>
    <div class="seg share-tabs" role="tablist" aria-label="Share With">
      <button type="button" role="tab" data-tab="dj" aria-selected="true">DJ</button>
      <button type="button" role="tab" data-tab="public" aria-selected="false">Public</button>
    </div>
    <p id="share-note" class="share-note"></p>
    <div class="grp share-grp">
      <div class="cell link-cell">
        <span class="cell-l">Link</span>
        <span id="link-v" class="link-v"></span>
        <span class="link-ops">
          <button class="ibtn" type="button" data-copy="tab" aria-label="Copy Link" title="Copy Link">${icon.copy}</button>
          <button class="ibtn" type="button" data-share="tab" aria-label="Share Link" title="Share Link" hidden>${icon.share}</button>
        </span>
      </div>
      <div class="cell qr-cell">
        <span class="cell-l">QR Code</span>
        <img id="qr" class="qr" alt="QR code" width="240" height="240" hidden>
        <span class="link-ops">
          <button id="qr-save" class="ibtn" type="button" aria-label="Save QR Code" title="Save QR Code">${icon.download}</button>
        </span>
      </div>
    </div>

    <div class="grp edit-link">
      <div class="cell link-cell">
        <span class="cell-l">Edit Link</span>
        <span class="link-v">Keep this private. Anyone with it can edit.</span>
        <span class="link-ops">
          <button class="ibtn" type="button" data-copy="edit" aria-label="Copy Edit Link" title="Copy Edit Link">${icon.copy}</button>
        </span>
      </div>
    </div>

    <button id="delete" class="danger" type="button">Delete Timetable</button>`
    }
  </div>`

  const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>('#' + id)!
  const title = $<HTMLInputElement>('title')
  const date = $<HTMLButtonElement>('date')
  const list = $<HTMLOListElement>('slots')
  const msg = $<HTMLUListElement>('msg')
  const saveEl = $('save')

  title.value = ev.t
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

  /* ---------- 自動保存（入力が止まってから少し待って保存。失敗したら少しあけて再試行） ---------- */
  let saveTimer = 0
  let saving = false
  let dirty = false
  let disposed = false
  // 保存の状態は、問題がある時（電波なし・編集リンクが無効）だけ表示する
  const showSave = (text: string, kind: '' | 'warn' = '') => {
    saveEl.textContent = kind === 'warn' ? text : ''
    saveEl.dataset.kind = kind
  }
  const flush = async () => {
    if (saving || !dirty || disposed) return
    saving = true
    dirty = false
    showSave('Saving…')
    try {
      await saveEvent(id, key, ev)
      mine.put({ id, key, t: ev.t, d: ev.d })
      showSave(dirty ? 'Saving…' : 'Saved')
    } catch (err) {
      if (err instanceof EditKeyError) {
        showSave('This edit link is not valid', 'warn')
        saving = false
        return
      }
      dirty = true
      showSave('Offline. Will retry.', 'warn')
      saveTimer = window.setTimeout(flush, 4000)
    }
    saving = false
    if (dirty) schedule()
  }
  const schedule = () => {
    clearTimeout(saveTimer)
    saveTimer = window.setTimeout(flush, 500)
  }

  const update = () => {
    ev.z = tzOffsetFor(ev.d)
    if (!draft) {
      dirty = true
      schedule()
      mine.put({ id, key, t: ev.t, d: ev.d })
    }

    // 入力の確認
    const problems: string[] = []
    const hasDate = /^\d{4}-\d{2}-\d{2}$/.test(ev.d)
    const resolved = resolve(ev)
    if (!hasDate) problems.push('Choose the event date.')
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
  }

  /* ---------- 共有（DJ / Public のタブごとにリンクとQRコード） ---------- */
  let qrToken = 0
  const showTab = () => {
    if (draft) return
    root.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)))
    $('link-v').textContent = url[tab].replace(/^https?:\/\//, '')
    $('share-note').textContent = tab === 'dj' ? 'For DJs. Opens the timetable and their set timer.' : 'For everyone. Shows the timetable only.'
    const qr = $<HTMLImageElement>('qr')
    const token = ++qrToken
    QRCode.toDataURL(url[tab], { margin: 1, width: 480, errorCorrectionLevel: 'M' })
      .then((d) => {
        if (token !== qrToken) return
        qr.src = d
        qr.hidden = false
      })
      .catch(() => (qr.hidden = true))
  }

  /** QRコードを画像（PNG）で書き出す。スマホは共有シート（写真に保存など）、それ以外はダウンロード */
  const saveQr = async () => {
    const dataUrl = await QRCode.toDataURL(url[tab], { margin: 4, width: 1024, errorCorrectionLevel: 'M' })
    const safe = (ev.t || 'timetable').replace(/[^\w\-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'timetable'
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

  root.addEventListener('click', async (e) => {
    const el = e.target as HTMLElement
    const c = el.closest<HTMLButtonElement>('[data-copy]')
    if (c) {
      const text = url[c.dataset.copy === 'edit' ? 'edit' : tab]
      try {
        await navigator.clipboard.writeText(text)
      } catch {
        prompt('Copy this link', text)
      }
      c.innerHTML = icon.check
      c.classList.add('done')
      setTimeout(() => {
        c.innerHTML = icon.copy
        c.classList.remove('done')
      }, 1500)
      return
    }
    const sh = el.closest<HTMLButtonElement>('[data-share]')
    if (sh) {
      const which = tab
      navigator
        .share({ title: ev.t || 'TAITE', text: `${ev.t || 'TAITE'} ${which === 'dj' ? 'timetable for DJs' : 'timetable'}`, url: url[which] })
        .catch(() => {})
      return
    }
    const tb = el.closest<HTMLButtonElement>('[data-tab]')
    if (tb) {
      tab = tb.dataset.tab as 'dj' | 'public'
      showTab()
      return
    }
    if (el.closest('#qr-save')) void saveQr()
  })
  // 新規: Create で登録して編集画面へ
  if (draft)
    $('create').addEventListener('click', async () => {
      const btn = $<HTMLButtonElement>('create')
      btn.disabled = true
      btn.textContent = 'Creating…'
      try {
        const res = await createEvent(ev)
        mine.put({ id: res.id, key: res.key, t: ev.t, d: ev.d })
        cache.put(res.id, { data: ev, rev: 1 })
        location.replace(`#/edit/${res.id}/${res.key}`)
      } catch {
        btn.disabled = false
        btn.textContent = 'Create Timetable'
        alert("Can't create a timetable offline. Connect to the internet and try again.")
      }
    })

  if (!draft) $('delete').addEventListener('click', async () => {
    if (!confirm(`Delete "${ev.t || 'Untitled'}"?\nDJ and public links will stop working. This can't be undone.`)) return
    const btn = $<HTMLButtonElement>('delete')
    btn.disabled = true
    disposed = true // 保存を止める
    clearTimeout(saveTimer)
    try {
      await deleteEvent(id, key)
      forget(id)
      location.replace('#/')
    } catch (err) {
      disposed = false
      btn.disabled = false
      alert(err instanceof EditKeyError ? err.message : "Can't delete offline. Connect to the internet and try again.")
    }
  })

  if ('share' in navigator) root.querySelectorAll<HTMLElement>('[data-share]').forEach((b) => (b.hidden = false))

  // 画面を離れる前に、保存していない変更を送る
  const onHide = () => {
    if (document.visibilityState === 'hidden') void flush()
  }
  document.addEventListener('visibilitychange', onHide)

  renderSlots()
  update()
  dirty = false // 開いただけでは保存しない
  clearTimeout(saveTimer)
  showSave(draft ? '' : 'Saved')
  showTab()
  document.title = draft ? 'New Timetable – TAITE' : `${ev.t || 'TAITE'} – Edit`
  return () => {
    void flush()
    disposed = true
    clearTimeout(saveTimer)
    document.removeEventListener('visibilitychange', onHide)
  }
}
