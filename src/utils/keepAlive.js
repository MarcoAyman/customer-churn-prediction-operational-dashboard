/*
  src/utils/keepAlive.js
  ─────────────────────────────────────────────────────────────────────────────
  KEEP-ALIVE UTILITY — prevents Render free tier from spinning down.

  THE PROBLEM:
    Render's free tier spins down a service after 15 minutes of inactivity.
    "Inactivity" means no HTTP requests reached the server in that window.
    Cold starts take 20–60 seconds, which is long enough for Chrome to
    declare the connection failed — causing the dashboard to show ERROR
    on every card and the entry form to silently drop registrations.

  THIS FILE SOLVES "SCENARIO A":
    When the browser tab is open but nobody is actively using the app
    (user left the tab open, walked away, switched to another tab),
    we send a lightweight ping to /health every 10 minutes.
    This keeps Render's inactivity timer from ever reaching 15 minutes.

  SCENARIO B (no browser open at all) is handled separately:
    → .github/workflows/keep_alive.yml (GitHub Actions cron job)
    That file pings Render every 10 minutes even when no browser has
    either app open. Together these two cover 100% of the time.

  HOW TO USE IN BOTH APPS:
    Import startKeepAlive in main.jsx and call it before mounting React.
    It returns a cleanup function (not needed at the root level but
    exported for completeness).

    import { startKeepAlive } from './utils/keepAlive'
    startKeepAlive(import.meta.env.VITE_API_URL)

  WHAT THE PING DOES:
    GET /api/v1/health — the lightest possible endpoint.
    No auth, no database query, no processing.
    Just "are you alive?" → "yes" → Render timer resets.
    The response body is ignored entirely.

  DESIGN DECISIONS:
    - 10-minute interval: Render sleeps at 15 min. 10 min leaves a 5-min
      buffer even if a ping is slightly delayed by network conditions.
      Don't go lower — unnecessary server load for no benefit.

    - Silent failures: If a ping fails we log a warning and do nothing.
      The next ping will try again in 10 minutes. We never throw, never
      show UI errors, never affect the app's state. This is infrastructure,
      not user-facing logic.

    - Immediate ping on mount: The first ping fires instantly when the
      app loads. This doubles as a warm-up signal — by the time the user
      interacts with the app, the server has already received at least
      one request and confirmed it's alive.

    - Page Visibility API: When the user switches back to the tab after
      being away, we ping immediately instead of waiting for the next
      10-minute tick. If the tab was hidden for 14 minutes, Render is
      about to sleep — the visibility ping resets the timer just in time.

    - Ping on tab wake from background: Some browsers throttle setInterval
      to once per minute or longer when a tab is in the background.
      The visibilitychange handler catches the moment the tab comes back
      into focus and fires a ping regardless of where the interval timer is.
  ─────────────────────────────────────────────────────────────────────────────
*/

// ── CONFIGURATION ─────────────────────────────────────────────────────────────

// How often to ping Render (must be < 15 minutes — Render's sleep threshold)
const PING_INTERVAL_MS = 10 * 60 * 1_000   // 10 minutes

// Timeout for each individual ping request
// Short timeout is fine — we don't need the response, just to send the signal
const PING_TIMEOUT_MS  = 10_000             // 10 seconds


// ── KEEP-ALIVE ────────────────────────────────────────────────────────────────

/**
 * Starts a keep-alive loop that pings the Render backend every 10 minutes.
 *
 * @param {string} baseUrl - The Render API base URL (VITE_API_URL env var).
 *                           Pass an empty string or nothing to disable silently
 *                           (e.g. in local dev with no backend running).
 * @returns {() => void}   - Cleanup function that stops all pings and
 *                           removes all event listeners. Call on app teardown.
 *
 * @example
 *   // In main.jsx, before ReactDOM.render():
 *   const stopKeepAlive = startKeepAlive(import.meta.env.VITE_API_URL)
 */
export function startKeepAlive(baseUrl) {
  // Disable silently when no API URL is configured.
  // This prevents errors in local development when there is no backend.
  if (!baseUrl) {
    console.log('[KeepAlive] No VITE_API_URL set — keep-alive disabled (local dev?)')
    return () => {}  // return a no-op cleanup so callers don't need to check
  }

  const healthUrl = `${baseUrl}/api/v1/health`
  let pingCount = 0

  /**
   * Sends a single lightweight GET to /health.
   * The response is ignored — we only care that the request reached Render.
   * Silent on failure — the interval will try again in 10 minutes.
   */
  async function ping() {
    pingCount++
    try {
      await fetch(healthUrl, {
        method: 'GET',
        // AbortSignal.timeout cancels the request if Render doesn't
        // respond in 10 seconds. We don't want a hung ping blocking anything.
        signal: AbortSignal.timeout(PING_TIMEOUT_MS),
      })
      console.log(`[KeepAlive] ✓ Ping #${pingCount} — server is alive`)
    } catch (err) {
      // Network error, timeout, or Render is mid-cold-start.
      // Do not throw — this is a background signal, not critical path.
      // The next scheduled ping will try again.
      console.warn(`[KeepAlive] ✗ Ping #${pingCount} failed:`, err.message)
    }
  }

  // ── 1. IMMEDIATE PING ON MOUNT ─────────────────────────────────────────────
  // Fire the first ping right away as a warm-up signal.
  // By the time the user starts interacting with the UI, Render is confirmed warm.
  ping()

  // ── 2. SCHEDULED PINGS EVERY 10 MINUTES ───────────────────────────────────
  // This is the main keep-alive loop.
  // NOTE: browsers may throttle setInterval when the tab is backgrounded
  // (Chrome caps it at ~1/min). That's fine — the visibilitychange handler
  // below catches the moment the tab comes back into view.
  const intervalId = setInterval(ping, PING_INTERVAL_MS)

  // ── 3. PING WHEN TAB BECOMES VISIBLE AGAIN ────────────────────────────────
  // If the tab was hidden for a long time, the scheduled interval may have
  // been throttled by the browser. We ping immediately when the user returns
  // to the tab to reset Render's inactivity timer right away — no waiting
  // for the next 10-minute tick.
  function onVisibilityChange() {
    if (document.visibilityState === 'visible') {
      console.log('[KeepAlive] Tab became visible — pinging immediately')
      ping()
    }
  }

  document.addEventListener('visibilitychange', onVisibilityChange)

  // ── 4. CLEANUP ─────────────────────────────────────────────────────────────
  // Returns a function that stops everything cleanly.
  // Not strictly necessary at the root level (the page is being unloaded),
  // but good practice and useful in testing or SSR environments.
  return function stopKeepAlive() {
    clearInterval(intervalId)
    document.removeEventListener('visibilitychange', onVisibilityChange)
    console.log('[KeepAlive] Stopped')
  }
}
