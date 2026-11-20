import { resolve, type EventData, type ResolvedSlot } from './data'
import { esc, fmtClock, fmtDur, fmtHM, now, store } from './util'
import { icon } from './icons'
import { initWakeLock } from './wakelock'

/** 警告レベル: 出番直前 / 残り10分 / 5分 / 1分 / 超過 / 超過（点滅停止済み） */
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
  const title = esc(ev.t || 'TAITE')
  const meKey = `taite:me:${ev.d}:${ev.t}`
  const saved = store.get(meKey)
  // null = まだ選んでいない（名前選択画面を出す）, ALL = 全体表示, それ以外 = DJ名
  let me: string | null = saved === ALL || slots.some((s) => s.name === saved) ? saved : null
  // 枠が1つもない（壊れたリンク等）なら名前選択を飛ばし、全体表示でエラー文言を出す
  if (!slots.length) me = ALL
  let showTable = false

  // 確認用（mock.html）: URLのパラメータで表示状態を固定する。保存はしない
  //   ?me=none（名前選択） / all（全体表示） / DJ名、?view=table、?ack=1（超過の点滅停止済み）
  const q = new URLSearchParams(location.search)
  const qMe = q.get('me')
  if (qMe !== null) me = qMe === 'none' ? null : qMe === 'all' ? ALL : qMe
  if (q.get('view') === 'table') showTable = true
  const forceAck = q.get('ack') === '1'

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
    <span class="ev">${title}</span>
    <h1 class="pk-q">Who are you?</h1>
    <ul class="pick-list">
      ${djs
        .map(
          (d) => `
        <li><button type="button" class="pick" data-name="${esc(d.name)}">
          <span class="pk-name">${esc(d.name)}</span><span class="pk-time">${d.times}</span>
        </button></li>`,
        )
        .join('')}
    </ul>
    <button type="button" id="pick-all" class="pick pick-all" aria-label="I'm not a DJ — show everyone">
      ${icon.all}<span class="pk-name">Everyone</span>
    </button>
  </section>

  <div id="deck" class="deck" hidden>
    <section class="pane pane-timer">
      <header class="top">
        <div class="who">
          <span class="ev">${title}</span>
          <span id="who-name" class="me"></span>
        </div>
        <button type="button" id="change" class="ibtn" aria-label="Switch DJ" title="Switch DJ">${icon.swap}</button>
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
      <ol id="list" class="list">
        ${slots
          .map(
            (s) => `
          <li data-i="${s.i}" data-name="${esc(s.name)}">
            <span class="li-time">${fmtHM(s.start)}–${fmtHM(s.end)}</span>
            <span class="li-name">${esc(s.name)}</span>
            <span class="li-mark" aria-hidden="true"></span>
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
  const npIc = $('np-ic')
  const np = $('np')
  const npTime = $('np-time')
  const nx = $('nx')
  const nxTime = $('nx-time')
  const change = $<HTMLButtonElement>('change')
  const stage = $('stage')
  const list = $<HTMLOListElement>('list')
  const items = [...list.querySelectorAll<HTMLLIElement>('li')]
  const picker = $('picker')
  const deck = $('deck')

  const isDj = () => me !== null && me !== ALL

  /** 表示する画面（名前選択 / タイマー / タイムテーブル）を切り替える */
  const renderView = () => {
    picker.hidden = me !== null
    deck.hidden = me === null
    // 狭い画面ではタイマーとタイムテーブルを切り替える（広い画面では CSS で両方並べる）
    deck.dataset.view = showTable ? 'table' : 'timer'
    // タイマーは画面に固定してスクロールさせない
    document.body.classList.toggle('lock', !deck.hidden)
    whoName.textContent = isDj() ? me! : 'Everyone'
    // 全体表示では中央がそのまま今プレイ中のDJなので、NEXT だけ出す
    for (const el of [npIc, np, npTime]) el.hidden = !isDj()
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
      li.classList.toggle('mine', isDj() && s.name === me)
      li.querySelector('.li-mark')!.innerHTML = s === cur ? icon.play : isDj() && s.name === me ? icon.headphones : ''
    })

    if (!slots.length) {
      show({ label: 'NO DATA', sub: 'This link has no sets', timer: '--:--', progress: 0, set: '--:--–--:--', level: '' })
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

    overSlot = null
    if (cur) {
      const remain = cur.end - t
      show({
        label: 'ON AIR',
        sub: cur.name,
        timer: fmtDur(remain),
        progress: (t - cur.start) / (cur.end - cur.start),
        set: rangeOf(cur),
        level: levelOf(remain),
      })
    } else if (upcoming) {
      show({
        label: 'STANDBY',
        sub: upcoming.name,
        timer: fmtDur(upcoming.start - t),
        progress: 0,
        set: rangeOf(upcoming),
        level: '',
      })
    } else {
      show({ label: 'END', sub: '', timer: '--:--', progress: 1, set: '--:--–--:--', level: '' })
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
