/**
 * @vitest-environment jsdom
 */
import * as matchers from '@testing-library/jest-dom/matchers'
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Levels from './Levels'

// Mock CSS modules to avoid errors during render and provide class names
vi.mock('./Levels.module.css', () => ({
  default: new Proxy({}, {
    get: (target, prop) => String(prop),
  }),
}))

expect.extend(matchers)

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
})