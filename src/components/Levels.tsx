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
  ReferenceArea,
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

// York, UK
const DEFAULT_LAT = 53.9614
const DEFAULT_LON = -1.0739

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

export default function Levels({ url = DEFAULT_URL, safeLevel = DEFAULT_SAFE_LEVEL, width, height }: LevelsProps) {
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [runtimeError, setRuntimeError] = useState<string | null>(null)
  const [points, setPoints] = useState<Point[]>([])
  const [lastRefresh, setLastRefresh] = useState<string | null>(null)
  const [displayWindowMs, setDisplayWindowMs] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('levels-display-window')
      if (saved !== null) {
        const parsed = Number(saved)
        if (!Number.isNaN(parsed)) return parsed
      }
    } catch (e) {
      console.warn('Levels: failed to read display window preference', e)
    }
    return TWO_WEEKS_MS
  })

  useEffect(() => {
    try {
      localStorage.setItem('levels-display-window', String(displayWindowMs))
    } catch (e) {
      console.warn('Levels: failed to save display window preference', e)
    }
  }, [displayWindowMs])

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
      }
    } catch (err: unknown) {
      console.warn('Levels: failed to read cache', err)
    }

    // If no cached data, do an initial fetch to populate the cache once.
    const rawNow = localStorage.getItem(storageKey)
    if (!rawNow) doRefresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url])

  // Capture runtime errors so they are visible in the UI for debugging
  useEffect(() => {
    const onError = (ev: ErrorEvent) => {
      const msg = `${ev.message} at ${ev.filename}:${ev.lineno}:${ev.colno}`
      console.error('Levels runtime error:', msg)
      setRuntimeError(msg)
    }
    const onRejection = (ev: PromiseRejectionEvent) => {
      const reason = ev.reason ? (ev.reason.stack || ev.reason.message || String(ev.reason)) : 'Unknown'
      const msg = `UnhandledRejection: ${reason}`
      console.error('Levels unhandled rejection:', msg)
      setRuntimeError(msg)
    }
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection as any)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection as any)
    }
  }, [])

  const data: Point[] = useMemo(() => {
    // Show only the selected display window in the chart UI; keep up to a
    // year's data in cache.
    if (!isFinite(displayWindowMs)) return points
    const cutoff = Date.now() - displayWindowMs
    return points.filter((p) => p.timestamp >= cutoff)
  }, [points, displayWindowMs])

  // Compute one tick per day (UTC midnight) for the X axis from the visible data
  const dailyTicks = useMemo(() => {
    if (!data || data.length === 0) return [] as number[]
    const first = data[0].timestamp
    const last = data[data.length - 1].timestamp

    // Find UTC midnight at or before `first`
    const startDate = new Date(first)
    let cur = Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate())

    // If the first data point is after the midnight we included, keep that midnight
    // If the data point is earlier than that midnight (unlikely), step back one day
    if (cur > first) cur -= MS_PER_DAY

    const ticks: number[] = []
    // Guard against pathological ranges by limiting to 366 days
    let guard = 0
    while (cur <= last && guard < 366) {
      ticks.push(cur)
      cur += MS_PER_DAY
      guard++
    }
    // Ensure last tick covers the end of the domain if nothing landed exactly on it
    if (ticks.length === 0) ticks.push(first)
    return ticks
  }, [data])

  // Y axis ticks at 0.5 increments based on visible data range (min 0)
  const yTicks = useMemo(() => {
    const vals: number[] = []
    for (const p of data) {
      if (typeof p.observed === 'number') vals.push(p.observed)
      if (typeof p.forecast === 'number') vals.push(p.forecast)
    }
    const maxVal = vals.length > 0 ? Math.max(...vals) : safeLevel
    const minTick = 0
    const maxTick = Math.ceil((maxVal ?? DEFAULT_SAFE_LEVEL) * 2) / 2
    const ticks: number[] = []
    for (let v = minTick; v <= maxTick + 1e-9; v += 0.5) {
      ticks.push(Number(v.toFixed(2)))
      if (ticks.length > 200) break
    }
    if (ticks.length === 1) ticks.push(ticks[0] + 0.5)
    return ticks
  }, [data, safeLevel])

  // Calculate weekend ranges for background shading
  const weekendAreas = useMemo(() => {
    if (data.length === 0) return []
    const first = data[0].timestamp
    const last = data[data.length - 1].timestamp

    // Start searching from a week before the first point to catch overlapping weekends
    const startDate = new Date(first)
    let cur = Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate()) - 7 * MS_PER_DAY

    const areas: { x1: number; x2: number }[] = []
    while (cur <= last) {
      if (new Date(cur).getUTCDay() === 6) { // Saturday
        const end = cur + 2 * MS_PER_DAY // Monday
        // The weekend interval [cur, end) overlaps with the data interval [first, last]
        // if the weekend starts before or at the same time the data ends, AND
        // the weekend ends after the data starts. This correctly shades partial weekends.
        if (cur <= last && end > first) {
          areas.push({ x1: cur, x2: end });
        }
      }
      cur += MS_PER_DAY
    }
    return areas
  }, [data])

  // Calculate daylight ranges for background shading
  const daylightAreas = useMemo(() => {
    if (data.length === 0) return []
    const first = data[0].timestamp
    const last = data[data.length - 1].timestamp

    const areas: { x1: number; x2: number }[] = []
    const startDate = new Date(first)
    let cur = Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate()) - MS_PER_DAY

    while (cur <= last) {
      const times = getSunTimes(cur, DEFAULT_LAT, DEFAULT_LON)
      if (times) {
        const { sunrise, sunset } = times
        if (sunset > first && sunrise < last) {
          areas.push({ x1: sunrise, x2: sunset })
        }
      }
      cur += MS_PER_DAY
    }
    return areas
  }, [data])

  // Determine status based on the value closest to the current time.
  // Uses observed or forecast data, whichever is available and closest to now.
  const currentStatusPoint = useMemo(() => {
    if (points.length === 0) return null
    const now = Date.now()
    // Find the point closest to now
    const closest = points.reduce((prev, curr) =>
      Math.abs(curr.timestamp - now) < Math.abs(prev.timestamp - now) ? curr : prev
    )
    // If the closest point is more than 4 hours away, consider data for "now" as missing
    if (Math.abs(closest.timestamp - now) > 4 * 60 * 60 * 1000) return null
    return closest
  }, [points])

  const currentStatusValue = currentStatusPoint ? (currentStatusPoint.observed ?? currentStatusPoint.forecast ?? null) : null
  const isUnsafe = typeof currentStatusValue === 'number' ? currentStatusValue > safeLevel : false
  const statusText = currentStatusValue === null
    ? 'Unknown'
    : (isUnsafe ? `Unsafe to row (${currentStatusValue.toFixed(2)} m)` : `Safe to row (${currentStatusValue.toFixed(2)} m)`)

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

  const downloadCsv = () => {
    if (points.length === 0) return
    const rows = ['Timestamp (UTC),Height (m),Type(observed/forecast)']
    for (const p of points) {
      if (p.observed !== undefined) rows.push(`${p.timestampIso},${p.observed},observed`)
      if (p.forecast !== undefined) rows.push(`${p.timestampIso},${p.forecast},forecast`)
    }
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'river-levels.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  if (loading) return <div>Loading levels…</div>
  if (error) return <div className={styles.emptyState} aria-live="assertive">Error loading CSV: <strong className={styles.errorText}>{error}</strong></div>
  if (data.length === 0) return (
    <div className={styles.emptyState}>
      <div>No data (CSV may be empty or in an unexpected format)</div>
      <div className={styles.emptyState}>
        <button onClick={() => doRefresh()} disabled={refreshing}>{refreshing ? 'Updating…' : 'Update'}</button>
      </div>
    </div>
  )

  // For app usage we use CSS to size the component; props are optional

  const fmtLastRefresh = lastRefresh ? new Date(lastRefresh).toLocaleString() : 'never'

  // Custom tooltip: show observed/forecast values for the hovered point and
  // whether that point (value) is safe to row relative to the `safeLevel`.
  function CustomTooltip({ active, payload, label, safeLevel }: any & { safeLevel: number }) {
    if (!active || !payload || payload.length === 0) return null
    const point: Point = payload[0].payload
    const ts = (label as number) ?? point.timestamp
    const dateStr = new Date(ts).toLocaleString()
    const obs = typeof point.observed === 'number' ? point.observed : null
    const fc = typeof point.forecast === 'number' ? point.forecast : null
    const val = obs ?? fc ?? null
    const isPointUnsafe = typeof val === 'number' ? val > safeLevel : null

    return (
      <div className={styles.tooltipBox}>
        <div className={styles.tooltipRow}><strong>{dateStr}</strong></div>
        {obs !== null && <div className={styles.tooltipRow}>Observed: <strong>{obs.toFixed(2)} m</strong></div>}
        {fc !== null && <div className={styles.tooltipRow}>Forecast: <strong>{fc.toFixed(2)} m</strong></div>}
        {val === null ? (
          <div className={styles.tooltipRow}>No measurement</div>
        ) : (
          <div className={styles.tooltipRow}>
            <span aria-hidden className={`${styles.statusDot} ${isPointUnsafe ? styles.unsafe : styles.safe}`} />
            <span>{isPointUnsafe ? `Unsafe to row (${val.toFixed(2)} m)` : `Safe to row (${val.toFixed(2)} m)`}</span>
          </div>
        )}
      </div>
    )
  }

  // Y axis ticks at 0.5 increments based on visible data range (min 0)
  

  return (
    <div className={styles.container} style={{ width, height }}>
      <style>{`
        @keyframes levels-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
      <div className={styles.header}>
        <div className={styles.leftGroup}>
          <div className={styles.statusRow}>
            <span aria-hidden className={`${styles.statusDot} ${isUnsafe ? styles.unsafe : styles.safe}`} />
            <span className={styles.statusText}>{statusText}</span>
          </div>
          {runtimeError && (
            <div role="alert" className={styles.runtimeError}>
              Runtime error: <strong>{runtimeError}</strong>
            </div>
          )}
          <div className={styles.info}>
            Last refresh: <strong>{fmtLastRefresh}</strong>
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
          <button onClick={downloadCsv} disabled={points.length === 0} title="Export CSV" aria-label="Export CSV">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" style={{ width: '1.2em', height: '1.2em' }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
          </button>
          <button
            onClick={() => doRefresh()}
            disabled={refreshing}
            className={styles.refreshButton}
            title={refreshing ? 'Updating…' : 'Update'}
            aria-label={refreshing ? 'Updating…' : 'Update'}
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" style={{ width: '1.2em', height: '1.2em', animation: refreshing ? 'levels-spin 1s linear infinite' : 'none' }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
            </svg>
          </button>
        </div>
      </div>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 20, right: 5, left: 0, bottom: 20 }}>
          {daylightAreas.map((area) => (
            <ReferenceArea key={area.x1} x1={area.x1} x2={area.x2} fill="#fcd34d" fillOpacity={0.15} />
          ))}
          {weekendAreas.map((area) => (
            <ReferenceArea key={area.x1} x1={area.x1} x2={area.x2} fill="#e5e7eb" fillOpacity={0.3} />
          ))}
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
            ticks={dailyTicks}
            tickFormatter={(ts) => new Date(ts as number).toLocaleDateString()}
            scale="time"
          />
          <YAxis
            dataKey={(d: Point) => (d.observed ?? d.forecast) as number}
            domain={[0, 'auto']}
            ticks={yTicks}
            allowDataOverflow={false}
            width={40}
          />
          <Tooltip content={(props) => <CustomTooltip {...props} safeLevel={safeLevel} />} />
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

/**
 * Calculates sunrise and sunset for a given date and location.
 * @param dateMs Timestamp for the day (any time during the day)
 * @param lat Latitude in decimal degrees
 * @param lng Longitude in decimal degrees (negative for West)
 */
function getSunTimes(dateMs: number, lat: number, lng: number) {
  const PI = Math.PI
  const rad = PI / 180
  const date = new Date(dateMs)
  // Calculate Julian date for noon UTC on the given day
  const J = (Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12, 0, 0) / 86400000) + 2440587.5
  const n = J - 2451545.0
  const M = (357.5291 + 0.98560028 * n) % 360
  const C = 1.9148 * Math.sin(M * rad) + 0.0200 * Math.sin(2 * M * rad) + 0.0003 * Math.sin(3 * M * rad)
  const lambda = (M + C + 180 + 102.9372) % 360
  const delta = Math.asin(Math.sin(lambda * rad) * Math.sin(23.44 * rad))
  const J_transit = 2451545.0 + n + 0.0053 * Math.sin(M * rad) - 0.0069 * Math.sin(2 * lambda * rad)
  const sin_h0 = Math.sin(-0.83 * rad) // -0.83 degrees for sunrise/sunset
  const phi = lat * rad
  const cos_w = (sin_h0 - Math.sin(phi) * Math.sin(delta)) / (Math.cos(phi) * Math.cos(delta))
  if (cos_w < -1 || cos_w > 1) return null
  const w = Math.acos(cos_w)
  const J_rise = J_transit - (w / (2 * PI)) - (lng / 360)
  const J_set = J_transit + (w / (2 * PI)) - (lng / 360)
  return {
    sunrise: (J_rise - 2440587.5) * 86400000,
    sunset: (J_set - 2440587.5) * 86400000
  }
}
