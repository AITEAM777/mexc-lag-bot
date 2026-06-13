// pages/index.tsx
import { useEffect, useState, useRef } from 'react'
import Head from 'next/head'

interface TokenData {
  symbol: string
  mexcPrice: number
  avgLagMs: number
  avgLagSec: string
  minLagMs: number
  maxLagMs: number
  sampleCount: number
  leadExchange: string
  leadCounts: Record<string, number>
  direction: 'UP' | 'DOWN' | null
  lastSignalTs: number
  priceChangePct: number
  profitPct100x: number
}

interface StatsData {
  trackedCount: number
  confirmedCount: number
  totalMonitored: number
  tokens: TokenData[]
  updatedAt: number
}

const EXCHANGE_COLORS: Record<string, string> = {
  Binance: '#F0B90B',
  Bybit:   '#F7A600',
  OKX:     '#00B0FF',
  Gate:    '#00DACC',
  BingX:   '#1DA1F2',
}

function LagBar({ ms, max }: { ms: number; max: number }) {
  const pct = Math.min((ms / max) * 100, 100)
  const color = ms < 1500 ? '#00ff88' : ms < 3000 ? '#ffcc00' : '#ff4444'
  return (
    <div style={{ background: '#1a1a2e', borderRadius: 4, height: 6, width: '100%', overflow: 'hidden' }}>
      <div style={{ width: `${pct}%`, height: '100%', background: color, transition: 'width 0.4s ease', borderRadius: 4 }} />
    </div>
  )
}

function PulsingDot({ active }: { active: boolean }) {
  return (
    <span style={{
      display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
      background: active ? '#00ff88' : '#333',
      boxShadow: active ? '0 0 8px #00ff88' : 'none',
      marginRight: 6,
      animation: active ? 'pulse 1.5s infinite' : 'none',
    }} />
  )
}

function TokenCard({ t }: { t: TokenData }) {
  const isNew = Date.now() - t.lastSignalTs < 5000
  const lagColor = t.avgLagMs < 1500 ? '#00ff88' : t.avgLagMs < 3000 ? '#ffcc00' : '#ff6644'
  const dirColor = t.direction === 'UP' ? '#00ff88' : '#ff4444'
  const dirSymbol = t.direction === 'UP' ? '▲' : '▼'

  const totalLeads = Object.values(t.leadCounts).reduce((a, b) => a + b, 0)

  return (
    <div style={{
      background: isNew ? '#0d1f2d' : '#0a0f1e',
      border: `1px solid ${isNew ? '#00ff8840' : '#1e2a40'}`,
      borderRadius: 12,
      padding: '16px 20px',
      transition: 'all 0.3s',
      boxShadow: isNew ? '0 0 20px #00ff8815' : 'none',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <PulsingDot active={isNew} />
          <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 16, color: '#e8f0fe', letterSpacing: 1 }}>
            {t.symbol.replace('USDT', '')}
            <span style={{ color: '#4a5568', fontWeight: 400 }}>/USDT</span>
          </span>
        </div>
        <span style={{
          background: t.direction === 'UP' ? '#00ff8820' : '#ff444420',
          color: dirColor,
          border: `1px solid ${dirColor}40`,
          borderRadius: 6,
          padding: '2px 10px',
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: 1,
        }}>
          {dirSymbol} {t.direction}
        </span>
      </div>

      {/* Lag highlight */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 10 }}>
        <div>
          <div style={{ color: '#4a5568', fontSize: 10, marginBottom: 2, letterSpacing: 1 }}>ЗАТРИМКА MEXC</div>
          <div style={{ color: lagColor, fontSize: 28, fontWeight: 800, fontFamily: 'monospace', lineHeight: 1 }}>
            {t.avgLagSec}с
          </div>
          <div style={{ color: '#333d52', fontSize: 11, marginTop: 2 }}>
            min {(t.minLagMs/1000).toFixed(1)}с / max {(t.maxLagMs/1000).toFixed(1)}с
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ color: '#4a5568', fontSize: 10, letterSpacing: 1 }}>ПРИБУТОК 100×</div>
          <div style={{ color: '#a78bfa', fontSize: 22, fontWeight: 700, fontFamily: 'monospace' }}>
            +{t.profitPct100x.toFixed(1)}%
          </div>
          <div style={{ color: '#333d52', fontSize: 11 }}>
            зміна {t.priceChangePct > 0 ? '+' : ''}{t.priceChangePct?.toFixed(3)}%
          </div>
        </div>
      </div>

      {/* Lag bar */}
      <LagBar ms={t.avgLagMs} max={8000} />

      {/* Exchanges */}
      <div style={{ marginTop: 12, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {Object.entries(t.leadCounts)
          .sort((a, b) => b[1] - a[1])
          .map(([exch, cnt]) => (
            <span key={exch} style={{
              background: `${EXCHANGE_COLORS[exch] || '#888'}18`,
              border: `1px solid ${EXCHANGE_COLORS[exch] || '#888'}40`,
              color: EXCHANGE_COLORS[exch] || '#888',
              borderRadius: 5,
              padding: '2px 8px',
              fontSize: 11,
              fontWeight: 600,
            }}>
              {exch} {Math.round(cnt / totalLeads * 100)}%
            </span>
          ))}
      </div>

      {/* Bottom */}
      <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', color: '#2d3748', fontSize: 11 }}>
        <span>MEXC ${t.mexcPrice?.toFixed(t.mexcPrice > 100 ? 2 : 4)}</span>
        <span>{t.sampleCount} зразків · {new Date(t.lastSignalTs).toLocaleTimeString('uk-UA')}</span>
      </div>
    </div>
  )
}

export default function Home() {
  const [data, setData] = useState<StatsData | null>(null)
  const [connected, setConnected] = useState(false)
  const [sort, setSort] = useState<'lag' | 'profit' | 'samples'>('lag')
  const [filter, setFilter] = useState('')
  const [minLag, setMinLag] = useState(0)
  const evtRef = useRef<EventSource | null>(null)

  useEffect(() => {
    function connect() {
      const es = new EventSource('/api/stream')
      evtRef.current = es
      es.onopen = () => setConnected(true)
      es.onmessage = (e) => {
        try { setData(JSON.parse(e.data)) } catch {}
      }
      es.onerror = () => {
        setConnected(false)
        es.close()
        setTimeout(connect, 3000)
      }
    }
    connect()
    return () => evtRef.current?.close()
  }, [])

  const tokens = (data?.tokens || [])
    .filter(t => t.symbol.toLowerCase().includes(filter.toLowerCase()))
    .filter(t => t.avgLagMs >= minLag * 1000)
    .sort((a, b) => {
      if (sort === 'lag') return b.avgLagMs - a.avgLagMs
      if (sort === 'profit') return b.profitPct100x - a.profitPct100x
      return b.sampleCount - a.sampleCount
    })

  const upCount = tokens.filter(t => t.direction === 'UP').length
  const downCount = tokens.filter(t => t.direction === 'DOWN').length

  return (
    <>
      <Head>
        <title>MEXC Lag Bot</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #060912; color: #e8f0fe; font-family: -apple-system, 'Segoe UI', sans-serif; min-height: 100vh; }
        @keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.5;transform:scale(1.4)} }
        @keyframes fadeIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
        ::-webkit-scrollbar { width: 6px; } ::-webkit-scrollbar-track { background: #0a0f1e; } ::-webkit-scrollbar-thumb { background: #1e2a40; border-radius: 3px; }
        input, select { background: #0a0f1e; border: 1px solid #1e2a40; color: #e8f0fe; border-radius: 8px; padding: 8px 12px; font-size: 13px; outline: none; }
        input:focus, select:focus { border-color: #3b5bdb; }
        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; }
        .btn { background: #0a0f1e; border: 1px solid #1e2a40; color: #6b7280; border-radius: 8px; padding: 6px 14px; cursor: pointer; font-size: 13px; transition: all .2s; }
        .btn.active { border-color: #3b5bdb; color: #818cf8; background: #1e1b4b30; }
        .btn:hover { border-color: #3b5bdb50; color: #a5b4fc; }
        .stat-card { background: #0a0f1e; border: 1px solid #1e2a40; border-radius: 10px; padding: 14px 20px; }
        .empty { text-align: center; padding: 80px 20px; color: #2d3748; }
        .empty h2 { font-size: 48px; margin-bottom: 12px; }
      `}</style>

      <div style={{ maxWidth: 1400, margin: '0 auto', padding: '24px 16px' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 24 }}>📡</span>
              <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: -0.5 }}>
                MEXC Lag <span style={{ color: '#3b5bdb' }}>Bot</span>
              </h1>
            </div>
            <div style={{ color: '#2d3748', fontSize: 12, marginTop: 2 }}>
              Binance · Bybit · OKX · Gate · BingX → MEXC zero-fee
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              background: connected ? '#00ff88' : '#ff4444',
              display: 'inline-block',
              boxShadow: connected ? '0 0 8px #00ff88' : '0 0 8px #ff4444',
            }} />
            <span style={{ color: connected ? '#00ff88' : '#ff4444', fontSize: 12 }}>
              {connected ? 'LIVE' : 'Підключення...'}
            </span>
          </div>
        </div>

        {/* Stats row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
          {[
            { label: 'Відстежується', value: data?.trackedCount ?? '—', sub: 'MEXC zero-fee' },
            { label: 'Моніторинг', value: data?.totalMonitored ?? 0, sub: 'мають рухи' },
            { label: 'Підтверджено', value: data?.confirmedCount ?? 0, sub: 'реальна затримка' },
            { label: 'Сигналів', value: `${upCount}▲ ${downCount}▼`, sub: 'активних' },
          ].map(s => (
            <div key={s.label} className="stat-card">
              <div style={{ color: '#2d3748', fontSize: 11, letterSpacing: 1 }}>{s.label.toUpperCase()}</div>
              <div style={{ fontSize: 24, fontWeight: 800, fontFamily: 'monospace', marginTop: 4 }}>{s.value}</div>
              <div style={{ color: '#374151', fontSize: 11, marginTop: 2 }}>{s.sub}</div>
            </div>
          ))}
        </div>

        {/* Controls */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            placeholder="🔍 Пошук токена..."
            value={filter}
            onChange={e => setFilter(e.target.value)}
            style={{ width: 180 }}
          />
          <select value={minLag} onChange={e => setMinLag(Number(e.target.value))}>
            <option value={0}>Усі затримки</option>
            <option value={1}>≥ 1 сек</option>
            <option value={2}>≥ 2 сек</option>
            <option value={3}>≥ 3 сек</option>
            <option value={5}>≥ 5 сек</option>
          </select>
          <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
            <span style={{ color: '#2d3748', fontSize: 12, alignSelf: 'center' }}>Сортування:</span>
            {[['lag','За затримкою'],['profit','За прибутком'],['samples','За зразками']].map(([val, label]) => (
              <button key={val} className={`btn ${sort === val ? 'active' : ''}`} onClick={() => setSort(val as any)}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Token grid */}
        {tokens.length === 0 ? (
          <div className="empty">
            <div style={{ fontSize: 48, marginBottom: 12 }}>🔍</div>
            <div style={{ color: '#374151', fontSize: 16 }}>
              {data === null ? 'Підключаємось до бірж...' : 'Збираємо дані, очікуйте 30–60 секунд...'}
            </div>
            <div style={{ color: '#1f2937', fontSize: 13, marginTop: 8 }}>
              Токен з'явиться тільки якщо MEXC реально відстає від інших бірж
            </div>
          </div>
        ) : (
          <div className="grid">
            {tokens.map(t => <TokenCard key={t.symbol} t={t} />)}
          </div>
        )}

        {/* Footer */}
        <div style={{ marginTop: 40, textAlign: 'center', color: '#1f2937', fontSize: 11 }}>
          Оновлення кожну секунду · Підтвердження після {'>'}5 збігів ·{' '}
          {data?.updatedAt ? new Date(data.updatedAt).toLocaleTimeString('uk-UA') : ''}
        </div>
      </div>
    </>
  )
}
