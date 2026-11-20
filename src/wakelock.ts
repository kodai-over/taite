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
    if (!supported) {
      btn.dataset.state = 'na'
      btn.textContent = 'スリープ防止 非対応'
      return
    }
    btn.dataset.state = sentinel ? 'on' : 'off'
    btn.textContent = sentinel ? '● スリープ防止 ON' : '○ タップでスリープ防止'
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
        'この端末のブラウザはスリープ防止に対応していません。\n' +
          'iPhone: 設定 > 画面表示と明るさ > 自動ロック を「なし」に\n' +
          'Android: 設定 > ディスプレイ > 画面消灯 を長めに設定してください。',
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
