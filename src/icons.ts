/**
 * 線画アイコン（24px グリッド、currentColor）。文字の代わりに形で操作を伝える。
 * 使う側でボタンに aria-label を付けること（アイコン自体は aria-hidden）。
 */
const svg = (body: string) =>
  `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true">${body}</svg>`

export const icon = {
  /** 現在時刻 */
  clock: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  /** 自分のセット */
  headphones: svg('<path d="M4.5 15v-3a7.5 7.5 0 0 1 15 0v3"/><path d="M4.5 14h3v6h-3zM16.5 14h3v6h-3z"/>'),
  /** 今プレイ中 */
  play: svg('<path d="M8 5.5v13l10-6.5z" fill="currentColor" stroke="none"/>'),
  /** 次 */
  next: svg('<path d="M6 6v12l8-6z" fill="currentColor" stroke="none"/><path d="M17.5 6v12"/>'),
  /** タイムテーブル一覧 */
  list: svg('<path d="M9 7h11M9 12h11M9 17h11"/><path d="M4.5 7h.5M4.5 12h.5M4.5 17h.5" stroke-width="2.6"/>'),
  /** 自分を選び直す */
  swap: svg('<path d="M7 7h12l-3-3M17 17H5l3 3"/>'),
  /** 戻る */
  back: svg('<path d="M14.5 5.5 8 12l6.5 6.5"/>'),
  /** 編集・複製 */
  edit: svg('<path d="M14.5 5.5l4 4L9 19H5v-4z"/><path d="M12.5 7.5l4 4"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  up: svg('<path d="M6 14.5 12 8.5l6 6"/>'),
  down: svg('<path d="M6 9.5l6 6 6-6"/>'),
  remove: svg('<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>'),
  copy: svg('<path d="M9 9h10v10H9z"/><path d="M5 15V5h10"/>'),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  share: svg('<path d="M12 4v11M7.5 8.5 12 4l4.5 4.5"/><path d="M5 13v7h14v-7"/>'),
  calendar: svg('<path d="M4.5 6.5h15v13h-15zM4.5 10.5h15M8.5 4v4M15.5 4v4"/>'),
  /** 全員（DJ以外） */
  all: svg('<path d="M4.5 4.5h6v6h-6zM13.5 4.5h6v6h-6zM4.5 13.5h6v6h-6zM13.5 13.5h6v6h-6z"/>'),
  /** 画面を消さない（点灯中） */
  awake: svg('<circle cx="12" cy="12" r="3.5"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"/>'),
  /** 画面を消さない（オフ） */
  asleep: svg('<path d="M15.5 4.5a8 8 0 1 0 4 11.5 6.5 6.5 0 0 1-4-11.5z"/>'),
}
