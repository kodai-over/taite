import { resolve, type EventData, type ResolvedSlot } from './data'
import { esc, fmtClock, fmtDur, fmtHM, now, store } from './util'
import { icon } from './icons'
import { initWakeLock } from './wakelock'

/** 警告レベル: 出番直前 / 残り10分 / 5分 / 1分 / 超過 / 超過（点滅停止済み） */
type Level = '' | 'soon' | 'w10' | 'w5' | 'w1' | 'over' | 'overAck'
const MIN = 60_000
const OVER_SHOW_MS = 30 * MIN // 自分のセット終了後、超過表示を続ける時間（延長してプレイ中の場合もあるため長めに。点滅はタップで止められる）
const SOON_MS = 10 * MIN // 出番の何分前から「まもなく出番」にするか

const levelOf = (remain: number): Level =>
  remain <= 1 * MIN ? 'w1' : remain <= 5 * MIN ? 'w5' : remain <= 10 * MIN ? 'w10' : ''

export interface ViewerOptions {
  /** 端末に「自分のDJ」などを保存する時のキー（イベントごとに変える） */
  storeKey: string
  /** 一覧（ホーム）へのリンク */
  homeHref?: string
  /** リンクで開いた時の「アプリで開く」ボタン（押した時の処理） */
  onApp?: () => void
}

/**
 * リアルタイム更新で描き直しても保ちたい、その画面の状態（タイムテーブルごと）。
 * スリープ防止のオン/オフ、直前の警告レベル（同じレベルで振動し直さない）、一覧のスクロール位置。
 */
const kept = new Map<string, { wake?: boolean; level?: Level; scroll?: number }>()

export function renderViewer(root: HTMLElement, ev: EventData, opts: ViewerOptions): () => void {
  const slots = resolve(ev)
  const title = esc(ev.t || 'TAITE')
  const meKey = `taite:me:${opts.storeKey}`
  const meIdxKey = `${meKey}:i`
  const keep = kept.get(opts.storeKey) ?? {}
  kept.set(opts.storeKey, keep)
  const saved = store.get(meKey)
  // null = まだ選んでいない（タイムテーブルから選んでもらう）、それ以外 = 自分のDJ名
  // 主催者がDJ名を直しても見失わないよう、名前で見つからなければ同じ番号の枠を自分とみなす
  let me: string | null = null
  if (saved !== null) {
    const byName = slots.findIndex((s) => s.name === saved)
    const savedIdx = Number(store.get(meIdxKey))
    const idx = byName >= 0 ? byName : Number.isInteger(savedIdx) && slots[savedIdx] ? savedIdx : -1
    if (idx >= 0) {
      me = slots[idx].name
      if (me !== saved) store.set(meKey, me)
      store.set(meIdxKey, String(idx))
    }
  }
  // 表示中の画面（狭い画面用）。タイムテーブルが起点で、名前をタップするとタイマーへ
  // リアルタイム更新で描き直した時も、今見ている画面を保つ（履歴の状態を優先）
  const hs = (history.state as { taite?: string } | null)?.taite
  let view: 'table' | 'timer' = hs === 'table' ? 'table' : hs === 'timer' ? 'timer' : 'table'

  // 確認用（mock.html）: URLのパラメータで表示状態を固定する。保存はしない。
  //   ?me=none（未選択） / DJ名、?view=table、?ack=1（超過の点滅停止済み）
  // 開発サーバーでだけ有効（公開版では無視する）
  const q = new URLSearchParams(import.meta.env.DEV ? location.search : '')
  const qMe = q.get('me')
  if (qMe !== null) me = qMe === 'none' ? null : qMe
  if (q.get('view') === 'table') view = 'table'
  if (qMe !== null && qMe !== 'none' && q.get('view') !== 'table') view = 'timer'
  const forceAck = q.get('ack') === '1'

  root.innerHTML = `
  <div id="deck" class="deck">
    <section class="pane pane-timer">
      <header class="top">
        <button type="button" id="to-table" class="ibtn" aria-label="Back to timetable" title="Timetable">${icon.back}</button>
        <div class="who">
          <span class="ev">${title}</span>
          <span id="who-name" class="me"></span>
        </div>
        <span class="sync" hidden></span>
        <button type="button" id="wake" class="ibtn wake"></button>
      </header>

      <div id="stage" class="display" aria-live="polite">
        <dl class="facts">
          <div class="fact"><dt>Time</dt><dd><span id="clock" class="fv big">--:--:--</span></dd></div>
          <div class="fact"><dt>Your Set</dt><dd><span id="set" class="fv big">--:--–--:--</span></dd></div>
          <div class="fact"><dt>Now Playing</dt><dd><span id="np" class="fv">—</span><span id="np-time" class="ft"></span></dd></div>
          <div class="fact"><dt>Next</dt><dd><span id="nx" class="fv">—</span><span id="nx-time" class="ft"></span></dd></div>
        </dl>
        <div class="core">
          <div class="status" id="label"></div>
          <div id="timer" class="timer">--:--</div>
          <div id="sub" class="sub"></div>
        </div>
        <div class="meter" aria-hidden="true"><div id="bar" class="meter-fill"></div></div>
      </div>
    </section>

    <section class="pane pane-table" aria-label="Timetable">
      <header class="top">
        ${opts.homeHref ? `<a class="ibtn" href="${opts.homeHref}" aria-label="All Timetables" title="All Timetables">${icon.home}</a>` : ''}
        <span class="ev">${title}</span>
        <span class="sync" hidden></span>
        ${opts.onApp ? `<button type="button" class="ibtn to-app" title="Open in App">${icon.app}<span>Open in App</span></button>` : ''}
      </header>
      ${slots.length ? '' : '<p class="l-hint">This link has no sets</p>'}
      <ol id="list" class="list">
        ${slots
          .map(
            (s) => `
          <li data-i="${s.i}">
            <button type="button" class="row" data-name="${esc(s.name)}">
              <span class="li-time">${fmtHM(s.start)}–${fmtHM(s.end)}</span>
              <span class="li-name">${esc(s.name)}</span>
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

  /** 表示する画面（タイマー / タイムテーブル）を切り替える（広い画面では CSS で両方並べる） */
  const renderView = () => {
    deck.dataset.view = me === null ? 'table' : view
    // 画面に固定してスクロールさせない（一覧は内側でスクロール）
    document.body.classList.add('lock')
    whoName.textContent = me ?? '—'
  }

  /** そのDJのタイマーを開く。タイムテーブルの上に積むので、端末の「戻る」でも一覧に戻れる */
  const openTimer = (name: string) => {
    me = name
    store.set(meKey, name)
    store.set(meIdxKey, String(slots.findIndex((s) => s.name === name)))
    if (view !== 'timer') {
      history.pushState({ taite: 'timer' }, '')
      view = 'timer'
    }
    renderView()
    tick()
  }

  /** タイムテーブルへ戻る */
  const openTable = () => {
    if ((history.state as { taite?: string } | null)?.taite === 'timer') {
      history.back() // popstate で再描画
    } else {
      view = 'table'
      renderView()
    }
  }

  list.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button.row')
    if (b) openTimer(b.dataset.name!)
  })
  $('to-table').addEventListener('click', openTable)
  if (opts.onApp) root.querySelector('.to-app')!.addEventListener('click', opts.onApp)
  const onPop = (e: PopStateEvent) => {
    view = (e.state as { taite?: string } | null)?.taite === 'timer' ? 'timer' : 'table'
    renderView()
  }
  window.addEventListener('popstate', onPop)

  let lastLevel: Level = keep.level ?? ''
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
    keep.level = o.level
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
    })

    if (!slots.length) {
      show({ label: 'No Sets', sub: 'This link has no sets', timer: '--:--', progress: 0, set: '--:--–--:--', level: '' })
      return
    }

    if (me === null) {
      // まだ自分を選んでいない（広い画面ではタイマー側にも案内を出す）
      show({ label: 'No DJ', sub: '', timer: '--:--', progress: 0, set: '--:--–--:--', level: '' })
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
          label: wait <= SOON_MS ? 'Cue' : 'Standby',
          sub: '',
          timer: fmtDur(wait),
          progress: 0,
          set: rangeOf(target),
          level: wait <= SOON_MS ? 'soon' : '',
        })
      } else if (t < target.end) {
        const remain = target.end - t
        show({
          label: 'On Air',
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
          label: 'Over',
          // 次のDJは NEXT 行に出るので、最後のセットの時だけ補足する
          sub: acked ? (following ? '' : 'Last set') : 'Tap to stop flashing',
          timer: '+' + fmtDur(t - target.end),
          progress: 1,
          set: rangeOf(target),
          level: acked ? 'overAck' : 'over',
        })
      } else {
        show({ label: 'Off Air', sub: '', timer: '--:--', progress: 1, set: rangeOf(target), level: '' })
      }
      return
    }

  }

  // タイマーから開いた時も、端末の「戻る」で一覧に戻れるよう、一覧の上にタイマーを積んだ履歴にする
  if (view === 'timer' && (history.state as { taite?: string } | null)?.taite !== 'timer') {
    history.replaceState({ taite: 'table' }, '')
    history.pushState({ taite: 'timer' }, '')
  }
  renderView()
  tick()
  // 秒の切り替わりに合わせて更新
  const timerId = setInterval(tick, 250)
  const disposeWake = initWakeLock($<HTMLButtonElement>('wake'), keep.wake ?? true, (on) => (keep.wake = on))
  if (keep.scroll) list.scrollTop = keep.scroll
  document.title = `${ev.t || 'TAITE'} – Timer`

  return () => {
    keep.scroll = list.scrollTop
    clearInterval(timerId)
    disposeWake()
    window.removeEventListener('popstate', onPop)
    document.body.classList.remove('lock')
    delete document.body.dataset.level
  }
}
