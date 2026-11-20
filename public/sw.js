// オフライン対応: 一度開けば会場で電波が弱くても動く
// CACHE の ID と PRECACHE の一覧は、ビルド時に vite.config.ts の swPrecache で置き換える
const CACHE = 'taite-__BUILD_ID__'
const PRECACHE = self.__PRECACHE__
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon.svg']
  .concat(Array.isArray(PRECACHE) ? PRECACHE : [])

/** ページの取得をこれ以上待たずにキャッシュを返す時間（電波が弱く接続が切れないまま待たされる対策） */
const NAV_TIMEOUT_MS = 3000

self.addEventListener('install', (e) => {
  self.skipWaiting()
  // ハッシュ付きの JS/CSS も含めて最初にまとめて保存する（初回訪問だけでもオフラインで開けるように）
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  const u = new URL(req.url)
  // API（タイムテーブルの中身・リアルタイム配信）は保存せず、常にサーバーへ
  if (req.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/')) return

  if (req.mode === 'navigate') {
    e.respondWith(navigate(req))
    return
  }

  // JS/CSS/画像: キャッシュ優先。なければ取得して保存
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req)
      if (cached) return cached
      const res = await fetch(req)
      if (res.ok) cache.put(req, res.clone())
      return res
    }),
  )
})

/**
 * ページ: ネット優先で最新版を取りに行くが、NAV_TIMEOUT_MS 以内に返らなければ保存済みのページを返す。
 * このアプリはハッシュで画面を切り替えるので、どのURLでも index.html を返せばよい。
 */
async function navigate(req) {
  const cache = await caches.open(CACHE)
  const cached = (await cache.match('./index.html')) || (await cache.match(req, { ignoreSearch: true }))
  const network = fetch(req).then((res) => {
    if (res.ok) cache.put('./index.html', res.clone())
    return res
  })
  if (!cached) return network

  const timeout = new Promise((resolve) => setTimeout(() => resolve(cached), NAV_TIMEOUT_MS))
  return Promise.race([network.catch(() => cached), timeout])
}
