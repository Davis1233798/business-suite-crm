# Workspace refactor — 2026-10-31

The portfolio has no global navigation strip. Its system links open station login pages. Station workspaces no longer have a top account header; switching systems always opens the selected system login, including when that system has an existing session. Sign-out remains available in the sidebar on desktop and mobile.

Login defaults to English and supports Traditional Chinese. The explicit choice is stored in `suite-language` and initializes the station document language, labels, printing and traffic workbench. Existing business record content is not translated.

MES and commerce back-office pages include an isolated load workbench. It issues 48–512 real HTTP writes with 4–32 concurrent clients. Finite capacity, repeated request keys, SQL transactions and persisted queued/processed records demonstrate oversell/over-report protection and idempotent consumption. The queue is manually drained. The lab uses dedicated SQLite tables and never changes operational orders or production reports. SQLite has one connection; this is a contention/correctness demonstration, not a production throughput benchmark or distributed message broker.

Verification: `npm test`, `go -C backend test ./...`, `npx tsc --noEmit`, `npm run build`, `npm run web:build`, and `python scripts/verify-traffic-http.py`. The HTTP verifier uses a disposable database and checks both domains, capacity saturation, retries, queue consumption and readonly denial. Browser QA covers login, language persistence, switching back to login, a commerce burst and consumer results.

These are local repository changes. Public deployments require both the station Go binary/static bundle and the portfolio build to be updated together.
