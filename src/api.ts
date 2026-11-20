/**
 * サーバーとのやりとりと、端末に保存する一覧・キャッシュ
 *
 * 端末に保存するもの（ログインなし。端末ごと）
 *   taite:mine   自分が作ったタイムテーブル（id と編集用の鍵）
 *   taite:gigs   DJ用リンクで開いたイベント（出演予定）
 *   taite:cache:<id>  最後に受け取った内容（電波が切れても表示・タイマーを続けるため）
 */
import { normalize, type EventData } from './model'
import { store } from './util'

const API = '/api/events'

export interface Snapshot {
  data: EventData
  rev: number
}

export interface MineItem {
  id: string
  key: string
  t: string
  d: string
  at: number
}
export interface GigItem {
  id: string
  t: string
  d: string
  at: number
}

/* ---------- 端末の一覧 ---------- */

function readList<T>(name: string): T[] {
  try {
    const v = JSON.parse(store.get(name) || '[]')
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}
const writeList = (name: string, list: unknown[]) => store.set(name, JSON.stringify(list))

export const mine = {
  all: () => readList<MineItem>('taite:mine').sort((a, b) => b.at - a.at),
  get: (id: string) => readList<MineItem>('taite:mine').find((m) => m.id === id),
  put(item: Omit<MineItem, 'at'>) {
    const list = readList<MineItem>('taite:mine').filter((m) => m.id !== item.id)
    writeList('taite:mine', [{ ...item, at: Date.now() }, ...list])
  },
  remove: (id: string) => writeList('taite:mine', readList<MineItem>('taite:mine').filter((m) => m.id !== id)),
}

export const gigs = {
  all: () => readList<GigItem>('taite:gigs').sort((a, b) => b.at - a.at),
  put(item: Omit<GigItem, 'at'>) {
    const list = readList<GigItem>('taite:gigs').filter((g) => g.id !== item.id)
    writeList('taite:gigs', [{ ...item, at: Date.now() }, ...list].slice(0, 50))
  },
  remove: (id: string) => writeList('taite:gigs', readList<GigItem>('taite:gigs').filter((g) => g.id !== id)),
}

export const cache = {
  get(id: string): Snapshot | null {
    try {
      const v = JSON.parse(store.get(`taite:cache:${id}`) || 'null')
      const data = normalize(v?.data)
      return data ? { data, rev: Number(v.rev) || 0 } : null
    } catch {
      return null
    }
  },
  put: (id: string, snap: Snapshot) => store.set(`taite:cache:${id}`, JSON.stringify(snap)),
  remove: (id: string) => store.set(`taite:cache:${id}`, null),
}

/** この端末から一覧・キャッシュ・選んだDJを消す */
export function forget(id: string) {
  mine.remove(id)
  gigs.remove(id)
  cache.remove(id)
  store.set(`taite:me:${id}`, null)
  store.set(`taite:me:${id}:ack`, null)
}

/* ---------- サーバー ---------- */

export async function createEvent(data: EventData): Promise<{ id: string; key: string }> {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ data }),
  })
  if (!res.ok) throw new Error(`Create failed (${res.status})`)
  return res.json()
}

export async function fetchEvent(id: string): Promise<Snapshot | null> {
  const res = await fetch(`${API}/${encodeURIComponent(id)}`, { cache: 'no-store' })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Load failed (${res.status})`)
  const v = await res.json()
  const data = normalize(v?.data)
  return data ? { data, rev: Number(v.rev) || 0 } : null
}

export class EditKeyError extends Error {}

export async function saveEvent(id: string, key: string, data: EventData): Promise<number> {
  const res = await fetch(`${API}/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ data }),
  })
  if (res.status === 403 || res.status === 401) throw new EditKeyError('This edit link is not valid')
  if (!res.ok) throw new Error(`Save failed (${res.status})`)
  return Number((await res.json()).rev) || 0
}

export async function deleteEvent(id: string, key: string): Promise<void> {
  const res = await fetch(`${API}/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${key}` },
  })
  if (res.status === 403 || res.status === 401) throw new EditKeyError('This edit link is not valid')
  if (!res.ok && res.status !== 404) throw new Error(`Delete failed (${res.status})`)
}

/**
 * リアルタイムの更新を受け取る。接続が切れたら少しずつ間隔をあけてつなぎ直す。
 * onStatus: 'live' = 最新の内容を受け取れている / 'offline' = つながっていない（保存済みの内容で動いている）
 */
export function subscribe(
  id: string,
  onSnap: (snap: Snapshot) => void,
  onStatus: (s: 'live' | 'offline') => void,
  onGone?: () => void,
): () => void {
  let ws: WebSocket | null = null
  let closed = false
  let retry = 0
  let pingTimer = 0
  let retryTimer = 0
  const url = `${location.origin.replace(/^http/, 'ws')}${API}/${encodeURIComponent(id)}/ws`

  const connect = () => {
    if (closed) return
    ws = new WebSocket(url)
    ws.onopen = () => {
      retry = 0
      clearInterval(pingTimer)
      pingTimer = window.setInterval(() => ws?.readyState === WebSocket.OPEN && ws.send('ping'), 25_000)
    }
    ws.onmessage = (e) => {
      if (e.data === 'pong') return
      try {
        const m = JSON.parse(e.data)
        const data = normalize(m?.data)
        if (m?.type === 'update' && data) {
          onStatus('live')
          onSnap({ data, rev: Number(m.rev) || 0 })
        }
      } catch {
        /* 壊れたメッセージは無視 */
      }
    }
    ws.onclose = (e) => {
      clearInterval(pingTimer)
      if (closed) return
      if (e.code === 4404) {
        // 削除された
        closed = true
        onGone?.()
        return
      }
      onStatus('offline')
      retryTimer = window.setTimeout(connect, Math.min(30_000, 1000 * 2 ** retry++))
    }
    ws.onerror = () => ws?.close()
  }

  // 画面に戻ってきた時・電波が戻った時はすぐつなぎ直す
  const kick = () => {
    if (closed || document.visibilityState !== 'visible') return
    if (!ws || ws.readyState === WebSocket.CLOSED) {
      clearTimeout(retryTimer)
      retry = 0
      connect()
    }
  }
  document.addEventListener('visibilitychange', kick)
  window.addEventListener('online', kick)
  connect()

  return () => {
    closed = true
    clearInterval(pingTimer)
    clearTimeout(retryTimer)
    document.removeEventListener('visibilitychange', kick)
    window.removeEventListener('online', kick)
    ws?.close()
  }
}
