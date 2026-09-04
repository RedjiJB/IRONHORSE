// Phase 0/1 has no long-running domain service yet -- this entry point
// exists so `npm run dev` has something to point at. Real entry points
// today are the migration runner (npm run migrate), the policy sync
// (npm run sync:policy), and the two MCP transports (npm run mcp:stdio
// / mcp:http). See docs/ROADMAP.md for what lands here next.
console.log("IRONHORSE Phase 0 skeleton -- see package.json scripts for the real entry points.");
