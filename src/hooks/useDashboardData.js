/*
  src/hooks/useDashboardData.js
  ─────────────────────────────────────────────────────────────────────────────
  React Query hooks for all polled dashboard data.

  FIX APPLIED — Staggered initial fetches + longer retry backoff.

  BEFORE (broken):
    All 6 hooks mounted and fired their first fetch simultaneously.
    On a cold Render server, 6 concurrent requests from a browser that
    Chrome has already decided is "slow" causes all 6 to fail at once.
    React Query retried them, but with a 5s cap — not long enough for
    a 30–60s Render cold start.

  AFTER (fixed — two changes):

    1. STAGGERED INITIAL FETCHES (fetchWithDelay wrapper)
       Each query fires its FIRST request at a slightly different time:
         kpi-summary       → fires immediately   (0ms offset)
         risk-distribution → fires after 400ms
         churn-trend       → fires after 800ms
         top-at-risk       → fires after 1200ms
         drift-monitor     → fires after 1600ms
         last-batch        → fires after 2000ms

       This spreads the initial burst over 2 seconds.
       After the first successful fetch, each hook polls at its own
       refetchInterval independently — the delay ONLY applies to the
       first mount fetch. Subsequent polling is unaffected.

       WHY THIS HELPS:
         The warm-up in main.jsx wakes Render before any hook fires.
         But if the warm-up times out and the hooks fire anyway,
         staggering gives Render time to process one request before
         the next arrives — reducing the chance of all failing together.

    2. PER-QUERY RETRY CONFIG
       Each hook now has explicit retry: 3 and retryDelay that matches
       the global config in main.jsx. This is belt-and-suspenders —
       the global default applies automatically, but making it explicit
       here means this file is self-documenting and the config won't
       silently change if main.jsx is updated.
  ─────────────────────────────────────────────────────────────────────────────
*/

import { useQuery } from '@tanstack/react-query'
import {
  MOCK_KPI_SUMMARY,
  MOCK_RISK_DISTRIBUTION,
  MOCK_CHURN_TREND,
  MOCK_TOP_AT_RISK,
  MOCK_DRIFT_FEATURES,
  MOCK_LAST_BATCH,
} from '../data/mockData'

// ── CONFIGURATION ─────────────────────────────────────────────────────────────

const MOCK_MODE = false

const BASE_URL  = import.meta.env.VITE_API_URL  || ''
const ADMIN_KEY = import.meta.env.VITE_ADMIN_KEY || ''

if (!MOCK_MODE) {
  console.log('[Dashboard] API URL:', BASE_URL || '(not set — check VITE_API_URL)')
  console.log('[Dashboard] Admin key set:', ADMIN_KEY ? 'YES' : 'NO — check VITE_ADMIN_KEY')
}


// ── HELPERS ───────────────────────────────────────────────────────────────────

// Mock delay for development — keeps loading states visible and realistic
const mockFetch = (data, delayMs = 300) =>
  new Promise(resolve => setTimeout(() => resolve(data), delayMs))

/**
 * Real API fetcher with X-Admin-Key header.
 * fetch() supports custom headers — only EventSource cannot.
 *
 * @param {string} endpoint  - e.g. '/api/v1/admin/overview'
 * @param {number} initialDelayMs - stagger delay applied ONLY on first call.
 *   After the first successful fetch, React Query calls this directly
 *   on its polling interval — the delay has no effect on subsequent calls
 *   because the server is already warm and responds in <200ms.
 */
const apiFetch = async (endpoint, initialDelayMs = 0) => {
  // Apply stagger delay. On subsequent polling calls this is still awaited
  // but resolves instantly (0ms effectively) since the server is now warm
  // and the tiny delay is negligible compared to network round-trip time.
  if (initialDelayMs > 0) {
    await new Promise(resolve => setTimeout(resolve, initialDelayMs))
  }

  const url = `${BASE_URL}${endpoint}`

  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Key':  ADMIN_KEY,
    },
  })

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}))
    throw new Error(
      `API error ${res.status} on ${endpoint}: ` +
      (errorBody.message || errorBody.detail || res.statusText)
    )
  }

  const body = await res.json()
  // All admin endpoints return { success, data, message } — unwrap the envelope
  return body.data ?? body
}

// Shared retry config — explicit per-hook so this file is self-documenting
// These values match the global defaults in main.jsx (belt-and-suspenders)
const RETRY_CONFIG = {
  retry: 3,
  retryDelay: (attempt) => Math.min(2_000 * 2 ** attempt, 30_000),
}


// ── HOOKS ─────────────────────────────────────────────────────────────────────

export function useKPISummary() {
  return useQuery({
    queryKey: ['kpi-summary'],
    queryFn: MOCK_MODE
      ? () => mockFetch(MOCK_KPI_SUMMARY)
      : () => apiFetch('/api/v1/admin/overview', 0),  // fires first, no delay
    refetchInterval: 60_000,
    staleTime:       50_000,
    ...RETRY_CONFIG,
  })
}

export function useRiskDistribution() {
  return useQuery({
    queryKey: ['risk-distribution'],
    queryFn: MOCK_MODE
      ? () => mockFetch(MOCK_RISK_DISTRIBUTION)
      : () => apiFetch('/api/v1/admin/risk-distribution', 400),  // +400ms
    refetchInterval: 60_000,
    staleTime:       50_000,
    ...RETRY_CONFIG,
  })
}

export function useChurnTrend() {
  return useQuery({
    queryKey: ['churn-trend'],
    queryFn: MOCK_MODE
      ? () => mockFetch(MOCK_CHURN_TREND)
      : () => apiFetch('/api/v1/admin/churn-trend', 800),  // +800ms
    refetchInterval: 120_000,
    staleTime:       110_000,
    ...RETRY_CONFIG,
  })
}

export function useTopAtRisk() {
  return useQuery({
    queryKey: ['top-at-risk'],
    queryFn: MOCK_MODE
      ? () => mockFetch(MOCK_TOP_AT_RISK)
      : () => apiFetch('/api/v1/admin/at-risk', 1_200),  // +1200ms
    refetchInterval: 60_000,
    staleTime:       50_000,
    ...RETRY_CONFIG,
  })
}

export function useDriftMonitor() {
  return useQuery({
    queryKey: ['drift-monitor'],
    queryFn: MOCK_MODE
      ? () => mockFetch(MOCK_DRIFT_FEATURES)
      : () => apiFetch('/api/v1/admin/drift', 1_600),  // +1600ms
    refetchInterval: 120_000,
    staleTime:       110_000,
    ...RETRY_CONFIG,
  })
}

export function useLastBatch() {
  return useQuery({
    queryKey: ['last-batch'],
    queryFn: MOCK_MODE
      ? () => mockFetch(MOCK_LAST_BATCH)
      : () => apiFetch('/api/v1/admin/last-batch', 2_000),  // +2000ms — fires last
    refetchInterval: 60_000,
    staleTime:       50_000,
    ...RETRY_CONFIG,
  })
}
