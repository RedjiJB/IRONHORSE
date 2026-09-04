import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { mcpServer } from "../server.js";

serveStdio(() => mcpServer);
