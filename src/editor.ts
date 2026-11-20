import QRCode from 'qrcode'
import { encode, fromMin, normalize, resolve, toMin, tzOffsetFor, type EventData, type Slot } from './data'
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
    const label = draft.t || '名前なしのタイテ'
    if (!confirm(`作成中の下書き「${label}」を、このリンクの内容で置き換えますか？\n（キャンセルすると下書きを開きます）`)) ev = draft
  }

  root.innerHTML = `
  <div class="editor">
    <header class="e-head">
      <h1>TAITE</h1>
      <p>DJ Set Timer — タイテを作ってリンクを共有すると、DJは自分の出番までの時間とセット残り時間をスマホで確認できます。</p>
    </header>

    <label class="field"><span>イベント名</span>
      <input id="title" maxlength="60" placeholder="例: NIGHT GROOVE vol.3" autocomplete="off">
    </label>
    <label class="field"><span>開催日（最初の枠の日付）</span>
      <input id="date" type="date">
    </label>

    <h2 class="sec">タイムテーブル</h2>
    <ol id="slots" class="slots"></ol>
    <button id="add" class="btn ghost wide" type="button">＋ 枠を追加</button>
    <ul id="msg" class="msg"></ul>

    <section class="share">
      <h2 class="sec">共有</h2>
      <div class="share-row">
        <input id="url" readonly aria-label="共有リンク">
        <button id="copy" class="btn" type="button">コピー</button>
      </div>
      <div class="share-actions">
        <button id="nshare" class="btn" type="button" hidden>共有…</button>
        <a id="open" class="btn primary">タイマーを開く</a>
      </div>
      <img id="qr" class="qr" alt="共有リンクのQRコード" width="240" height="240" hidden>
      <p class="hint">リンク自体にタイムテーブルが入っています（サーバー保存なし）。内容を変更したら、新しいリンクを共有し直してください。</p>
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
        <input type="time" class="s" value="${esc(s)}" aria-label="開始">
        <span class="tilde">〜</span>
        <input type="time" class="e" value="${esc(e)}" aria-label="終了">
        <div class="row2">
        <input class="n" value="${esc(n)}" placeholder="DJ名" maxlength="40" autocomplete="off" aria-label="DJ名">
        <div class="ops">
          <button type="button" data-op="up" aria-label="上へ" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button type="button" data-op="down" aria-label="下へ" ${i === ev.s.length - 1 ? 'disabled' : ''}>↓</button>
          <button type="button" data-op="del" aria-label="削除" ${ev.s.length === 1 ? 'disabled' : ''}>✕</button>
        </div>
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
    if (!hasDate) problems.push('開催日が未入力です')
    else if (resolved.length !== ev.s.length) problems.push('開始・終了時刻が未入力の枠があります')
    if (ev.s.some(([, , n]) => !n.trim())) problems.push('DJ名が未入力の枠があります')
    for (let k = 1; k < resolved.length; k++) {
      const a = resolved[k - 1]
      const b = resolved[k]
      if (b.start < a.end) problems.push(`${a.name} と ${b.name} の時間が重なっています`)
    }
    if (resolved.length) {
      const first = resolved[0]
      const last = resolved[resolved.length - 1]
      problems.unshift(`全体: ${fmtHM(first.start)} 〜 ${fmtHM(last.end)}（${resolved.length}枠）`)
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
      urlInput.placeholder = '開催日を入力すると共有リンクができます'
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
    copy.textContent = 'コピーしました'
    setTimeout(() => (copy.textContent = 'コピー'), 1500)
  })

  if ('share' in navigator) {
    nshare.hidden = false
    nshare.addEventListener('click', () => {
      navigator
        .share({ title: ev.t || 'TAITE', text: `${ev.t || 'TAITE'} タイムテーブル`, url: urlInput.value })
        .catch(() => {})
    })
  }

  renderSlots()
  update()
  document.title = 'TAITE – タイテ作成'
  return () => {}
}
