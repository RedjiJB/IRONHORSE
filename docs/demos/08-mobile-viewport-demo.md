# Mobile Viewport Demo: What Works, What Doesn't

**Audience:** prospective clients (mobile/field use angle) + internal UX review
**Length:** ~6–8 minutes
**Setup:** resize browser to mobile width (375px), or use phone emulator

**IMPORTANT:** This is a *reality check* demo, not a highlight reel. Be honest about the gaps.

---

## Opening line

> "This is what the dashboard looks like on a phone. The good news: crew members don't actually need it much — they use WhatsApp. But if they do open a browser, here's what they get."

## 1. Home page on mobile (1 min)

Resize to mobile (375px width) or take a screenshot on a real phone (if testing).

- **Say:** "The home page works fine on mobile — weather cards, site overview, no overflow."
- Scroll down slowly to show each section.
- **Say:** "Everything fits, nothing is cut off. This part is ready for field use."

## 2. Equipment page — the overflow (2–3 min)

Navigate to `/equipment`.

- **Say:** "Here's where the mobile experience gets rough. The table is too wide for the screen."
- Show the **table with horizontal scroll** — crew, equipment status, utilization columns all squeeze into 375px.
- **Say:** "To see the full picture, you have to scroll sideways inside the table. That's not great on a phone."
- *Scroll right within the table* to show the STATUS and ACTION columns.
- **Say:** "The STATUS column and the edit/delete buttons are off-screen. You have to know to scroll to see them."

## 3. Resources page — same issue (1 min)

Navigate to `/resources`.

- **Say:** "Same problem here. The crew list is a table, it overflows."
- Show the horizontal scroll needed to see all columns.
- **Say:** "On a desktop, this layout is fine. On a phone, it's clunky."

## 4. Procurement, Site Inventory — same pattern (1 min)

Quick flips to `/procurement` and `/site-inventory`.

- **Say:** "Every data-heavy page has this same issue. It works, but it's not elegant."

## 5. What works on mobile (1–2 min)

Go back to **Home** or **Map**.

- **Say:** "Single-column layouts work great — the map, notifications, the home summary cards. Those are mobile-friendly."
- Show the **Map** page zooming and panning on a narrow screen.
- **Say:** "If a crew member just wants to check a map or read alerts, the mobile experience is fine."

## 6. Honest close (1 min)

> "The dashboard is **read-only** on mobile, which is fine — crew members use WhatsApp for any real work. But the table overflow is tracked as a known issue and will be fixed. It's not broken; it's just waiting for a responsive redesign."

---

## Deployment checklist (optional, for internal audiences)

If you're showing this to your team:

- [ ] Table-overflow issue is tracked in `docs/ARCHITECTURE.md` backlog
- [ ] Mobile UI is **not a blocker** for launch — WhatsApp is the crew interface
- [ ] Desktop experience is the priority; mobile enhancement is phase 2
- [ ] The overflow can be fixed by switching tables to a card layout on narrow screens (a known pattern, several slices of work)

---

## Notes for the presenter

- **Don't pretend it's perfect.** Say "this is a known limitation" — prospects respect honesty more than spin.
- **Reframe the use case.** Crew members have their phones for WhatsApp. A crew member opening the dashboard on their phone is the *exception*, not the workflow.
- **The office views it on a laptop.** That's where the real experience matters. Emphasize that.
- **If asked "when will mobile be fixed?"** — Say: "Q4 / early next year, as part of the UI polish phase. It's tracked and prioritized, but crew WhatsApp comes first."
- **If asked "can we use tablets?"** — Say: "Tablets work fine — they're wide enough to avoid the overflow. The problem is phones specifically."
