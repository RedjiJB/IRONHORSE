import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import {
  abandonPatrolRun,
  completePatrolRun,
  createPatrolRoute,
  listPatrolRoutes,
  listPatrolRuns,
  startPatrolRun,
} from "../../domain/patrols.js";
import {
  createCheckpoint,
  listCheckpointScans,
  listCheckpoints,
  scanCheckpoint,
} from "../../domain/checkpoints.js";
import { requireCapability } from "../middleware.js";
import { credentialArg, deniedResult } from "./shared.js";

const verificationMethodSchema = z.enum(["qr", "nfc", "gps"]);
const patrolRunStatusSchema = z.enum(["in_progress", "completed", "abandoned"]);

export function registerPatrolTools(server: McpServer): void {
  server.registerTool(
    "create_patrol_route",
    {
      title: "Create Patrol Route",
      description: "Creates a named patrol route at a site. Minimum tier: 2.",
      inputSchema: z.object({ ...credentialArg, siteId: z.string().uuid(), name: z.string() }),
    },
    async ({ credentialJwt, ...args }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:create_patrol_route", 2);
        const route = await createPatrolRoute(args);
        return { content: [{ type: "text", text: JSON.stringify(route) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "list_patrol_routes",
    {
      title: "List Patrol Routes",
      description: "Lists patrol routes, optionally filtered by site. Minimum tier: 0 (read-only).",
      inputSchema: z.object({ ...credentialArg, siteId: z.string().uuid().optional() }),
    },
    async ({ credentialJwt, siteId }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:list_patrol_routes", 0);
        const routes = await listPatrolRoutes({ siteId });
        return { content: [{ type: "text", text: JSON.stringify(routes) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "create_checkpoint",
    {
      title: "Create Checkpoint",
      description: "Adds a checkpoint to a patrol route. Minimum tier: 2.",
      inputSchema: z.object({
        ...credentialArg,
        patrolRouteId: z.string().uuid(),
        sequence: z.number().int(),
        label: z.string(),
        verificationMethod: verificationMethodSchema,
        qrOrNfcToken: z.string().optional(),
        lat: z.number().optional(),
        lng: z.number().optional(),
        radiusM: z.number().int().positive().optional(),
      }),
    },
    async ({ credentialJwt, ...args }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:create_checkpoint", 2);
        const checkpoint = await createCheckpoint(args);
        return { content: [{ type: "text", text: JSON.stringify(checkpoint) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "list_checkpoints",
    {
      title: "List Checkpoints",
      description: "Lists a patrol route's checkpoints in sequence order. Minimum tier: 0 (read-only).",
      inputSchema: z.object({ ...credentialArg, patrolRouteId: z.string().uuid() }),
    },
    async ({ credentialJwt, patrolRouteId }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:list_checkpoints", 0);
        const checkpoints = await listCheckpoints(patrolRouteId);
        return { content: [{ type: "text", text: JSON.stringify(checkpoints) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "start_patrol_run",
    {
      title: "Start Patrol Run",
      description:
        "A guard starts a patrol run against a route -- requires an active shift owned by that guard at the route's site. Minimum tier: 2.",
      inputSchema: z.object({
        ...credentialArg,
        patrolRouteId: z.string().uuid(),
        guardId: z.string().uuid(),
        shiftId: z.string().uuid(),
      }),
    },
    async ({ credentialJwt, ...args }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:start_patrol_run", 2);
        const result = await startPatrolRun(args);
        if (!result.ok) return { content: [{ type: "text", text: `Failed: ${result.reason}` }], isError: true };
        return { content: [{ type: "text", text: JSON.stringify(result.run) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "complete_patrol_run",
    {
      title: "Complete Patrol Run",
      description: "Marks a patrol run completed. Minimum tier: 2.",
      inputSchema: z.object({ ...credentialArg, id: z.string().uuid() }),
    },
    async ({ credentialJwt, id }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:complete_patrol_run", 2);
        const run = await completePatrolRun(id);
        if (!run) return { content: [{ type: "text", text: "Not found or not in progress" }], isError: true };
        return { content: [{ type: "text", text: JSON.stringify(run) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "abandon_patrol_run",
    {
      title: "Abandon Patrol Run",
      description: "Marks a patrol run abandoned. Minimum tier: 2.",
      inputSchema: z.object({ ...credentialArg, id: z.string().uuid() }),
    },
    async ({ credentialJwt, id }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:abandon_patrol_run", 2);
        const run = await abandonPatrolRun(id);
        if (!run) return { content: [{ type: "text", text: "Not found or not in progress" }], isError: true };
        return { content: [{ type: "text", text: JSON.stringify(run) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "list_patrol_runs",
    {
      title: "List Patrol Runs",
      description: "Lists patrol runs, optionally filtered by guard/status. Minimum tier: 0 (read-only).",
      inputSchema: z.object({ ...credentialArg, guardId: z.string().uuid().optional(), status: patrolRunStatusSchema.optional() }),
    },
    async ({ credentialJwt, ...filter }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:list_patrol_runs", 0);
        const runs = await listPatrolRuns(filter);
        return { content: [{ type: "text", text: JSON.stringify(runs) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "scan_checkpoint",
    {
      title: "Scan Checkpoint",
      description:
        "Records a checkpoint scan during a patrol run. verified is resolved server-side (GPS distance or QR/NFC token match), never client-asserted. Minimum tier: 2.",
      inputSchema: z.object({
        ...credentialArg,
        patrolRunId: z.string().uuid(),
        checkpointId: z.string().uuid(),
        submittedToken: z.string().optional(),
        lat: z.number().optional(),
        lng: z.number().optional(),
        exceptionNote: z.string().optional(),
      }),
    },
    async ({ credentialJwt, ...args }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:scan_checkpoint", 2);
        const result = await scanCheckpoint(args);
        if (!result.ok) return { content: [{ type: "text", text: `Failed: ${result.reason}` }], isError: true };
        return { content: [{ type: "text", text: JSON.stringify(result.scan) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "list_checkpoint_scans",
    {
      title: "List Checkpoint Scans",
      description: "Lists all checkpoint scans for a patrol run. Minimum tier: 0 (read-only).",
      inputSchema: z.object({ ...credentialArg, patrolRunId: z.string().uuid() }),
    },
    async ({ credentialJwt, patrolRunId }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:list_checkpoint_scans", 0);
        const scans = await listCheckpointScans(patrolRunId);
        return { content: [{ type: "text", text: JSON.stringify(scans) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );
}
