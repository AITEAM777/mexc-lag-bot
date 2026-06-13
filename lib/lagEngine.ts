// lib/lagEngine.ts
// Ядро бота: відстежує ціни з усіх бірж та вимірює затримку MEXC
 
export const EXCHANGES = ['Binance', 'Bybit', 'OKX', 'Gate', 'BingX'] as const
export type Exchange = typeof EXCHANGES[number]
 
export interface PriceTick {
  exchange: Exchange | 'MEXC'
  symbol: string
  price: number
  ts: number // unix ms
}
 
export interface TokenLagStats {
  symbol: string
  mexcPrice: number
  mexcTs: number
  confirmed: boolean        // true = реальна затримка підтверджена
  sampleCount: number
  avgLagMs: number          // середня затримка MEXC відносно лідера
  minLagMs: number
  maxLagMs: number
  lagSamples: number[]      // останні 50 зразків
  leadExchange: Exchange | null  // яка біржа найчастіше лідирує
  leadCounts: Record<string, number>
  direction: 'UP' | 'DOWN' | null  // поточний напрямок сигналу
  lastSignalTs: number
  priceChangePct: number
  // Розрахунок прибутку
  profitPct100x: number   // % прибуток при 100x плечі та 0.015% русі
}
 
// Глобальний стор — живе в пам'яті процесу Node.js
// На Vercel використовуємо глобальну змінну щоб не скидати між hot-reload
declare global {
  // eslint-disable-next-line no-var
  var __lagStore: LagStore | undefined
}
 
export class LagStore {
  // Ціни за останні 30 секунд для кожної біржі + символу
  private priceHistory: Map<string, PriceTick[]> = new Map()
  // Статистика по токенах
  public stats: Map<string, TokenLagStats> = new Map()
  // Мінімальна затримка для показу (мс)
  public MIN_LAG_MS = 500
  // Мінімальна кількість зразків для підтвердження
  public MIN_SAMPLES = 5
  // Вікно кореляції (мс)
  public CORRELATION_WINDOW_MS = 10_000
  // Поріг зміни ціни %
  public PRICE_CHANGE_THRESHOLD = 0.01
 
  key(exchange: string, symbol: string) {
    return `${exchange}:${symbol}`
  }
 
  addTick(tick: PriceTick) {
    const k = this.key(tick.exchange, tick.symbol)
    if (!this.priceHistory.has(k)) this.priceHistory.set(k, [])
    const arr = this.priceHistory.get(k)!
    arr.push(tick)
    // Тримаємо тільки останні 30 секунд
    const cutoff = Date.now() - 30_000
    while (arr.length > 0 && arr[0].ts < cutoff) arr.shift()
 
    // Якщо це MEXC тік — перевіряємо затримку
    if (tick.exchange === 'MEXC') {
      this.evaluateLag(tick)
    }
  }
 
  private evaluateLag(mexcTick: PriceTick) {
    const sym = mexcTick.symbol
    const now = mexcTick.ts
 
    // Знаходимо попередній MEXC тік для розрахунку зміни
    const mexcHistory = this.priceHistory.get(this.key('MEXC', sym)) || []
    const prevMexc = mexcHistory[mexcHistory.length - 2]
    if (!prevMexc) return
 
    const mexcChangePct = (mexcTick.price - prevMexc.price) / prevMexc.price * 100
    if (Math.abs(mexcChangePct) < this.PRICE_CHANGE_THRESHOLD) return
 
    // Шукаємо першу біржу яка рухнулась у тому ж напрямку
    let bestLeader: Exchange | null = null
    let bestLeaderTs = Infinity
    let bestLagMs = Infinity
 
    for (const exch of EXCHANGES) {
      const history = this.priceHistory.get(this.key(exch, sym)) || []
      if (history.length < 2) continue
 
      // Шукаємо рух на цій біржі у вікні ДО MEXC тіку
      for (let i = history.length - 1; i >= 0; i--) {
        const tick = history[i]
        const lag = now - tick.ts
        if (lag < 0 || lag > this.CORRELATION_WINDOW_MS) break
 
        const prevTick = history[i - 1]
        if (!prevTick) continue
 
        const exchChangePct = (tick.price - prevTick.price) / prevTick.price * 100
        if (Math.abs(exchChangePct) < this.PRICE_CHANGE_THRESHOLD) continue
 
        // Однаковий напрямок?
        const sameDir = (mexcChangePct > 0 && exchChangePct > 0) ||
                        (mexcChangePct < 0 && exchChangePct < 0)
        if (!sameDir) continue
 
        if (tick.ts < bestLeaderTs) {
          bestLeader = exch
          bestLeaderTs = tick.ts
          bestLagMs = lag
        }
        break
      }
    }
 
    if (!bestLeader || bestLagMs < 100) return // немає значущої затримки
 
    // Оновлюємо статистику
    let s = this.stats.get(sym)
    if (!s) {
      s = {
        symbol: sym,
        mexcPrice: mexcTick.price,
        mexcTs: now,
        confirmed: false,
        sampleCount: 0,
        avgLagMs: 0,
        minLagMs: Infinity,
        maxLagMs: 0,
        lagSamples: [],
        leadExchange: null,
        leadCounts: {},
        direction: null,
        lastSignalTs: 0,
        priceChangePct: 0,
        profitPct100x: 0,
      }
      this.stats.set(sym, s)
    }
 
    s.mexcPrice = mexcTick.price
    s.mexcTs = now
    s.sampleCount++
    s.lagSamples.push(bestLagMs)
    if (s.lagSamples.length > 50) s.lagSamples.shift()
    s.avgLagMs = s.lagSamples.reduce((a, b) => a + b, 0) / s.lagSamples.length
    s.minLagMs = Math.min(s.minLagMs, bestLagMs)
    s.maxLagMs = Math.max(s.maxLagMs, bestLagMs)
    s.leadCounts[bestLeader] = (s.leadCounts[bestLeader] || 0) + 1
    s.leadExchange = Object.entries(s.leadCounts).sort((a, b) => b[1] - a[1])[0][0] as Exchange
    s.direction = mexcChangePct > 0 ? 'UP' : 'DOWN'
    s.lastSignalTs = now
    s.priceChangePct = mexcChangePct
    // Прибуток при 100x: зміна% * 100 мінус комісія MEXC (0%) = чиста зміна * 100
    s.profitPct100x = Math.abs(mexcChangePct) * 100
 
    // Підтверджено якщо >= MIN_SAMPLES і avg lag >= MIN_LAG_MS
    s.confirmed = s.sampleCount >= this.MIN_SAMPLES && s.avgLagMs >= this.MIN_LAG_MS
  }
 
  getConfirmedTokens(): TokenLagStats[] {
    return Array.from(this.stats.values())
      .filter(s => s.confirmed)
      .sort((a, b) => b.avgLagMs - a.avgLagMs)
  }
 
  cleanup() {
    const cutoff = Date.now() - 60_000 * 5
    for (const [sym, s] of this.stats.entries()) {
      if (s.lastSignalTs < cutoff) this.stats.delete(sym)
    }
  }
}
 
export function getLagStore(): LagStore {
  if (!global.__lagStore) global.__lagStore = new LagStore()
  return global.__lagStore
}
 
