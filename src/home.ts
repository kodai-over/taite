import { gigs, mine } from './api'
import { fmtDate } from './editor'
import { icon } from './icons'
import { esc } from './util'

/**
 * トップ画面: 自分が作ったタイムテーブル（編集へ）と、DJ用リンクで開いたイベント（タイマーへ）。
 * 一覧はこの端末に保存している（ログインなし）。
 */
export function renderHome(root: HTMLElement): () => void {
  const render = () => {
    const made = mine.all()
    const played = gigs.all()
    const row = (href: string, t: string, d: string, kind: 'mine' | 'gig', id: string) => `
      <li>
        <a class="h-row" href="${href}">
          <span class="li-time">${esc(d ? fmtDate(d) : '—')}</span>
          <span class="li-name">${esc(t || 'Untitled')}</span>
        </a>
        <button type="button" class="del" data-remove="${kind}" data-id="${esc(id)}" aria-label="Remove from This List" title="Remove from This List">${icon.remove}</button>
      </li>`

    root.innerHTML = `
    <div class="editor home">
      <header class="e-head">
        <h1 class="brand">TAITE</h1>
        <p class="tagline">DJ Set Timer</p>
      </header>

      <h2 class="grp-h">Your Timetables</h2>
      ${
        made.length
          ? `<ul class="grp h-list">${made.map((m) => row(`#/edit/${m.id}/${m.key}`, m.t, m.d, 'mine', m.id)).join('')}</ul>`
          : `<p class="h-empty">Timetables you create show up here.</p>`
      }
      <a class="go" href="#/new">${icon.plus}<span>New Timetable</span></a>

      <h2 class="grp-h">Your Gigs</h2>
      ${
        played.length
          ? `<ul class="grp h-list">${played.map((g) => row(`#/dj/${g.id}`, g.t, g.d, 'gig', g.id)).join('')}</ul>`
          : `<p class="h-empty">Events you open from a DJ link show up here.</p>`
      }
    </div>`
  }

  // 一覧から外す（タイムテーブル自体は消えない。リンクがあればまた開ける）
  const onClick = (e: Event) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-remove]')
    if (!b) return
    const id = b.dataset.id!
    if (b.dataset.remove === 'mine') {
      if (!confirm('Remove this timetable from this device?\nKeep the edit link if you want to edit it again.')) return
      mine.remove(id)
    } else {
      gigs.remove(id)
    }
    render()
  }
  root.addEventListener('click', onClick)
  render()
  document.title = 'TAITE'
  return () => root.removeEventListener('click', onClick)
}
