import React, { useEffect, useMemo, useState } from 'react'
import Papa from 'papaparse'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts'

type LevelsProps = {
  /** CSV URL to fetch. Defaults to the Environment Agency station CSV for station 8208 */
  url?: string
  /** Height of the chart container (pixels if number, or any CSS height string) */
  height?: number | string
  /** Width of the chart container (pixels if number, or any CSS width string) */
  width?: number | string
}

type RawRow = {
  timestamp?: string
  height?: string
  type?: string
  [k: string]: any
}

type Point = {
  timestamp: number
  timestampIso: string
  observed?: number
  forecast?: number
}

const DEFAULT_URL =
  'https://check-for-flooding.service.gov.uk/station-csv/8208'

const DEFAULT_HEIGHT = 640
const DEFAULT_WIDTH = 1200

export default function Levels({ url = DEFAULT_URL, height = DEFAULT_HEIGHT, width = DEFAULT_WIDTH }: LevelsProps) {
  const [csvText, setCsvText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [points, setPoints] = useState<Point[]>([])
  const [lastRefresh, setLastRefresh] = useState<string | null>(null)
  const [cacheSize, setCacheSize] = useState<number | null>(null)

  const storageKey = `levels-cache:${url}`

  // Load cached points from localStorage on mount (or when URL changes).
  useEffect(() => {
    setError(null)
    try {
      const raw = localStorage.getItem(storageKey)
      if (raw) {
        const parsed = JSON.parse(raw) as Point[]
        if (Array.isArray(parsed) && parsed.length > 0) {
          setPoints(parsed)
        }
      }

      // Read meta (if present) so we can show last refresh and cache size
      const metaRaw = localStorage.getItem(`${storageKey}:meta`)
      if (metaRaw) {
        const meta = JSON.parse(metaRaw) as { lastRefresh?: string; count?: number; sizeBytes?: number }
        if (meta.lastRefresh) setLastRefresh(meta.lastRefresh)
        if (typeof meta.sizeBytes === 'number') setCacheSize(meta.sizeBytes)
      } else if (raw) {
        // If no meta but we have raw cache, compute approximate size and set it
        const size = typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(raw).length : raw.length
        setCacheSize(size)
      }
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.warn('Levels: failed to read cache', err)
    }

    // If no cached data, do an initial fetch to populate the cache once.
    const rawNow = localStorage.getItem(storageKey)
    if (!rawNow) {
      doRefresh()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url])

  const data: Point[] = useMemo(() => {
    // The display data comes from the in-memory cached points so it reflects
    // previous refreshes and merges. If you want to preview an unmerged
    // CSV, use the Refresh button.
    return points
  }, [points])

  // Parse CSV text into Point[] using the same header-detection logic
  const parseCsvToPoints = (text: string): Point[] => {
    const parsed = Papa.parse<RawRow>(text, {
      header: true,
      skipEmptyLines: true,
    })

    const headers = parsed.meta.fields ?? []
    const findHeader = (candidates: string[]) =>
      headers.find((h) => {
        const nh = (h || '').toLowerCase()
        return candidates.some((c) => nh.includes(c))
      })

    const keyTimestamp = findHeader(['timestamp', 'time', 'date'])
    const keyHeight = findHeader(['height', 'level'])
    const keyType = findHeader(['type'])

    // eslint-disable-next-line no-console
    console.debug('Levels: detected CSV headers ->', { keyTimestamp, keyHeight, keyType })

    const byTs = new Map<number, Point>()
    for (const row of parsed.data) {
      const t = (keyTimestamp && (row as any)[keyTimestamp]) ?? row.timestamp ?? row.date ?? row.time ?? row.Timestamp
      const h = (keyHeight && (row as any)[keyHeight]) ?? row.height ?? row.level ?? row.Height
      const type = ((keyType && ((row as any)[keyType] as string)) ?? row.type ?? row.Type ?? '').toString().trim().toLowerCase()

      if (!t || !h) continue
      const ts = Date.parse(t.toString())
      if (Number.isNaN(ts)) continue

      const height = parseFloat(h.toString())
      if (Number.isNaN(height)) continue

      const existing = byTs.get(ts) ?? { timestamp: ts, timestampIso: new Date(ts).toISOString() }
      if (type === 'observed') existing.observed = height
      else if (type === 'forecast') existing.forecast = height
      else {
        existing.observed = existing.observed ?? height
      }
      byTs.set(ts, existing)
    }

    return Array.from(byTs.values()).sort((a, b) => a.timestamp - b.timestamp)
  }

  const saveCache = (pts: Point[]) => {
    try {
      const json = JSON.stringify(pts)
      localStorage.setItem(storageKey, json)

      // Update meta: last refresh timestamp, count and size in bytes
      const size = typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(json).length : json.length
      const meta = { lastRefresh: new Date().toISOString(), count: pts.length, sizeBytes: size }
      try {
        localStorage.setItem(`${storageKey}:meta`, JSON.stringify(meta))
      } catch (err: any) {
        // eslint-disable-next-line no-console
        console.warn('Levels: failed to save cache meta', err)
      }
      setLastRefresh(meta.lastRefresh)
      setCacheSize(meta.sizeBytes)
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.warn('Levels: failed to save cache', err)
    }
  }

  const mergePoints = (existing: Point[], incoming: Point[]) => {
    const map = new Map<number, Point>()
    for (const p of existing) map.set(p.timestamp, { ...p })

    for (const inc of incoming) {
      const ts = inc.timestamp
      const cur = map.get(ts) ?? { timestamp: ts, timestampIso: inc.timestampIso }

      // If incoming has observed, prefer it and remove any forecast-only value
      if (inc.observed !== undefined) {
        cur.observed = inc.observed
        // Replace data that was simply forecast
        if (cur.forecast !== undefined) delete cur.forecast
      }

      // If incoming has forecast, add it unless observed already exists and
      // we prefer observed to supersede forecast; it's OK to keep both fields
      if (inc.forecast !== undefined) {
        if (cur.observed === undefined) cur.forecast = inc.forecast
        else cur.forecast = cur.forecast ?? inc.forecast
      }

      map.set(ts, cur)
    }

    const out = Array.from(map.values()).sort((a, b) => a.timestamp - b.timestamp)
    return out
  }

  // Refresh action: fetch CSV from server and merge into local cache
  async function doRefresh() {
    setRefreshing(true)
    setError(null)
    try {
      const r = await fetch(url)
      if (!r.ok) throw new Error(`Failed to fetch CSV: ${r.status}`)
      const text = await r.text()
      setCsvText(text)

      const incoming = parseCsvToPoints(text)
      // Use functional update to ensure we merge with the latest `points`
      setPoints((prev) => {
        const merged = mergePoints(prev, incoming)
        saveCache(merged)
        return merged
      })
    } catch (err: any) {
      setError(String(err))
    } finally {
      setRefreshing(false)
      setLoading(false)
    }
  }

  if (loading) return <div>Loading levels…</div>
  if (error) return <div style={{ color: 'red' }}>Error loading CSV: {error}</div>
  if (data.length === 0) return (
    <div>
      <div>No data (CSV may be empty or in an unexpected format)</div>
      <div style={{ marginTop: 8 }}>
        <button onClick={() => doRefresh()} disabled={refreshing}>{refreshing ? 'Refreshing…' : 'Refresh from server'}</button>
      </div>
    </div>
  )

  const cssHeight = typeof height === 'number' ? `${height}px` : height
  const cssWidth = typeof width === 'number' ? `${width}px` : width

  const fmtLastRefresh = lastRefresh ? new Date(lastRefresh).toLocaleString() : 'never'
  const fmtCacheSize = cacheSize && cacheSize > 0 ? `${Math.round(cacheSize / 1024)} KB` : '0 KB'

  return (
    <div style={{ width: cssWidth, height: cssHeight }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div>
          Showing <strong>{data.length}</strong> timestamps • Last refresh: <strong>{fmtLastRefresh}</strong> • Cache: <strong>{fmtCacheSize}</strong>
        </div>
        <div>
          <button onClick={() => doRefresh()} disabled={refreshing} style={{ marginRight: 8 }}>{refreshing ? 'Refreshing…' : 'Refresh from server'}</button>
        </div>
      </div>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 20, right: 30, left: 10, bottom: 20 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="timestamp"
            type="number"
            domain={["dataMin", "dataMax"]}
            tickFormatter={(ts) => new Date(ts as number).toLocaleString()}
            scale="time"
          />
          <YAxis
            dataKey={(d: Point) => (d.observed ?? d.forecast) as number}
            domain={["auto", "auto"]}
            allowDataOverflow={false}
          />
          <Tooltip
            labelFormatter={(label) => new Date(label as number).toLocaleString()}
            formatter={(value: any, name: string) => [value, name]}
          />
          <Legend />

          <Line
            dataKey="observed"
            name="Observed"
            stroke="#2563EB"
            dot={false}
            isAnimationActive={false}
            strokeWidth={2}
          />
          <Line
            dataKey="forecast"
            name="Forecast"
            stroke="#F59E0B"
            dot={false}
            isAnimationActive={false}
            strokeWidth={2}
            strokeDasharray="6 6"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
