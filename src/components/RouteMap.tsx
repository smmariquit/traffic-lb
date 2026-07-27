import { Map } from 'lucide-react'
import { lazy, Suspense } from 'react'
import type { CorridorDirection } from '../lib/types'

const LeafletMap = lazy(() => import('./LeafletMap'))

interface RouteMapProps {
  corridors?: Record<string, CorridorDirection>
  flyTo?: { lat: number; lng: number } | null
}

export function RouteMap({ corridors, flyTo }: RouteMapProps) {
  return (
    <div className="card p-4 overflow-hidden">
      <h2 className="text-xs font-semibold uppercase tracking-wider mb-3 flex items-center gap-1.5" style={{ color: 'var(--color-text-muted)' }}>
        <Map size={12} aria-hidden="true" />
        Route Map
      </h2>
      <div className="w-full h-[220px] sm:h-[320px] lg:h-[400px] rounded-lg overflow-hidden">
        <Suspense fallback={
          <div
            role="status"
            aria-live="polite"
            className="w-full h-full flex items-center justify-center text-sm"
            style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text-muted)' }}
          >
            Loading map…
          </div>
        }>
          <LeafletMap corridors={corridors} flyTo={flyTo} />
        </Suspense>
      </div>
    </div>
  )
}
