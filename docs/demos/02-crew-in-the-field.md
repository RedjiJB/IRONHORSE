# Demo 2 — The Crew View (WhatsApp)

**Audience:** prospective clients — this is the half that sells the "crew never opens an app" pitch
**Length:** ~6–8 minutes
**Setup:** text the bot number (**+1 343 204 0439**) from a phone with a number already on the allowlist (e.g. Redji's, or add a demo phone to `channels.whatsapp.allowFrom` in `openclaw.json` beforehand). Model is DeepSeek by default, OpenAI as fallback and for any photo a crew member sends.

Real messages get real replies — the bot is not scripted, so exact wording will vary. What's below is the realistic shape of each exchange, and which real backend action it triggers.

---

## Opening line

> "Everything on the last screen — sites, equipment, POs, alerts — updates from this. A crew member never opens an app or a browser. They just text."

## 1. Who is this? (30 sec)

Send: **"hey"**

- Bot resolves the sender by phone number against the real crew roster (Jake, Mia, Tyler, Nick, Vicki, Redji) and greets by name.
- **Say:** "It just looked up who's texting — same crew table you saw on the Resources page a minute ago. No login, no PIN."

## 2. Checking in for the day (1 min)

Send: **"clocking in at riverside"**

- The bot resolves "riverside" against real site names (142 Riverside Residence), logs a real `timeclock_entries` row, and confirms.
- **Say:** "That just wrote a real punch-in to the same database Payroll reads from. If you flip back to the dashboard right now, Field Time updates immediately."

*(Optional live cut: switch back to the dashboard tab, refresh Field Time, show the new entry.)*

## 3. Asking about the weather (30 sec)

Send: **"whats the weather like there today"**

- Bot calls the real site-weather tool for that site's coordinates.
- **Say:** "Real forecast, not a guess — useful when the call is 'do we lay sod today or hold.'"

## 4. Logging a receipt / spend (1–2 min)

Send a photo of a receipt (or a description): **"grabbed trimmer line at the hardware store, $42, here's the receipt"** + photo.

- Falls to the vision-capable model (OpenAI) to read the photo, then goes through **submit_spend_record** — which lands as a *pending confirmation*, not an instant write.
- **Say:** "Money never moves on a crew member's say-so alone — this queues for the office to approve. You'll see it land in the same Inbox we looked at on the dashboard."

## 5. Flagging low stock (1 min)

Send: **"we're almost out of trimmer line"**

- Bot resolves the consumable, submits a stock adjustment / reorder-relevant note.
- **Say:** "That's the same Site Inventory screen — a crew member doesn't need to know what a 'reorder threshold' is, they just say what they see."

## 6. Asking to stay late (1 min)

Send: **"gonna need another hour at riverside today, running behind"**

- Goes through **submit_shift_extension** — another confirm-before-execute action.
- **Say:** "Same pattern — the crew requests, the office approves. Nothing about pay or scheduling happens unilaterally from a text message."

## 7. Reporting a problem (1 min)

Send: **"truck 204 wont start"**

- Bot can log an IT/equipment issue (**report_it_issue**) or cross-reference the vehicle.
- **Say:** "This is exactly the kind of thing that used to be a phone call the office might miss. Now it's a record, timestamped, tied to the actual vehicle."

## 8. Clocking out (30 sec)

Send: **"heading out, done for the day"**

- Logs the `out` timeclock event.
- **Say:** "And that's a full day — check-in, weather, a receipt, a stock flag, an overtime request, an equipment issue, check-out. All from one text thread, all of it now sitting in the office system you saw a minute ago."

## Close (30 sec)

> "The crew member never learned a new tool. They just texted like they always have — the system did the translating."

---

### Notes for the presenter
- If a message doesn't get the expected response, it's a live LLM — rephrase naturally rather than repeating the script verbatim.
- Every "confirm-before-execute" action (spend records, shift extensions, mileage claims) intentionally does **not** auto-apply — that's a selling point (crew can't unilaterally move money or change payroll), not a limitation. Say so if asked.
- Sender must be on `channels.whatsapp.allowFrom` in `openclaw.json` or the bot won't respond at all — see `docs/demos/README.md`.
