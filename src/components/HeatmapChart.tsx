import { useId, useMemo, useState } from 'react'
import { Calendar } from 'lucide-react'
import { CORRIDORS, type HeatmapBucket } from '../lib/types'

interface HeatmapChartProps {
  data: HeatmapBucket[]
  expanded: boolean
  onToggle: () => void
}

const DOW_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const HOUR_LABELS = Array.from({ length: 12 }, (_, i) => {
  const hour = i * 2
  if (hour === 0) return '12a'
  if (hour === 12) return '12p'
  return hour < 12 ? `${hour}a` : `${hour - 12}p`
})

function getDelayField(
  bucket: HeatmapBucket,
  field:
    | 'p50UsualDelaySeconds'
    | 'p50FreeFlowDelaySeconds'
    | 'p90UsualDelaySeconds'
    | 'p90FreeFlowDelaySeconds'
    | 'avgUsualDelaySeconds'
    | 'avgFreeFlowDelaySeconds',
): number | null {
  return bucket[field]
}

function displayToSqlDow(displayDow: number): number {
  return (displayDow + 1) % 7
}

function delayToColor(p90Seconds: number | null): string {
  if (p90Seconds === null) {
    return 'var(--color-surface-subtle)'
  }
  const normalized = Math.min(p90Seconds / 300, 1)

  if (normalized < 0.25) {
    const t = normalized / 0.25
    return `color-mix(in srgb, var(--color-congestion-light) ${(1 - t) * 100}%, var(--color-congestion-moderate) ${t * 100}%)`
  } else if (normalized < 0.5) {
    const t = (normalized - 0.25) / 0.25
    return `color-mix(in srgb, var(--color-congestion-moderate) ${(1 - t) * 100}%, var(--color-congestion-heavy) ${t * 100}%)`
  } else if (normalized < 0.75) {
    const t = (normalized - 0.5) / 0.25
    return `color-mix(in srgb, var(--color-congestion-heavy) ${(1 - t) * 100}%, var(--color-congestion-severe) ${t * 100}%)`
  } else {
    return 'var(--color-congestion-severe)'
  }
}

function cellDescription(
  dowLabel: string,
  hr: number,
  bucket: HeatmapBucket | undefined,
  p50Field: 'p50FreeFlowDelaySeconds',
  p90Field: 'p90FreeFlowDelaySeconds',
): string {
  if (!bucket) return `${dowLabel} ${hr}:00 · No data`
  const p50 = getDelayField(bucket, p50Field)
  const p90 = getDelayField(bucket, p90Field)
  const p50Min = p50 !== null ? Math.round(p50 / 60) : 'N/A'
  const p90Min = p90 !== null ? Math.round(p90 / 60) : 'N/A'
  const incidentText =
    bucket.incidentCount > 0
      ? ` · ${bucket.incidentCount} incident${bucket.incidentCount > 1 ? 's' : ''}`
      : ''
  return `${dowLabel} ${hr}:00 · P50 +${p50Min} min · P90 +${p90Min} min · ${bucket.sampleCount} sample${bucket.sampleCount !== 1 ? 's' : ''}${incidentText}`
}

export function HeatmapChart({ data, expanded, onToggle }: HeatmapChartProps) {
  const panelId = useId()
  const tabPanelId = useId()
  const cellDescId = useId()
  const [selectedCorridor, setSelectedCorridor] = useState(CORRIDORS[0].id)
  const [selectedDirection, setSelectedDirection] = useState<'f' | 'r'>('f')
  const [hoveredCell, setHoveredCell] = useState<{ dow: number; hr: number } | null>(null)
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [activeDesc, setActiveDesc] = useState('')

  const p50Field = 'p50FreeFlowDelaySeconds' as const
  const p90Field = 'p90FreeFlowDelaySeconds' as const

  const dirKey = `${selectedCorridor}_${selectedDirection}`
  const hasAnyData = data.length > 0

  const bucketsByDirection = useMemo(() => {
    const map = new Map<string, Map<string, HeatmapBucket>>()
    for (const bucket of data) {
      if (!map.has(bucket.direction)) {
        map.set(bucket.direction, new Map())
      }
      const key = `${bucket.dow}-${bucket.hr}`
      map.get(bucket.direction)!.set(key, bucket)
    }
    return map
  }, [data])

  const selectedBuckets = bucketsByDirection.get(dirKey)
  const selectionEmpty = selectedBuckets === undefined || selectedBuckets.size === 0
  const totalCells = 7 * 24
  const filledCells = selectedBuckets?.size ?? 0
  const reliability = Math.round((filledCells / totalCells) * 100)

  const currentBucket = useMemo(() => {
    const now = new Date()
    const utcHour = now.getUTCHours()
    const utcDow = now.getUTCDay()
    const manilaHour = (utcHour + 8) % 24
    const manilaDow = (utcDow + Math.floor((utcHour + 8) / 24) + 7) % 7
    const key = `${manilaDow}-${manilaHour}`
    return selectedBuckets?.get(key) ?? null
  }, [selectedBuckets])

  const selectedCorridorDef = CORRIDORS.find(c => c.id === selectedCorridor)!

  const gridData = useMemo(() => {
    const cells: Array<{
      dow: number
      hr: number
      bucket: HeatmapBucket | undefined
    }> = []
    for (let displayDow = 0; displayDow < 7; displayDow++) {
      const sqlDow = displayToSqlDow(displayDow)
      for (let hr = 0; hr < 24; hr++) {
        const key = `${sqlDow}-${hr}`
        const bucket = selectedBuckets?.get(key)
        cells.push({ dow: displayDow, hr, bucket })
      }
    }
    return cells
  }, [selectedBuckets])

  const activateCell = (
    displayDow: number,
    hr: number,
    clientX: number,
    clientY: number,
  ) => {
    setHoveredCell({ dow: displayDow, hr })
    setTooltipPos({ x: clientX, y: clientY })
    const sqlDow = displayToSqlDow(displayDow)
    const bucket = selectedBuckets?.get(`${sqlDow}-${hr}`)
    setActiveDesc(
      cellDescription(DOW_LABELS[displayDow], hr, bucket, p50Field, p90Field),
    )
  }

  const clearCell = () => {
    setHoveredCell(null)
    setActiveDesc('')
  }

  return (
    <div className="card p-0 overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 text-left focus-visible:outline focus-visible:outline-offset-2 border-b"
        style={{ outlineColor: 'var(--color-focus)', borderColor: 'var(--color-border)' }}
        aria-expanded={expanded}
        aria-controls={panelId}
      >
        <div className="flex items-center gap-1.5">
          <Calendar size={13} aria-hidden="true" style={{ color: 'var(--color-text-muted)' }} />
          <h2 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
            Weekly Pattern
          </h2>
        </div>
        <span aria-hidden="true" style={{ color: 'var(--color-text-muted)' }}>
          {expanded ? '▼' : '▾'}
        </span>
      </button>

      {expanded && (
        <div id={panelId} className="p-4 sm:p-5 pt-4">
          <p className="text-xs mb-4" style={{ color: 'var(--color-text-muted)' }}>
            Typical delay by day and time (90th percentile). Color scale: Fast to Slow.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <div className="flex flex-wrap gap-1" role="tablist" aria-label="Corridors">
              {CORRIDORS.map(c => (
                <button
                  key={c.id}
                  type="button"
                  role="tab"
                  id={`${tabPanelId}-tab-${c.id}`}
                  aria-selected={selectedCorridor === c.id}
                  aria-controls={tabPanelId}
                  disabled={!hasAnyData}
                  onClick={() => setSelectedCorridor(c.id)}
                  className="min-h-8 px-3 text-xs font-medium rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 transition-all disabled:cursor-not-allowed disabled:opacity-55"
                  style={{
                    color: selectedCorridor === c.id ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                    backgroundColor: selectedCorridor === c.id ? 'var(--color-surface-overlay)' : 'transparent',
                    '--tw-ring-color': 'var(--color-focus)',
                    '--tw-ring-offset-color': 'var(--color-surface-raised)',
                  } as React.CSSProperties}
                >
                  {c.tabLabel}
                </button>
              ))}
            </div>

            <div
              className="flex rounded-md p-0.5"
              style={{
                backgroundColor: 'var(--color-surface-overlay)',
                border: '1px solid var(--color-border)',
                opacity: hasAnyData ? 1 : 0.55,
              }}
              role="group"
              aria-label="Direction"
            >
              {(['f', 'r'] as const).map(dir => (
                <button
                  key={dir}
                  type="button"
                  onClick={() => setSelectedDirection(dir)}
                  disabled={!hasAnyData}
                  className="min-h-7 px-3 text-xs font-medium rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 transition-all disabled:cursor-not-allowed"
                  style={{
                    color: selectedDirection === dir ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                    backgroundColor: selectedDirection === dir ? 'var(--color-surface-raised)' : 'transparent',
                    '--tw-ring-color': 'var(--color-focus)',
                    '--tw-ring-offset-color': 'var(--color-surface-raised)',
                  } as React.CSSProperties}
                  aria-pressed={selectedDirection === dir}
                >
                  {dir === 'f' ? selectedCorridorDef.forwardLabel : selectedCorridorDef.reverseLabel}
                </button>
              ))}
            </div>
          </div>

          <div
            id={tabPanelId}
            role="tabpanel"
            aria-labelledby={`${tabPanelId}-tab-${selectedCorridor}`}
          >
            {selectionEmpty ? (
              <div className="text-center py-12" role="status">
                <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  No pattern data for this corridor and direction yet. Pick another corridor or check back after more samples.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {currentBucket && (
                  <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                    <span>Right now:</span>
                    <span style={{ color: 'var(--color-text-primary)' }}>
                      Typical: +{Math.round((getDelayField(currentBucket, p50Field) ?? 0) / 60)} min | Plan for: +{Math.round((getDelayField(currentBucket, p90Field) ?? 0) / 60)} min
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>based on {currentBucket.sampleCount} samples</span>
                  </div>
                )}

                <p id={cellDescId} className="sr-only" aria-live="polite">
                  {activeDesc}
                </p>

                <div className="overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0">
                  <div
                    role="grid"
                    aria-label={`Weekly delay pattern for ${selectedCorridorDef.label}, ${selectedDirection === 'f' ? selectedCorridorDef.forwardLabel : selectedCorridorDef.reverseLabel}`}
                    aria-describedby={cellDescId}
                    className="grid gap-0.5 min-w-max"
                    style={{
                      gridTemplateColumns: '3rem repeat(24, minmax(14px, 1fr))',
                      gridTemplateRows: 'auto repeat(7, minmax(28px, 1fr))',
                    }}
                  >
                    <div className="col-start-1 row-start-1" role="presentation" />

                    {HOUR_LABELS.map((label) => (
                      <div
                        key={label}
                        role="columnheader"
                        className="col-span-2 text-[10px] text-center flex items-center justify-center"
                        style={{ color: 'var(--color-text-muted)' }}
                      >
                        {label}
                      </div>
                    ))}

                    {DOW_LABELS.map((dowLabel, displayDow) => (
                      <div key={dowLabel} className="contents" role="row">
                        <div
                          role="rowheader"
                          className="text-[10px] text-right pr-2 flex items-center justify-end"
                          style={{ color: 'var(--color-text-muted)' }}
                        >
                          {dowLabel}
                        </div>

                        {Array.from({ length: 24 }, (_, hr) => {
                          const cell = gridData.find(c => c.dow === displayDow && c.hr === hr)
                          const bucket = cell?.bucket
                          const delaySec = bucket ? getDelayField(bucket, p90Field) : null
                          const isEmpty = delaySec === null
                          const incidentCount = bucket?.incidentCount ?? 0
                          const label = isEmpty
                            ? `${dowLabel} ${hr}:00, no data`
                            : `${dowLabel} ${hr}:00, +${Math.round((delaySec ?? 0) / 60)} min delay${
                                incidentCount > 0
                                  ? `, ${incidentCount} incident${incidentCount > 1 ? 's' : ''}`
                                  : ''
                              }`

                          return (
                            <div
                              key={`${displayDow}-${hr}`}
                              className="rounded-sm cursor-crosshair transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 relative"
                              style={{
                                backgroundColor: delayToColor(delaySec),
                                outlineColor: 'var(--color-focus)',
                              }}
                              onMouseEnter={(e) =>
                                activateCell(displayDow, hr, e.clientX, e.clientY)
                              }
                              onMouseLeave={clearCell}
                              onFocus={(e) => {
                                const r = e.currentTarget.getBoundingClientRect()
                                activateCell(displayDow, hr, r.right, r.top)
                              }}
                              onBlur={clearCell}
                              tabIndex={0}
                              role="gridcell"
                              aria-label={label}
                            >
                              {incidentCount > 0 && (
                                <div
                                  className="absolute top-0.5 right-0.5 w-1 h-1 rounded-full"
                                  style={{ backgroundColor: 'var(--color-text-muted)', opacity: 0.5 }}
                                  aria-hidden="true"
                                />
                              )}
                            </div>
                          )
                        })}
                      </div>
                    ))}
                  </div>
                </div>

                <div
                  className="flex items-center justify-between text-xs"
                  style={{ color: 'var(--color-text-muted)' }}
                  aria-label="Delay color legend from fast to slow"
                >
                  <span>Fast</span>
                  <div className="flex gap-0.5" aria-hidden="true">
                    {[0, 1, 2, 3, 4].map((value) => (
                      <div
                        key={value}
                        className="w-6 h-4 rounded-sm"
                        style={{ backgroundColor: delayToColor(value * 75) }}
                      />
                    ))}
                  </div>
                  <span>Slow</span>
                </div>

                <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  <span>{reliability}% data coverage</span>
                  <span aria-hidden="true">·</span>
                  <span>Last 14 days</span>
                </div>
              </div>
            )}
          </div>

          {hoveredCell && selectedBuckets && (
            <div
              className="fixed z-50 px-2 py-1.5 rounded text-xs pointer-events-none shadow-lg"
              style={{
                backgroundColor: 'var(--color-surface-raised)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-text-primary)',
                left: tooltipPos.x + 12,
                top: tooltipPos.y - 8,
              }}
              aria-hidden="true"
            >
              {(() => {
                const displayDow = hoveredCell.dow
                const hr = hoveredCell.hr
                const sqlDow = displayToSqlDow(displayDow)
                const key = `${sqlDow}-${hr}`
                const bucket = selectedBuckets.get(key)
                if (!bucket) return `${DOW_LABELS[displayDow]} ${hr}:00 · No data`

                const p50Min = getDelayField(bucket, p50Field) !== null ? Math.round(getDelayField(bucket, p50Field)! / 60) : 'N/A'
                const p90Min = getDelayField(bucket, p90Field) !== null ? Math.round(getDelayField(bucket, p90Field)! / 60) : 'N/A'
                const incidentText = bucket.incidentCount > 0
                  ? ` · ${bucket.incidentCount} incident${bucket.incidentCount > 1 ? 's' : ''}`
                  : ''

                return (
                  <>
                    <div style={{ fontWeight: 600 }}>{DOW_LABELS[displayDow]} {hr}:00</div>
                    <div>P50: +{p50Min} min | P90: +{p90Min} min</div>
                    <div>{bucket.sampleCount} sample{bucket.sampleCount !== 1 ? 's' : ''}{incidentText}</div>
                  </>
                )
              })()}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
