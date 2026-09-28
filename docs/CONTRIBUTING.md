# The Wire — Developer Guide

Quick-start guide for developers (and their AI assistants) working on The Wire dashboard.

## Prerequisites

- Node.js ≥ 22.2.0
- pnpm 10.9.0 (`corepack enable && corepack prepare pnpm@10.9.0 --activate`)
- Access to the monorepo at `apps/wire`

## Running Locally

```bash
# From monorepo root
pnpm install
pnpm run dev --filter=wire    # starts at http://localhost:5001
```

The `.env` file in `apps/wire/` has all required environment variables for local development. Do not commit this file.

## Making Changes

### Adding a New Graph / Visualization

1. **Data is already available** — check `lib/types.ts` for `DashboardData` interface. The `/api/data` endpoint returns everything.
2. **Charts use Recharts** — import from `recharts` (BarChart, ComposedChart, Line, Area, etc.)
3. **Add your graph** to the relevant page component:
    - Portfolio → `app/page.tsx`
    - Buyer Visits → `components/visits/VisitAnalyticsPage.tsx`
    - Inventory → `components/inventory/InventoryPage.tsx`
4. **If you need new data from Zoho**, add it to `lib/aggregate.ts` in `_fetchDashboardData()`, update the `DashboardData` interface in `lib/types.ts`, and bump the `KV_KEY` version constant at the top of `aggregate.ts` to force a fresh cache.

### Styling Conventions

- **No CSS framework** — all styles are inline `style={{}}` objects
- **Color palette**: background `#f4f1ea`, cards `#fbf9f4`, borders `#e9e4db`, muted text `#9a948a`, dark text `#23211e`
- **Fonts**: body is `Hanken Grotesk`, data/labels use `IBM Plex Mono`
- **Chart colors**: green `#3a7d5d`, gold/CP `#cf9d5b`, red `#c7533e`, blue `#4a90d9`, purple `#7c5cbf`

### Key Patterns

```tsx
// URL-persisted filter state (bookmarkable)
const [hashCluster, setHashCluster] = useHashState('cluster', 'all')

// Data from the single SWR call (no additional fetches needed)
const { data } = useSWR<DashboardData>('/api/data', fetcher)

// Filter properties by visible markets
const filteredPropertyIds = useMemo(() => {
    return new Set(data.data.filter(p => visibleMarkets.includes(p.m)).map(p => p.i))
}, [data.data, visibleMarkets])

// Recharts bar chart
<ResponsiveContainer width="100%" height={280}>
    <BarChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#efe9e0" />
        <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#9a948a' }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 10, fill: '#9a948a' }} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip contentStyle={{ background: '#fbf9f4', border: '1px solid #e9e4db', borderRadius: 8, fontSize: 12 }} />
        <Bar dataKey="value" fill="#3a7d5d" radius={[4, 4, 0, 0]} />
    </BarChart>
</ResponsiveContainer>
```

### Adding a New Tab / Page

1. Add the view key to `NavView` type in `components/shared/Nav.tsx`
2. Add the tab to the `topTabs` array (or `visitTabs` for visit sub-pages) in `Nav.tsx`
3. Add the route in `app/page.tsx`:
    ```tsx
    {
        view === 'your-view' && <YourPage data={data} loading={isInitialLoad} />
    }
    ```
4. Create your component in `components/your-feature/YourPage.tsx`

### Rules

- **Never hardcode clusters/micromarkets** — they come dynamically from `data.clusters`
- **Always exclude "virtual"** — any cluster/micromarket with "virtual" in its name must be excluded everywhere
- **Weeks start on Monday** — use `getMondayOf()` helper
- **No try-catch in route handlers** — middleware handles errors
- **Use absolute imports** — `@/components/...`, `@/lib/...`
- **Prefer classes for services** — but components and hooks are fine as functions
- **Use `CustomError`** for throwing errors, never plain `Error`

## Caching

Two-layer cache to avoid hammering Zoho on every page load:

| Layer                  | TTL    | Scope                   | Purpose                           |
| ---------------------- | ------ | ----------------------- | --------------------------------- |
| **Upstash Redis (KV)** | 30 min | shared across instances | Primary cache — survives restarts |
| **In-memory**          | 5 min  | per-process             | Warm-instance fast path           |

### How it works

1. Client calls `/api/data`
2. Server checks in-memory cache (5 min TTL) → if hit, returns immediately
3. On memory miss, checks Redis (key: `dashboard:v{N}`) → if hit, populates memory and returns
4. On full miss, fetches from Zoho (~50 COQL queries), stores in both caches, sets `cachedAt` timestamp

### Breaking the cache

**When you add new fields or change aggregation logic**, you must bust the cache:

1. **Bump `KV_KEY`** in `lib/aggregate.ts` (e.g. `dashboard:v14` → `dashboard:v15`). Preferred approach — old keys expire naturally.

2. **Hit the cron endpoint** (forces re-fetch without bumping key):

    ```bash
    # Locally
    curl -H "Authorization: Bearer YOUR_CRON_SECRET" http://localhost:5001/api/cron/refresh

    # Production
    curl -H "Authorization: Bearer PROD_CRON_SECRET" https://wire.truva.in/api/cron/refresh
    ```

3. **Restart the dev server** only clears in-memory cache, NOT Redis. You'll still get stale Redis data until its TTL expires.

### When to bump `KV_KEY`

- You added/removed fields to `DashboardData`
- You changed how data is aggregated (new filters, different Zoho queries)
- You changed the shape of existing fields (renamed keys, restructured arrays)

You do **NOT** need to bump for:

- Frontend-only changes (new graphs using existing data)
- Styling or layout changes
- Adding new tabs that consume existing data fields

The footer shows "data refreshed Xm ago" using the `cachedAt` field — this helps users know if they're looking at stale data.

## Testing Changes

There are no automated tests. Verify visually in the browser at `http://localhost:5001`.

To force a fresh data fetch locally:

```bash
curl -H "Authorization: Bearer $(grep CRON_SECRET apps/wire/.env | cut -d'"' -f2)" http://localhost:5001/api/cron/refresh
```

## Pushing Changes

```bash
# From monorepo root
git add apps/wire/...
git commit -m "feat(wire): description of change"
git push origin main
```

- Amplify auto-deploys on push to `main`
- Builds take ~5 minutes
- Production URL: https://wire.truva.in
- Check deploy status: `aws amplify list-jobs --app-id d1cj42w6thrsev --branch-name main --region ap-south-1`

## Data Available in `DashboardData`

| Field            | Type                          | Description                                                   |
| ---------------- | ----------------------------- | ------------------------------------------------------------- |
| `data`           | `RawProperty[]`               | All live properties (with visit/bid counts)                   |
| `acquired`       | `RawProperty[]`               | Properties in "Acquired" status                               |
| `sold`           | `RawProperty[]`               | Properties sold this quarter                                  |
| `visitEvents`    | `VisitEvent[]`                | Every completed visit event (date, property, source, deal ID) |
| `inventoryTrend` | `InventoryPoint[]`            | Weekly live property count with per-market breakdown          |
| `inventoryFlow`  | `InventoryFlowPoint[]`        | Weekly going-live / sold / expired counts                     |
| `clusters`       | `ClusterDef[]`                | Dynamic cluster definitions with market lists                 |
| `pipe`           | `Record<id, PipelineCounts>`  | Pipeline stage counts per property                            |
| `hot`            | `Record<id, HotLead[]>`       | Active warm/offer leads per property                          |
| `weeklyVisits`   | `Record<id, {wk, cp, dir}[]>` | Weekly visit history per property                             |
| `monthlyVisits`  | `Record<id, {mo, cp, dir}[]>` | Monthly visit history per property                            |
| `src`            | `Record<id, [cp, direct]>`    | Total visit counts by source per property                     |
| `feedback`       | `Record<id, FeedbackCounts>`  | Likes/dislikes/deal blockers per property                     |

See `lib/types.ts` for full interface definitions.

## Architecture Notes

- Single API endpoint (`/api/data`) serves ALL dashboard data
- Client renders everything client-side with SWR caching (5 min refresh)
- Server-side aggregation in `lib/aggregate.ts` is ~50 COQL queries batched efficiently
- Redis caches the full aggregated payload (key: `dashboard:v{N}`)
- Bumping `KV_KEY` in `aggregate.ts` invalidates cache without deleting Redis keys
