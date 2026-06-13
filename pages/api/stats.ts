import type { NextApiRequest, NextApiResponse } from 'next'
import { getLagStore } from '../../lib/lagEngine'
import { startCollector, getTrackedSymbols } from '../../lib/collector'

let collectorStarted = false

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!collectorStarted) {
    collectorStarted = true
    startCollector().catch(console.error)
  }
  const store = getLagStore()
  const confirmed = store.getConfirmedTokens()
  res.setHeader('Cache-Control', 'no-store')
  res.json({
    trackedCount: getTrackedSymbols().length,
    confirmedCount: confirmed.length,
    totalMonitored: store.stats.size,
    tokens: confirmed.map(s => ({
      symbol: s.symbol,
      mexcPrice: s.mexcPrice,
      avgLagMs: Math.round(s.avgLagMs),
      avgLagSec: (s.avgLagMs / 1000).toFixed(2),
      minLagMs: Math.round(s.minLagMs),
      maxLagMs: Math.round(s.maxLagMs),
      sampleCount: s.sampleCount,
      leadExchange: s.leadExchange,
      leadCounts: s.leadCounts,
      direction: s.direction,
      lastSignalTs: s.lastSignalTs,
      priceChangePct: Number(s.priceChangePct?.toFixed(4)),
      profitPct100x: Number(s.profitPct100x?.toFixed(2)),
    })),
    updatedAt: Date.now(),
  })
}
