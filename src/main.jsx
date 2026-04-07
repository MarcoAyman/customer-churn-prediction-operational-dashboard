/*
  src/main.jsx
  ─────────────────────────────────────────────────────────────────────────────
  REACT ENTRY POINT

  FIX APPLIED — Warm-up ping before React mounts.

  WHY THIS FIXES THE CHROME/DESKTOP ISSUE:
    Render's free tier spins down after ~15 min of inactivity.
    Cold starts take 20–60 seconds.

    BEFORE (broken):
      React mounted immediately → all 6 useQuery hooks fired at once
      → all hit a sleeping Render → Chrome declared them failed
      → every card showed "—", SSE showed ERROR, status showed RECONNECTING

    AFTER (fixed):
      warmUpServer() sends one /health ping with a 60s timeout first
      → React only mounts after Render is fully awake
      → every hook's first request hits a warm server and succeeds

    WHY MAIN.JSX AND NOT DASHBOARD.JSX:
      This is the earliest possible point — before any component tree exists.
      If the warm-up lived in Dashboard, all hooks would have already fired
      their first requests during the waiting period.

    WHY SAFARI WAS FINE:
      Safari waits longer before declaring a connection failed.
      Chrome is stricter and times out sooner.
      The warm-up removes this difference entirely — both browsers
      hit a warm server on their first real request.
  ─────────────────────────────────────────────────────────────────────────────
*/

import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import './index.css'
import Dashboard from './Dashboard'

// ── WARM-UP ───────────────────────────────────────────────────────────────────

const BASE_URL = import.meta.env.VITE_API_URL || ''

/**
 * Pings /health with a 60-second timeout before React mounts.
 * Forces Render to fully wake up before any useQuery hook fires.
 * Always resolves (never rejects) — a failed ping still lets the app mount.
 */
async function warmUpServer() {
  if (!BASE_URL) {
    // No API URL configured — local dev without backend, skip ping
    console.log('[WarmUp] No VITE_API_URL — skipping warm-up')
    return
  }

  console.log('[WarmUp] Pinging server before mount...', BASE_URL)

  try {
    const res = await fetch(`${BASE_URL}/api/v1/health`, {
      // AbortSignal.timeout cancels after 60s so we never block forever.
      // Without this a completely dead server would hang the app indefinitely.
      signal: AbortSignal.timeout(60_000),
    })

    if (res.ok) {
      console.log('[WarmUp] ✓ Server is warm — mounting React now')
    } else {
      // Server responded but returned a non-2xx status.
      // Still mount — dashboard components handle their own error states.
      console.warn('[WarmUp] Server responded with', res.status, '— mounting anyway')
    }
  } catch (err) {
    // Network failure, DNS error, CORS preflight fail, or 60s timeout.
    // Always mount — a dashboard with retry logic is better than a blank screen.
    console.warn('[WarmUp] Server did not respond:', err.message, '— mounting anyway')
  }
}


// ── REACT QUERY CLIENT ────────────────────────────────────────────────────────

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // How long cached data is considered fresh — individual hooks override this
      staleTime: 30_000,

      // FIX: raised from 2 → 3 retries.
      // After the warm-up Render is awake, but transient errors still occur.
      // 3 retries with backoff covers virtually all real-world failure cases.
      retry: 3,

      // FIX: raised max backoff cap from 5s → 30s.
      // BEFORE: Math.min(1000 * 2 ** attempt, 5_000)  → max 5s
      // AFTER:  Math.min(2000 * 2 ** attempt, 30_000) → 2s, 4s, 8s (cap 30s)
      // The longer cap handles cases where the warm-up didn't fully complete
      // and Render still needs a moment to serve the first real request.
      retryDelay: (attempt) => Math.min(2_000 * 2 ** attempt, 30_000),

      // Do not refetch on tab focus — polling intervals handle freshness.
      // Aggressive refetch-on-focus creates burst load on a cold Render server.
      refetchOnWindowFocus: false,
    },
  },
})


// ── MOUNT — only after warm-up resolves ──────────────────────────────────────

warmUpServer().then(() => {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <Dashboard />
      </QueryClientProvider>
    </React.StrictMode>
  )
})
