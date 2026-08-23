// Task #156 slice G (teams half). The vendored frontend's Team Visibility
// module is entirely project-scoped (every route in
// src/features/teams/api.ts hangs off /project/:projectId, and TeamsPage
// gates every query on `enabled: !!projectId`) and models a real
// multi-team, multi-role, restriction/access-matrix permission system --
// none of which exists in this domain. Per the plan's explicit framing,
// this is the thinnest possible pass: one synthetic team ("All Crew")
// containing every crew member as a membership, echoing whatever
// projectId the frontend happens to be holding (this backend has no
// Projects concept, so the id isn't validated or persisted against
// anything -- same pattern already used in payroll/site-inventory/
// procurement for the same reason).
//
// Deliberately NOT built here (see docs/ARCHITECTURE.md Task #156 scope
// table): team CRUD (there is exactly one team and it isn't creatable or
// deletable), membership CRUD (membership mirrors crew_members 1:1, nothing
// to add/remove independently), the roster sub-system (trades,
// certifications, allocation -- a materially different concept with no
// backing data), and the whole restrictions/access-matrix visibility
// system (no per-record visibility concept exists anywhere in this
// domain). All of these 404 in isolation; per-widget query isolation on
// this page (confirmed already for every other project-gated module in
// this task) means an isolated 404 doesn't crash the rest of the tab.
import type { Router } from "../router.js";
import { sendError, sendJson } from "../context.js";
import { requireStaffRole } from "../auth.js";
import { listCrewMembers, type CrewMember } from "../../domain/crewMembers.js";

const SYNTHETIC_TEAM_ID = "all-crew";

function toMembership(crew: CrewMember) {
  return {
    id: crew.id,
    team_id: SYNTHETIC_TEAM_ID,
    user_id: crew.id,
    role: "member",
    email: "",
    full_name: crew.name,
    is_active: crew.active,
    created_at: crew.created_at,
  };
}

async function buildSyntheticTeam(projectId: string) {
  const crew = await listCrewMembers();
  const memberships = crew.map(toMembership);
  return {
    id: SYNTHETIC_TEAM_ID,
    project_id: projectId,
    name: "All Crew",
    name_translations: null,
    description: "Every crew member on this node -- this backend has no separate team concept.",
    kind: "internal" as const,
    sort_order: 0,
    is_default: true,
    is_active: true,
    metadata: {},
    memberships,
    member_count: memberships.length,
    restricted_record_count: null,
    created_at: crew[0]?.created_at ?? new Date().toISOString(),
    updated_at: crew[0]?.created_at ?? new Date().toISOString(),
  };
}

export function registerTeamRoutes(router: Router): void {
  router.get("/api/v1/teams/project/:projectId", async (req, res, { projectId }) => {
    try {
      await requireStaffRole(req);
      sendJson(res, 200, [await buildSyntheticTeam(projectId)]);
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get("/api/v1/teams/:teamId/members", async (req, res, { teamId }) => {
    try {
      await requireStaffRole(req);
      if (teamId !== SYNTHETIC_TEAM_ID) {
        sendJson(res, 404, { detail: "Not found" });
        return;
      }
      const crew = await listCrewMembers();
      sendJson(res, 200, crew.map(toMembership));
    } catch (err) {
      sendError(res, err);
    }
  });
}
