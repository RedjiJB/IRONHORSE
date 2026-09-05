// Posts + certification-gating checks over the façade (DOMAIN-DESIGN.md
// §5, resolved 2026-09-04). Supervisor-only for writes (creating posts,
// attaching requirements); reading posts/compliance only needs a valid
// token.
import type { Router } from "../router.js";
import { readJsonBody, sendError, sendJson } from "../context.js";
import { requireBearerToken, requireSupervisor } from "../auth.js";
import { addRequiredCertification, createPost, listPosts, listRequiredCertifications } from "../../domain/posts.js";
import { checkGuardPostCompliance } from "../../domain/certifications.js";
import { getQueryParam } from "../context.js";

export function registerPostRoutes(router: Router): void {
  router.post("/posts", async (req, res) => {
    try {
      await requireSupervisor(req);
      const body = await readJsonBody<{ siteId?: string; name?: string }>(req);
      if (!body.siteId || !body.name) {
        sendJson(res, 400, { detail: "siteId and name are required" });
        return;
      }
      const post = await createPost({ siteId: body.siteId, name: body.name });
      sendJson(res, 200, { post });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get("/posts", async (req, res) => {
    try {
      await requireBearerToken(req);
      const siteId = getQueryParam(req, "siteId");
      const posts = await listPosts({ siteId });
      sendJson(res, 200, { posts });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post("/posts/:id/required-certifications", async (req, res, params) => {
    try {
      await requireSupervisor(req);
      const body = await readJsonBody<{ certType?: string }>(req);
      if (!body.certType) {
        sendJson(res, 400, { detail: "certType is required" });
        return;
      }
      const requirement = await addRequiredCertification({ postId: params.id, certType: body.certType });
      sendJson(res, 200, { requirement });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get("/posts/:id/required-certifications", async (req, res, params) => {
    try {
      await requireBearerToken(req);
      const requirements = await listRequiredCertifications(params.id);
      sendJson(res, 200, { requirements });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get("/posts/:id/compliance", async (req, res, params) => {
    try {
      await requireBearerToken(req);
      const guardId = getQueryParam(req, "guardId");
      const asOfDate = getQueryParam(req, "asOfDate");
      if (!guardId || !asOfDate) {
        sendJson(res, 400, { detail: "guardId and asOfDate query params are required" });
        return;
      }
      const result = await checkGuardPostCompliance(guardId, params.id, asOfDate);
      sendJson(res, 200, result);
    } catch (err) {
      sendError(res, err);
    }
  });
}
