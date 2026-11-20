import { resolve, type EventData, type ResolvedSlot } from './data'
import { esc, fmtClock, fmtDur, fmtHM, now, store } from './util'
import { initWakeLock } from './wakelock'

/** 警告レベル: 出番直前 / 残り10分 / 5分 / 1分 / 超過 / 超過（点滅停止済み） */
type Level = '' | 'soon' | 'w10' | 'w5' | 'w1' | 'over' | 'overAck'
/** 時計の表示方式 */
type Face = 'digital' | 'analog'

const MIN = 60_000
const OVER_SHOW_MS = 30 * MIN // 自分のセット終了後、超過表示を続ける時間（延長してプレイ中の場合もあるため長めに。点滅はタップで止められる）
const SOON_MS = 10 * MIN // 出番の何分前から「まもなく出番」にするか
/** 「DJではない（全体表示）」を選んだ時の保存値 */
const ALL = '__all__'
const FACE_KEY = 'taite:face'

const levelOf = (remain: number): Level =>
  remain <= 1 * MIN ? 'w1' : remain <= 5 * MIN ? 'w5' : remain <= 10 * MIN ? 'w10' : ''

/* ---------- アナログ時計の描画 ---------- */
// 文字盤は viewBox 0 0 200 200、中心 (100,100)。角度は 12時=0度、時計回り

const polar = (r: number, deg: number): [number, number] => {
  const a = ((deg - 90) * Math.PI) / 180
  return [100 + r * Math.cos(a), 100 + r * Math.sin(a)]
}

const minuteAngle = (t: number) => {
  const d = new Date(t)
  return ((d.getMinutes() + d.getSeconds() / 60) / 60) * 360
}
const hourAngle = (t: number) => {
  const d = new Date(t)
  return (((d.getHours() % 12) + d.getMinutes() / 60) / 12) * 360
}
const secondAngle = (t: number) => (new Date(t).getSeconds() / 60) * 360

/** 時刻 from から長さ ms 分の扇形（60分を一周として描く。60分以上は円全体） */
function sectorPath(from: number, ms: number, r = 70): string {
  if (ms <= 0) return ''
  if (ms >= 60 * MIN) return `M 100 ${100 - r} A ${r} ${r} 0 1 1 100 ${100 + r} A ${r} ${r} 0 1 1 100 ${100 - r} Z`
  const a0 = minuteAngle(from)
  const span = (ms / (60 * MIN)) * 360
  const [x0, y0] = polar(r, a0)
  const [x1, y1] = polar(r, a0 + span)
  return `M 100 100 L ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${span > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} Z`
}

const dialTicks = Array.from({ length: 60 }, (_, i) => {
  const major = i % 5 === 0
  const [x0, y0] = polar(90, i * 6)
  const [x1, y1] = polar(major ? 79 : 85, i * 6)
  return `<line class="${major ? 'tick major' : 'tick'}" x1="${x0.toFixed(2)}" y1="${y0.toFixed(2)}" x2="${x1.toFixed(2)}" y2="${y1.toFixed(2)}"/>`
}).join('')

export function renderViewer(root: HTMLElement, ev: EventData, payload: string): () => void {
  const slots = resolve(ev)
  const title = esc(ev.t || 'TAITE')
  const meKey = `taite:me:${ev.d}:${ev.t}`
  const saved = store.get(meKey)
  // null = まだ選んでいない（名前選択画面を出す）, ALL = 全体表示, それ以外 = DJ名
  let me: string | null = saved === ALL || slots.some((s) => s.name === saved) ? saved : null
  // 枠が1つもない（壊れたリンク等）なら名前選択を飛ばし、全体表示でエラー文言を出す
  if (!slots.length) me = ALL
  let face: Face = store.get(FACE_KEY) === 'analog' ? 'analog' : 'digital'
  let showTable = false

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
    <div class="v-title">${title}</div>
    <h1>Who are you?</h1>
    <p>Pick your name to see the time until your set and the time left in it.</p>
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
    <button type="button" id="pick-all" class="btn ghost wide">I'm not a DJ — show the full timetable</button>
  </section>

  <div id="view-timer" class="view-timer" hidden>
    <header class="t-top">
      <div class="who">
        <span id="who-label" class="who-label"></span>
        <span id="who-name" class="who-name"></span>
      </div>
      <button type="button" id="change" class="btn small ghost">Change</button>
    </header>

    <div class="t-meta">
      <span class="v-title">${title}</span>
      <span id="clock" class="clock-sm" aria-label="Current time">--:--:--</span>
    </div>

    <section id="stage" class="stage" aria-live="polite">
      <div id="label" class="stage-label"></div>
      <svg id="dial" class="dial" viewBox="0 0 200 200" aria-hidden="true">
        <circle class="dial-face" cx="100" cy="100" r="96"/>
        <path id="sector" class="dial-sector" d=""/>
        ${dialTicks}
        <line id="hand-h" class="hand hour" x1="100" y1="100" x2="100" y2="54"/>
        <line id="hand-m" class="hand min" x1="100" y1="100" x2="100" y2="26"/>
        <line id="hand-s" class="hand sec" x1="100" y1="114" x2="100" y2="20"/>
        <circle class="dial-pin" cx="100" cy="100" r="4"/>
      </svg>
      <div id="timer" class="timer">--:--</div>
      <div id="sub" class="stage-sub"></div>
      <div class="bar"><div id="bar" class="bar-fill"></div></div>
      <div id="range" class="stage-range"></div>
    </section>

    <div id="next" class="next"></div>

    <footer class="t-bottom">
      <button type="button" id="to-table" class="btn">Timetable</button>
      <button type="button" id="face" class="btn"></button>
      <button type="button" id="wake" class="wake"></button>
    </footer>
  </div>

  <div id="view-table" class="view-table" hidden>
    <header class="l-top">
      <button type="button" id="back" class="btn small">← Timer</button>
      <span class="v-title">${title}</span>
    </header>
    <h1 class="l-head">Timetable</h1>
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
    <a class="btn wide l-edit" href="#e.${payload}">Edit / duplicate this timetable</a>
  </div>`

  const $ = <T extends Element = HTMLElement>(id: string) => root.querySelector<T>('#' + id)!
  const clock = $('clock')
  const label = $('label')
  const sub = $('sub')
  const timer = $('timer')
  const bar = $('bar')
  const range = $('range')
  const next = $('next')
  const whoLabel = $('who-label')
  const whoName = $('who-name')
  const change = $<HTMLButtonElement>('change')
  const stage = $('stage')
  const dial = $<SVGSVGElement>('dial')
  const sector = $<SVGPathElement>('sector')
  const handH = $<SVGLineElement>('hand-h')
  const handM = $<SVGLineElement>('hand-m')
  const handS = $<SVGLineElement>('hand-s')
  const faceBtn = $<HTMLButtonElement>('face')
  const list = $<HTMLOListElement>('list')
  const items = [...list.querySelectorAll<HTMLLIElement>('li')]
  const picker = $('picker')
  const viewTimer = $('view-timer')
  const viewTable = $('view-table')

  const isDj = () => me !== null && me !== ALL

  /** 表示する画面（名前選択 / タイマー / タイムテーブル）を切り替える */
  const renderView = () => {
    picker.hidden = me !== null
    viewTimer.hidden = me === null || showTable
    viewTable.hidden = me === null || !showTable
    // タイマー画面はスクロールさせず画面に固定する
    document.body.classList.toggle('lock', !viewTimer.hidden)
    whoLabel.textContent = isDj() ? 'DJ' : 'FULL TIMETABLE'
    whoName.textContent = isDj() ? me! : 'Everyone'
    change.textContent = isDj() ? 'Change' : 'Pick my name'
    faceBtn.textContent = face === 'analog' ? 'Digital' : 'Analog'
    faceBtn.setAttribute('aria-label', face === 'analog' ? 'Switch to digital display' : 'Switch to analog display')
    stage.classList.toggle('analog', face === 'analog')
    dial.style.display = face === 'analog' ? '' : 'none'
  }

  const setMe = (name: string | null) => {
    me = name
    store.set(meKey, name)
    renderView()
    tick()
    window.scrollTo({ top: 0 })
  }

  picker.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button.pick')
    if (b) setMe(b.dataset.name!)
  })
  $('pick-all').addEventListener('click', () => setMe(ALL))
  change.addEventListener('click', () => setMe(null))

  faceBtn.addEventListener('click', () => {
    face = face === 'analog' ? 'digital' : 'analog'
    store.set(FACE_KEY, face)
    renderView()
    tick()
  })

  // タイムテーブル画面は履歴に積み、端末の「戻る」でもタイマーに戻れるようにする
  $('to-table').addEventListener('click', () => {
    history.pushState({ taite: 'table' }, '')
    showTable = true
    renderView()
    window.scrollTo({ top: 0 })
  })
  $('back').addEventListener('click', () => history.back())
  const onPop = (e: PopStateEvent) => {
    showTable = (e.state as { taite?: string } | null)?.taite === 'table'
    renderView()
  }
  window.addEventListener('popstate', onPop)

  // 一覧は表示のみ。暗いブースでの誤タップで他のDJに切り替わらないよう、切り替えは「Change」ボタンからだけにする

  let lastLevel: Level = ''
  /** 超過の点滅をタップで止めた枠（同じ枠の間は点滅させない） */
  const ackKey = `${meKey}:ack`
  // 枠は番号ではなく内容で識別する（タイムテーブルを直して並びが変わっても別の枠と取り違えないように）
  const slotId = (s: ResolvedSlot) => `${s.name}@${s.start}-${s.end}`
  let ackedSlot: string | null = store.get(ackKey)
  let overSlot: string | null = null
  stage.addEventListener('click', () => {
    if (overSlot !== null) {
      ackedSlot = overSlot
      store.set(ackKey, overSlot) // 再読み込みしても点滅を再開しない
      tick()
    }
  })

  const show = (o: {
    label: string
    sub: string
    timer: string
    progress: number
    range: string
    next: string
    level: Level
    /** アナログ時計に重ねる扇形（この時刻から、この長さ） */
    sector?: { from: number; ms: number }
  }) => {
    label.textContent = o.label
    sub.textContent = o.sub
    timer.textContent = o.timer
    timer.style.setProperty('--chars', String(o.timer.length))
    bar.style.transform = `scaleX(${Math.min(1, Math.max(0, o.progress))})`
    range.textContent = o.range
    next.textContent = o.next
    sector.setAttribute('d', o.sector ? sectorPath(o.sector.from, o.sector.ms) : '')
    document.body.dataset.level = o.level
    const canVibrate = navigator.userActivation?.hasBeenActive ?? true // 未タップ時はブラウザが拒否する
    if (canVibrate && o.level !== lastLevel && ['soon', 'w5', 'w1', 'over'].includes(o.level)) {
      navigator.vibrate?.([200, 100, 200])
    }
    lastLevel = o.level
  }

  const nextAfter = (s: ResolvedSlot): ResolvedSlot | undefined => slots.find((x) => x.start >= s.end && x !== s)
  const nextLine = (s: ResolvedSlot | undefined) => (s ? `Next  ${fmtHM(s.start)}  ${s.name}` : '')
  const rangeOf = (s: ResolvedSlot) => `${fmtHM(s.start)} – ${fmtHM(s.end)}`

  const tick = () => {
    const t = now()
    clock.textContent = fmtClock(t)
    if (face === 'analog') {
      handH.setAttribute('transform', `rotate(${hourAngle(t)} 100 100)`)
      handM.setAttribute('transform', `rotate(${minuteAngle(t)} 100 100)`)
      handS.setAttribute('transform', `rotate(${secondAngle(t)} 100 100)`)
    }

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
      show({ label: 'NO TIMETABLE', sub: 'This link has no sets.', timer: '--:--', progress: 0, range: '', next: '', level: '' })
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
      if (t < target.start) {
        const wait = target.start - t
        show({
          label: wait <= SOON_MS ? "YOU'RE ON SOON" : 'YOUR SET STARTS IN',
          sub: cur ? `Now playing: ${cur.name} (${fmtDur(cur.end - t)} left)` : '',
          timer: fmtDur(wait),
          progress: 0,
          range: `Your set ${rangeOf(target)} · ${Math.round((target.end - target.start) / MIN)} min`,
          next: '',
          level: wait <= SOON_MS ? 'soon' : '',
          sector: { from: t, ms: wait },
        })
      } else if (t < target.end) {
        const remain = target.end - t
        const following = nextAfter(target)
        show({
          label: 'TIME LEFT',
          sub: 'ON AIR',
          timer: fmtDur(remain),
          progress: (t - target.start) / (target.end - target.start),
          range: `Your set ${rangeOf(target)}`,
          next: nextLine(following),
          level: levelOf(remain),
          sector: { from: t, ms: remain },
        })
      } else if (t - target.end < OVER_SHOW_MS) {
        overSlot = slotId(target)
        const acked = ackedSlot === overSlot
        const following = nextAfter(target)
        show({
          label: acked ? 'OVERTIME' : 'OVERTIME · TAP TO STOP FLASHING',
          // 実際に交代したかはアプリから分からないので、促すのではなく状況を伝える
          sub: following ? `Next: ${following.name}` : 'Last set of the night',
          timer: '+' + fmtDur(t - target.end),
          progress: 1,
          range: `Your set ${rangeOf(target)}`,
          next: '',
          level: acked ? 'overAck' : 'over',
        })
      } else {
        show({ label: 'SET COMPLETE', sub: 'Great set!', timer: '--:--', progress: 1, range: `Your set ${rangeOf(target)}`, next: '', level: '' })
      }
      return
    }

    overSlot = null
    if (cur) {
      const remain = cur.end - t
      show({
        label: 'NOW PLAYING',
        sub: cur.name,
        timer: fmtDur(remain),
        progress: (t - cur.start) / (cur.end - cur.start),
        range: rangeOf(cur),
        next: nextLine(nextAfter(cur)),
        level: levelOf(remain),
        sector: { from: t, ms: remain },
      })
    } else if (upcoming) {
      show({
        label: upcoming === slots[0] ? 'STARTS IN' : 'NEXT SET IN',
        sub: upcoming.name,
        timer: fmtDur(upcoming.start - t),
        progress: 0,
        range: rangeOf(upcoming),
        next: '',
        level: '',
        sector: { from: t, ms: upcoming.start - t },
      })
    } else {
      show({ label: 'EVENT OVER', sub: 'Thank you!', timer: '--:--', progress: 1, range: '', next: '', level: '' })
    }
  }

  renderView()
  tick()
  // 秒の切り替わりに合わせて更新
  const timerId = setInterval(tick, 250)
  const disposeWake = initWakeLock($<HTMLButtonElement>('wake'))
  document.title = `${ev.t || 'TAITE'} – Timer`

  return () => {
    clearInterval(timerId)
    disposeWake()
    window.removeEventListener('popstate', onPop)
    document.body.classList.remove('lock')
    delete document.body.dataset.level
  }
}
