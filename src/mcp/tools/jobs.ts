import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { completeJob, createJob, getJob, listJobs, startJob } from "../../domain/jobs.js";
import { requireCapability } from "../middleware.js";
import { credentialArg, deniedResult } from "./shared.js";

const jobStatusSchema = z.enum(["not_started", "in_progress", "complete"]);

export function registerJobTools(server: McpServer): void {
  server.registerTool(
    "create_job",
    {
      title: "Create Job",
      description: "Creates a job -- a site+date+job_type dispatch that one or more crew members' shifts can link to (multi-team dispatch). Minimum tier: 3.",
      inputSchema: z.object({ ...credentialArg, siteId: z.string().uuid(), jobTypeId: z.string().uuid().optional(), date: z.string() }),
    },
    async ({ credentialJwt, ...args }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:create_job", 3);
        const job = await createJob(args);
        return { content: [{ type: "text", text: JSON.stringify(job) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "start_job",
    {
      title: "Start Job",
      description: "Marks a job in_progress. Minimum tier: 2.",
      inputSchema: z.object({ ...credentialArg, jobId: z.string().uuid(), crewMemberId: z.string().uuid() }),
    },
    async ({ credentialJwt, jobId, crewMemberId }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:start_job", 2);
        const job = await startJob(jobId, crewMemberId);
        if (!job) return { content: [{ type: "text", text: "Not found" }], isError: true };
        return { content: [{ type: "text", text: JSON.stringify(job) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "complete_job",
    {
      title: "Complete Job",
      description: "Marks a job complete. Minimum tier: 2.",
      inputSchema: z.object({ ...credentialArg, jobId: z.string().uuid(), crewMemberId: z.string().uuid() }),
    },
    async ({ credentialJwt, jobId, crewMemberId }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:complete_job", 2);
        const job = await completeJob(jobId, crewMemberId);
        if (!job) return { content: [{ type: "text", text: "Not found" }], isError: true };
        return { content: [{ type: "text", text: JSON.stringify(job) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "list_jobs",
    {
      title: "List Jobs",
      description: "Lists jobs, optionally filtered by site, date, or status. Minimum tier: 0 (read-only).",
      inputSchema: z.object({ ...credentialArg, siteId: z.string().uuid().optional(), date: z.string().optional(), status: jobStatusSchema.optional() }),
    },
    async ({ credentialJwt, ...filter }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:list_jobs", 0);
        const jobs = await listJobs(filter);
        return { content: [{ type: "text", text: JSON.stringify(jobs) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "get_job",
    {
      title: "Get Job",
      description: "Fetches a single job by id. Minimum tier: 0 (read-only).",
      inputSchema: z.object({ ...credentialArg, id: z.string().uuid() }),
    },
    async ({ credentialJwt, id }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:get_job", 0);
        const job = await getJob(id);
        if (!job) return { content: [{ type: "text", text: "Not found" }], isError: true };
        return { content: [{ type: "text", text: JSON.stringify(job) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );
}
