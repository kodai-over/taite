import { resolve, type EventData, type ResolvedSlot } from './data'
import { esc, fmtClock, fmtDur, fmtHM, now, store } from './util'
import { initWakeLock } from './wakelock'

/** 警告レベル: 10分前 / 5分前 / 1分前 / 超過 */
type Level = '' | 'w10' | 'w5' | 'w1' | 'over'

const MIN = 60_000
const OVER_SHOW_MS = 30 * MIN // 自分のセット終了後、超過表示を続ける時間

const levelOf = (remain: number): Level =>
  remain <= 1 * MIN ? 'w1' : remain <= 5 * MIN ? 'w5' : remain <= 10 * MIN ? 'w10' : ''

export function renderViewer(root: HTMLElement, ev: EventData, payload: string): () => void {
  const slots = resolve(ev)
  const meKey = `djtt:me:${ev.d}:${ev.t}`
  let me: string | null = store.get(meKey)
  if (me && !slots.some((s) => s.name === me)) me = null

  root.innerHTML = `
  <div class="viewer">
    <header class="v-head">
      <div class="v-title">${esc(ev.t || 'DJ Timetable')}</div>
      <button id="wake" class="wake" type="button"></button>
    </header>

    <div id="clock" class="clock" aria-label="現在時刻">--:--:--</div>

    <section id="card" class="card" aria-live="polite">
      <div id="label" class="card-label"></div>
      <div id="name" class="card-name"></div>
      <div id="timer" class="timer">--:--</div>
      <div class="bar"><div id="bar" class="bar-fill"></div></div>
      <div id="range" class="card-range"></div>
    </section>

    <div id="next" class="next"></div>

    <div id="mode" class="mode"></div>

    <ol id="list" class="list">
      ${slots
        .map(
          (s) => `
        <li data-i="${s.i}" data-name="${esc(s.name)}">
          <button type="button">
            <span class="t">${fmtHM(s.start)}–${fmtHM(s.end)}</span>
            <span class="n">${esc(s.name)}</span>
            <span class="badge"></span>
          </button>
        </li>`,
        )
        .join('')}
    </ol>

    <footer class="v-foot">
      <a href="#e.${payload}">このタイムテーブルを編集・複製</a>
    </footer>
  </div>`

  const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>('#' + id)!
  const clock = $('clock')
  const label = $('label')
  const nameEl = $('name')
  const timer = $('timer')
  const bar = $('bar')
  const range = $('range')
  const next = $('next')
  const mode = $('mode')
  const list = $<HTMLOListElement>('list')
  const items = [...list.querySelectorAll<HTMLLIElement>('li')]

  const renderMode = () => {
    mode.innerHTML = me
      ? `<span>DJモード: <b>${esc(me)}</b></span><button type="button" id="unme" class="btn small">全体表示に戻す</button>`
      : `<span>自分の名前をタップすると、自分のセット専用の表示になります</span>`
    mode.querySelector('#unme')?.addEventListener('click', () => setMe(null))
  }

  const setMe = (name: string | null) => {
    me = name
    store.set(meKey, name)
    renderMode()
    tick()
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  list.addEventListener('click', (e) => {
    const li = (e.target as HTMLElement).closest<HTMLLIElement>('li')
    if (!li) return
    const n = li.dataset.name!
    setMe(me === n ? null : n)
  })

  let lastLevel: Level = ''

  const show = (o: {
    label: string
    name: string
    timer: string
    progress: number
    range: string
    next: string
    level: Level
  }) => {
    label.textContent = o.label
    nameEl.textContent = o.name
    timer.textContent = o.timer
    timer.style.setProperty('--chars', String(o.timer.length))
    bar.style.transform = `scaleX(${Math.min(1, Math.max(0, o.progress))})`
    range.textContent = o.range
    next.textContent = o.next
    document.body.dataset.level = o.level
    const canVibrate = navigator.userActivation?.hasBeenActive ?? true // 未タップ時はブラウザが拒否する
    if (canVibrate && o.level !== lastLevel && (o.level === 'w5' || o.level === 'w1' || o.level === 'over')) {
      navigator.vibrate?.([200, 100, 200])
    }
    lastLevel = o.level
  }

  const nextAfter = (s: ResolvedSlot): ResolvedSlot | undefined => slots.find((x) => x.start >= s.end && x !== s)
  const nextLine = (s: ResolvedSlot | undefined) => (s ? `NEXT  ${fmtHM(s.start)}〜  ${s.name}` : '')

  const tick = () => {
    const t = now()
    clock.textContent = fmtClock(t)

    let cur: ResolvedSlot | undefined
    for (const s of slots) if (s.start <= t && t < s.end) cur = s
    const upcoming = slots.find((s) => s.start > t)

    items.forEach((li, k) => {
      const s = slots[k]
      li.classList.toggle('past', s.end <= t)
      li.classList.toggle('now', s === cur)
      li.classList.toggle('mine', s.name === me)
      li.querySelector('.badge')!.textContent = s === cur ? 'NOW' : s.name === me ? 'YOU' : ''
    })

    if (!slots.length) {
      show({ label: 'タイムテーブルがありません', name: '', timer: '--:--', progress: 0, range: '', next: '', level: '' })
      return
    }

    if (me) {
      const mine = slots.filter((s) => s.name === me)
      const target = mine.find((s) => t < s.end) ?? mine[mine.length - 1]
      const rangeText = `${fmtHM(target.start)} 〜 ${fmtHM(target.end)}`
      if (t < target.start) {
        show({
          label: '出番まで',
          name: target.name,
          timer: fmtDur(target.start - t),
          progress: 0,
          range: rangeText,
          next: cur ? `いまプレイ中: ${cur.name}（残り ${fmtDur(cur.end - t)}）` : '',
          level: '',
        })
      } else if (t < target.end) {
        const remain = target.end - t
        show({
          label: '残り時間',
          name: target.name,
          timer: fmtDur(remain),
          progress: (t - target.start) / (target.end - target.start),
          range: rangeText,
          next: nextLine(nextAfter(target)),
          level: levelOf(remain),
        })
      } else if (t - target.end < OVER_SHOW_MS) {
        show({
          label: '終了時刻を超過',
          name: target.name,
          timer: '+' + fmtDur(t - target.end),
          progress: 1,
          range: rangeText,
          next: nextLine(nextAfter(target)),
          level: 'over',
        })
      } else {
        show({ label: 'お疲れさまでした', name: target.name, timer: '--:--', progress: 1, range: rangeText, next: '', level: '' })
      }
      return
    }

    if (cur) {
      const remain = cur.end - t
      show({
        label: 'NOW PLAYING',
        name: cur.name,
        timer: fmtDur(remain),
        progress: (t - cur.start) / (cur.end - cur.start),
        range: `${fmtHM(cur.start)} 〜 ${fmtHM(cur.end)}`,
        next: nextLine(nextAfter(cur)),
        level: levelOf(remain),
      })
    } else if (upcoming) {
      show({
        label: upcoming === slots[0] ? 'スタートまで' : '次の出番まで',
        name: upcoming.name,
        timer: fmtDur(upcoming.start - t),
        progress: 0,
        range: `${fmtHM(upcoming.start)} 〜 ${fmtHM(upcoming.end)}`,
        next: '',
        level: '',
      })
    } else {
      show({ label: 'イベント終了', name: 'Thank you!', timer: '--:--', progress: 1, range: '', next: '', level: '' })
    }
  }

  renderMode()
  tick()
  // 秒の切り替わりに合わせて更新
  const timerId = setInterval(tick, 250)
  const disposeWake = initWakeLock($<HTMLButtonElement>('wake'))
  document.title = `${ev.t || 'DJ Timetable'} – タイマー`

  return () => {
    clearInterval(timerId)
    disposeWake()
    delete document.body.dataset.level
  }
}
