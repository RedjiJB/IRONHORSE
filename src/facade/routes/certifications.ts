// Compliance-dashboard basics (FEATURES.md §7) over the façade --
// read-only visibility for supervisors, no gating logic (see
// certifications.ts's own comment; that's Phase 2, needs a posts concept).
import type { Router } from "../router.js";
import { readJsonBody, sendError, sendJson } from "../context.js";
import { requireSupervisor } from "../auth.js";
import { addCertification, listExpiredCertifications, listExpiringSoonCertifications } from "../../domain/certifications.js";
import { getQueryInt } from "../context.js";

export function registerCertificationRoutes(router: Router): void {
  router.get("/compliance/expiring-certifications", async (req, res) => {
    try {
      await requireSupervisor(req);
      const daysAhead = getQueryInt(req, "daysAhead", 30, { min: 1, max: 365 });
      const certifications = await listExpiringSoonCertifications(daysAhead);
      sendJson(res, 200, { certifications });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get("/compliance/expired-certifications", async (req, res) => {
    try {
      await requireSupervisor(req);
      const certifications = await listExpiredCertifications();
      sendJson(res, 200, { certifications });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post("/certifications", async (req, res) => {
    try {
      await requireSupervisor(req);
      const body = await readJsonBody<{ guardId?: string; certType?: string; issuedAt?: string; expiresAt?: string }>(req);
      if (!body.guardId || !body.certType || !body.expiresAt) {
        sendJson(res, 400, { detail: "guardId, certType, and expiresAt are required" });
        return;
      }
      const cert = await addCertification({
        guardId: body.guardId,
        certType: body.certType,
        issuedAt: body.issuedAt,
        expiresAt: body.expiresAt,
      });
      sendJson(res, 200, { certification: cert });
    } catch (err) {
      sendError(res, err);
    }
  });
}
