# ChurnGuard — Operational Dashboard

**Internal operations dashboard for the ChurnGuard churn prediction system.**

Real-time view of the customer churn landscape — KPI cards, risk distribution, churn trend, top at-risk customers, drift monitoring, and a live SSE event feed. Deployed on Vercel. Talks to the FastAPI backend on Render.

---

## Live

| | URL |
|-|-----|
| **Dashboard** | *(your Vercel URL)* |
| **API it talks to** | *(your Render URL)* |
| **Entry Form** | *(your other Vercel app)* |

---

## What It Shows

```
┌──────────────────────────────────────────────────────────────────────┐
│  HEALTH BAR                                                           │
│  SYSTEM operational · MODEL v1.0.0 · LAST BATCH 5m ago · DRIFT none │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ TOTAL         │ │ HIGH RISK    │ │ RETAINED     │ │ AVG CHURN    │
│ CUSTOMERS     │ │              │ │              │ │ SCORE        │
│ 5,630         │ │ 1,206        │ │ 3,351        │ │ 0.214        │
└──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘

┌──────────────────────┐ ┌──────────────────────┐ ┌──────────────┐
│ RISK DISTRIBUTION    │ │ CHURN TREND          │ │ LIVE EVENT   │
│ bar chart            │ │ % HIGH risk per      │ │ FEED         │
│ HIGH / MED / LOW     │ │ batch run over time  │ │ SSE stream   │
└──────────────────────┘ └──────────────────────┘ └──────────────┘

┌───────────────────────────────────────────────────────────────────┐
│ TOP AT-RISK CUSTOMERS                                              │
│ TIER · SCORE · CUSTOMER · TENURE · LAST ORDER · SAT · COMPLAINT   │
│ TOP REASON (SHAP)                                                  │
└───────────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────────┐
│ DRIFT MONITOR                                                      │
│ Last PSI check results — feature-level distribution shift         │
└───────────────────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Layer | Choice |
|-------|--------|
| **Framework** | React 18 |
| **Build tool** | Vite 5 |
| **Data fetching** | TanStack React Query v5 |
| **Charts** | Recharts 2 |
| **Real-time** | Browser `EventSource` API (SSE) |
| **Styling** | Plain CSS modules per component |
| **Deployment** | Vercel |

---

## Project Structure

```
customer-churn-prediction-operational-dashboard/
│
├── src/
│   ├── main.jsx                            ← React entry point
│   ├── Dashboard.jsx                       ← root layout + orchestrator
│   ├── Dashboard.css                       ← dashboard grid layout
│   ├── ErrorBoundary.jsx                   ← crash protection
│   ├── index.css                           ← global reset + CSS vars
│   │
│   ├── components/
│   │   ├── HealthBar/
│   │   │   ├── HealthBar.jsx               ← top status bar
│   │   │   └── HealthBar.css
│   │   ├── KPICards/
│   │   │   ├── KPICards.jsx                ← 4 metric cards
│   │   │   └── KPICards.css
│   │   ├── RiskDistributionChart/
│   │   │   ├── RiskDistributionChart.jsx   ← HIGH/MEDIUM/LOW bar chart
│   │   │   └── RiskDistributionChart.css
│   │   ├── ChurnTrendChart/
│   │   │   ├── ChurnTrendChart.jsx         ← % HIGH risk per batch over time
│   │   │   └── ChurnTrendChart.css
│   │   ├── AtRiskTable/
│   │   │   ├── AtRiskTable.jsx             ← top at-risk customer list
│   │   │   └── AtRiskTable.css
│   │   ├── DriftMonitor/
│   │   │   ├── DriftMonitor.jsx            ← PSI drift report
│   │   │   └── DriftMonitor.css
│   │   └── EventFeed/
│   │       ├── EventFeed.jsx               ← live SSE event feed
│   │       └── EventFeed.css
│   │
│   ├── hooks/
│   │   ├── useDashboardData.js             ← all REST polling hooks
│   │   └── useSSE.js                       ← SSE connection manager
│   │
│   ├── data/
│   │   └── mockData.js                     ← fallback data for development
│   │
│   └── utils/
│       └── keepAlive.js                    ← Render cold start prevention
│
├── index.html
├── vite.config.js
├── vercel.json                             ← Vercel SPA routing config
└── package.json
```

---

## File Purpose — Full Reference

### `src/main.jsx`

React entry point. Mounts the app into `#root`. Wraps everything in `QueryClientProvider` (required by React Query). Also calls `startKeepAlive(VITE_API_URL)` immediately — this pings Render before any user interaction to prevent cold starts.

```jsx
startKeepAlive(import.meta.env.VITE_API_URL)   // ← fires before render
ReactDOM.createRoot(document.getElementById('root')).render(
  <QueryClientProvider client={queryClient}>
    <Dashboard />
  </QueryClientProvider>
)
```

---

### `src/Dashboard.jsx`

**The root layout component and orchestrator.** Nothing renders here directly — it wires together all the hooks and passes data down to components.

**Two data strategies in parallel:**

```
SSE (always-open connection)
  useSSE() → connects to /api/v1/admin/events
  Receives: ping, new_customer, high_churn_alert, batch_completed,
            drift_alert, model_promoted
  On batch_completed → invalidates ALL React Query caches immediately
  On drift_alert    → invalidates drift-monitor + last-batch caches
  On model_promoted → invalidates everything (model changed)

REST (polled)
  useKPISummary()        → polls /api/v1/admin/overview       every 60s
  useRiskDistribution()  → polls /api/v1/admin/risk-distribution every 60s
  useChurnTrend()        → polls /api/v1/admin/churn-trend    every 120s
  useTopAtRisk()         → polls /api/v1/admin/at-risk        every 60s
  useDriftMonitor()      → polls /api/v1/admin/drift          every 120s
  useLastBatch()         → polls /api/v1/admin/last-batch     every 60s
```

**Zone layout:**
```
Zone 1 — HealthBar (outside ErrorBoundary — always visible even on crash)
Zone 2 — KPICards
Zone 3 — Left column: RiskDistributionChart + ChurnTrendChart + AtRiskTable + DriftMonitor
          Right column: EventFeed
```

**Why the SSE invalidation pattern:**
React Query's polling is great for routine updates but has up to 60-120 second lag. When the batch scoring job finishes, the SSE stream delivers a `batch_completed` event immediately — the dashboard invalidates all caches and refetches right then, instead of waiting for the next poll cycle.

---

### `src/ErrorBoundary.jsx`

React class component that catches any JavaScript error thrown by a child component during rendering. Without this, a single null dereference in `AtRiskTable` would unmount the entire tree and show a blank screen.

The `HealthBar` is intentionally placed **outside** the ErrorBoundary — it always stays visible even if the main content crashes.

---

### Components

#### `HealthBar/HealthBar.jsx`

Top strip across the full dashboard width. Shows system status at a glance:

```
● SYSTEM operational | MODEL v1.0.0 | LAST BATCH 5m ago · 218s | CUSTOMERS 5,630 | DRIFT none detected | ● LIVE  11:57:13
```

**Props:** `lastBatch` (from `useLastBatch`), `kpiSummary` (from `useKPISummary`), `sseStatus` (`'connecting'` / `'connected'` / `'error'`)

The green ● dot next to LIVE turns red when the SSE connection is lost. This gives the operator an instant signal that real-time events are not flowing.

---

#### `KPICards/KPICards.jsx`

Four metric cards in a horizontal row:

| Card | Source | Value example |
|------|--------|---------------|
| **Total Customers** | `kpiSummary.total_customers` | 5,630 |
| **High Risk** | `kpiSummary.high_risk_count` + `high_risk_pct` | 1,206 · 21.4% |
| **Retained** | `kpiSummary.low_risk_count` + pct | 3,351 · 78.6% low risk |
| **Avg Churn Score** | `kpiSummary.avg_churn_probability` | 0.214 |

All cards show a skeleton loading state while data is fetching.

---

#### `RiskDistributionChart/RiskDistributionChart.jsx`

Horizontal bar chart showing the count of customers in each risk tier (HIGH / MEDIUM / LOW / ONBOARDING). Built with Recharts `BarChart`.

- HIGH → red bar
- MEDIUM → amber bar
- LOW → green bar
- ONBOARDING → blue bar (new customers not yet eligible for scoring)

Reads from `/api/v1/admin/risk-distribution` via `useRiskDistribution()`.

---

#### `ChurnTrendChart/ChurnTrendChart.jsx`

Line chart showing the percentage of HIGH risk customers across the last N batch runs over time. Each data point represents one batch scoring execution.

- X axis: batch date
- Y axis: % HIGH risk
- Amber dot on a data point = drift was detected during that batch

This lets the operator see whether churn risk is trending up or down across scoring cycles.

Reads from `/api/v1/admin/churn-trend` via `useChurnTrend()`.

---

#### `AtRiskTable/AtRiskTable.jsx`

Paginated table of the top 20 highest-probability customers from the most recent batch run. Columns:

```
TIER   SCORE (bar)   CUSTOMER (#id)   TENURE   LAST ORDER   SAT.   COMPLAINT   TOP REASON
HIGH   ████████ 1.0  #c0888b18        0mo      1d ago       ★★☆☆☆  ● yes       —
```

- Risk tier shown as a coloured badge (HIGH = red, MEDIUM = amber, LOW = green)
- Score shown as a proportional fill bar + numeric value
- TOP REASON comes from `shap_top_reasons[0].feature` — the single biggest driver for that customer
- COMPLAINT shown as coloured dot (red = yes, grey = no)

Reads from `/api/v1/admin/at-risk` (Supabase view `v_top_at_risk`) via `useTopAtRisk()`.

---

#### `DriftMonitor/DriftMonitor.jsx`

Shows the PSI drift check result from the most recent batch run:

- Overall status: NONE DETECTED (green) or DRIFT ALERT (red)
- Per-feature PSI scores for the top drifted features
- Timestamp of last check

PSI > 0.20 on any feature fires a drift alert. This component displays the result stored in `drift_reports` table.

Reads from `/api/v1/admin/drift` via `useDriftMonitor()`.

---

#### `EventFeed/EventFeed.jsx`

Right-column live event feed. Displays all events received over the SSE connection, newest first. Maximum 50 events before oldest are dropped.

Event types and what they show:

| Event type | Display |
|------------|---------|
| `ping` | Connection keepalive (shown as PING) |
| `new_customer` | Customer registered — shows ID and city tier |
| `high_churn_alert` | Probability ≥ threshold — shows customer ID and top reason |
| `batch_completed` | Batch scoring finished — shows counts |
| `drift_alert` | PSI > 0.20 — shows which features drifted |
| `model_promoted` | New production model loaded |

Has a "clear" button to empty the feed.

---

### `src/hooks/useDashboardData.js`

All React Query polling hooks in one file. Key design details:

**Authentication:** All admin API endpoints require `X-Admin-Key` header. Regular `fetch()` supports custom headers so this works cleanly:

```js
const res = await fetch(url, {
  headers: {
    'Content-Type': 'application/json',
    'X-Admin-Key': ADMIN_KEY,     // ← header approach works for fetch()
  }
})
```

**Mock mode:** `MOCK_MODE = true` bypasses all API calls and returns mock data with a simulated 300ms delay. Used during development when the backend is not running. Switch to `false` for production.

**Polling intervals:**
- Fast data (KPIs, at-risk): 60 seconds
- Slow data (trend, drift): 120 seconds
- SSE `batch_completed` event overrides both — forces immediate refetch

**Response envelope:** All admin endpoints return `{ success, data, message }`. The hook unwraps `body.data` so components receive clean data objects.

---

### `src/hooks/useSSE.js`

Manages the persistent SSE connection to FastAPI's event stream.

**The browser SSE limitation and how it's solved:**

The browser's `EventSource` API cannot send custom HTTP headers — this is a browser specification limitation, not a bug. The admin endpoints require `X-Admin-Key`. The solution:

```js
// BROKEN — EventSource cannot send headers
const es = new EventSource(url)
es.setRequestHeader('X-Admin-Key', key)  // ← does not exist

// FIXED — admin key in query param
const es = new EventSource(`${url}?admin_key=${ADMIN_KEY}`)
// FastAPI events.py route was updated to also accept ?admin_key=
```

**Connection lifecycle:**
```
mount → connect() → EventSource(SSE_ENDPOINT)
          ├── onopen  → status = 'connected'
          ├── onmessage → parse JSON → addEvent()
          └── onerror → status = 'error' → es.close() → setTimeout(connect, 3s)

unmount → es.close()
```

**Reconnect on error:** If the SSE connection drops (Render restarts, network blip), the hook waits 3 seconds then reconnects automatically. No user interaction needed.

**Mock mode:** In `MOCK_MODE`, simulates incoming events every 8 seconds using `setInterval`. The event types cycle through ping, new_customer, high_churn_alert, ping.

---

### `src/data/mockData.js`

Static fallback data matching the exact shape of each API response. Used when `MOCK_MODE = true` in the hooks. Lets you develop and style components without the backend running.

Contains: `MOCK_KPI_SUMMARY`, `MOCK_RISK_DISTRIBUTION`, `MOCK_CHURN_TREND`, `MOCK_TOP_AT_RISK`, `MOCK_DRIFT_FEATURES`, `MOCK_LAST_BATCH`, `MOCK_INITIAL_EVENTS`.

---

### `src/utils/keepAlive.js`

Prevents Render's free tier from spinning down due to inactivity.

**The problem:** Render sleeps a free-tier service after 15 minutes with no HTTP requests. Cold starts take 20–60 seconds — long enough for the browser to declare the request failed. The dashboard would show error states on all cards.

**The solution — three-part:**

```
1. Immediate ping on app mount
   → fires GET /api/v1/health the instant the JS loads
   → warms up Render before the user interacts

2. Scheduled pings every 10 minutes (setInterval)
   → keeps the inactivity timer from reaching 15 minutes
   → 10 min chosen deliberately: leaves a 5-min buffer even if a ping is delayed

3. Ping on tab visibility change
   → if the user returns to the tab after being away, pings immediately
   → browsers throttle setInterval in background tabs — this compensates
```

**GitHub Actions handles Scenario B** (no browser open at all) — a separate `keep_alive.yml` workflow pings Render every 10 minutes even when no browser has either app open.

Silent failures: if a ping fails, a warning is logged and the interval continues. This is background infrastructure — it never affects app state or shows UI errors.

---

## How It Connects to the Rest of the System

```
┌─────────────────────────────────────────────────────────────┐
│  Entry Form (Vercel)                                        │
│  Customer fills form → POST /api/v1/customers/register      │
│                                       │                     │
│                                       ▼                     │
│                          FastAPI on Render                  │
│                          /api/v1/admin/*    ◄────────────── │ ← Dashboard polls here (REST)
│                          /api/v1/admin/events ◄──────────── │ ← Dashboard connects here (SSE)
│                                       │                     │
│                                       ▼                     │
│                          Supabase PostgreSQL                 │
│                          customers, predictions,             │
│                          batch_runs, drift_reports          │
│                                       │                     │
│                            (every 20 days)                  │
│                                       │                     │
│                          GitHub Actions cron                 │
│                          run_batch_scoring.py               │
│                          → writes 5,121 predictions         │
│                          → SSE: batch_completed event       │
│                          → Dashboard updates instantly       │
└─────────────────────────────────────────────────────────────┘
```

**Entry form → Dashboard flow:**
1. Operator registers a customer in the entry form
2. FastAPI inserts into `customers` + `customer_features`
3. FastAPI pushes `new_customer` event over SSE
4. Dashboard EventFeed shows the event within seconds
5. On the next 60-second poll, KPICards total count increments

**Batch scoring → Dashboard flow:**
1. GitHub Actions runs `run_batch_scoring.py` every 20 days
2. Batch writes 5,121+ predictions to Supabase
3. FastAPI pushes `batch_completed` SSE event
4. Dashboard receives event → immediately invalidates all React Query caches
5. All charts and tables refresh with fresh batch data — no waiting for poll

---

## Environment Variables

Set these in your Vercel project dashboard under **Settings → Environment Variables**:

| Variable | Value | Required |
|----------|-------|----------|
| `VITE_API_URL` | Your Render API URL e.g. `https://churnguard-api.onrender.com` | ✓ |
| `VITE_ADMIN_KEY` | Same value as `ADMIN_API_KEY` in your FastAPI `.env` | ✓ |

**Note:** Both variables must start with `VITE_` — Vite only exposes env vars with this prefix to the browser bundle.

---

## Running Locally

```bash
git clone https://github.com/MarcoAyman/customer-churn-prediction-operational-dashboard.git
cd customer-churn-prediction-operational-dashboard

npm install

# Create .env.local for local dev
echo "VITE_API_URL=https://your-render-url.onrender.com" > .env.local
echo "VITE_ADMIN_KEY=your-admin-key" >> .env.local

npm run dev
# → http://localhost:5173
```

**Development without backend:** Set `MOCK_MODE = true` in both `useDashboardData.js` and `useSSE.js`. The dashboard will use static mock data and simulate SSE events.

---

## Deployment

Deployed automatically on Vercel:

```
git push origin main → Vercel auto-deploys → live in ~45 seconds
```

`vercel.json` configures SPA routing so direct URL access and refreshes work correctly:

```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/" }]
}
```

---

## Author

**Marco Hanna** · ML/AI Engineer
- GitHub: [@MarcoAyman](https://github.com/MarcoAyman)
- Portfolio: [marco-hanna-portfolio.vercel.app](https://marco-hanna-portfolio.vercel.app)

---

## License

MIT — see [LICENSE](./LICENSE)
