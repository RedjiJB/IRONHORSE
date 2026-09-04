# Demo 1 — The Office Command Center (Dashboard)

**Audience:** prospective clients (landscaping/field-service business owners and office staff)
**Length:** ~10–12 minutes
**Presenter logs in as:** `redji@thesodboysltd.ca` (admin) — or use `nick@thesodboysltd.ca` for a business-owner-eye view
**Setup:** demo data is seeded (3 job sites, 3 crew members, equipment, POs, alerts) — see `demo-data-manifest.json` for exact IDs if you need to reference specific records

---

## Opening line

> "This is the exact system a real landscaping crew uses today — Sod Boys Ltd, running live in Ottawa. Everything you're about to see is real data flowing through a real backend. Nothing here is a mockup."

## 1. Home — the morning glance (1 min)

Land on `/` after login.

- **Say:** "This is what an owner or dispatcher sees first thing in the morning — every active job site, at a glance."
- Point at the four site cards: three real client job sites (142 Riverside Residence, 88 Elmwood Crescent, Bank Street Commercial Plaza) plus the depot (HQ).
- Point at the **Locations & weather** map widget — click through to show the map itself.
- **Say:** "Weather's pulled live per site — matters when you're deciding whether today's the day to lay sod."
- Point at **System Status** — "API, database, and AI providers, all self-reported health. If something's down, the office knows before a crew member has to call in."

## 2. Inbox — nothing slips through (1–2 min)

Scroll to the Inbox card, or navigate to **Notifications**.

- Two real alerts are live: a maintenance-due alert on the Sod Cutter, and an idle-vehicle alert for truck SDBY-204 sitting at Bank Street Plaza.
- **Say:** "This isn't a manual checklist — the system watches vehicle telemetry and equipment service intervals itself and raises these automatically. No one has to remember to check."
- Click into one alert, show **Mark all read**.
- Mention the **Recent activity** feed just below — a single timestamped record of everything that happened today (alerts, POs, timeclock), the audit trail an owner would want if a customer ever disputes an invoice.

## 3. Equipment & Fleet (2 min)

Navigate to **Equipment**.

- Show the three seeded vehicles: two trucks (SDBY-101, SDBY-204) and a mower (Toro Z Master #4).
- Click into SDBY-204 — show its detail drawer: hour meter, odometer, last-known location.
- **Say:** "Every vehicle's last GPS ping is tracked automatically from telemetry — no separate GPS device to buy, no separate app."
- Point out the utilization tab — real hour-meter/odometer history, not guessed.

## 4. Resources & Crew (1–2 min)

Navigate to **Resources**.

- Show the crew table: Jake Tremblay (foreman), Mia Chen, Tyler Brooks — plus Nick as owner, Vicki as HR/management.
- **Say:** "This is the same roster the WhatsApp bot uses to know who's texting it — one source of truth, not two systems that can drift apart."
- Click into Jake's row — show his pay rate, assigned equipment.

## 5. Procurement (1–2 min)

Navigate to **Procurement**.

- Three real purchase orders: sod rolls from Ottawa Turf Supply Co. ($2,450), fuel from Petro-Canada Fleet Fuel ($680), and parts from Stihl Dealer Ottawa.
- Click into the sod order — show status pipeline (draft → issued).
- **Say:** "A foreman doesn't need to call the office to know if the sod order shipped — it's right here, and the vendor's contact info travels with it."

## 6. Site Inventory (1 min)

Navigate to **Site Inventory**.

- Show consumables: diesel fuel, grass seed, fertilizer, trimmer line — each with a reorder threshold.
- **Say:** "When trimmer line drops below five spools, the system flags it before a crew shows up to a job without one."

## 7. Payroll (1–2 min)

Navigate to **Payroll**.

- Show the current period's hours for Jake, Mia, and Tyler — pulled directly from real timeclock punches, not re-entered by hand.
- **Say:** "This is the number that used to take someone an afternoon with a spreadsheet, cross-referencing paper timesheets. Here it's just... correct, continuously."

## 8. Site Cost Summary (1 min)

Navigate to `/5d` (Site Cost Summary).

- Pick 142 Riverside Residence.
- **Say:** "Real spend against a budget — purchase orders and labour cost, blended live. An owner can see mid-job whether a site is trending over budget instead of finding out at invoicing."

## 9. Close (30 sec)

> "Every screen you just saw is backed by the same data the crew touches from their phones over WhatsApp — which is the next demo. Nothing here is entered twice."

---

### Fallback / if something looks empty
If a page shows an empty state, the demo data may need re-seeding — check `demo-data-manifest.json` in the repo root for the record IDs, or re-run the seed script (`docs/demos/README.md` has the procedure).
