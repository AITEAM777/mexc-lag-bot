// lib/collector.ts
// Підключається до всіх бірж через WebSocket і подає тіки до LagStore
 
import WebSocket from 'ws'
import { getLagStore, PriceTick, Exchange } from './lagEngine'
 
// Символи MEXC з нульовою комісією (futures zero-fee list)
// Ці символи ми відстежуємо — реальний список підтягується з MEXC API
let TRACKED_SYMBOLS: string[] = []
let isRunning = false
 
// ─── Отримати символи MEXC з нульовою комісією ───────────────────
export async function fetchMexcZeroFeeSymbols(): Promise<string[]> {
  try {
    // MEXC Futures — символи з 0% maker fee
    const res = await fetch('https://contract.mexc.com/api/v1/contract/detail', {
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) throw new Error(`MEXC API: ${res.status}`)
    const data = await res.json()
    const symbols: string[] = []
    for (const item of data?.data || []) {
      // makerFeeRate === 0 або takerFeeRate === 0
      if (Number(item.makerFeeRate) === 0 || Number(item.takerFeeRate) === 0) {
        // MEXC futures символ: BTC_USDT → BTCUSDT
        const sym = item.symbol?.replace('_', '') as string
        if (sym && sym.endsWith('USDT')) symbols.push(sym)
      }
    }
    console.log(`[MEXC] Zero-fee symbols: ${symbols.length}`)
    return symbols.length > 0 ? symbols : getFallbackSymbols()
  } catch (e) {
    console.error('[MEXC] Failed to fetch symbols, using fallback:', e)
    return getFallbackSymbols()
  }
}
 
function getFallbackSymbols(): string[] {
  // Відомі символи з нульовою комісією на MEXC
  return [
    'BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT',
    'DOGEUSDT','ADAUSDT','AVAXUSDT','DOTUSDT','MATICUSDT',
    'LINKUSDT','UNIUSDT','LTCUSDT','ATOMUSDT','NEARUSDT',
    'APTUSDT','ARBUSDT','OPUSDT','INJUSDT','SUIUSDT',
    'SEIUSDT','TIAUSDT','HOODUSDT','WIFUSDT','BONKUSDT',
    'JUPUSDT','PENDLEUSDT','EIGENUSDT','MEMEUSDT','NOTUSDT',
  ]
}
 
// ─── Допоміжна: реконект WebSocket ───────────────────────────────
function createReconnectingWS(
  name: string,
  getUrl: () => string,
  onOpen: (ws: WebSocket) => void,
  onMessage: (data: string) => void
) {
  let ws: WebSocket | null = null
  let dead = false
 
  function connect() {
    if (dead) return
    try {
      ws = new WebSocket(getUrl())
      ws.on('open', () => {
        console.log(`[${name}] connected`)
        onOpen(ws!)
      })
      ws.on('message', (raw) => onMessage(raw.toString()))
      ws.on('error', (e) => console.error(`[${name}] error:`, e.message))
      ws.on('close', () => {
        console.log(`[${name}] disconnected, reconnecting in 3s...`)
        if (!dead) setTimeout(connect, 3000)
      })
    } catch (e) {
      console.error(`[${name}] connect error:`, e)
      setTimeout(connect, 3000)
    }
  }
 
  connect()
  return { stop: () => { dead = true; ws?.close() } }
}
 
// ─── MEXC WebSocket ───────────────────────────────────────────────
function startMEXC(symbols: string[]) {
  const store = getLagStore()
  // MEXC spot WS — підписуємось на trade stream
  const ws = createReconnectingWS(
    'MEXC',
    () => 'wss://wbs.mexc.com/ws',
    (ws) => {
      // Підписка пачками по 20
      for (let i = 0; i < symbols.length; i += 20) {
        const batch = symbols.slice(i, i + 20).map(s => `spot@public.deals.v3.api@${s}`)
        ws.send(JSON.stringify({ method: 'SUBSCRIPTION', params: batch }))
      }
    },
    (raw) => {
      try {
        const msg = JSON.parse(raw)
        const channel = msg.c || ''
        if (!channel.includes('deals')) return
        const sym = channel.split('@')[2] // spot@public.deals.v3.api@BTCUSDT
        if (!TRACKED_SYMBOLS.includes(sym)) return
        const deals = msg.d?.deals || []
        if (!deals.length) return
        const price = parseFloat(deals[0].p)
        const ts = deals[0].t || Date.now()
        const tick: PriceTick = { exchange: 'MEXC', symbol: sym, price, ts }
        store.addTick(tick)
      } catch {}
    }
  )
  return ws
}
 
// ─── Binance WebSocket ────────────────────────────────────────────
function startBinance(symbols: string[]) {
  const store = getLagStore()
  const streams = symbols.map(s => `${s.toLowerCase()}@trade`).join('/')
  return createReconnectingWS(
    'Binance',
    () => `wss://stream.binance.com:9443/stream?streams=${streams}`,
    () => {},
    (raw) => {
      try {
        const msg = JSON.parse(raw)
        const d = msg.data
        if (!d || d.e !== 'trade') return
        const sym = d.s
        if (!TRACKED_SYMBOLS.includes(sym)) return
        store.addTick({ exchange: 'Binance', symbol: sym, price: parseFloat(d.p), ts: d.T })
      } catch {}
    }
  )
}
 
// ─── Bybit WebSocket ──────────────────────────────────────────────
function startBybit(symbols: string[]) {
  const store = getLagStore()
  return createReconnectingWS(
    'Bybit',
    () => 'wss://stream.bybit.com/v5/public/spot',
    (ws) => {
      for (let i = 0; i < symbols.length; i += 10) {
        const args = symbols.slice(i, i + 10).map(s => `publicTrade.${s}`)
        ws.send(JSON.stringify({ op: 'subscribe', args }))
      }
    },
    (raw) => {
      try {
        const msg = JSON.parse(raw)
        if (!msg.topic?.startsWith('publicTrade.')) return
        const sym = msg.topic.split('.')[1]
        if (!TRACKED_SYMBOLS.includes(sym)) return
        const trades = msg.data || []
        if (!trades.length) return
        const t = trades[trades.length - 1]
        store.addTick({ exchange: 'Bybit', symbol: sym, price: parseFloat(t.p), ts: t.T })
      } catch {}
    }
  )
}
 
// ─── OKX WebSocket ────────────────────────────────────────────────
function startOKX(symbols: string[]) {
  const store = getLagStore()
  // OKX uses format BTC-USDT
  const okxSymbols = symbols.map(s => s.replace('USDT', '-USDT'))
  return createReconnectingWS(
    'OKX',
    () => 'wss://ws.okx.com:8443/ws/v5/public',
    (ws) => {
      for (let i = 0; i < okxSymbols.length; i += 10) {
        const args = okxSymbols.slice(i, i + 10).map(id => ({ channel: 'trades', instId: id }))
        ws.send(JSON.stringify({ op: 'subscribe', args }))
      }
    },
    (raw) => {
      try {
        const msg = JSON.parse(raw)
        if (msg.event) return
        const trades = msg.data || []
        if (!trades.length) return
        const t = trades[0]
        const sym = t.instId?.replace('-', '')
        if (!TRACKED_SYMBOLS.includes(sym)) return
        store.addTick({ exchange: 'OKX', symbol: sym, price: parseFloat(t.px), ts: parseInt(t.ts) })
      } catch {}
    }
  )
}
 
// ─── Gate.io WebSocket ────────────────────────────────────────────
function startGate(symbols: string[]) {
  const store = getLagStore()
  const gateSymbols = symbols.map(s => s.replace('USDT', '_USDT'))
  return createReconnectingWS(
    'Gate',
    () => 'wss://api.gateio.ws/ws/v4/',
    (ws) => {
      // Gate підписка пачками
      for (let i = 0; i < gateSymbols.length; i += 10) {
        const batch = gateSymbols.slice(i, i + 10)
        ws.send(JSON.stringify({
          time: Math.floor(Date.now() / 1000),
          channel: 'spot.trades',
          event: 'subscribe',
          payload: batch,
        }))
      }
    },
    (raw) => {
      try {
        const msg = JSON.parse(raw)
        if (msg.channel !== 'spot.trades' || msg.event !== 'update') return
        const t = msg.result
        const sym = t.currency_pair?.replace('_', '')
        if (!TRACKED_SYMBOLS.includes(sym)) return
        store.addTick({ exchange: 'Gate', symbol: sym, price: parseFloat(t.price), ts: Math.floor(t.create_time_ms) })
      } catch {}
    }
  )
}
 
// ─── BingX WebSocket ──────────────────────────────────────────────
function startBingX(symbols: string[]) {
  const store = getLagStore()
  return createReconnectingWS(
    'BingX',
    () => 'wss://open-api-ws.bingx.com/market',
    (ws) => {
      for (const sym of symbols) {
        ws.send(JSON.stringify({
          id: sym,
          reqType: 'sub',
          dataType: `${sym.slice(0, -4)}-USDT@trade`,
        }))
      }
    },
    (raw) => {
      try {
        // BingX може надсилати gzip, але зазвичай JSON
        const msg = JSON.parse(raw)
        if (!msg.data?.T) return
        const pair = msg.dataType?.split('@')[0]?.replace('-', '')
        const sym = pair + 'USDT'
        if (!TRACKED_SYMBOLS.includes(sym)) return
        store.addTick({ exchange: 'BingX', symbol: sym, price: parseFloat(msg.data.p), ts: msg.data.T })
      } catch {}
    }
  )
}
 
// ─── Запуск всіх підключень ───────────────────────────────────────
let connections: Array<{ stop: () => void }> = []
 
export async function startCollector() {
  if (isRunning) return
  isRunning = true
 
  TRACKED_SYMBOLS = await fetchMexcZeroFeeSymbols()
  console.log(`[Collector] Tracking ${TRACKED_SYMBOLS.length} MEXC zero-fee symbols`)
 
  // Запускаємо всі WS
  connections = [
    startMEXC(TRACKED_SYMBOLS),
    startBinance(TRACKED_SYMBOLS),
    startBybit(TRACKED_SYMBOLS),
    startOKX(TRACKED_SYMBOLS),
    startGate(TRACKED_SYMBOLS),
    startBingX(TRACKED_SYMBOLS),
  ]
 
  // Чистимо старі дані кожні 5 хвилин
  setInterval(() => getLagStore().cleanup(), 5 * 60_000)
 
  console.log('[Collector] All exchanges started')
}
 
export function getTrackedSymbols() {
  return TRACKED_SYMBOLS
}
 
