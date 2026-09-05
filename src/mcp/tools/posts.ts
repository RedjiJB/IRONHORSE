import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { addRequiredCertification, createPost, listPosts, listRequiredCertifications } from "../../domain/posts.js";
import { checkGuardPostCompliance } from "../../domain/certifications.js";
import { requireCapability } from "../middleware.js";
import { credentialArg, deniedResult } from "./shared.js";

export function registerPostTools(server: McpServer): void {
  server.registerTool(
    "create_post",
    {
      title: "Create Post",
      description: "Creates a post (a specific position within a site, e.g. 'Main Gate -- Armed'). Minimum tier: 2.",
      inputSchema: z.object({ ...credentialArg, siteId: z.string().uuid(), name: z.string() }),
    },
    async ({ credentialJwt, ...args }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:create_post", 2);
        const post = await createPost(args);
        return { content: [{ type: "text", text: JSON.stringify(post) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "list_posts",
    {
      title: "List Posts",
      description: "Lists posts, optionally filtered by site. Minimum tier: 0 (read-only).",
      inputSchema: z.object({ ...credentialArg, siteId: z.string().uuid().optional() }),
    },
    async ({ credentialJwt, siteId }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:list_posts", 0);
        const posts = await listPosts({ siteId });
        return { content: [{ type: "text", text: JSON.stringify(posts) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "add_post_required_certification",
    {
      title: "Add Post Required Certification",
      description: "Adds a required certification type to a post. Minimum tier: 2.",
      inputSchema: z.object({ ...credentialArg, postId: z.string().uuid(), certType: z.string() }),
    },
    async ({ credentialJwt, ...args }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:add_post_required_certification", 2);
        const requirement = await addRequiredCertification(args);
        return { content: [{ type: "text", text: JSON.stringify(requirement) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "list_post_required_certifications",
    {
      title: "List Post Required Certifications",
      description: "Lists a post's required certification types. Minimum tier: 0 (read-only).",
      inputSchema: z.object({ ...credentialArg, postId: z.string().uuid() }),
    },
    async ({ credentialJwt, postId }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:list_post_required_certifications", 0);
        const requirements = await listRequiredCertifications(postId);
        return { content: [{ type: "text", text: JSON.stringify(requirements) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "check_guard_post_compliance",
    {
      title: "Check Guard Post Compliance",
      description:
        "Checks whether a guard holds every certification a post requires, as of a given date -- soft-flag only, never blocks anything. Minimum tier: 0 (read-only).",
      inputSchema: z.object({ ...credentialArg, guardId: z.string().uuid(), postId: z.string().uuid(), asOfDate: z.string() }),
    },
    async ({ credentialJwt, guardId, postId, asOfDate }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:check_guard_post_compliance", 0);
        const result = await checkGuardPostCompliance(guardId, postId, asOfDate);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );
}
