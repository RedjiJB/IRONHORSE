# Feature Deep-Dive: Procurement & Purchase Orders

**Audience:** office/operations (supply chain perspective)
**Length:** ~5 minutes
**Setup:** logged in as admin, Procurement page (`/procurement`)

---

## Opening line

> "Every purchase order, from draft to fulfilled, with vendor info and cost tracking built in. One place to see what's been ordered, what's pending, and what's arrived."

## 1. The three active orders (1–2 min)

Land on `/procurement`.

- **Say:** "Three active purchase orders for three different vendors."
- Point at each:
  - **Ottawa Turf Supply Co.** — sod rolls, $2,450, **Issued** (sent to vendor, awaiting delivery)
  - **Petro-Canada Fleet Fuel** — diesel delivery, $680, **Issued**
  - **Stihl Dealer Ottawa** — trimmer line + parts, $340, **Draft** (not yet sent to vendor)

## 2. Click into the sod order (2–2.5 min)

Click the Ottawa Turf Supply row.

- **Say:** "This is the sod order for 142 Riverside Residence — 500 square feet of Kentucky Bluegrass."
- Point at the **Vendor contact info**: email and lead time (3 days).
- **Say:** "When we issue this order, the system knows who to send it to and how long it typically takes to arrive. We don't have to look up the vendor separately."
- Show the **Status** — currently "Issued" (we've already sent it).
- **Say:** "Once it arrives and the crew verifies it, we mark it fulfilled. No separate receiving system — the crew texts 'got the sod' and it updates here."

## 3. Create a draft order (optional, 2 min)

If comfortable doing it live:
- Click **New purchase order**.
- **Say:** "Let's say we need more trimmer line — I'll create a draft order."
- Fill in: vendor (Stihl), items (trimmer line, qty 10), cost ($150).
- **Say:** "It starts as a draft — we can review it, make sure the math is right, before we actually send it to the vendor."
- Click **Save**.
- **Say:** "Now it's in our system, ready to issue whenever we're sure. No more 'did we order that or not' conversations."

## 4. Cost summary (1 min)

Back on the Procurement page:
- **Say:** "Total spend this month: $3,470 across all three orders. That number updates automatically as orders come in and get fulfilled."

## 5. Close (30 sec)

> "Procurement that tracks itself. Vendors, costs, statuses — all in one place. No email threads, no 'where's that order' calls."

---

### Notes for the presenter

- The three seeded orders are real — genuine vendors, real costs, real lead times.
- The **Issued** status means we've sent it (simulated for demo); in live use, there's a real email or portal integration with the vendor.
- If asked about multi-item orders or splitting: "Each order can have multiple line items — we kept this one simple for the demo."
- If asked about approval workflows: "No approval gate exists yet — that's a future feature. Today, the person creating the order is responsible for it."
