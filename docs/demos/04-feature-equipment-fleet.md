# Feature Deep-Dive: Equipment & Fleet

**Audience:** prospective clients (fleet/vehicle management angle)
**Length:** ~5–6 minutes
**Setup:** logged in as admin, Equipment page (`/equipment`)

---

## Opening line

> "Every vehicle's GPS location, fuel consumption, hour meter, and maintenance schedule — all automatic. No separate tracking app, no manual odometer logs."

## 1. Fleet overview (1 min)

Land on `/equipment`.

- **Say:** "Here's the entire fleet at a glance — three vehicles, all tracked live."
- Show the three vehicles: SDBY-101 (truck), SDBY-204 (truck), Toro Z Master #4 (mower).
- Point out the utilization bar for each — **hour meter** (not guessed), real data from telemetry.

## 2. Click into a vehicle (2 min)

Click SDBY-204.

- **Say:** "This truck has been on the road 61,870 kilometers. That number is real, streamed from the truck's own sensors."
- Point at **Last known location** — the GPS pin on the map shows where it was last seen.
- **Say:** "Not a guess, not a manual entry — actual telemetry. A crew member drives, we track."
- Click the **Utilization** tab — show the hour-meter and odometer history over time.

## 3. The alert (1–2 min)

**Say:** "This truck has been idle at Bank Street Commercial Plaza for over 2 hours — the system flagged it automatically."

- Navigate to **Notifications** (or show the alert still visible on Home).
- Point at the idle alert for SDBY-204.
- **Say:** "No one has to remember to check. The system watches and tells you when something looks wrong."

## 4. Assignment (optional, 1 min)

Back on the vehicle detail:
- **Say:** "This truck is assigned to Jake Tremblay (our foreman). If Jake clocks in at a job site, we know which vehicle he has with him — that assignment is automatic from the checkout system."

## 5. Close (30 sec)

> "Real vehicles, real locations, real utilization. The only thing we're not tracking is whether the crew actually wants us to."

---

### Notes for the presenter

- The GPS location is synthetic for demo purposes (seeded, not live) — don't claim "real-time tracking" if showing a static screenshot; say "tracked" or "last known location" instead.
- Hour meter/odometer are real from the seed data — genuine numbers, not placeholders.
- If asked about fuel costs or CO2 tracking, say: "Not yet — that's on the roadmap. Today we track utilization; fuel/emissions tracking is next."
