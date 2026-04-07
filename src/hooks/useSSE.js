/*
  src/hooks/useSSE.js
  ─────────────────────────────────────────────────────────────────────────────
  CUSTOM HOOK: useSSE
  Manages a Server-Sent Events (SSE) connection to the FastAPI backend.

  FIX 1 (existing — kept):
    EventSource cannot send custom HTTP headers (browser spec limitation).
    Admin key is sent as a URL query param instead.

  FIX 2 (NEW — this update):
    Exponential backoff on reconnect.

    BEFORE (broken):
      const RECONNECT_DELAY_MS = 3_000  ← fixed 3s forever
      // On a cold Render server, 3s is too short.
      // Chrome fires 15+ rapid reconnects in 45 seconds, each failing.
      // Chrome then marks the origin as broken and the SSE never recovers
      // even after Render is fully awake.

    AFTER (fixed):
      retryDelayRef starts at 3_000ms.
      Each failed connection attempt multiplies by 1.5.
      Caps at 30_000ms (30 seconds) so we never wait too long.
      Resets to 3_000ms the moment a connection opens successfully.

      Timeline on a cold Render start:
        Attempt 1 → fails → wait 3s
        Attempt 2 → fails → wait 4.5s
        Attempt 3 → fails → wait 6.75s
        Attempt 4 → fails → wait 10s
        Attempt 5 → succeeds (Render is now warm) → reset to 3s ✓

    WHY NOT FIXED DELAY?
      A short fixed delay hammers a cold server repeatedly.
      A long fixed delay makes reconnect feel sluggish once the server is warm.
      Exponential backoff gives the server time to wake up while recovering
      quickly once it's ready.
  ─────────────────────────────────────────────────────────────────────────────
*/

import { useState, useEffect, useRef, useCallback } from 'react'
import { MOCK_INITIAL_EVENTS } from '../data/mockData'

// ── CONFIGURATION ─────────────────────────────────────────────────────────────

const MOCK_MODE = false

const BASE_URL  = import.meta.env.VITE_API_URL  || ''
const ADMIN_KEY = import.meta.env.VITE_ADMIN_KEY || ''

const SSE_ENDPOINT = `${BASE_URL}/api/v1/admin/events?admin_key=${ADMIN_KEY}`

// Maximum events to keep in the live feed
const MAX_EVENTS = 50

// Backoff configuration
const RECONNECT_INITIAL_MS = 3_000   // first retry after 3 seconds
const RECONNECT_MULTIPLIER = 1.5     // multiply delay by this on each failure
const RECONNECT_MAX_MS     = 30_000  // never wait longer than 30 seconds


// ── HOOK ──────────────────────────────────────────────────────────────────────

export function useSSE() {
  const [events, setEvents]   = useState(MOCK_MODE ? MOCK_INITIAL_EVENTS : [])
  const [status, setStatus]   = useState(MOCK_MODE ? 'mock' : 'connecting')

  // Ref to the active EventSource instance
  const eventSourceRef = useRef(null)

  // FIX: mutable ref for current retry delay — persists across renders
  // without triggering re-renders (unlike useState)
  const retryDelayRef  = useRef(RECONNECT_INITIAL_MS)

  // Ref to the pending reconnect timeout — so we can cancel it on unmount
  const retryTimerRef  = useRef(null)


  const addEvent = useCallback((newEvent) => {
    setEvents(prev => [newEvent, ...prev].slice(0, MAX_EVENTS))
  }, [])

  const clearEvents = useCallback(() => {
    setEvents([])
  }, [])


  useEffect(() => {

    // ── MOCK MODE ─────────────────────────────────────────────────────────────
    if (MOCK_MODE) {
      const mockEvents = [
        { event_type: 'ping',             payload: {},                                                              created_at: new Date().toISOString() },
        { event_type: 'new_customer',     payload: { customer_id: '#50999', city_tier: 2 },                        created_at: new Date().toISOString() },
        { event_type: 'high_churn_alert', payload: { customer_id: '#50500', score: 1.0, top_reason: 'Complaint' }, created_at: new Date().toISOString() },
      ]
      let idx = 0
      const interval = setInterval(() => {
        addEvent({ ...mockEvents[idx % mockEvents.length], id: `mock-${Date.now()}`, created_at: new Date().toISOString() })
        idx++
      }, 8_000)
      return () => clearInterval(interval)
    }


    // ── REAL SSE MODE ─────────────────────────────────────────────────────────

    if (!ADMIN_KEY) {
      console.error('[SSE] VITE_ADMIN_KEY is not set. Add it to Vercel env vars and redeploy.')
      setStatus('error')
      return
    }

    function connect() {
      setStatus('connecting')
      console.log(`[SSE] Connecting... (retry delay: ${retryDelayRef.current}ms)`)

      const es = new EventSource(SSE_ENDPOINT)
      eventSourceRef.current = es

      es.onopen = () => {
        setStatus('connected')
        console.log('[SSE] ✓ Connected successfully')

        // FIX: reset backoff delay on successful connection.
        // Next disconnect will start the retry sequence from scratch at 3s.
        retryDelayRef.current = RECONNECT_INITIAL_MS
      }

      es.onmessage = (event) => {
        try {
          addEvent(JSON.parse(event.data))
        } catch (err) {
          console.warn('[SSE] Failed to parse event:', event.data, err)
        }
      }

      es.onerror = () => {
        setStatus('error')
        es.close()
        eventSourceRef.current = null

        const delay = retryDelayRef.current
        console.warn(`[SSE] Connection failed. Retrying in ${delay}ms...`)

        // FIX: increase delay for next attempt, capped at RECONNECT_MAX_MS
        retryDelayRef.current = Math.min(
          delay * RECONNECT_MULTIPLIER,
          RECONNECT_MAX_MS
        )

        // Store the timer ref so we can cancel it on unmount
        retryTimerRef.current = setTimeout(connect, delay)
      }
    }

    connect()

    // Cleanup: close connection and cancel any pending retry on unmount
    return () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current)
        retryTimerRef.current = null
      }
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
        eventSourceRef.current = null
        console.log('[SSE] Connection closed (component unmounted)')
      }
    }
  }, [addEvent])


  return {
    events,
    isConnected: status === 'connected' || status === 'mock',
    status,
    clearEvents,
  }
}
