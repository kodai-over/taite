import { addFromText, markFromApp, standalone } from './applink'
import { cache, deleteEvent, EditKeyError, fetchEvent, forget, gigs, mine } from './api'
import { resolve } from './data'
import { fmtDate } from './editor'
import { icon } from './icons'
import { ask } from './picker'
import { openAdd } from './scan'
import { openLinks } from './share'
import { esc, now } from './util'

const ID = /^[A-Za-z0-9_-]{1,40}$/

/**
 * URLの一覧（?l=id,id,…）を、この端末の一覧に取り込む。
 * iPhone ではホーム画面のアプリと Safari で保存場所が別なので、Safari のトップから追加した時は
 * 追加した時のURL（一覧つき）だけが引き継がれる。名前と日付はサーバーから取り直す。
 */
let imported = false
function importFromUrl() {
  // ページを読み込んだ（アプリを起動した）時に一度だけ。トップに戻るたびに取り込むと、
  // 削除されて一覧から外したものが戻ってしまう
  if (imported) return
  imported = true
  const ids = (new URLSearchParams(location.search).get('l') || '').split(',').filter((x) => ID.test(x))
  const known = new Set([...mine.all(), ...gigs.all()].map((x) => x.id))
  for (const id of ids) if (!known.has(id)) gigs.put({ id, t: '', d: '' })
}

/** イベントが終わっているか。最後のセットの終了時刻で見る（まだ内容を持っていない時は、開催日の翌日の正午を過ぎたか） */
function ended(x: { id: string; d: string }): boolean {
  const snap = cache.get(x.id)
  const slots = snap ? resolve(snap.data) : []
  if (slots.length) return Math.max(...slots.map((s) => s.end)) <= now()
  // 内容がない時は、日付をまたぐセット（23:00–02:00 など）の本番中にグレーにならないよう、翌日の正午まで待つ
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(x.d)
  return !!m && new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1, 12).getTime() <= now()
}

/** スライドして止めた時に見せる操作ボタンの幅（px）。左端: 編集・リンク発行 / 右端: 削除 */
const LEAD = 160
const TRAIL = 88
/** 行の幅のこの割合を越えてスライドしたら、離した時にその操作を実行する（iOS のメールと同じ） */
const FULL = 0.55

/**
 * トップ画面: タイムテーブルの一覧。右上に、リンク・QRコードから追加（スキャン）と新規作成（プラス）。
 * 自分が作ったもの・リンクから追加したものを1つにまとめ、タップでタイムテーブル画面を開く。
 * 操作（iOS のメールと同じ）: スマホは行をスライドする。左へ: 削除（追加したものは一覧から外す）。右へ: 編集・リンク発行（自分が作ったものだけ）。
 * 端までスライドしきって離すと、削除・編集をそのまま実行する。PC（マウス）は、行にカーソルを乗せると右端に操作ボタンが出る。
 * 終わったイベントはグレーにする。一覧はこの端末に保存（ログインなし）。
 */
export function renderHome(root: HTMLElement): () => void {
  let gone = false
  importFromUrl()

  const render = () => {
    const keys = new Map(mine.all().map((m) => [m.id, m.key]))
    const seen = new Set<string>()
    const list = [...mine.all(), ...gigs.all()]
      .sort((a, b) => b.at - a.at)
      .filter((x) => !seen.has(x.id) && seen.add(x.id))

    // ブラウザでは、一覧をURL（?l=…）に載せておく（このページをホーム画面に追加した時に引き継ぐため）。
    // iPhone はページを読み込んだ時のURLを起動先にするので、一覧が変わった時だけ読み込み直す。
    // 一覧が同じなら # 以降を書き換えるだけにする（電波の弱い会場で待たせないため）。
    // 並び順が変わっただけで読み込み直さないよう、id は並べ替えて載せる。編集用の鍵は載せない（URLは人に見せたり送ったりしやすいので）
    if (!standalone()) {
      const want = new URL(location.href)
      const ids = list.map((x) => x.id).sort().join(',')
      if (ids) want.searchParams.set('l', ids)
      else want.searchParams.delete('l')
      want.hash = '#/'
      if (want.search !== location.search) {
        location.replace(want.href)
        return
      }
      if (location.hash !== '#/') history.replaceState(history.state, '', want.href)
    }

    root.innerHTML = `
    <div class="editor home">
      <header class="e-head">
        <h1 class="brand">TAITE</h1>
        <div class="h-acts">
          <button type="button" class="ibtn scan" aria-label="Add from Link or QR Code" title="Add from Link or QR Code">${icon.scan}</button>
          <a class="ibtn add" href="#/new" aria-label="New Timetable" title="New Timetable">${icon.plus}</a>
        </div>
      </header>
      ${
        list.length
          ? `<ul class="grp h-list">${list
              .map((x) => {
                const own = keys.has(x.id)
                return `
            <li class="h-item${ended(x) ? ' over' : ''}" data-id="${esc(x.id)}">
              ${own ? `<div class="sw-lead">
                <button type="button" class="sw-edit" data-act="edit" tabindex="-1">${icon.edit}<span>Edit</span></button>
                <button type="button" class="sw-link" data-act="link" tabindex="-1">${icon.link}<span>Link</span></button>
              </div>` : ''}
              <div class="sw-trail">
                <button type="button" class="sw-del" data-act="del" tabindex="-1">${icon.trash}<span>${own ? 'Delete' : 'Remove'}</span></button>
              </div>
              <a class="h-row" href="#/dj/${esc(x.id)}" draggable="false">
                <span class="li-name">${esc(x.t || (x.d ? 'Untitled' : 'Loading…'))}</span>
                <span class="li-time">${esc(x.d ? fmtDate(x.d) : '—')}</span>
              </a>
              <div class="h-tools">
                ${own ? `<button type="button" class="ibtn" data-act="edit" aria-label="Edit" title="Edit">${icon.edit}</button>
                <button type="button" class="ibtn" data-act="link" aria-label="Link" title="Link">${icon.link}</button>` : ''}
                <button type="button" class="ibtn t-del" data-act="del" aria-label="${own ? 'Delete' : 'Remove from List'}" title="${own ? 'Delete' : 'Remove from List'}">${icon.trash}</button>
              </div>
            </li>`
              })
              .join('')}</ul>`
          : '<p class="h-empty">No timetables yet. Tap + to create one, or tap the scan icon to add one from a link or QR code.</p>'
      }
    </div>`
    root.querySelector('.scan')!.addEventListener('click', () =>
      openAdd(async (text) => {
        const err = await addFromText(text)
        if (!err && !gone) {
          render()
          fill()
        }
        return err
      }),
    )
    openRow = null
    rows = list
  }

  /* ---------- 行のスライド（スマホ。iOS のメールと同じ） ---------- */
  let rows: { id: string; t: string; d: string }[] = []
  let openRow: HTMLElement | null = null
  type Full = '' | 'lead' | 'trail'
  /** 行を x（px。+ で右、- で左）の位置へ。full = 離すと実行する状態 */
  const slide = (li: HTMLElement, x: number, animate: boolean, full: Full = '') => {
    li.classList.toggle('dragging', !animate)
    li.style.setProperty('--x', `${x}px`)
    li.dataset.full = full
  }
  const closeRow = () => {
    if (!openRow) return
    slide(openRow, 0, true)
    openRow = null
  }
  const openAt = (li: HTMLElement, x: number) => {
    if (openRow && openRow !== li) closeRow()
    slide(li, x, true)
    openRow = x ? li : null
  }
  const editRoute = (id: string) => {
    const own = mine.get(id)
    return own ? `#/edit/${id}/${own.key}` : null
  }

  let drag: { li: HTMLElement; id: number; x0: number; y0: number; base: number; horizontal: boolean; x: number; full: Full } | null = null
  let swiped = false // スライドした直後の「クリック」では、行を開かない
  const ac = new AbortController()
  const on = <K extends keyof HTMLElementEventMap>(el: HTMLElement | Document, type: K, fn: (e: HTMLElementEventMap[K]) => void) =>
    el.addEventListener(type, fn as EventListener, { signal: ac.signal })

  on(root, 'pointerdown', (e) => {
    // マウスはスライドせず、カーソルを乗せた時に出る操作ボタンを使う
    if (e.pointerType === 'mouse') return
    const li = (e.target as HTMLElement).closest<HTMLElement>('.h-item')
    if (!li || !(e.target as HTMLElement).closest('.h-row')) return
    if (openRow && openRow !== li) closeRow()
    const base = li === openRow ? parseFloat(li.style.getPropertyValue('--x')) || 0 : 0
    drag = { li, id: e.pointerId, x0: e.clientX, y0: e.clientY, base, horizontal: false, x: base, full: '' }
  })
  on(root, 'pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return
    const dx = e.clientX - drag.x0
    const dy = e.clientY - drag.y0
    if (!drag.horizontal) {
      if (Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) return void (drag = null) // 縦のスクロール
      if (Math.abs(dx) < 8) return
      drag.horizontal = true
      try {
        drag.li.querySelector('.h-row')!.setPointerCapture(e.pointerId)
      } catch {
        /* 指がすでに離れている */
      }
    }
    const w = drag.li.offsetWidth
    const lead = !!drag.li.querySelector('.sw-lead')
    let x = drag.base + dx
    if (x > 0 && !lead) x = Math.min(x / 6, 16) // 右に操作がない（追加しただけの）行は、少しだけ動いて戻る
    x = Math.max(-w, Math.min(w, x))
    drag.x = x
    drag.full = x <= -w * FULL ? 'trail' : lead && x >= w * FULL ? 'lead' : ''
    slide(drag.li, x, false, drag.full)
  })
  const release = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return
    const d = drag
    drag = null
    if (!d.horizontal) return
    swiped = true
    setTimeout(() => (swiped = false), 120)
    const id = d.li.dataset.id!
    if (d.full === 'trail') {
      // スライドしきった: 削除（行を押し出してから）
      slide(d.li, -d.li.offsetWidth, true, 'trail')
      openRow = d.li
      setTimeout(() => void remove(id), 180)
    } else if (d.full === 'lead') {
      // スライドしきった: 編集画面へ
      slide(d.li, d.li.offsetWidth, true, 'lead')
      const to = editRoute(id)
      setTimeout(() => to && (location.hash = to), 180)
    } else if (d.x < -TRAIL / 2) openAt(d.li, -TRAIL)
    else if (d.x > LEAD / 2 && d.li.querySelector('.sw-lead')) openAt(d.li, LEAD)
    else {
      slide(d.li, 0, true)
      if (openRow === d.li) openRow = null
    }
  }
  on(root, 'pointerup', release)
  on(root, 'pointercancel', release)
  // 行の外をタップしたら閉じる
  on(document, 'pointerdown', (e) => {
    if (openRow && !(e.target as HTMLElement).closest('.h-item')) closeRow()
  })

  /** 自分が作ったものはサーバーからも削除（確認あり）、追加しただけのものは、この端末の一覧から外すだけ */
  const remove = async (id: string) => {
    const own = mine.get(id)
    const item = rows.find((x) => x.id === id)
    if (!own) {
      // 一覧から外すだけ。オフライン用の保存と選んだDJは残す（誤って外しても、リンクを開けば電波なしで使える）
      gigs.remove(id)
      return render()
    }
    const yes = await ask({
      title: `Delete "${item?.t || 'Untitled'}"?`,
      text: "DJ and public links will stop working. This can't be undone.",
      ok: 'Delete',
      danger: true,
    })
    if (!yes) return closeRow()
    try {
      await deleteEvent(id, own.key)
      forget(id)
      render()
    } catch (err) {
      closeRow()
      void ask({
        title: err instanceof EditKeyError ? 'Edit Link Not Valid' : "Can't Delete Offline",
        text: err instanceof EditKeyError ? 'The edit link no longer works for this timetable.' : 'Connect to the internet and try again.',
        ok: 'OK',
        cancel: false,
      })
    }
  }

  on(root, 'click', (e) => {
    const target = e.target as HTMLElement
    const li = target.closest<HTMLElement>('.h-item')
    if (!li) return
    const id = li.dataset.id!
    const act = target.closest<HTMLElement>('[data-act]')?.dataset.act
    if (act) {
      if (act === 'edit') {
        const to = editRoute(id)
        if (to) location.hash = to
      } else if (act === 'link') {
        openLinks(id, rows.find((x) => x.id === id)?.t ?? '')
        closeRow()
      } else void remove(id)
      return
    }
    if (target.closest('.h-row')) {
      // スライドした直後・開いている行をタップした時は、タイムテーブルを開かず閉じる
      if (swiped) return void e.preventDefault()
      if (li === openRow) {
        e.preventDefault()
        return closeRow()
      }
      markFromApp(id) // 一覧から開いたので、タイムテーブルから一覧へ戻れるようにする
    }
  })

  // 終わったイベントのグレー表示を、開いたままでも更新する
  const paint = () =>
    root.querySelectorAll<HTMLElement>('.h-item').forEach((li) => {
      const x = rows.find((r) => r.id === li.dataset.id)
      if (x) li.classList.toggle('over', ended(x))
    })
  const paintTimer = setInterval(paint, 60_000)

  render()
  document.title = 'TAITE'

  // 名前と日付がまだないもの（追加したばかり・前回オフラインだった）をサーバーから埋める
  const fill = () => {
    for (const g of gigs.all())
      if (!g.t && !g.d)
        fetchEvent(g.id)
          .then((snap) => {
            if (!snap) return forget(g.id)
            cache.put(g.id, snap)
            gigs.update({ ...g, t: snap.data.t, d: snap.data.d })
          })
          .catch(() => {})
          .finally(() => !gone && render())
  }
  fill()

  return () => {
    gone = true
    ac.abort()
    clearInterval(paintTimer)
  }
}
