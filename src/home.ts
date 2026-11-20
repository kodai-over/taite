import { gigs, mine } from './api'
import { fmtDate } from './editor'
import { icon } from './icons'
import { esc } from './util'

/**
 * トップ画面: タイムテーブルの一覧と、新規作成のプラスボタンだけ。
 * 自分が作ったもの・DJ用リンクで開いたものを1つにまとめ、タップでタイムテーブル画面を開く
 * 自分が作ったものには編集ボタンを付ける（編集・削除は編集画面でだけ行う）。一覧はこの端末に保存（ログインなし）。
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
            </li>`,
              )
              .join('')}</ul>`
          : ''
      }
    </div>`
  }

  render()
  document.title = 'TAITE'
  return () => {}
}
