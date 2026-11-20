import { resolve, type EventData, type ResolvedSlot } from './data'
import { esc, fmtClock, fmtDur, fmtHM, now, store } from './util'
import { icon } from './icons'
import { initWakeLock } from './wakelock'

/** 警告レベル: 出番直前 / 残り10分 / 5分 / 1分 / 超過 / 超過（点滅停止済み） */
type Level = '' | 'soon' | 'w10' | 'w5' | 'w1' | 'over' | 'overAck'
const MIN = 60_000
const OVER_SHOW_MS = 30 * MIN // 自分のセット終了後、超過表示を続ける時間（延長してプレイ中の場合もあるため長めに。点滅はタップで止められる）
const SOON_MS = 10 * MIN // 出番の何分前から「まもなく出番」にするか
const LONG_PRESS_MS = 500 // 広い画面でDJを切り替える長押しの長さ
/** タイマーとタイムテーブルを左右に並べる広い画面か（style.css のメディアクエリと揃える） */
const WIDE_QUERY = '(min-width: 720px) and (min-height: 520px), (horizontal-viewport-segments: 2)'

const levelOf = (remain: number): Level =>
  remain <= 1 * MIN ? 'w1' : remain <= 5 * MIN ? 'w5' : remain <= 10 * MIN ? 'w10' : ''

export function renderViewer(root: HTMLElement, ev: EventData, payload: string): () => void {
  const slots = resolve(ev)
  const title = esc(ev.t || 'TAITE')
  const meKey = `taite:me:${ev.d}:${ev.t}`
  const saved = store.get(meKey)
  // null = まだ選んでいない（タイムテーブルから選んでもらう）、それ以外 = 自分のDJ名
  let me: string | null = slots.some((s) => s.name === saved) ? saved : null
  let showTable = false

  // 確認用（mock.html）: URLのパラメータで表示状態を固定する。保存はしない
  //   ?me=none（未選択） / DJ名、?view=table、?ack=1（超過の点滅停止済み）
  const q = new URLSearchParams(location.search)
  const qMe = q.get('me')
  if (qMe !== null) me = qMe === 'none' ? null : qMe
  if (q.get('view') === 'table') showTable = true
  const forceAck = q.get('ack') === '1'

  root.innerHTML = `
  <div id="deck" class="deck">
    <section class="pane pane-timer">
      <header class="top">
        <div class="who">
          <span class="ev">${title}</span>
          <span id="who-name" class="me"></span>
        </div>
      </header>

      <div id="stage" class="display" aria-live="polite">
        <div class="readouts">
          <div class="ro" title="Now">${icon.clock}<span id="clock" class="ro-v" aria-label="Current time">--:--:--</span></div>
          <div class="ro" title="Set">${icon.headphones}<span id="set" class="ro-v" aria-label="Set time">--:--–--:--</span></div>
        </div>
        <dl class="lineup">
          <dt id="np-ic" title="Now playing" aria-label="Now playing">${icon.play}</dt>
          <dd id="np" class="lu-name">—</dd>
          <dd id="np-time" class="lu-time"></dd>
          <dt title="Next" aria-label="Next">${icon.next}</dt>
          <dd id="nx" class="lu-name">—</dd>
          <dd id="nx-time" class="lu-time"></dd>
        </dl>
        <div class="core">
          <div class="status"><i class="led" aria-hidden="true"></i><span id="label"></span></div>
          <div id="timer" class="timer">--:--</div>
          <div id="sub" class="sub"></div>
        </div>
        <div class="meter" aria-hidden="true"><div id="bar" class="meter-fill"></div></div>
      </div>

      <footer class="bottom">
        <button type="button" id="to-table" class="ibtn" aria-label="Timetable" title="Timetable">${icon.list}</button>
        <button type="button" id="wake" class="ibtn wake"></button>
      </footer>
    </section>

    <section class="pane pane-table" aria-label="Timetable">
      <header class="top">
        <button type="button" id="back" class="ibtn" aria-label="Back to timer" title="Back">${icon.back}</button>
        <span class="ev">${title}</span>
        <a class="ibtn" href="#e.${payload}" aria-label="Edit or duplicate this timetable" title="Edit / duplicate">${icon.edit}</a>
      </header>
      <p id="hint" class="l-hint">${slots.length ? 'Tap your name' : 'This link has no sets'}</p>
      <ol id="list" class="list">
        ${slots
          .map(
            (s) => `
          <li data-i="${s.i}">
            <button type="button" class="row" data-name="${esc(s.name)}">
              <span class="li-time">${fmtHM(s.start)}–${fmtHM(s.end)}</span>
              <span class="li-name">${esc(s.name)}</span>
              <span class="li-mark" aria-hidden="true"></span>
            </button>
          </li>`,
          )
          .join('')}
      </ol>
    </section>
  </div>`

  const $ = <T extends Element = HTMLElement>(id: string) => root.querySelector<T>('#' + id)!
  const clock = $('clock')
  const label = $('label')
  const sub = $('sub')
  const timer = $('timer')
  const bar = $('bar')
  const setEl = $('set')
  const whoName = $('who-name')
  const np = $('np')
  const npTime = $('np-time')
  const nx = $('nx')
  const nxTime = $('nx-time')
  const stage = $('stage')
  const list = $<HTMLOListElement>('list')
  const items = [...list.querySelectorAll<HTMLLIElement>('li')]
  const deck = $('deck')
  const hint = $('hint')
  const back = $('back')
  const wide = matchMedia(WIDE_QUERY)

  /** 表示する画面（タイマー / タイムテーブル）を切り替える */
  const renderView = () => {
    // 狭い画面ではタイマーとタイムテーブルを切り替える（広い画面では CSS で両方並べる）。
    // 自分をまだ選んでいなければタイムテーブルを出す
    deck.dataset.view = showTable || me === null ? 'table' : 'timer'
    // 画面に固定してスクロールさせない（一覧は内側でスクロール）
    document.body.classList.add('lock')
    whoName.textContent = me ?? '—'
    hint.hidden = me !== null && slots.length > 0
    back.hidden = me === null
  }

  /** 自分のDJを決めてタイマーへ */
  const selectMe = (name: string) => {
    me = name
    store.set(meKey, name)
    if ((history.state as { taite?: string } | null)?.taite === 'table') {
      history.back() // ☰ から開いた一覧なら履歴を戻してタイマーへ（popstate で再描画）
    } else {
      showTable = false
    }
    renderView()
    tick()
  }

  // 一覧の名前で自分を選ぶ。スマホは「一覧を開いてタップ」なので意図した操作とみなしてタップで切り替える。
  // 一覧が常に見えている広い画面では、暗いブースでの誤タップを防ぐため長押しで切り替える（未選択時はタップで可）
  let pressTimer = 0
  let longPressed = false
  const needsLongPress = () => wide.matches && me !== null
  list.addEventListener('pointerdown', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button.row')
    if (!b || !needsLongPress()) return
    longPressed = false
    b.classList.add('pressing')
    pressTimer = window.setTimeout(() => {
      longPressed = true
      b.classList.remove('pressing')
      navigator.vibrate?.(30)
      selectMe(b.dataset.name!)
    }, LONG_PRESS_MS)
  })
  const cancelPress = () => {
    clearTimeout(pressTimer)
    list.querySelectorAll('.pressing').forEach((el) => el.classList.remove('pressing'))
  }
  for (const type of ['pointerup', 'pointerleave', 'pointercancel']) list.addEventListener(type, cancelPress)
  list.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button.row')
    if (!b || needsLongPress() || longPressed) return
    selectMe(b.dataset.name!)
  })
  // 長押しでブラウザのメニューが出ないように
  list.addEventListener('contextmenu', (e) => e.preventDefault())

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
    /** 横に並べる set time（対象の枠の時間帯） */
    set: string
    level: Level
  }) => {
    label.textContent = o.label
    sub.textContent = o.sub
    timer.textContent = o.timer
    timer.style.setProperty('--chars', String(o.timer.length))
    bar.style.transform = `scaleX(${Math.min(1, Math.max(0, o.progress))})`
    setEl.textContent = o.set
    document.body.dataset.level = o.level
    stage.dataset.state = o.label.toLowerCase().replace(/\s+/g, '-')
    const canVibrate = navigator.userActivation?.hasBeenActive ?? true // 未タップ時はブラウザが拒否する
    if (canVibrate && o.level !== lastLevel && ['soon', 'w5', 'w1', 'over'].includes(o.level)) {
      navigator.vibrate?.([200, 100, 200])
    }
    lastLevel = o.level
  }

  const nextAfter = (s: ResolvedSlot): ResolvedSlot | undefined => slots.find((x) => x.start >= s.end && x !== s)
  const rangeOf = (s: ResolvedSlot) => `${fmtHM(s.start)}–${fmtHM(s.end)}`
  /** NOW PLAYING / NEXT のDJ名の横に出す開始〜終了（小さめ） */
  const slotTime = (s: ResolvedSlot) => `${fmtHM(s.start)}–${fmtHM(s.end)}`

  const tick = () => {
    const t = now()
    clock.textContent = fmtClock(t)
    let cur: ResolvedSlot | undefined
    for (const s of slots) if (s.start <= t && t < s.end) cur = s
    const upcoming = slots.find((s) => s.start > t)

    // NOW PLAYING 行: 今プレイ中のDJ名だけ
    np.textContent = cur ? cur.name : '—'
    npTime.textContent = cur ? slotTime(cur) : ''
    // NEXT 行: 今の枠の次（誰もプレイしていなければ、次に始まる枠）
    const nextSlot = cur ? nextAfter(cur) : upcoming
    nx.textContent = nextSlot ? nextSlot.name : '—'
    nxTime.textContent = nextSlot ? slotTime(nextSlot) : ''

    items.forEach((li, k) => {
      const s = slots[k]
      li.classList.toggle('past', s.end <= t)
      li.classList.toggle('now', s === cur)
      li.classList.toggle('mine', me !== null && s.name === me)
      li.querySelector('.li-mark')!.innerHTML = s === cur ? icon.play : me !== null && s.name === me ? icon.headphones : ''
    })

    if (!slots.length) {
      show({ label: 'NO DATA', sub: 'This link has no sets', timer: '--:--', progress: 0, set: '--:--–--:--', level: '' })
      return
    }

    if (me === null) {
      // まだ自分を選んでいない（広い画面ではタイマー側にも案内を出す）
      show({ label: 'NO DJ', sub: '', timer: '--:--', progress: 0, set: '--:--–--:--', level: '' })
      return
    }

    {
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
          label: wait <= SOON_MS ? 'CUE' : 'STANDBY',
          sub: '',
          timer: fmtDur(wait),
          progress: 0,
          set: rangeOf(target),
          level: wait <= SOON_MS ? 'soon' : '',
        })
      } else if (t < target.end) {
        const remain = target.end - t
        show({
          label: 'ON AIR',
          sub: '',
          timer: fmtDur(remain),
          progress: (t - target.start) / (target.end - target.start),
          set: rangeOf(target),
          level: levelOf(remain),
        })
      } else if (t - target.end < OVER_SHOW_MS) {
        overSlot = slotId(target)
        const acked = forceAck || ackedSlot === overSlot
        const following = nextAfter(target)
        show({
          label: 'OVER',
          // 次のDJは NEXT 行に出るので、最後のセットの時だけ補足する
          sub: acked ? (following ? '' : 'Last set') : 'Tap to stop flashing',
          timer: '+' + fmtDur(t - target.end),
          progress: 1,
          set: rangeOf(target),
          level: acked ? 'overAck' : 'over',
        })
      } else {
        show({ label: 'OFF AIR', sub: '', timer: '--:--', progress: 1, set: rangeOf(target), level: '' })
      }
      return
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
