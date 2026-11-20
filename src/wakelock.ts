import { icon } from './icons'

/**
 * 画面の自動スリープ防止（Screen Wake Lock API）。
 * タブを離れると OS が解除するので、戻ってきた時・タップ時に取り直す。
 */
export function initWakeLock(btn: HTMLButtonElement): () => void {
  const supported = 'wakeLock' in navigator
  let sentinel: WakeLockSentinel | null = null
  let wanted = true
  let disposed = false

  const render = () => {
    // 文字は出さず、点灯（太陽）/ 消灯可（月）のアイコンで状態を示す
    const state = !supported ? 'na' : sentinel ? 'on' : 'off'
    const text =
      state === 'na' ? "Can't keep the screen on in this browser" : state === 'on' ? 'Screen stays on' : 'Keep screen on'
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
      s.addEventListener('release', () => {
        if (sentinel === s) sentinel = null
        render()
      })
    } catch {
      sentinel = null
    }
    render()
  }

  const onClick = async () => {
    if (!supported) {
      alert(
        "This browser can't keep the screen on.\n" +
          'iPhone: Settings > Display & Brightness > Auto-Lock > Never\n' +
          'Android: Settings > Display > Screen timeout > set a longer time',
      )
      return
    }
    if (sentinel) {
      wanted = false
      const s = sentinel
      sentinel = null
      await s.release()
    } else {
      wanted = true
      await acquire()
    }
    render()
  }

  const onVisible = () => void acquire()
  const onPointer = () => void acquire()

  btn.addEventListener('click', onClick)
  document.addEventListener('visibilitychange', onVisible)
  document.addEventListener('pointerdown', onPointer)
  render()
  void acquire()

  return () => {
    disposed = true
    document.removeEventListener('visibilitychange', onVisible)
    document.removeEventListener('pointerdown', onPointer)
    sentinel?.release().catch(() => {})
    sentinel = null
  }
}
