// 以前の公開URLで登録されたオフライン用の仕組みを片付ける。
// 古い画面を端末に保存したままの人も、次に開いた時に新しいURLへの転送ページが読み込まれる。
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      for (const k of await caches.keys()) await caches.delete(k)
      await self.registration.unregister()
      for (const c of await self.clients.matchAll({ type: 'window' })) c.navigate(c.url)
    })(),
  )
})
