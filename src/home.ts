import { gigs, mine } from './api'
import { fmtDate } from './editor'
import { icon } from './icons'
import { esc } from './util'

/**
 * トップ画面: タイムテーブルの一覧と、新規作成のプラスボタンだけ。
 * 自分が作ったもの・DJ用リンクで開いたものを1つにまとめ、タップでタイムテーブル画面を開く
 * 自分が作ったものには編集ボタンを付ける（編集画面へはここからだけ行ける）。一覧はこの端末に保存（ログインなし）。
 */
export function renderHome(root: HTMLElement): () => void {
  const render = () => {
    const keys = new Map(mine.all().map((m) => [m.id, m.key]))
    const seen = new Set<string>()
    const list = [...mine.all(), ...gigs.all()]
      .sort((a, b) => b.at - a.at)
      .filter((x) => !seen.has(x.id) && seen.add(x.id))

    root.innerHTML = `
    <div class="editor home">
      <header class="e-head">
        <h1 class="brand">TAITE</h1>
        <a class="ibtn add" href="#/new" aria-label="New Timetable" title="New Timetable">${icon.plus}</a>
      </header>
      ${
        list.length
          ? `<ul class="grp h-list">${list
              .map(
                (x) => `
            <li>
              <a class="h-row" href="#/dj/${esc(x.id)}">
                <span class="li-name">${esc(x.t || 'Untitled')}</span>
                <span class="li-time">${esc(x.d ? fmtDate(x.d) : '—')}</span>
              </a>
              ${
                keys.has(x.id)
                  ? `<a class="ibtn edit" href="#/edit/${esc(x.id)}/${esc(keys.get(x.id)!)}" aria-label="Edit Timetable" title="Edit">${icon.edit}</a>`
                  : ''
              }
              <button type="button" class="del" data-id="${esc(x.id)}" data-own="${keys.has(x.id) ? 1 : ''}" aria-label="Remove from This List" title="Remove from This List">${icon.remove}</button>
            </li>`,
              )
              .join('')}</ul>`
          : ''
      }
    </div>`
  }

  // 一覧から外す（タイムテーブル自体は消えない。リンクがあればまた開ける）
  const onClick = (e: Event) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('.del')
    if (!b) return
    const id = b.dataset.id!
    if (b.dataset.own && !confirm('Remove this timetable from this device?\nKeep the edit link if you want to edit it again.')) return
    mine.remove(id)
    gigs.remove(id)
    render()
  }
  root.addEventListener('click', onClick)
  render()
  document.title = 'TAITE'
  return () => root.removeEventListener('click', onClick)
}
