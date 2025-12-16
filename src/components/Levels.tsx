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

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to fetch CSV: ${r.status}`)
        return r.text()
      })
      .then((text) => setCsvText(text))
      .catch((err: any) => setError(String(err)))
      .finally(() => setLoading(false))
  }, [url])

  const data: Point[] = useMemo(() => {
    if (!csvText) return []
    const parsed = Papa.parse<RawRow>(csvText, {
      header: true,
      skipEmptyLines: true,
    })

    const byTs = new Map<number, Point>()

    // Detect header keys more robustly: normalize available header names and
    // pick keys which contain substrings like 'timestamp', 'time', 'date',
    // or 'height', 'level', or 'type'. This handles headers like
    // "Timestamp (UTC)", "Height (m)", "Type(observed/forecast)".
    const headers = parsed.meta.fields ?? []
    const findHeader = (candidates: string[]) =>
      headers.find((h) => {
        const nh = (h || '').toLowerCase()
        return candidates.some((c) => nh.includes(c))
      })

    const keyTimestamp = findHeader(['timestamp', 'time', 'date'])
    const keyHeight = findHeader(['height', 'level'])
    const keyType = findHeader(['type'])

    // Keep a small diagnostic so it's easier to debug when headers change
    // (visible in browser console).
    // eslint-disable-next-line no-console
    console.debug('Levels: detected CSV headers ->', { keyTimestamp, keyHeight, keyType })

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
        // If type is not given, assume observed
        existing.observed = existing.observed ?? height
      }
      byTs.set(ts, existing)
    }

    const arr = Array.from(byTs.values()).sort((a, b) => a.timestamp - b.timestamp)
    return arr
  }, [csvText])

  if (loading) return <div>Loading levels…</div>
  if (error) return <div style={{ color: 'red' }}>Error loading CSV: {error}</div>
  if (data.length === 0) return <div>No data (CSV may be empty or in an unexpected format)</div>

  const cssHeight = typeof height === 'number' ? `${height}px` : height
  const cssWidth = typeof width === 'number' ? `${width}px` : width

  return (
    <div style={{ width: cssWidth, height: cssHeight }}>
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
