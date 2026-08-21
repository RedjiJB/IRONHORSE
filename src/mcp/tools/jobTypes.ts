import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { listJobTypes } from "../../domain/jobTypes.js";
import { requireCapability } from "../middleware.js";
import { credentialArg, deniedResult } from "./shared.js";

export function registerJobTypeTools(server: McpServer): void {
  server.registerTool(
    "list_job_types",
    {
      title: "List Job Types",
      description: "Lists the seeded job types (interlock_repair, sod_install, etc.). Minimum tier: 0 (read-only).",
      inputSchema: z.object({ ...credentialArg }),
    },
    async ({ credentialJwt }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:list_job_types", 0);
        const jobTypes = await listJobTypes();
        return { content: [{ type: "text", text: JSON.stringify(jobTypes) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );
}
