# Xenomit Panel

Multi-instance web control panel for the **Xenomit** DarkOrbit bot — pair bot
instances, watch them live on the game map, start/stop them, and edit their
configuration remotely. Phase 6 adds **managed instances**: bots created and
supervised by the xenomit orchestrator, alongside the existing paired-agent
model. DarkBot-dash style, self-hosted.

## Stack

- **Next.js 15** (App Router) + TypeScript + TailwindCSS 4 — UI + REST
- **Prisma + SQLite** (dev default; Postgres via `docker-compose` for prod —
  the schema uses `Json` columns only, so the switch is a one-line provider
  change + `db push`)
- **Auth.js (NextAuth v5)** — Discord OAuth; a local *Dev Login* provider is
  enabled automatically when Discord creds aren't configured
- **`ws`** — agent + viewer websockets, served in-process by `server.ts`
  (the broadcast boundary in `src/server/hub.ts` is the seam where a Redis
  pub/sub adapter plugs in when scaling past one node)
- **Recharts** — stats charts · **vitest** — protocol contract tests

## Quick start

```bash
npm install
cp .env.example .env          # set AUTH_SECRET (and Discord creds, optional)
npm run db:push               # create prisma/dev.db
npm run dev                   # http://localhost:3000
```

Login with **Dev Login** (or Discord if `AUTH_DISCORD_ID/SECRET` are set),
open the dashboard, click **+ Add instance** → copy the pairing code, then in
a second terminal:

```bash
npm run mock -- --pairing ABCD-EFGH            # pairs and connects one agent
npm run mock -- --tokens-file tokens.json      # reconnect saved tokens
npm run mock -- --instances 8 --token t1 t2 …  # several instances
```

The instance card flips online immediately; open it for the live map, stats,
config editor, commands and log tabs.

## Managed bots (Phase 6)

Managed instances are created by the orchestrator, not paired by hand. For a
full offline loop:

```bash
npm run mock:orch -- --fast --connect-bots   # fake orchestrator on :4010
ORCHESTRATOR_MOCK=1 npm run dev              # panel, same terminal
```

Then on the dashboard: **+ Create bot** → pick password *or* `dosid`
credentials, a module preset, proxy mode and version channel. Credentials are
validated for shape, forwarded to the orchestrator in memory, and **never**
stored in the panel DB, audit metadata, or logs.

- `src/lib/orchestrator.ts` — typed client; every call carries a short-lived
  (≤60 s) EdDSA JWT (`sub`/`role`/`act`/`jti`). Keys come from
  `ORCHESTRATOR_PRIVATE_KEY`/`_PUBLIC_KEY` or the shared
  `.orchestrator-dev.json` dev file.
- `src/server/orchestrator-events.ts` — SSE consumer for `/v1/events`:
  reconnects with `Last-Event-ID`, resyncs bot state after reconnect, mirrors
  `phase`/`desiredState`/`version` into `Instance` cache columns, and pushes
  `phase` messages to viewers.
- `POST /api/orchestrator/instances` — service-authenticated callback the
  orchestrator uses to mint `Instance(kind=managed)` + agent token; re-binds
  rotate the token.
- Lifecycle tab on the instance page: phase chip, pause/resume/restart/
  drain/delete, NeedsHuman prompts (captcha, credential + `dosid` re-entry,
  update), snapshot list/restore, optional trace link.
- `/admin` — fleet console (summary, fleet table, bot detail, bulk drain/
  restart), rollouts, proxies, users & invites, audit search. `role`/`status`
  are re-read from the DB on every request — suspension/demotion apply
  immediately.
- Invite-only signup: `/api/invites/claim` redeems a code into an HMAC cookie
  the Discord sign-in consumes; admins can also pre-approve Discord IDs.
  `ADMIN_DISCORD_IDS` bootstraps the first admins.
- `mock-agent --managed` speaks protocol v1.1 (managed hello, `epoch`,
  `restored`, status `phase`, `seq`'d stat events + `stat_ack`).
- `scripts/orch-smoke.ts` — one-shot client↔mock integration check
  (`npx tsx scripts/orch-smoke.ts` while the mock runs).

## How it fits together

- `server.ts` — one process: Next.js for HTTP/REST, `ws` upgrade handlers for
  `/api/agent/ws` (token-authed agents) and `/api/view/ws` (ticket-authed
  browsers). Agents only ever dial *out*; the panel never connects to them.
- `src/server/hub.ts` — connection registry, latest-frame/status cache,
  300-line log ring, command dispatch with 10 s `command_result` timeout,
  viewer broadcast. Presence (`online`/`last_seen_at`) is broadcast on
  connect/disconnect.
- `src/app/api/**` — REST per spec: instances CRUD + pairing codes,
  status/stats/events/config snapshots, command queueing, `agent/pair`, and
  `view/token` which mints the 60 s HMAC ticket used by the view socket.
- `shared/protocol.ts` — the whole Agent Protocol v1 type surface, shared by
  server, UI and `mock-agent/`.
- `mock-agent/` — synthetic bot: 3 module descriptors covering every
  `SettingKind`, 4 Hz frame stream on a 21000×13100 map (hero + trail, ~30
  NPCs, 6 portals, obstacles incl. one inverted bounds, spawning boxes,
  occasional enemy player), 1 Hz status, ~5 s stat events, realistic command
  semantics (`set_module` fails while running, `update_config` echoes back).

## Security notes

- **No `sid`/`dosid` is ever transported or stored.** Any payload containing
  keys named `sid`, `dosid`, `session_id`, `cookie` (any depth, any case) is
  stripped before relay/persist, and outright rejected on REST input.
- Instance tokens are shown once at pairing, stored SHA-256; unlink revokes
  and kicks the live socket; re-pair codes rotate the token.
- Every viewer subscription is ACL-checked against instance ownership; REST
  routes check session + ownership. Rate limits on pairing, commands and ws
  connects; every command is audit-logged.
- Size caps: ws messages ≤ 64 KiB, entities ≤ 4096.

## Tests

```bash
npm test
```

- `tests/validate.test.ts` — sanitizer, message/config/command validators.
- `tests/protocol.test.ts` — boots the real ws layer on a scratch db and runs
  a scripted agent + viewer through hello → frame/status/event relay →
  command round-trip → sid-scrub → disconnect/offline.
- `tests/managed-protocol.test.ts` — protocol v1.1: `seq`'d stat events get
  `stat_ack`, replays dedupe on `(instanceId, seq)`, managed hello metadata,
  phase events reach viewers and the cache.
- `tests/orchestrator.test.ts` — EdDSA JWT claims/signature, REST semantics,
  error mapping, `Last-Event-ID` forwarding (injected fetch, no network).
- `tests/invites.test.ts` — claim-cookie integrity and the
  `resolveInviteForSignIn` gate (codes, pre-approved Discord IDs, used/
  expired/bound invites).
- `tests/api-guards.test.ts` — `requireUser`/`requireAdmin` re-read
  role/status per request (suspension + demotion are immediate).
- `tests/provision.test.ts` — service-auth provisioning callback: token
  issuance, rotation on re-bind, owner conflict.
- `tests/schema-parity.test.ts` — keeps `prisma/schema.prisma` (SQLite) and
  `prisma/postgres/schema.prisma` model-identical.

## Postgres

`prisma/postgres/schema.prisma` is the production twin (same models,
`postgresql` provider); `prisma/postgres/migrations/` ships the deployable
migration. Against a throwaway Postgres:

```bash
docker run -d --name xenomit-mig -p 5433:5432 \
  -e POSTGRES_USER=xenomit -e POSTGRES_PASSWORD=x -e POSTGRES_DB=xenomit \
  postgres:16-alpine
DATABASE_URL=postgresql://xenomit:x@localhost:5433/xenomit \
  npm run db:deploy:pg
docker rm -f xenomit-mig
```

## Deviations from the suggested stack (and why)

- **SQLite instead of Postgres for dev** — zero-service `npm run dev` on any
  machine; schema avoids Postgres-only features so prod can run Postgres via
  `docker-compose.yml`.
- **In-process ws gateway** instead of a separate service — lets REST dispatch
  commands to live agent sockets without an internal RPC hop; `hub.ts`
  isolates the broadcast seam for a Redis adapter later.
- **HMAC view tickets** instead of passing session cookies to the ws upgrade —
  keeps NextAuth cookie handling inside Next routes entirely.
