/**
 * TAITE のサーバー（Cloudflare Workers）
 *
 * - 画面（dist/）の配信は Workers の静的アセット機能に任せ、/api/* だけをここで扱う
 * - タイムテーブル1つにつき Durable Object（EventRoom）1つ。保存と、開いている全員へのリアルタイム配信を受け持つ
 * - 編集できるかどうかは「編集用の鍵」を持っているかで決める（サーバーには鍵のハッシュだけを保存する）
 *
 *   POST /api/events              新規作成 → { id, key, rev }
 *   GET  /api/events/:id          読み込み → { data, rev, updatedAt }
 *   PUT  /api/events/:id          更新（Authorization: Bearer <key>）→ { rev }
 *   GET  /api/events/:id/ws       WebSocket。接続直後と更新のたびに { type: 'update', data, rev } が届く
 */
import { DurableObject } from 'cloudflare:workers'
import { normalize, type EventData } from '../src/model'

export interface Env {
  EVENTS: DurableObjectNamespace<EventRoom>
  ASSETS: Fetcher
}

const MAX_BODY = 32 * 1024
const ID_RE = /^[a-z0-9]{12}$/

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })

/** 推測されにくい英数字（小文字）の文字列 */
function randomId(len: number): string {
  const abc = 'abcdefghijklmnopqrstuvwxyz0123456789'
  const bytes = crypto.getRandomValues(new Uint8Array(len))
  return Array.from(bytes, (b) => abc[b % abc.length]).join('')
}

/** 編集用の鍵（URLに入れても安全な文字だけ） */
function randomKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
}

async function readData(req: Request): Promise<EventData | null> {
  const len = Number(req.headers.get('content-length') || 0)
  if (len > MAX_BODY) return null
  const text = await req.text()
  if (text.length > MAX_BODY) return null
  try {
    return normalize((JSON.parse(text) as { data?: unknown })?.data)
  } catch {
    return null
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req)

    const parts = url.pathname.split('/').filter(Boolean) // ['api', 'events', id?, 'ws'?]
    if (parts[1] !== 'events') return json({ error: 'Not found' }, 404)

    // 新規作成
    if (parts.length === 2 && req.method === 'POST') {
      const data = await readData(req)
      if (!data) return json({ error: 'Invalid timetable' }, 400)
      const id = randomId(12)
      const key = randomKey()
      await env.EVENTS.get(env.EVENTS.idFromName(id)).init(data, await sha256(key))
      return json({ id, key, rev: 1 }, 201)
    }

    const id = parts[2]
    if (!id || !ID_RE.test(id)) return json({ error: 'Not found' }, 404)
    const room = env.EVENTS.get(env.EVENTS.idFromName(id))

    if (parts[3] === 'ws') {
      if (req.headers.get('upgrade') !== 'websocket') return json({ error: 'Expected WebSocket' }, 426)
      return room.fetch(req)
    }
    if (parts.length !== 3) return json({ error: 'Not found' }, 404)

    if (req.method === 'GET') {
      const snap = await room.read()
      return snap ? json(snap) : json({ error: 'Not found' }, 404)
    }

    if (req.method === 'PUT') {
      const key = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
      if (!key) return json({ error: 'Missing edit key' }, 401)
      const data = await readData(req)
      if (!data) return json({ error: 'Invalid timetable' }, 400)
      const res = await room.write(data, await sha256(key))
      return res.ok ? json({ rev: res.rev }) : json({ error: res.error }, res.status)
    }

    return json({ error: 'Method not allowed' }, 405)
  },
} satisfies ExportedHandler<Env>

/** タイムテーブル1つ分の保存と配信 */
export class EventRoom extends DurableObject<Env> {
  async init(data: EventData, keyHash: string): Promise<void> {
    if (await this.ctx.storage.get('keyHash')) throw new Error('Already exists')
    await this.ctx.storage.put({ data, keyHash, rev: 1, updatedAt: Date.now() })
  }

  async read(): Promise<{ data: EventData; rev: number; updatedAt: number } | null> {
    const m = await this.ctx.storage.get<unknown>(['data', 'rev', 'updatedAt'])
    const data = m.get('data') as EventData | undefined
    if (!data) return null
    return { data, rev: (m.get('rev') as number) ?? 1, updatedAt: (m.get('updatedAt') as number) ?? 0 }
  }

  async write(
    data: EventData,
    keyHash: string,
  ): Promise<{ ok: true; rev: number } | { ok: false; status: 403 | 404; error: string }> {
    const stored = await this.ctx.storage.get<string>('keyHash')
    if (!stored) return { ok: false, status: 404, error: 'Not found' }
    const a = new TextEncoder().encode(stored)
    const b = new TextEncoder().encode(keyHash)
    if (a.byteLength !== b.byteLength || !crypto.subtle.timingSafeEqual(a, b)) {
      return { ok: false, status: 403, error: 'Wrong edit key' }
    }
    const rev = ((await this.ctx.storage.get<number>('rev')) ?? 1) + 1
    const updatedAt = Date.now()
    await this.ctx.storage.put({ data, rev, updatedAt })
    // 開いている全員に新しい内容を送る
    const msg = JSON.stringify({ type: 'update', data, rev, updatedAt })
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(msg)
      } catch {
        /* 切れている接続は無視 */
      }
    }
    return { ok: true, rev }
  }

  /** WebSocket の接続を受ける（休止できる方式で、接続が多くても費用がかからない） */
  async fetch(): Promise<Response> {
    const pair = new WebSocketPair()
    this.ctx.acceptWebSocket(pair[1])
    const snap = await this.read()
    if (snap) pair[1].send(JSON.stringify({ type: 'update', ...snap }))
    return new Response(null, { status: 101, webSocket: pair[0] })
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (message === 'ping') ws.send('pong') // 接続の生存確認
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    try {
      ws.close(code, 'closing')
    } catch {
      /* すでに閉じている */
    }
  }
}
