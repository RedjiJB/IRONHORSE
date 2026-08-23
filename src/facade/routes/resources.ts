// Task #156 slice G (resources half). Maps this backend's only real
// "who could be assigned to work" concept -- crewMembers.ts -- onto the
// vendored frontend's much richer Resource type (four resource kinds,
// cost rates, project homing, a whole assignments/skills/time-off system)
// -- confirmed exact field names by reading the frontend's own
// src/features/resources/api.ts, not guessed.
//
// Deliberately read-only and thin, per the plan's explicit framing: this
// is "least effort of the eight" -- a crew directory wearing the
// Resource costume, not real feature parity. Every resource reports
// resource_type:'person' (the other three kinds -- crew/equipment/
// subcontractor -- have no distinct backing concept here); cost rate and
// currency are fixed stubs since crew_members carries neither. No
// create/update/delete: crew provisioning stays an ops/MCP-tool
// operation (register_crew_member), not a REST endpoint, matching the
// same decision already made for users in Slice A.
//
// Deliberately NOT built here (see docs/ARCHITECTURE.md Task #156 scope
// table): skills/certifications, availability/time-off windows, per-
// resource cost rates, the assignments board, and project homing --
// none of these have any backing concept in this domain. Skills is a
// clean 404: the frontend's own listSkills() call already has a
// `.catch(() => [])` fallback baked in (confirmed by reading
// ResourcesPage.tsx), so it degrades gracefully with no route needed
// here at all.
import type { Router } from "../router.js";
import { getQueryInt, getQueryParam, sendError, sendJson } from "../context.js";
import { requireStaffRole } from "../auth.js";
import { getCrewMember, listCrewMembers, type CrewMember } from "../../domain/crewMembers.js";

const STUB_RESOURCE_TYPE = "person";
const STUB_COST_RATE = 0;
const STUB_CURRENCY = "USD";

function toFrontendShape(crew: CrewMember) {
  return {
    id: crew.id,
    code: crew.phone,
    name: crew.name,
    resource_type: STUB_RESOURCE_TYPE,
    home_project_id: null,
    contact_id: null,
    default_cost_rate: STUB_COST_RATE,
    currency: STUB_CURRENCY,
    status: crew.active ? "active" : "inactive",
    avatar_url: null,
    notes: "",
    metadata: {},
    created_at: crew.created_at,
    updated_at: crew.created_at, // crew_members has no updated_at column
  };
}

export function registerResourceRoutes(router: Router): void {
  router.get("/api/v1/resources/resources/", async (req, res) => {
    try {
      await requireStaffRole(req);
      const limit = getQueryInt(req, "limit", 50);
      const offset = getQueryInt(req, "offset", 0);
      const type = getQueryParam(req, "type");
      const status = getQueryParam(req, "status");

      // Every crew member reports the same stub resource_type -- asking
      // for 'crew'/'equipment'/'subcontractor' is emulated as "no
      // matches", not pushed into a query against a column that doesn't
      // exist. A status filter is real: it maps onto crew_members.active.
      if (type && type !== STUB_RESOURCE_TYPE) {
        sendJson(res, 200, { items: [], total: 0, offset, limit });
        return;
      }

      const active = status === "active" ? true : status === "inactive" ? false : undefined;
      const all = await listCrewMembers({ active });
      const total = all.length;
      const page = all.slice(offset, offset + limit);
      sendJson(res, 200, { items: page.map(toFrontendShape), total, offset, limit });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get("/api/v1/resources/resources/:id", async (req, res, { id }) => {
    try {
      await requireStaffRole(req);
      const crew = await getCrewMember(id);
      if (!crew) {
        sendJson(res, 404, { detail: "Not found" });
        return;
      }
      sendJson(res, 200, toFrontendShape(crew));
    } catch (err) {
      sendError(res, err);
    }
  });
}
