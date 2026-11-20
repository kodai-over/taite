import '@fontsource/barlow/latin-500.css'
import '@fontsource/barlow/latin-600.css'
import '@fontsource/barlow/latin-700.css'
import './style.css'
import { cache, createEvent, fetchEvent, gigs, mine } from './api'
import { decode, normalize, type EventData } from './data'
import { newEventData, renderEditor } from './editor'
import { renderHome } from './home'
import { icon } from './icons'
import { live } from './live'
import { renderPublic } from './public'
import { store } from './util'
import { renderViewer } from './viewer'

/*
  画面の切り替え（URLの # 以降）
    #/                    トップ（自分が作ったタイムテーブル・出演予定）
    #/new                 新規作成（入力して Create で登録 → #/edit へ）
    #/edit/<id>/<key>     作成者の編集画面（鍵を持つ人だけ）
    #/dj/<id>             DJ用: タイムテーブル + 自分のタイマー（リアルタイム）
    #/t/<id>              一般用: タイムテーブルのみ（リアルタイム）
    #v1.…                 以前の形式の共有リンク（中身がURLに入っている。更新はされない）
    #e.…                  以前の形式の編集リンク → 新しいタイムテーブルとして取り込む
*/

const app = document.getElementById('app')!
let dispose: () => void = () => {}

const show = (title: string, text: string, action = `<a class="go" href="#/">${icon.home}<span>All Timetables</span></a>`) => {
  app.innerHTML = `<div class="error"><h1>${title}</h1><p>${text}</p>${action}</div>`
  dispose = () => {}
}

/** 新しいタイムテーブルをサーバーに作って編集画面へ */
async function create(data: EventData) {
  app.innerHTML = '<div class="loading" aria-busy="true">Creating…</div>'
  try {
    const { id, key } = await createEvent(data)
    mine.put({ id, key, t: data.t, d: data.d })
    cache.put(id, { data, rev: 1 })
    location.replace(`#/edit/${id}/${key}`)
  } catch {
    show("Can't create a timetable offline", 'Connect to the internet and try again.', `<a class="go" href="#/new">${icon.plus}<span>Try Again</span></a>`)
  }
}

/** 以前の端末に残っている下書き（URL埋め込み形式の時代のもの）があれば、最初の新規作成に使う */
function takeOldDraft(): EventData | null {
  const raw = store.get('taite:draft')
  if (!raw) return null
  store.set('taite:draft', null)
  try {
    return normalize(JSON.parse(raw))
  } catch {
    return null
  }
}

function route() {
  dispose()
  dispose = () => {}
  window.scrollTo(0, 0)
  const raw = location.hash.slice(1)
  let h = raw
  try {
    h = decodeURIComponent(raw)
  } catch {
    // % の並びが壊れたリンク。そのまま読み込みを試し、読めなければエラー画面にする
  }
  const parts = h.replace(/^\//, '').split('/')

  // 以前の形式の共有リンク
  if (h.startsWith('v1.')) {
    const ev = decode(h)
    if (!ev) return show('Link broken', 'The URL may have been cut off. Ask for the link again.')
    dispose = renderViewer(app, ev, { storeKey: `${ev.d}:${ev.t}`, homeHref: '#/' })
    return
  }
  // 以前の形式の編集リンク → 新しいタイムテーブルとして取り込む
  if (h.startsWith('e.')) {
    const ev = decode(h.slice(2))
    if (!ev) return show('Link broken', 'The URL may have been cut off.')
    void create(ev)
    return
  }

  const [page, id, key] = parts
  if (page === 'new') {
    // 入力してから Create で登録する（ここではまだサーバーに保存しない）
    dispose = renderEditor(app, { data: takeOldDraft() ?? newEventData() })
    return
  }

  if (page === 'edit' && id && key) {
    // 別の端末で開いた編集リンクも、この端末の一覧に加える
    const open = (data: EventData) => {
      mine.put({ id, key, t: data.t, d: data.d })
      dispose = renderEditor(app, { id, key, data })
    }
    const cached = cache.get(id)
    app.innerHTML = '<div class="loading" aria-busy="true">Loading…</div>'
    let gone = false
    dispose = () => (gone = true)
    fetchEvent(id)
      .then((snap) => {
        if (gone) return
        if (!snap) return show('Timetable not found', 'The edit link may be wrong.')
        cache.put(id, snap)
        open(snap.data)
      })
      .catch(() => {
        if (gone) return
        if (cached) open(cached.data)
        else show("Can't load the timetable", 'Check your connection and try again.')
      })
    return
  }

  if (page === 'dj' && id) {
    dispose = live(
      app,
      id,
      (data) => renderViewer(app, data, { storeKey: id, homeHref: '#/' }),
      (data) => gigs.put({ id, t: data.t, d: data.d }),
    )
    return
  }

  if (page === 't' && id) {
    dispose = live(app, id, (data) => renderPublic(app, data))
    return
  }

  dispose = renderHome(app)
}

window.addEventListener('hashchange', route)
route()

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {})
}
