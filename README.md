# IRONHORSE

Security-guard operations platform (client sites, guard shifts, patrols, incidents,
supervisors, optional camera integration). Currently **pre-repo / planning-stage** —
this documentation exists to carry the design conversation into a fresh session
without losing context.

**Architectural precedent**: the design leans heavily on patterns already proven in
`dcentral-fieldops` (the Sod Boys Ltd field-operations system at
`C:\Users\jredj\dev\dcentral-fieldops`) — same domain-module style, same
capability-gating approach, same sovereignty-tiering discipline. Read that repo's
`src/domain/*.ts` and `policy/sovereignty_tiers.yaml` for the concrete shape these
docs refer to before writing any new code here.

Start with [`docs/PROJECT-BRIEF.md`](docs/PROJECT-BRIEF.md) — the full planning
transcript, organized and de-duplicated, with open questions flagged explicitly.
