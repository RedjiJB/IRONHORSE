# dcentral-fieldops

D-Central-native successor to [`fieldops-system`](../fieldops-system) (v1) — built clean-slate, meant to eventually replace v1 in production. v1 stays live for the real client throughout this build. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the real status, technology decisions, and known gaps — read that before assuming anything here is further along than it is.

## Setup

```bash
git submodule update --init --recursive   # pulls vendor/openconstructionerp (the frontend)
npm install
docker compose up -d   # postgres on host port 5433 -- deliberately not 5432, see docker-compose.yml
cp .env.example .env   # fill in DATABASE_URL (port 5433), NODE_DID_DOMAIN, VERAMO_KMS_SECRET_KEY
npm run migrate
npm run sync:policy    # after reviewing and approving policy/sovereignty_tiers.yaml
npm test
```

## Frontend

`vendor/openconstructionerp` is a git submodule of [OpenConstructionERP](https://github.com/datadrivenconstruction/OpenConstructionERP) (AGPL-3.0) — only its `frontend/` subdirectory is used. See `docs/ARCHITECTURE.md`'s "Frontend" section for the license implications and what's actually left to do to wire it up (not started).

## Scripts

- `npm run build` — typecheck + compile to `dist/`
- `npm run migrate` — apply pending Postgres migrations (`src/db/migrations/`)
- `npm run sync:policy` — sync `policy/sovereignty_tiers.yaml` into the `sovereignty_tiers` table
- `npm run mcp:stdio` / `npm run mcp:http` — run the MCP server over each transport
- `npm test` — vitest

## Status

Phase 1 (foundational identity/capability/MCP skeleton, no domain logic). See `docs/ARCHITECTURE.md`'s Status section for exactly what's built, typechecked, and actually verified vs. written-but-unverified.
