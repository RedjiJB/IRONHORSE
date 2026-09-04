# Scenario: Problem → Solution (Live Responses)

**Audience:** prospective clients (show-the-system-working angle)
**Length:** ~4–6 minutes per scenario, mix and match
**Setup:** two screens if possible (WhatsApp on phone, dashboard on laptop)

---

Each scenario is a complete "problem appears, system responds" story. Pick one or combine several for a longer demo.

---

## Scenario A: Low Stock Flag

**The problem:** Crew member at a job site realizes they're running low on trimmer line.

**Setup:** start with `/site-inventory`, show **Trimmer line** at 2 spools (below the 5-spool reorder threshold).

1. **On the phone**, send: **"almost out of trimmer line at riverside"**
2. **Bot responds:** "Logged — trimmer line reorder flagged. The office will see it."
3. **On the dashboard**, switch to `/site-inventory` and refresh.
   - **Say:** "Watch — the system just flagged this before a crew shows up to a job without one."
   - Point at trimmer line, still showing low (or a new alert badge if implemented).

**Close:** "The crew doesn't need to know what a 'reorder threshold' is. They just say what they see, and the system knows to act on it."

---

## Scenario B: Maintenance Due

**The problem:** Equipment is overdue for scheduled service.

**Setup:** start with `/equipment`, show the **Sod Cutter** detail. Point at service interval (90 days); it's now at day 92 (overdue).

1. **On the dashboard**, navigate to **Notifications** — you'll see a **Maintenance due** alert for the Sod Cutter.
   - **Say:** "This was raised automatically. No one had to remember when the last service was."
2. **On the phone** (optional), send: **"when was the sod cutter last serviced?"**
3. **Bot responds:** "Sod Cutter due for scheduled service — maintenance was last done 92 days ago."
   - **Say:** "The crew can ask in plain language and get the facts straight."

**Close:** "Scheduled maintenance stops being guesswork and becomes a tracked reality."

---

## Scenario C: Idle Vehicle Alert

**The problem:** A truck has been sitting at a job site for over 2 hours — is something wrong?

**Setup:** start with **Notifications** (or **Home**), show the **Idle alert** for truck SDBY-204 at Bank Street Commercial Plaza.

1. **On the dashboard**, click the alert.
   - **Say:** "The system detected this truck at Bank Street Plaza, stationary, for 2+ hours. Is the crew still working there? Did something break down?"
2. **On the phone** (optional), send: **"whats going on with truck 204?"**
3. **Bot responds:** "Truck SDBY-204 has been idle at Bank Street Commercial Plaza for over 2 hours."
   - **Say:** "No phone call from the crew needed — the system caught it first and the crew can respond."
4. **On the phone**, send: **"we're on lunch break, all good"** (or **"truck wont start, need help"**).

**Close:** "Early warning system. You know about problems before they become crises."

---

## Scenario D: Receipt & Approval

**The problem:** Crew member buys supplies and needs to log the expense.

**Setup:** start with **Notifications**.

1. **On the phone**, send: **"grabbed trimmer line at the hardware store, $42"** (or attach a photo of a receipt).
2. **Bot responds:** "Logged — $42 spend record. Sent to the office for approval."
3. **On the dashboard**, navigate to **Notifications** and refresh.
   - Point at a new **pending confirmation** entry.
   - **Say:** "The spend is recorded, but money doesn't move until someone approves it. The crew can't unilaterally spend; the office keeps control."
4. **(Optionally, if you're logged in as admin)** click **Approve** on the record.
   - **Say:** "Once approved, it's applied to the crew member's account and the payroll system."

**Close:** "Trust and transparency. Crew submits, office verifies, system records."

---

## Scenario E: Real-Time Clock-In

**The problem:** Crew member arrives at a job site and needs to clock in.

**Setup:** start with **Field Time** page (or **Payroll**), showing the current period's hours. Note Jake's current hours: 40.

1. **On the phone**, send: **"clocking in at riverside"**
2. **Bot responds:** "Logged — Jake clocked in at 142 Riverside Residence, 8:03 AM."
3. **On the dashboard**, without closing the phone window, refresh **Field Time**.
   - Point at a new entry for Jake at 142 Riverside.
   - **Say:** "That punch-in just appeared here — same database, immediately. No sync buttons, no app refresh delay."

**Close:** "The office and the field are looking at the same data, in real time."

---

## Notes for all scenarios

- **Responses are live LLM-generated**, not scripted — exact wording will vary. The key is showing the *shape* of the response (confirmation, cross-reference, approval needed).
- **Timing varies** — some responses come back in 1–2 seconds, others may take 5+ if the LLM is reasoning. That's okay; say "the system is thinking" if there's a pause.
- **Mix and match** — you don't need to do all five scenarios in one video. Pick 2–3 that matter most to your audience:
  - For **operations/logistics**: Scenarios A, B, E (preventive).
  - For **office/finance**: Scenario D (expense control).
  - For **fleet/dispatch**: Scenario C (utilization).
- **Camera angles**: show both the phone and dashboard in the same shot if possible (side-by-side), or cut between them. The magic is "I do one thing on the phone, the office sees it instantly."
