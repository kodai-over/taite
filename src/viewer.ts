import { resolve, type EventData, type ResolvedSlot } from './data'
import { esc, fmtClock, fmtDur, fmtHM, now, store } from './util'
import { initWakeLock } from './wakelock'

/** 警告レベル: 出番直前 / 残り10分 / 5分 / 1分 / 超過 */
type Level = '' | 'soon' | 'w10' | 'w5' | 'w1' | 'over' | 'overAck'

const MIN = 60_000
const OVER_SHOW_MS = 30 * MIN // 自分のセット終了後、超過表示を続ける時間（延長してプレイ中の場合もあるため長めに。点滅はタップで止められる）
const SOON_MS = 10 * MIN // 出番の何分前から「まもなく出番」にするか
/** 「DJではない（全体表示）」を選んだ時の保存値 */
const ALL = '__all__'

const levelOf = (remain: number): Level =>
  remain <= 1 * MIN ? 'w1' : remain <= 5 * MIN ? 'w5' : remain <= 10 * MIN ? 'w10' : ''

export function renderViewer(root: HTMLElement, ev: EventData, payload: string): () => void {
  const slots = resolve(ev)
  const meKey = `taite:me:${ev.d}:${ev.t}`
  const saved = store.get(meKey)
  // null = まだ選んでいない（名前選択画面を出す）, ALL = 全体表示, それ以外 = DJ名
  let me: string | null = saved === ALL || slots.some((s) => s.name === saved) ? saved : null
  // 枠が1つもない（壊れたリンク等）なら名前選択を飛ばし、全体表示でエラー文言を出す
  if (!slots.length) me = ALL

  // DJ名ごとの出番時刻（同じDJが複数枠ある場合はまとめる）
  const djs = [...new Set(slots.map((s) => s.name))].map((name) => ({
    name,
    times: slots
      .filter((s) => s.name === name)
      .map((s) => `${fmtHM(s.start)}–${fmtHM(s.end)}`)
      .join(' / '),
  }))

  root.innerHTML = `
  <section id="picker" class="picker" hidden>
    <div class="v-title">${esc(ev.t || 'TAITE')}</div>
    <h1>あなたは誰？</h1>
    <p>自分の名前を選ぶと、出番までの時間とセットの残り時間を表示します。</p>
    <ul class="pick-list">
      ${djs
        .map(
          (d) => `
        <li><button type="button" class="pick" data-name="${esc(d.name)}">
          <span class="n">${esc(d.name)}</span><span class="t">${d.times}</span>
        </button></li>`,
        )
        .join('')}
    </ul>
    <button type="button" id="pick-all" class="btn ghost wide">DJではない（全体のタイムテーブルを見る）</button>
  </section>

  <div id="main" class="viewer" hidden>
    <header class="v-head">
      <div class="v-title">${esc(ev.t || 'TAITE')}</div>
      <button id="wake" class="wake" type="button"></button>
    </header>

    <div id="mode" class="mode"></div>

    <div id="clock" class="clock" aria-label="現在時刻">--:--:--</div>

    <section id="card" class="card" aria-live="polite">
      <div id="label" class="card-label"></div>
      <div id="name" class="card-name"></div>
      <div id="timer" class="timer">--:--</div>
      <div class="bar"><div id="bar" class="bar-fill"></div></div>
      <div id="range" class="card-range"></div>
    </section>

    <div id="next" class="next"></div>

    <h2 class="list-head">タイムテーブル</h2>
    <ol id="list" class="list">
      ${slots
        .map(
          (s) => `
        <li data-i="${s.i}" data-name="${esc(s.name)}">
          <div class="row">
            <span class="t">${fmtHM(s.start)}–${fmtHM(s.end)}</span>
            <span class="n">${esc(s.name)}</span>
            <span class="badge"></span>
          </div>
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
  const picker = $('picker')
  const main = $('main')

  const isDj = () => me !== null && me !== ALL

  const renderMode = () => {
    picker.hidden = me !== null
    main.hidden = me === null
    mode.innerHTML = isDj()
      ? `<span class="who"><b>${esc(me!)}</b></span><button type="button" id="change" class="btn small">変更</button>`
      : `<span class="who">全体表示</span><button type="button" id="change" class="btn small">自分の名前を選ぶ</button>`
    mode.querySelector('#change')!.addEventListener('click', () => setMe(null))
  }

  const setMe = (name: string | null) => {
    me = name
    store.set(meKey, name)
    renderMode()
    tick()
    window.scrollTo({ top: 0 })
  }

  picker.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button.pick')
    if (b) setMe(b.dataset.name!)
  })
  $('pick-all').addEventListener('click', () => setMe(ALL))

  // 一覧は表示のみ。暗いブースでの誤タップで他のDJに切り替わらないよう、切り替えは「変更」ボタンからだけにする

  let lastLevel: Level = ''
  /** 超過の点滅をタップで止めた枠（同じ枠の間は点滅させない） */
  const ackKey = `${meKey}:ack`
  const savedAck = store.get(ackKey)
  // 枠は番号ではなく内容で識別する（タイムテーブルを直して並びが変わっても別の枠と取り違えないように）
  const slotId = (s: ResolvedSlot) => `${s.name}@${s.start}-${s.end}`
  let ackedSlot: string | null = savedAck
  let overSlot: string | null = null
  $('card').addEventListener('click', () => {
    if (overSlot !== null) {
      ackedSlot = overSlot
      store.set(ackKey, overSlot) // 再読み込みしても点滅を再開しない
      tick()
    }
  })

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
    if (canVibrate && o.level !== lastLevel && ['soon', 'w5', 'w1', 'over'].includes(o.level)) {
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
      li.classList.toggle('mine', isDj() && s.name === me)
      li.querySelector('.badge')!.textContent = s === cur ? 'NOW' : isDj() && s.name === me ? 'YOU' : ''
    })

    if (!slots.length) {
      show({ label: 'タイムテーブルがありません', name: '', timer: '--:--', progress: 0, range: '', next: '', level: '' })
      return
    }

    if (me === null) {
      // 名前選択中は警告表示を解除
      delete document.body.dataset.level
      lastLevel = ''
      return
    }

    if (isDj()) {
      const mine = slots.filter((s) => s.name === me)
      let target = mine.find((s) => t < s.end) ?? mine[mine.length - 1]
      // 同じDJの枠が複数ある場合、直前の枠の終了から OVER_SHOW_MS 以内で、次の枠が「まもなく出番」より先なら、
      // 前の枠の超過表示を優先する（終わった瞬間に次の出番のカウントダウンへ切り替わらないように）
      const prev = mine.filter((s) => s.end <= t).pop()
      if (prev && t - prev.end < OVER_SHOW_MS && target.start - t > SOON_MS) target = prev
      overSlot = null
      const rangeText = `${fmtHM(target.start)} 〜 ${fmtHM(target.end)}`
      if (t < target.start) {
        const wait = target.start - t
        show({
          label: wait <= SOON_MS ? 'まもなく出番' : '出番まで',
          name: `出番 ${rangeText}`,
          timer: fmtDur(wait),
          progress: 0,
          range: `セット ${Math.round((target.end - target.start) / MIN)}分`,
          next: cur ? `いまプレイ中: ${cur.name}（残り ${fmtDur(cur.end - t)}）` : '',
          level: wait <= SOON_MS ? 'soon' : '',
        })
      } else if (t < target.end) {
        const remain = target.end - t
        show({
          label: '残り時間',
          name: 'ON AIR',
          timer: fmtDur(remain),
          progress: (t - target.start) / (target.end - target.start),
          range: rangeText,
          next: nextLine(nextAfter(target)),
          level: levelOf(remain),
        })
      } else if (t - target.end < OVER_SHOW_MS) {
        overSlot = slotId(target)
        const acked = ackedSlot === overSlot
        const following = nextAfter(target)
        show({
          label: acked ? '終了時刻を超過' : '終了時刻を超過（タップで点滅を止める）',
          // 実際に交代したかはアプリから分からないので、促すのではなく状況を伝える
          name: following ? `次は ${following.name}` : '最後のセットです',
          timer: '+' + fmtDur(t - target.end),
          progress: 1,
          range: rangeText,
          next: '',
          level: acked ? 'overAck' : 'over',
        })
      } else {
        show({ label: 'セット終了', name: 'お疲れさまでした', timer: '--:--', progress: 1, range: rangeText, next: '', level: '' })
      }
      return
    }

    overSlot = null
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
  document.title = `${ev.t || 'TAITE'} – タイマー`

  return () => {
    clearInterval(timerId)
    disposeWake()
    delete document.body.dataset.level
  }
}
