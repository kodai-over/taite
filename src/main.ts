import '@fontsource/barlow/latin-500.css'
import '@fontsource/barlow/latin-600.css'
import '@fontsource/barlow/latin-700.css'
import './style.css'
import { icon } from './icons'
import { decode } from './data'
import { renderEditor } from './editor'
import { renderViewer } from './viewer'

const app = document.getElementById('app')!
let dispose: () => void = () => {}

function route() {
  dispose()
  window.scrollTo(0, 0)
  const raw = location.hash.slice(1)
  let h = raw
  try {
    h = decodeURIComponent(raw)
  } catch {
    // % の並びが壊れたリンク。そのまま読み込みを試し、読めなければエラー画面にする
  }

  if (h.startsWith('v1.')) {
    const ev = decode(h)
    if (ev) {
      dispose = renderViewer(app, ev, h)
      return
    }
    app.innerHTML = `<div class="error">
      <h1>Link broken</h1>
      <p>The URL may have been cut off. Ask for the link again.</p>
      <a class="go" href="#">${icon.plus}<span>New timetable</span></a></div>`
    dispose = () => {}
    return
  }

  if (h.startsWith('e.')) {
    const ev = decode(h.slice(2))
    // 編集用URLは一度読み込んだら消す（以降は下書きとして保存される）
    history.replaceState(null, '', location.pathname + location.search)
    dispose = renderEditor(app, ev ?? undefined)
    return
  }

  dispose = renderEditor(app)
}

window.addEventListener('hashchange', route)
route()

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {})
}
