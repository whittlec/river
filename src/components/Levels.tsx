import { useEffect, useMemo, useState } from 'react'
import Papa from 'papaparse'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts'
import styles from './Levels.module.css'

type LevelsProps = {
  /** CSV URL to fetch. Defaults to the Environment Agency station CSV for station 8208 */
  url?: string
  /** Height of the chart container (pixels if number, or any CSS height string) */
  height?: number | string
  /** Width of the chart container (pixels if number, or any CSS width string) */
  width?: number | string
  /** Safe rowing level in metres. Values above this are considered unsafe to row. Default: 1.9 */
  safeLevel?: number
}

type RawRow = {
  timestamp?: string
  height?: string
  type?: string
  [k: string]: string | undefined
}

type Point = {
  timestamp: number
  timestampIso: string
  observed?: number
  forecast?: number
}

const DEFAULT_URL =
  'https://check-for-flooding.service.gov.uk/station-csv/8208'

const DEFAULT_SAFE_LEVEL = 1.9
const MS_PER_DAY = 24 * 60 * 60 * 1000
const ONE_YEAR_MS = 365 * MS_PER_DAY
const TWO_WEEKS_MS = 14 * MS_PER_DAY
const PRESETS: { label: string; ms: number }[] = [
  { label: '1d', ms: 1 * MS_PER_DAY },
  { label: '7d', ms: 7 * MS_PER_DAY },
  { label: '14d', ms: TWO_WEEKS_MS },
  { label: '30d', ms: 30 * MS_PER_DAY },
  { label: 'All', ms: Infinity },
]

export default function Levels({ url = DEFAULT_URL, safeLevel = DEFAULT_SAFE_LEVEL }: LevelsProps) {
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [points, setPoints] = useState<Point[]>([])
  const [lastRefresh, setLastRefresh] = useState<string | null>(null)
  const [cacheSize, setCacheSize] = useState<number | null>(null)
  const [displayWindowMs, setDisplayWindowMs] = useState<number>(TWO_WEEKS_MS)

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
    } catch (err: unknown) {
      console.warn('Levels: failed to read cache', err)
    }

    // If no cached data, do an initial fetch to populate the cache once.
    const rawNow = localStorage.getItem(storageKey)
    if (!rawNow) doRefresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url])

  const data: Point[] = useMemo(() => {
    // Show only the selected display window in the chart UI; keep up to a
    // year's data in cache.
    if (!isFinite(displayWindowMs)) return points
    const cutoff = Date.now() - displayWindowMs
    return points.filter((p) => p.timestamp >= cutoff)
  }, [points, displayWindowMs])

  // Latest measurement (from full cache) — used to determine safe/unsafe status
  // Use the latest *observed* measurement to decide safe/unsafe.
  // Forecasts should not be used for safety decisions.
  const latestObservedPoint = useMemo(() => {
    const observed = points.filter((p) => typeof p.observed === 'number')
    if (observed.length === 0) return null
    return observed.reduce((a, b) => (a.timestamp > b.timestamp ? a : b))
  }, [points])

  const latestObservedValue = latestObservedPoint ? (latestObservedPoint.observed ?? null) : null
  const isUnsafe = typeof latestObservedValue === 'number' ? latestObservedValue > safeLevel : false
  const statusText = latestObservedValue === null ? 'No recent observed measurement' : (isUnsafe ? `Unsafe to row (${latestObservedValue.toFixed(2)} m)` : `Safe to row (${latestObservedValue.toFixed(2)} m)`)

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

    console.debug('Levels: detected CSV headers ->', { keyTimestamp, keyHeight, keyType })

    const byTs = new Map<number, Point>()
    for (const row of parsed.data) {
      const r = row as Record<string, string | undefined>
      const t = (keyTimestamp && r[keyTimestamp]) ?? row.timestamp ?? row.date ?? row.time ?? row.Timestamp
      const h = (keyHeight && r[keyHeight]) ?? row.height ?? row.level ?? row.Height
      const type = ((keyType && (r[keyType] as string | undefined)) ?? row.type ?? row.Type ?? '').toString().trim().toLowerCase()

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

  const prunePoints = (pts: Point[], maxAgeMs: number) => {
    const cutoff = Date.now() - maxAgeMs
    return pts.filter((p) => p.timestamp >= cutoff)
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
      } catch (err: unknown) {
        console.warn('Levels: failed to save cache meta', err)
      }
      setLastRefresh(meta.lastRefresh)
      setCacheSize(meta.sizeBytes)
    } catch (err: unknown) {
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

      const incoming = parseCsvToPoints(text)
      // Use functional update to ensure we merge with the latest `points`.
      // After merging, prune to keep at most one year's worth of data.
      setPoints((prev) => {
        const merged = mergePoints(prev, incoming)
        const pruned = prunePoints(merged, ONE_YEAR_MS)
        saveCache(pruned)
        return pruned
      })
    } catch (err: unknown) {
      setError(String(err))
    } finally {
      setRefreshing(false)
      setLoading(false)
    }
  }

  if (loading) return <div>Loading levels…</div>
  if (error) return <div className={styles.emptyState} aria-live="assertive">Error loading CSV: <strong className={styles.errorText}>{error}</strong></div>
  if (data.length === 0) return (
    <div className={styles.emptyState}>
      <div>No data (CSV may be empty or in an unexpected format)</div>
      <div className={styles.emptyState}>
        <button onClick={() => doRefresh()} disabled={refreshing}>{refreshing ? 'Refreshing…' : 'Refresh from server'}</button>
      </div>
    </div>
  )

  // For app usage we use CSS to size the component; props are optional

  const fmtLastRefresh = lastRefresh ? new Date(lastRefresh).toLocaleString() : 'never'
  const fmtCacheSize = cacheSize && cacheSize > 0 ? `${Math.round(cacheSize / 1024)} KB` : '0 KB'

  const currentWindowLabel = PRESETS.find((p) => p.ms === displayWindowMs)?.label ?? (isFinite(displayWindowMs) ? `${Math.round(displayWindowMs / MS_PER_DAY)}d` : 'All')

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.leftGroup}>
          <div className={styles.statusRow}>
            <span aria-hidden className={`${styles.statusDot} ${isUnsafe ? styles.unsafe : styles.safe}`} />
            <span className={styles.statusText}>{statusText}</span>
          </div>
          <div className={styles.info}>
            Showing <strong>{data.length}</strong> timestamps (window: <strong>{currentWindowLabel}</strong>) • Last refresh: <strong>{fmtLastRefresh}</strong> • Cache: <strong>{fmtCacheSize}</strong>
          </div>
        </div>
        <div className={styles.rightGroup}>
          <div className={styles.presetList} role="tablist" aria-label="Display window">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                role="tab"
                onClick={() => setDisplayWindowMs(p.ms)}
                tabIndex={0}
                className={`${styles.presetButton} ${p.ms === displayWindowMs ? styles.presetButtonActive : ''}`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <button onClick={() => doRefresh()} disabled={refreshing} className={styles.refreshButton}>{refreshing ? 'Refreshing…' : 'Refresh from server'}</button>
        </div>
      </div>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 20, right: 30, left: 10, bottom: 20 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <ReferenceLine
            y={safeLevel}
            stroke="#0f9d58"
            strokeDasharray="4 4"
            label={{ position: 'right', value: `Safe rowing level (${safeLevel} m)` }}
          />
          <XAxis
            dataKey="timestamp"
            type="number"
            domain={["dataMin", "dataMax"]}
            tickFormatter={(ts) => new Date(ts as number).toLocaleString()}
            scale="time"
          />
          <YAxis
            dataKey={(d: Point) => (d.observed ?? d.forecast) as number}
            domain={[0, 'auto']}
            allowDataOverflow={false}
          />
          <Tooltip
            labelFormatter={(label) => new Date(label as number).toLocaleString()}
            formatter={(value: number | string | undefined, name?: string | undefined) => [value ?? '', name ?? '']}
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
