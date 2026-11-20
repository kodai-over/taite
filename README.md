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
- 作成画面: イベント名・日付・枠（開始/終了/DJ名）、日付またぎ対応、重なり警告、下書き自動保存
- 共有: リンクコピー / Web Share / QRコード
- タイマー画面: 現在時刻、NOW PLAYING と残り時間、次のDJ、一覧
- DJモード: 一覧で自分の名前をタップ → 出番までのカウントダウン → 残り時間 → 超過時間
- 警告: 残り10分 黄 / 5分 橙 / 1分 赤点滅 / 超過 高速点滅（Androidは振動）
- 画面スリープ防止（Screen Wake Lock API）、オフライン対応（Service Worker）

## デプロイ（無料）
Cloudflare Pages / GitHub Pages に `dist/` を配置。ビルドコマンド `npm run build`、出力 `dist`。

公開URL: https://kodai-over.github.io/taite/ （`main` へのpushで GitHub Actions が自動デプロイ）
