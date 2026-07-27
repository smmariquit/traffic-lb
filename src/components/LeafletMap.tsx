import { useEffect, useRef, useState } from 'react'
import maplibregl, { Map as MapLibreMap } from 'maplibre-gl'
import type { LayerSpecification, StyleSpecification } from 'maplibre-gl'
import { CORRIDOR_ENDPOINTS } from '../lib/route'
import { CORRIDORS, CORRIDOR_COLORS } from '../lib/types'
import type { CorridorDirection } from '../lib/types'
import 'maplibre-gl/dist/maplibre-gl.css'

// Decode "lat,lng;lat,lng;..." polyline into [lng,lat][] for MapLibre
function decodePolyline(raw: string): [number, number][] {
  return raw.split(';').map(pair => {
    const [lat, lng] = pair.split(',').map(Number)
    return [lng, lat]
  })
}

// Build GeoJSON route sources and line layers from corridor data
function buildRouteSources(corridors?: Record<string, CorridorDirection>): Record<string, { type: 'geojson'; data: GeoJSON.FeatureCollection }> {
  if (!corridors) return {}
  const sources: Record<string, { type: 'geojson'; data: GeoJSON.FeatureCollection }> = {}
  for (const { id } of CORRIDORS) {
    const fwd = corridors[`${id}_f`]
    const rev = corridors[`${id}_r`]
    const fwdCoords = fwd?.routePolyline ? decodePolyline(fwd.routePolyline) : null
    const revCoords = rev?.routePolyline ? decodePolyline(rev.routePolyline) : null
    // Merge both directions into one source for the corridor
    const features: GeoJSON.Feature<GeoJSON.LineString, { dir: string }>[] = []
    if (fwdCoords) features.push({ type: 'Feature', properties: { dir: 'f' }, geometry: { type: 'LineString', coordinates: fwdCoords } })
    if (revCoords) features.push({ type: 'Feature', properties: { dir: 'r' }, geometry: { type: 'LineString', coordinates: revCoords } })
    if (features.length > 0) {
      sources[`route-${id}`] = { type: 'geojson', data: { type: 'FeatureCollection', features } }
    }
  }
  return sources
}

function buildRouteLayers(corridors: Record<string, CorridorDirection> | undefined, dark: boolean): StyleSpecification['layers'] {
  if (!corridors) return []
  const layers: NonNullable<StyleSpecification['layers']> = []
  for (const { id } of CORRIDORS) {
    if (!corridors[`${id}_f`]?.routePolyline && !corridors[`${id}_r`]?.routePolyline) continue
    layers.push({
      id: `route-line-${id}`,
      type: 'line' as const,
      source: `route-${id}`,
      layout: { 'line-join': 'round' as const, 'line-cap': 'round' as const },
      paint: {
        'line-color': CORRIDOR_COLORS[id] ?? '#6b7280',
        'line-width': ['interpolate', ['linear'], ['zoom'], 13, 2, 14, 3.5, 15, 5],
        'line-opacity': dark ? 0.6 : 0.5,
        'line-dasharray': [2, 1],
      },
    })
  }
  return layers
}

// Bounds covering all corridor endpoints with padding
const ALL_BOUNDS = CORRIDOR_ENDPOINTS.reduce(
  (bounds, { lat, lng }) => bounds.extend([lng, lat]),
  new maplibregl.LngLatBounds()
)

const PADDED_BOUNDS = new maplibregl.LngLatBounds([
  ALL_BOUNDS.getSouthWest().toArray(),
  ALL_BOUNDS.getNorthEast().toArray(),
])
const latSpan = PADDED_BOUNDS.getNorth() - PADDED_BOUNDS.getSouth()
const lngSpan = PADDED_BOUNDS.getEast() - PADDED_BOUNDS.getWest()
PADDED_BOUNDS.setSouthWest([
  PADDED_BOUNDS.getWest() - lngSpan * 0.15,
  PADDED_BOUNDS.getSouth() - latSpan * 0.15,
])
PADDED_BOUNDS.setNorthEast([
  PADDED_BOUNDS.getEast() + lngSpan * 0.15,
  PADDED_BOUNDS.getNorth() + latSpan * 0.15,
])

interface LeafletMapProps {
  corridors?: Record<string, CorridorDirection>
  flyTo?: { lat: number; lng: number } | null
}

export default function LeafletMap({ corridors, flyTo: flyTarget }: LeafletMapProps = {}) {
  const mapContainer = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const [dark, setDark] = useState(false)

  useEffect(() => {
    const isDark = document.documentElement.classList.contains('dark')
    setDark(isDark)

    const observer = new MutationObserver(() => {
      setDark(document.documentElement.classList.contains('dark'))
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: 'https://demotiles.maplibre.org/style.json',
      center: [121.218, 14.177],
      zoom: 14,
      minZoom: 12,
      maxZoom: 18,
      maxBounds: [
        [PADDED_BOUNDS.getWest(), PADDED_BOUNDS.getSouth()],
        [PADDED_BOUNDS.getEast(), PADDED_BOUNDS.getNorth()],
      ],
    })

    mapRef.current = map
    map.on('load', () => map.fitBounds(ALL_BOUNDS, { padding: 30 }))

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!mapRef.current) return

    const map = mapRef.current
    const tomtomKey = import.meta.env.VITE_TOMTOM_API_KEY

    ;(async () => {
      // Load official TomTom incident style: geometry layers + POI icon layers
      let incidentLayers: StyleSpecification['layers'] = []
      let incidentSprite = ''
      let incidentGlyphs = ''
      if (tomtomKey) {
        const variant = dark ? 'incidents_dark' : 'incidents_day'
        const resp = await fetch(`https://api.tomtom.com/traffic/map/4/style/22.*/${variant}.json?key=${tomtomKey}`)
        if (resp.ok) {
          const official = await resp.json()
          incidentLayers = official.layers
            .map((l: StyleSpecification['layers'][number]) => ({ ...l, source: 'tomtom-incidents' }))
          incidentSprite = official.sprite ?? ''
          incidentGlyphs = official.glyphs ?? ''
        }
      }

      // Generate pin icon as RGBA for map style
      const pinSize = 32
      const pinCanvas = document.createElement('canvas')
      pinCanvas.width = pinSize
      pinCanvas.height = pinSize + 12
      const ctx = pinCanvas.getContext('2d')!
      // Pin body
      ctx.beginPath()
      ctx.arc(pinSize / 2, pinSize / 2 - 2, 10, Math.PI * 0.15, Math.PI * 0.85, true)
      ctx.lineTo(pinSize / 2, pinSize + 10)
      ctx.closePath()
      ctx.fillStyle = '#3b82f6'
      ctx.fill()
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 2
      ctx.stroke()
      // Inner dot
      ctx.beginPath()
      ctx.arc(pinSize / 2, pinSize / 2 - 2, 4, 0, Math.PI * 2)
      ctx.fillStyle = '#ffffff'
      ctx.fill()
      const pinImage = ctx.getImageData(0, 0, pinCanvas.width, pinCanvas.height)

      const style: StyleSpecification = {
        version: 8,
        ...(incidentSprite ? { sprite: incidentSprite } : {}),
        ...(incidentGlyphs ? { glyphs: incidentGlyphs } : {}),
        sources: {
          'carto-base': {
            type: 'raster',
            tiles: [dark ? 'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png' : 'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png'],
            tileSize: 256,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
          },
          ...(tomtomKey ? {
            'tomtom-flow': {
              type: 'vector',
              tiles: [`https://api.tomtom.com/traffic/map/4/tile/flow/relative/{z}/{x}/{y}.pbf?key=${tomtomKey}&tags=[traffic_level,traffic_road_coverage,road_type]`],
              minzoom: 0,
              maxzoom: 22,
            },
            'tomtom-incidents': {
              type: 'vector',
              tiles: [`https://api.tomtom.com/traffic/map/4/tile/incidents/{z}/{x}/{y}.pbf?key=${tomtomKey}`],
              minzoom: 0,
              maxzoom: 22,
            },
          } : {}),
          'waypoints': {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: CORRIDOR_ENDPOINTS.map(({ lat, lng, label }) => ({ type: 'Feature', properties: { label }, geometry: { type: 'Point', coordinates: [lng, lat] } })) },
          },
          ...buildRouteSources(corridors),
        },
        layers: [
          { id: 'carto-base', type: 'raster', source: 'carto-base', minzoom: 0, maxzoom: 22 },
          ...(tomtomKey ? [
            {
              id: 'tomtom-flow-forward',
              type: 'line',
              source: 'tomtom-flow',
              'source-layer': 'Traffic flow',
              filter: ['==', ['get', 'traffic_road_coverage'], 'one_side'],
              layout: { 'line-join': 'round', 'line-cap': 'round' },
              paint: {
                'line-color': ['interpolate', ['linear'], ['to-number', ['get', 'traffic_level']], 0, '#ef4444', 0.25, '#f97316', 0.5, '#eab308', 0.75, '#84cc16', 1, '#22c55e'],
                'line-width': ['interpolate', ['linear'], ['zoom'], 13, 2, 14, 3.5, 15, 5],
                'line-offset': ['interpolate', ['linear'], ['zoom'], 13, 2, 14, 3, 15, 4],
                'line-opacity': dark ? 0.9 : 0.8,
              },
            },
            {
              id: 'tomtom-flow-reverse',
              type: 'line',
              source: 'tomtom-flow',
              'source-layer': 'Traffic flow',
              filter: ['==', ['get', 'traffic_road_coverage'], 'one_side'],
              layout: { 'line-join': 'round', 'line-cap': 'round' },
              paint: {
                'line-color': ['interpolate', ['linear'], ['to-number', ['get', 'traffic_level']], 0, '#ef4444', 0.25, '#f97316', 0.5, '#eab308', 0.75, '#84cc16', 1, '#22c55e'],
                'line-width': ['interpolate', ['linear'], ['zoom'], 13, 2, 14, 3.5, 15, 5],
                'line-offset': ['interpolate', ['linear'], ['zoom'], 13, -2, 14, -3, 15, -4],
                'line-opacity': dark ? 0.9 : 0.8,
              },
            },
            {
              id: 'tomtom-flow-full',
              type: 'line',
              source: 'tomtom-flow',
              'source-layer': 'Traffic flow',
              filter: ['!=', ['get', 'traffic_road_coverage'], 'one_side'],
              layout: { 'line-join': 'round', 'line-cap': 'round' },
              paint: {
                'line-color': ['interpolate', ['linear'], ['to-number', ['get', 'traffic_level']], 0, '#ef4444', 0.25, '#f97316', 0.5, '#eab308', 0.75, '#84cc16', 1, '#22c55e'],
                'line-width': ['interpolate', ['linear'], ['zoom'], 13, 2, 14, 4, 15, 6],
                'line-opacity': dark ? 0.9 : 0.8,
              },
            },
          ] as LayerSpecification[] : []),
          // Route lines from TomTom routing
          ...buildRouteLayers(corridors, dark),
          {
            id: 'waypoint-pins',
            type: 'symbol' as const,
            source: 'waypoints',
            layout: {
              'icon-image': 'pin',
              'icon-size': 0.9,
              'icon-anchor': 'bottom' as const,
              'icon-allow-overlap': true,
              'text-field': ['get', 'label'],
              'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
              'text-size': 12,
              'text-anchor': 'top' as const,
              'text-offset': [0, 0.2],
              'text-optional': true,
            },
            paint: {
              'text-color': dark ? '#ffffff' : '#1e293b',
              'text-halo-color': dark ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.8)',
              'text-halo-width': 2,
            },
          },
          ...(tomtomKey ? incidentLayers : []),
        ],
      }

      map.setStyle(style)
      map.once('styledata', () => {
        if (!map.hasImage('pin')) {
          map.addImage('pin', pinImage as unknown as Parameters<MapLibreMap['addImage']>[1])
        }
        if (map.isStyleLoaded()) map.fitBounds(ALL_BOUNDS, { padding: 30 })
      })
    })()
  }, [dark, corridors])

  // Fly to incident when clicked
  useEffect(() => {
    if (!flyTarget || !mapRef.current) return
    mapRef.current.flyTo({ center: [flyTarget.lng, flyTarget.lat], zoom: 16 })
  }, [flyTarget])

  return (
    <div
      ref={mapContainer}
      className="w-full h-full"
      role="application"
      aria-label="Los Baños traffic route map. Use two-finger scroll or map controls to pan and zoom. Corridor colors show congestion: green light, yellow moderate, orange heavy, red severe."
      style={{ height: '100%', width: '100%' }}
    />
  )
}
