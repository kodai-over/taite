import { cache, fetchEvent, forget, subscribe, type Snapshot } from './api'
import type { EventData } from './data'
import { icon } from './icons'

/**
 * サーバー上のタイムテーブルを表示し、更新が届いたら描き直す（DJ用・一般用で共通）。
 * まず端末に保存してある内容ですぐ表示し、つながったら最新に差し替える。電波が切れても表示とタイマーは続く。
 */
export function live(
  root: HTMLElement,
  id: string,
  render: (data: EventData) => () => void,
  onData?: (data: EventData) => void,
  /** アプリの一覧から開いた時だけ、一覧へ戻るリンクを出す（リンクで開いた時は、そのイベントだけを見せる） */
  home = false,
): () => void {
  let disposeView: () => void = () => {}
  let shown = ''
  let status: 'live' | 'offline' = 'offline'

  const applyStatus = () =>
    root.querySelectorAll<HTMLElement>('.sync').forEach((el) => {
      el.hidden = status === 'live'
      el.innerHTML = icon.offline
      el.title = 'Offline. Showing the last saved timetable.'
      el.setAttribute('aria-label', el.title)
    })

  const show = (snap: Snapshot) => {
    const json = JSON.stringify(snap.data)
    if (json === shown) return
    shown = json
    disposeView()
    disposeView = render(snap.data)
    applyStatus()
    onData?.(snap.data)
  }

  const message = (title: string, text: string, retry = false) => {
    root.innerHTML = `<div class="error"><h1>${title}</h1><p>${text}</p>${
      retry ? '<button type="button" class="go" data-retry>Try Again</button>' : ''
    }${home ? `<a class="go${retry ? ' sub' : ''}" href="#/">${icon.home}<span>All Timetables</span></a>` : ''}</div>`
    // 電波が戻ったら開き直せるように（ハッシュはそのままなので、読み込み直すと同じタイムテーブルを開く）
    root.querySelector('[data-retry]')?.addEventListener('click', () => location.reload())
  }

  // 削除されたタイムテーブル: 端末の一覧・キャッシュからも消す
  const gone = () => {
    forget(id)
    unsubscribe()
    disposeView()
    disposeView = () => {}
  }

  const cached = cache.get(id)
  if (cached) show(cached)
  else root.innerHTML = '<div class="loading" aria-busy="true">Loading…</div>'

  fetchEvent(id)
    .then((snap) => {
      if (snap) {
        cache.put(id, snap)
        show(snap)
      } else {
        gone()
        message('Timetable not found', 'The link may be wrong, or the timetable was deleted. Ask the organizer for the link again.')
      }
    })
    .catch(() => {
      if (!cached)
        message(
          "Can't load the timetable",
          "This device hasn't opened it before, so the first time needs a connection. Try again where you have signal.",
          true,
        )
    })

  const unsubscribe = subscribe(
    id,
    (snap) => {
      cache.put(id, snap)
      show(snap)
    },
    (s) => {
      status = s
      applyStatus()
    },
    () => {
      gone()
      message('Timetable deleted', 'The organizer deleted this timetable. If the event is still on, ask them for a new link.')
    },
  )

  return () => {
    unsubscribe()
    disposeView()
  }
}
