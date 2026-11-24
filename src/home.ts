import { pasteLink, standalone } from './applink'
import { cache, fetchEvent, forget, gigs, mine } from './api'
import { fmtDate } from './editor'
import { icon } from './icons'
import { esc } from './util'

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

/**
 * トップ画面: タイムテーブルの一覧と、新規作成のプラスボタンだけ。
 * 自分が作ったもの・DJ用リンクで開いたものを1つにまとめ、タップでタイムテーブル画面を開く
 * 自分が作ったものには編集ボタンを付ける（編集・削除は編集画面でだけ行う）。一覧はこの端末に保存（ログインなし）。
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
          <button type="button" class="ibtn paste" aria-label="Add from Link" title="Add from Link">${icon.paste}</button>
          <a class="ibtn add" href="#/new" aria-label="New Timetable" title="New Timetable">${icon.plus}</a>
        </div>
      </header>
      ${
        list.length
          ? `<ul class="grp h-list">${list
              .map(
                (x) => `
            <li>
              <a class="h-row" href="#/dj/${esc(x.id)}">
                <span class="li-name">${esc(x.t || (x.d ? 'Untitled' : 'Loading…'))}</span>
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
    root.querySelector('.paste')!.addEventListener('click', () => void pasteLink())
  }

  render()
  document.title = 'TAITE'

  // 名前と日付がまだないもの（取り込んだばかり・前回オフラインだった）をサーバーから埋める
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

  return () => (gone = true)
}
