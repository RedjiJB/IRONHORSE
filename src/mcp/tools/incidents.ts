import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import {
  addIncidentAction,
  getCurrentSeverity,
  getIncident,
  listIncidentActions,
  listIncidents,
  reportIncident,
} from "../../domain/incidents.js";
import { triggerDuressAlert } from "../../domain/duress.js";
import { requireCapability } from "../middleware.js";
import { credentialArg, deniedResult } from "./shared.js";

const severitySchema = z.enum(["low", "medium", "high", "critical"]);
const statusSchema = z.enum(["open", "escalated", "resolved"]);
const actionTypeSchema = z.enum(["escalated", "reassigned", "note_added", "resolved"]);

export function registerIncidentTools(server: McpServer): void {
  server.registerTool(
    "report_incident",
    {
      title: "Report Incident",
      description: "A guard reports an incident at a site. Minimum tier: 2.",
      inputSchema: z.object({
        ...credentialArg,
        siteId: z.string().uuid(),
        reportedByGuardId: z.string().uuid(),
        category: z.string(),
        severity: severitySchema,
        summary: z.string(),
        lat: z.number().optional(),
        lng: z.number().optional(),
      }),
    },
    async ({ credentialJwt, ...args }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:report_incident", 2);
        const incident = await reportIncident(args);
        return { content: [{ type: "text", text: JSON.stringify(incident) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "list_incidents",
    {
      title: "List Incidents",
      description: "Lists incidents, optionally filtered by site/status. Minimum tier: 0 (read-only).",
      inputSchema: z.object({ ...credentialArg, siteId: z.string().uuid().optional(), status: statusSchema.optional() }),
    },
    async ({ credentialJwt, ...filter }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:list_incidents", 0);
        const incidents = await listIncidents(filter);
        return { content: [{ type: "text", text: JSON.stringify(incidents) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "get_incident",
    {
      title: "Get Incident",
      description: "Fetches a single incident by id, along with its current (possibly escalated) severity. Minimum tier: 0 (read-only).",
      inputSchema: z.object({ ...credentialArg, id: z.string().uuid() }),
    },
    async ({ credentialJwt, id }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:get_incident", 0);
        const incident = await getIncident(id);
        if (!incident) return { content: [{ type: "text", text: "Not found" }], isError: true };
        const currentSeverity = await getCurrentSeverity(id);
        return { content: [{ type: "text", text: JSON.stringify({ ...incident, currentSeverity }) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "add_incident_action",
    {
      title: "Add Incident Action",
      description:
        "Records an action on an incident (escalate/reassign/note/resolve) -- append-only, never overwrites the incident's original severity. Minimum tier: 2.",
      inputSchema: z.object({
        ...credentialArg,
        incidentId: z.string().uuid(),
        actorGuardId: z.string().uuid(),
        actionType: actionTypeSchema,
        note: z.string().optional(),
        newSeverity: severitySchema.optional(),
      }),
    },
    async ({ credentialJwt, ...args }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:add_incident_action", 2);
        const action = await addIncidentAction(args);
        return { content: [{ type: "text", text: JSON.stringify(action) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "list_incident_actions",
    {
      title: "List Incident Actions",
      description: "Lists an incident's full action log. Minimum tier: 0 (read-only).",
      inputSchema: z.object({ ...credentialArg, incidentId: z.string().uuid() }),
    },
    async ({ credentialJwt, incidentId }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:list_incident_actions", 0);
        const actions = await listIncidentActions(incidentId);
        return { content: [{ type: "text", text: JSON.stringify(actions) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "trigger_duress_alert",
    {
      title: "Trigger Duress Alert",
      description:
        "A guard triggers a silent duress/panic alert -- creates a critical incident and pages every active supervisor/admin with the guard's location. Minimum tier: 2.",
      inputSchema: z.object({
        ...credentialArg,
        guardId: z.string().uuid(),
        siteId: z.string().uuid(),
        lat: z.number(),
        lng: z.number(),
      }),
    },
    async ({ credentialJwt, ...args }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:trigger_duress_alert", 2);
        const result = await triggerDuressAlert(args);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );
}
