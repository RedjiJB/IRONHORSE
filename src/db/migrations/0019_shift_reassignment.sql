-- Override/reassign shift on the fly (FEATURES.md §3, no-show handling).
-- The precedent's trigger for this ("exceptions.ts's existing `delay`
-- alert") is a poller this pruned tree doesn't have -- same gap already
-- flagged for duress's re-page escalation and the lone-worker overdue
-- query, not silently assumed to exist here either. This migration only
-- adds what the *manual* override/reassign action itself needs: a
-- supervisor decides on their own initiative (or in response to a guard
-- reporting a no-show by some other channel), not an automated trigger.
--
-- 'reassigned' is distinct from the existing 'no_show' status: a guard
-- who never showed up is 'no_show', but "override" also covers a
-- supervisor proactively swapping guards for other reasons (injury,
-- conflict, better fit) where the outgoing guard did nothing wrong --
-- collapsing both into 'no_show' would misrepresent the reason on their
-- record.
ALTER TYPE shift_status ADD VALUE 'reassigned';

-- The replacement shift's own row (a fresh assignShift-style insert)
-- points back at the shift it replaced, for an auditable trail -- same
-- reasoning as posts.ts's post_id backfill-for-free: existing rows get
-- NULL, no migration of historical data needed.
ALTER TABLE shifts ADD COLUMN reassigned_from_shift_id UUID REFERENCES shifts(id);
