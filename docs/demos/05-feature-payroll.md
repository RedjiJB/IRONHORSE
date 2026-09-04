# Feature Deep-Dive: Payroll & Hours

**Audience:** office/HR perspective (payroll accuracy)
**Length:** ~4–5 minutes
**Setup:** logged in as admin, Payroll page (`/payroll`)

---

## Opening line

> "Payroll that reconciles itself from real timeclock data — no re-entry, no spreadsheet, no math errors."

## 1. The current period (1 min)

Land on `/payroll`.

- **Say:** "This is this week's payroll, reconciled live from real timeclock punches."
- Show the three demo crew members: Jake, Mia, Tyler.
- Point at **Jake's hours**: 40 hours, $1,140.00 (28.50/hr × 40).
- **Say:** "Every hour there comes straight from his actual clock-in/clock-out timestamps. We didn't re-key anything."

## 2. Click into one crew member (2 min)

Click Jake's row.

- **Say:** "Here's every single punch Jake made this week."
- Show the list of timeclock entries: punch-in at Riverside on Monday 7:00 AM, punch-out at 3:00 PM.
- **Say:** "This isn't a self-reported timesheet — this is GPS-verified check-in data. He clocked in at the actual job site."
- Point at the **geofence-verified** indicator (if visible, or mention it in the data).
- **Say:** "We verify his location matched the site when he clocked in. No ghost clocking from home."

## 3. Pay rate edit (1 min)

**Say:** "Jake's hourly rate is $28.50 — that's set once, reused for every week's calculation. If his rate changes (a raise, a new role), we update it here and it applies going forward."

- Show the pay rate field (read-only for this demo, but note where it's managed).

## 4. Comparison view (optional, 1 min)

If the payroll page has a comparison mode:
- **Say:** "Here's what changed week-to-week. Jake worked 2 extra hours this week (40 vs 38 last week) — the system caught that automatically."

## 5. Close (30 sec)

> "Payroll without re-entry. Accuracy without spreadsheets. That's what it means to have one system of record."

---

### Notes for the presenter

- The demo data has 3 days of backdated timeclock entries (Mon-Wed last week).
- Hours are real calculations from punch pairs, not faked.
- If asked about benefits/deductions: "Not yet — payroll is straight-time only today. Deductions are on the roadmap."
- If asked about multi-pay-rate scenarios (e.g., overtime, per-job billing): "That's a future feature — today one crew member has one rate."
