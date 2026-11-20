import { fmtDate } from './editor'
import { resolve, type EventData } from './data'
import { esc, fmtHM, now } from './util'

/** 一般用: タイムテーブルだけのシンプルな画面（今プレイ中の行の時刻を緑に） */
export function renderPublic(root: HTMLElement, ev: EventData): () => void {
  const slots = resolve(ev)
  root.innerHTML = `
  <div class="public">
    <header class="pub-h">
      <h1 class="pub-t">${esc(ev.t || 'Timetable')}</h1>
      <p class="pub-d">${esc(ev.d ? fmtDate(ev.d) : '')}</p>
      <span class="sync" hidden></span>
    </header>
    <ol class="list pub-list">
      ${slots
        .map(
          (s) => `
        <li>
          <div class="row">
            <span class="li-time">${fmtHM(s.start)}–${fmtHM(s.end)}</span>
            <span class="li-name">${esc(s.name)}</span>
          </div>
        </li>`,
        )
        .join('')}
    </ol>
    ${slots.length ? '' : '<p class="h-empty">No sets yet.</p>'}
  </div>`
  const items = [...root.querySelectorAll<HTMLLIElement>('.pub-list li')]
  const tick = () => {
    const t = now()
    items.forEach((li, k) => {
      li.classList.toggle('past', slots[k].end <= t)
      li.classList.toggle('now', slots[k].start <= t && t < slots[k].end)
    })
  }
  tick()
  const timer = setInterval(tick, 10_000)
  document.title = `${ev.t || 'TAITE'} – Timetable`
  return () => clearInterval(timer)
}
