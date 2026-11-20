/**
 * 線画アイコン（24px グリッド、currentColor）。文字の代わりに形で操作を伝える。
 * 使う側でボタンに aria-label を付けること（アイコン自体は aria-hidden）。
 */
const svg = (body: string) =>
  `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true">${body}</svg>`

export const icon = {
  /** 今プレイ中 */
  play: svg('<path d="M8 5.5v13l10-6.5z" fill="currentColor" stroke="none"/>'),
  /** 戻る */
  back: svg('<path d="M14.5 5.5 8 12l6.5 6.5"/>'),
  /** 一覧（ホーム） */
  home: svg('<path d="M4 11.5 12 5l8 6.5"/><path d="M6.5 10v9h11v-9"/>'),
  /** 電波が切れている */
  offline: svg('<path d="M4 9.5a12 12 0 0 1 16 0M7 13a7.5 7.5 0 0 1 10 0M10 16.5a3 3 0 0 1 4 0"/><path d="M4 4l16 16"/>'),
  /** 編集・複製 */
  edit: svg('<path d="M14.5 5.5l4 4L9 19H5v-4z"/><path d="M12.5 7.5l4 4"/>'),
  /** ドラッグで並べ替えるつまみ */
  grip: svg('<path d="M5 8.5h14M5 12h14M5 15.5h14"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  remove: svg('<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>'),
  copy: svg('<path d="M9 9h10v10H9z"/><path d="M5 15V5h10"/>'),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  /** 書き出し（保存） */
  download: svg('<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5"/><path d="M5 19h14"/>'),
  share: svg('<path d="M12 4v11M7.5 8.5 12 4l4.5 4.5"/><path d="M5 13v7h14v-7"/>'),
  calendar: svg('<path d="M4.5 6.5h15v13h-15zM4.5 10.5h15M8.5 4v4M15.5 4v4"/>'),
  /** 画面を消さない（オン）: 湯気の立つコーヒーカップ（スリープ防止アプリで定番の印） */
  awake: svg('<path d="M5 10h11v4.5a5.5 5.5 0 0 1-5.5 5.5h0A5.5 5.5 0 0 1 5 14.5z"/><path d="M16 11.5h1.5a2.5 2.5 0 0 1 0 5H16"/><path d="M8 3.5c-.9 1 .9 2.2 0 3.3M11 3.5c-.9 1 .9 2.2 0 3.3M14 3.5c-.9 1 .9 2.2 0 3.3" stroke-linecap="round"/>'),
  /** 画面を消さない（オフ）: 湯気のないカップ */
  asleep: svg('<path d="M5 10h11v4.5a5.5 5.5 0 0 1-5.5 5.5h0A5.5 5.5 0 0 1 5 14.5z"/><path d="M16 11.5h1.5a2.5 2.5 0 0 1 0 5H16"/>'),
}
