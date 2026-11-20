# TAITE（タイテ）

DJ Set Timer & Timetable — 自分の出番まで・セット残り時間をスマホで把握する。

DJイベントのタイムテーブルをリンクで共有し、各自のスマホで現在時刻・セットの残り時間を表示するPWA。サーバー・DB不要（タイムテーブルはURLの `#` 以降に圧縮して埋め込み）。

## 開発
```bash
npm install
npm run dev      # http://localhost:5173（同一Wi-Fiのスマホからも --host で確認可）
npm run build    # dist/ に出力
```

デバッグ: `?now=2026-11-21T21:55` を付けると現在時刻をずらして表示確認できる。

## 機能
- 表示言語: 英語
- 作成画面: イベント名・日付・枠（開始/終了/DJ名）、日付またぎ対応、重なり警告、下書き自動保存
- 共有: リンクコピー / Web Share / QRコード
- 名前選択: リンクを開くと「Who are you?」で自分の名前を選ぶ（端末に保存され、次回から直接開く）。DJ以外は全体表示を選べる
- タイマー画面（スクロールしない固定レイアウト）
  - 上部にイベント名、その下に自分のDJ名（同じ大きさ）と「Change」
  - 中央の上段に現在時刻（NOW）と自分のセット時間（YOUR SET）を横並び
  - その下に NOW PLAYING（今プレイ中のDJ名と終了時刻）と NEXT（次のDJ名と開始時刻）。全体表示では NEXT のみ
  - その下に出番までの時間 → 残り時間 → 超過時間を大きく表示（10分前から「YOU'RE ON SOON」）
  - 下部に「Timetable」と控えめなスリープ防止表示
- タイムテーブル画面: 一覧（NOW / YOU 表示）と「Edit / duplicate this timetable」ボタン。端末の「戻る」でタイマーへ戻る
- 警告: 残り10分 黄 / 5分 橙 / 1分 赤点滅 / 超過 高速点滅（タップで点滅停止。Androidは振動）。動きを減らす設定では点滅せず固定表示
- 画面スリープ防止（Screen Wake Lock API）、オフライン対応（Service Worker）

## デプロイ（無料）
Cloudflare Pages / GitHub Pages に `dist/` を配置。ビルドコマンド `npm run build`、出力 `dist`。

公開URL: https://kodai-over.github.io/taite/ （`main` へのpushで GitHub Actions が自動デプロイ）
