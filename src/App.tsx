import { useState, useEffect, useRef, useCallback } from 'react'
import { Car, RefreshCw, Activity, BarChart3, LayoutList, LayoutGrid } from 'lucide-react'
import { TrafficCard } from './components/TrafficCard'
import { TrendChart } from './components/TrendChart'
import { RouteMap } from './components/RouteMap'
import { IncidentSummary } from './components/IncidentSummary'
import { ThemeToggle } from './components/ThemeToggle'
import { HeatmapChart } from './components/HeatmapChart'
import { StatusBadge } from './components/StatusBadge'
import { useTrafficData, type TrendRange } from './lib/api'
import { CORRIDORS } from './lib/types'
import { ageText } from './lib/time'
import type { CorridorDirection, DirectionSampleData, TrafficSamplePoint } from './lib/types'

function extractTrend(samples: TrafficSamplePoint[], dirKey: string): number[] {
  return samples
    .map(s => {
      const d = s[dirKey] as DirectionSampleData | undefined
      return d?.freeFlowDelaySeconds
    })
    .filter((v): v is number => v != null)
}

function heroSummary(corridors: Record<string, CorridorDirection>): string {
  const all = Object.values(corridors) as CorridorDirection[]
  if (all.length === 0) return 'No live traffic data yet'

  const stale = all.filter(d => d.isStale)
  if (stale.length === all.length) return 'Traffic data may be outdated'

  const active = all.filter(d => !d.isStale)

  const withDelay = active.map(d => ({
    ...d,
    delay: d.freeFlowDelaySeconds,
    severity: d.freeFlowCongestionLevel,
  }))

  const worst = withDelay.sort((a, b) => b.delay - a.delay)[0]

  if (!worst) return 'Traffic data may be outdated'

  const delayMin = Math.round(worst.delay / 60)
  const dirLabel = corridorLabel(worst.direction)

  if (delayMin <= 0 || worst.severity === 'light') return 'Roads moving well'
  if (worst.severity === 'moderate') return `+${delayMin} min delay ${dirLabel}`
  if (worst.severity === 'heavy') return `Heavy delay ${dirLabel}`
  return `Severe delay ${dirLabel}`
}

function corridorLabel(directionKey: string): string {
  for (const c of CORRIDORS) {
    if (directionKey === `${c.id}_f`) return `to ${c.forwardLabel.replace('To ', '').toLowerCase()}`
    if (directionKey === `${c.id}_r`) return `to ${c.reverseLabel.replace('To ', '').toLowerCase()}`
  }
  return ''
}

function PageToggle({
  page,
  setPage,
  disabled = false,
}: {
  page: 'live' | 'analytics'
  setPage: (p: 'live' | 'analytics') => void
  disabled?: boolean
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const liveRef = useRef<HTMLButtonElement>(null)
  const analyticsRef = useRef<HTMLButtonElement>(null)
  const [slider, setSlider] = useState({ left: 0, width: 0 })

  const measure = useCallback(() => {
    const btn = page === 'live' ? liveRef.current : analyticsRef.current
    const container = containerRef.current
    if (!btn || !container) return
    const cRect = container.getBoundingClientRect()
    const bRect = btn.getBoundingClientRect()
    setSlider({ left: bRect.left - cRect.left, width: bRect.width })
  }, [page])

  useEffect(() => { measure() }, [measure])

  return (
    <div
      ref={containerRef}
      className="relative flex rounded-md border p-0.5"
      style={{
        backgroundColor: 'var(--color-surface-overlay)',
        borderColor: 'var(--color-border)',
        opacity: disabled ? 0.4 : 1,
      }}
      aria-disabled={disabled || undefined}
    >
      <div
        className="absolute top-0.5 bottom-0.5 rounded-[4px] transition-[left,width] duration-200 ease-out"
        style={{
          left: slider.left,
          width: slider.width,
          backgroundColor: 'var(--color-surface-raised)',
          boxShadow: '0 1px 3px rgba(0,0,0,0.12)',
        }}
      />
      <button
        ref={liveRef}
        type="button"
        onClick={() => setPage('live')}
        disabled={disabled}
        className="relative z-10 h-7 px-2.5 text-xs font-medium rounded-[4px] flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 transition-colors duration-150 disabled:cursor-not-allowed"
        style={{
          color: page === 'live' ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
          '--tw-ring-color': 'var(--color-focus)',
          '--tw-ring-offset-color': 'var(--color-surface-raised)',
        } as React.CSSProperties}
        aria-pressed={page === 'live'}
      >
        <Activity size={12} aria-hidden="true" />
        Live
      </button>
      <button
        ref={analyticsRef}
        type="button"
        onClick={() => setPage('analytics')}
        disabled={disabled}
        className="relative z-10 h-7 px-2.5 text-xs font-medium rounded-[4px] flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 transition-colors duration-150 disabled:cursor-not-allowed"
        style={{
          color: page === 'analytics' ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
          '--tw-ring-color': 'var(--color-focus)',
          '--tw-ring-offset-color': 'var(--color-surface-raised)',
        } as React.CSSProperties}
        aria-pressed={page === 'analytics'}
      >
        <BarChart3 size={12} aria-hidden="true" />
        Analytics
      </button>
    </div>
  )
}

export default function App() {
  const {
    data, history, samples, heatmap,
    loading, refreshing, error,
    corridors, incidents, load,
  } = useTrafficData()

  const [page, setPage] = useState<'live' | 'analytics'>('live')
  const [trendRange, setTrendRange] = useState<TrendRange>('3h')
  const [flyTo, setFlyTo] = useState<{ lat: number; lng: number } | null>(null)
  const [detailMode, setDetailMode] = useState(false)
  const [trendExpanded, setTrendExpanded] = useState(true)
  const [heatmapExpanded, setHeatmapExpanded] = useState(true)
  const didInitial = useRef(false)

  // Initial load + 10min interval; re-fetch when trendRange changes
  useEffect(() => {
    load(trendRange, !didInitial.current)
    didInitial.current = true
    const id = setInterval(() => load(trendRange), 10 * 60 * 1000)
    return () => clearInterval(id)
  }, [trendRange, load])

  const isNoData = data?.status === 'no_data'
  const hasData = data?.status === 'ok' && Object.keys(corridors).length > 0
  const controlsDisabled = !hasData && !loading
  const isStale = hasData && Object.values(corridors).some((d: CorridorDirection) => d.isStale)
  const summary = hasData
    ? heroSummary(corridors)
    : isNoData
      ? 'Waiting for the first traffic sample'
      : ''

  return (
    <div className="min-h-screen textured" style={{ backgroundColor: 'var(--color-surface)' }}>
      <header className="sticky top-0 z-40 backdrop-blur-md border-b" style={{ backgroundColor: 'color-mix(in srgb, var(--color-surface) 85%, transparent)', borderColor: 'var(--color-border)' }}>
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <span className="text-sm font-semibold tracking-tight flex items-center gap-2" style={{ color: 'var(--color-text-primary)' }}>
            <Car size={18} strokeWidth={2.5} style={{ color: 'var(--color-congestion-light)' }} />
            <span>Traffic Ba Sa LB?</span>
          </span>
          <div className="flex items-center gap-1.5">
            <PageToggle page={page} setPage={setPage} disabled={controlsDisabled} />

            <button
              type="button"
              onClick={() => setDetailMode(!detailMode)}
              disabled={controlsDisabled}
              className="h-8 w-8 rounded-md border flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40"
              style={{
                backgroundColor: detailMode ? 'var(--color-surface-raised)' : 'var(--color-surface-overlay)',
                borderColor: 'var(--color-border)',
                color: detailMode ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                '--tw-ring-color': 'var(--color-focus)',
                '--tw-ring-offset-color': 'var(--color-surface)',
              } as React.CSSProperties}
              aria-pressed={detailMode}
              aria-label={
                controlsDisabled
                  ? 'Detail view unavailable until traffic data loads'
                  : detailMode
                    ? 'Switch to simple view'
                    : 'Switch to detailed view'
              }
              title={controlsDisabled ? 'Unavailable without data' : detailMode ? 'Simple view' : 'Detailed view'}
            >
              {detailMode
                ? <LayoutGrid size={14} aria-hidden="true" />
                : <LayoutList size={14} aria-hidden="true" />
              }
            </button>

            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6 sm:py-10">
        <div className="text-center mb-8">
          <h1 className="font-display text-4xl sm:text-5xl mb-2" style={{ color: 'var(--color-text-primary)' }}>
            Traffic Ba Sa LB<span className="font-display italic" style={{ color: 'var(--color-text-muted)' }}>?</span>
          </h1>
          <p className="text-sm sm:text-base" style={{ color: 'var(--color-text-muted)' }}>
            {loading ? 'Loading…' : summary}
          </p>
        </div>

        {loading && (
          <div role="status" aria-live="polite" className="text-center py-16">
            <div className="inline-block w-5 h-5 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--color-border)', borderTopColor: 'var(--color-congestion-moderate)' }} aria-hidden="true" />
            <p className="text-sm mt-3" style={{ color: 'var(--color-text-muted)' }}>Loading traffic data…</p>
          </div>
        )}

        {error && !loading && (
          <div role="alert" className="text-center py-10">
            <p className="text-sm" style={{ color: 'var(--color-congestion-severe)' }}>{error}</p>
            <button onClick={() => load(trendRange, !hasData)} className="mt-2 min-h-11 px-3 text-sm underline focus-visible:outline-2 focus-visible:outline-offset-2" style={{ color: 'var(--color-text-secondary)', outlineColor: 'var(--color-focus)' }}>
              Try again
            </button>
          </div>
        )}

        {isNoData && !loading && (
          <div className="text-center py-16" role="status">
            <div className="text-4xl mb-4" role="img" aria-label="Construction sign">🚧</div>
            <h2 className="text-lg font-semibold mb-2" style={{ color: 'var(--color-text-secondary)' }}>
              No live traffic yet
            </h2>
            <p className="text-sm max-w-sm mx-auto mb-4" style={{ color: 'var(--color-text-muted)' }}>
              The collector has not written a sample. Live and Analytics stay off until the first successful pull.
            </p>
            <button
              type="button"
              onClick={() => load(trendRange, true)}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 min-h-9 px-3 rounded-md text-sm font-medium border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-70"
              style={{
                backgroundColor: 'var(--color-surface-raised)',
                borderColor: 'var(--color-border)',
                color: 'var(--color-text-primary)',
                '--tw-ring-color': 'var(--color-focus)',
                '--tw-ring-offset-color': 'var(--color-surface)',
              } as React.CSSProperties}
            >
              <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} aria-hidden="true" />
              Check again
            </button>
          </div>
        )}

        {hasData && !loading && page === 'live' && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
              {CORRIDORS.map(({ id, label, forwardLabel, reverseLabel, a, b }) => {
                const fwd = corridors[`${id}_f`]
                const rev = corridors[`${id}_r`]
                if (!fwd && !rev) return null

                return (
                  <TrafficCard
                    key={id}
                    corridorId={id}
                    label={label}
                    forward={fwd}
                    reverse={rev}
                    forwardLabel={forwardLabel}
                    reverseLabel={reverseLabel}
                    detailMode={detailMode}
                    forwardTrend={extractTrend(samples, `${id}_f`)}
                    reverseTrend={extractTrend(samples, `${id}_r`)}
                    onDirectionZoom={(dirKey) => {
                      const isForward = dirKey.endsWith('_f')
                      setFlyTo(isForward ? b : a)
                    }}
                  />
                )
              })}
            </div>

            <div className="flex items-center justify-center gap-3 text-xs mb-8">
              <StatusBadge type={isStale ? 'warning' : 'success'} size="sm">
                {isStale ? 'Stale' : 'Fresh'}
              </StatusBadge>
              <span style={{ color: 'var(--color-text-muted)' }}>Updated {ageText(data!.lastUpdated)}</span>
              <button
                onClick={() => load(trendRange)}
                disabled={refreshing}
                className="flex items-center gap-1.5 min-h-7 px-2 rounded-md font-medium transition-colors disabled:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 hover:bg-black/4 dark:hover:bg-white/6"
                style={{
                  color: 'var(--color-text-secondary)',
                  '--tw-ring-color': 'var(--color-focus)',
                  '--tw-ring-offset-color': 'var(--color-surface)',
                } as React.CSSProperties}
              >
                <RefreshCw size={11} className={refreshing ? 'animate-spin' : ''} aria-hidden="true" />
                Refresh
              </button>
            </div>

            <IncidentSummary
              incidents={incidents}
              detailMode={detailMode}
              onIncidentClick={(inc) => inc.lat != null && setFlyTo({ lat: inc.lat!, lng: inc.lng! })}
            />

            <div className="mb-4">
              <RouteMap corridors={corridors} flyTo={flyTo} />
            </div>
          </>
        )}

        {hasData && !loading && page === 'analytics' && (
          <>
            <div className="mb-4">
              <TrendChart
                history={history}
                samples={samples}
                range={trendRange}
                onRangeChange={setTrendRange}
                expanded={trendExpanded}
                onToggle={() => setTrendExpanded(!trendExpanded)}
              />
            </div>

            {heatmap.length > 0 && (
              <div className="mb-4">
                <HeatmapChart
                  data={heatmap}
                  expanded={heatmapExpanded}
                  onToggle={() => setHeatmapExpanded(!heatmapExpanded)}
                />
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}
