import { icon } from './icons'

/** 画面下に短いお知らせを出す（数秒で消える） */
function toast(message: string) {
  document.querySelector('.toast')?.remove()
  const el = document.createElement('div')
  el.className = 'toast'
  el.setAttribute('role', 'status')
  el.textContent = message
  document.body.append(el)
  setTimeout(() => el.remove(), 4500)
}

const HOW_TO =
  'iPhone: turn off Low Power Mode, or set Auto-Lock to Never. Android: set a longer screen timeout.'

/**
 * 画面の自動スリープ防止（Screen Wake Lock API）。
 * タブを離れると OS が解除するので、戻ってきた時・タップ時に取り直す。
 * 端末やブラウザに断られた時は、ボタンを押した時に理由と代わりの方法を知らせる（無反応にしない）。
 */
export function initWakeLock(btn: HTMLButtonElement): () => void {
  const supported = 'wakeLock' in navigator
  let sentinel: WakeLockSentinel | null = null
  let wanted = true
  let refused = false // 直近の要求が断られた（省電力モード、埋め込み表示など）
  let disposed = false

  const render = () => {
    // 文字は出さず、点灯（太陽）/ 消灯可（月）のアイコンで状態を示す
    const state = !supported ? 'na' : sentinel ? 'on' : refused ? 'refused' : 'off'
    const text =
      state === 'on'
        ? 'Screen stays on'
        : state === 'off'
          ? 'Keep screen on'
          : "Can't keep the screen on here"
    btn.dataset.state = state
    btn.innerHTML = state === 'on' ? icon.awake : icon.asleep
    btn.setAttribute('aria-label', text)
    btn.title = text
    btn.setAttribute('aria-pressed', String(state === 'on'))
  }

  const acquire = async () => {
    if (!supported || disposed || !wanted || sentinel || document.visibilityState !== 'visible') return
    try {
      const s = await navigator.wakeLock.request('screen')
      if (disposed) {
        s.release()
        return
      }
      sentinel = s
      refused = false
      s.addEventListener('release', () => {
        if (sentinel === s) sentinel = null
        render()
      })
    } catch {
      sentinel = null
      refused = true
    }
    render()
  }

  const onClick = async () => {
    if (!supported) {
      toast(`This browser can't keep the screen on. ${HOW_TO}`)
      return
    }
    if (sentinel) {
      wanted = false
      const s = sentinel
      sentinel = null
      await s.release()
      render()
      toast('Screen may turn off now')
      return
    }
    wanted = true
    await acquire()
    toast(sentinel ? 'Screen stays on' : `Couldn't keep the screen on. ${HOW_TO}`)
  }

  const onVisible = () => void acquire()
  const onPointer = (e: PointerEvent) => {
    // ボタン自体のタップは onClick で扱う（二重に要求しない）
    if (!btn.contains(e.target as Node)) void acquire()
  }

  btn.addEventListener('click', onClick)
  document.addEventListener('visibilitychange', onVisible)
  document.addEventListener('pointerdown', onPointer)
  render()
  void acquire()

  return () => {
    disposed = true
    document.removeEventListener('visibilitychange', onVisible)
    document.removeEventListener('pointerdown', onPointer)
    document.querySelector('.toast')?.remove()
    sentinel?.release().catch(() => {})
    sentinel = null
  }
}
