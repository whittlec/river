/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom/vitest'
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Levels, { CustomTooltip } from './Levels'
// Mock CSS modules to avoid errors during render and provide class names
vi.mock('./Levels.module.css', () => ({
  default: new Proxy({}, {
    get: (_target, prop) => String(prop),
  }),
}))

// Mock Recharts ResponsiveContainer to ensure chart renders with dimensions in JSDOM
vi.mock('recharts', async (importOriginal) => {
  const Original = await importOriginal<typeof import('recharts')>()
  const { cloneElement } = await import('react')
  return {
    ...Original,
    ResponsiveContainer: ({ children }: { children: any }) => (
      <div style={{ width: 500, height: 300 }}>
        {cloneElement(children, { width: 500, height: 300 })}
      </div>
    ),
  }
})

// Mock ResizeObserver for Recharts
vi.stubGlobal('ResizeObserver', class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
})

describe('Levels Component', () => {
  beforeEach(() => {
    vi.restoreAllMocks()

    // Mock localStorage
    let store: Record<string, string> = {}
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store[key] || null,
      setItem: (key: string, value: string) => { store[key] = String(value) },
      clear: () => { store = {} },
      removeItem: (key: string) => { delete store[key] },
    })

    // Default fetch mock to return empty CSV to avoid unhandled rejections
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve('timestamp,height,type\n'),
    }))
  })

  afterEach(() => {
    cleanup()
  })

  it('renders loading state initially', () => {
    // Mock a pending fetch so we can see the loading state
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})))
    render(<Levels width={500} height={300} />)
    expect(screen.getByText(/Updating/i)).toBeInTheDocument()
  })

  it('fetches data and displays safe status', async () => {
    const now = Date.now()
    // Create a data point 1 hour ago
    const recent = new Date(now - 1000 * 60 * 60).toISOString()
    const csv = `timestamp,height,type\n${recent},1.5,observed`

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(csv),
    }))

    render(<Levels width={500} height={300} safeLevel={2.0} />)

    // Wait for loading to finish
    await waitFor(() => {
      expect(screen.queryByText(/Loading levels/i)).not.toBeInTheDocument()
    })

    // Check status text
    expect(screen.getByText(/Safe to row/i)).toBeInTheDocument()
    // Check value display
    expect(screen.getByText(/1.50 m/i)).toBeInTheDocument()
  })

  it('displays unsafe status when level is high', async () => {
    const now = Date.now()
    const recent = new Date(now - 1000 * 60 * 60).toISOString()
    const csv = `timestamp,height,type\n${recent},2.5,observed`

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(csv),
    }))

    render(<Levels width={500} height={300} safeLevel={2.0} />)

    await waitFor(() => {
      expect(screen.getByText(/Unsafe to row/i)).toBeInTheDocument()
    })
    expect(screen.getByText(/2.50 m/i)).toBeInTheDocument()
  })

  it('displays Unknown status if data is stale', async () => {
    const now = Date.now()
    const old = new Date(now - 5 * 60 * 60 * 1000).toISOString() // 5 hours ago
    const csv = `timestamp,height,type\n${old},1.5,observed`

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(csv),
    }))

    render(<Levels width={500} height={300} />)

    await waitFor(() => {
      expect(screen.getByText(/Unknown/i)).toBeInTheDocument()
    })
  })

  it('handles fetch errors gracefully', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: () => Promise.resolve('Error'),
    }))

    render(<Levels width={500} height={300} />)

    await waitFor(() => {
      expect(screen.getByText(/Error loading CSV/i)).toBeInTheDocument()
    })
    expect(screen.getByText(/Failed to fetch CSV: 500/i)).toBeInTheDocument()
  })

  it('loads from cache if available and skips fetch', async () => {
    const now = Date.now()
    const recent = new Date(now - 1000 * 60 * 60).toISOString()
    const cachedData = [
      { timestamp: now - 1000 * 60 * 60, timestampIso: recent, observed: 1.2 }
    ]
    const url = 'https://example.com/data.csv'
    localStorage.setItem(`levels-cache:${url}`, JSON.stringify(cachedData))

    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    render(<Levels url={url} width={500} height={300} />)

    // Should display data immediately
    expect(screen.getByText(/Safe to row/i)).toBeInTheDocument()
    expect(screen.getByText(/1.20 m/i)).toBeInTheDocument()
    
    // Fetch should not have been called because cache was present
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('handles empty data state and allows update', async () => {
    // Return empty CSV
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve('timestamp,height,type\n'),
    }))

    render(<Levels width={500} height={300} />)

    await waitFor(() => {
      expect(screen.getByText(/No data/i)).toBeInTheDocument()
    })

    // Now mock a successful response for the update click
    const now = Date.now()
    const recent = new Date(now).toISOString()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(`timestamp,height,type\n${recent},1.6,observed`),
    }))

    const updateBtn = screen.getByRole('button', { name: 'Update' })
    fireEvent.click(updateBtn)

    await waitFor(() => {
      expect(screen.getByText(/Safe to row/i)).toBeInTheDocument()
    })
    expect(screen.getByText(/1.60 m/i)).toBeInTheDocument()
  })

  it('merges uploaded data correctly preferring existing data except when upgrading forecast to observed', async () => {
    const now = Date.now()
    const existingTime = now - 1000 * 60 * 60
    const newTime = now

    const t1 = existingTime + 10000
    const t2 = existingTime
    const t3 = existingTime - 10000
    const t4 = newTime

    // Initial state:
    // t1: Observed 1.0
    // t2: Forecast 2.0
    // t3: Forecast 3.0
    const initialPoints = [
      { timestamp: t1, timestampIso: new Date(t1).toISOString(), observed: 1.0 },
      { timestamp: t2, timestampIso: new Date(t2).toISOString(), forecast: 2.0 },
      { timestamp: t3, timestampIso: new Date(t3).toISOString(), forecast: 3.0 },
    ]

    localStorage.setItem(`levels-cache:https://example.com/data.csv`, JSON.stringify(initialPoints))

    render(<Levels url="https://example.com/data.csv" width={500} height={300} />)

    await waitFor(() => {
      expect(screen.getByText(/1.00 m/i)).toBeInTheDocument()
    })

    // Upload:
    // t1: Observed 1.5 (Should be ignored, existing Observed 1.0 wins)
    // t2: Observed 2.5 (Should win over existing Forecast 2.0)
    // t3: Forecast 3.5 (Should be ignored, existing Forecast 3.0 wins)
    // t4: Observed 4.0 (New point, should be added)
    const csvContent = `timestamp,height,type
${new Date(t1).toISOString()},1.5,observed
${new Date(t2).toISOString()},2.5,observed
${new Date(t3).toISOString()},3.5,forecast
${new Date(t4).toISOString()},4.0,observed`

    const file = new File([csvContent], 'upload.csv', { type: 'text/csv' })
    const input = screen.getByTestId('csv-upload-input')
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      // t4 is the latest point, so it should be displayed as current status
      expect(screen.getByText(/4.00 m/i)).toBeInTheDocument()
      expect(screen.getByText(/Unsafe to row/i)).toBeInTheDocument()
    })
  })

  it('displays daylight times in tooltip', () => {
    const now = new Date('2024-06-21T12:00:00').getTime()
    const payload = [{
      payload: {
        timestamp: now,
        timestampIso: new Date(now).toISOString(),
        observed: 1.5
      }
    }]

    render(<CustomTooltip active={true} payload={payload} label={now} safeLevel={2.0} />)

    expect(screen.getByText(/Sunrise/i)).toBeInTheDocument()
    expect(screen.getByText(/Sunset/i)).toBeInTheDocument()
  })
})