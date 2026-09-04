import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 20000,
    // vendor/openconstructionerp is a git submodule with its own large
    // test suite (and its own vitest config/environment expectations --
    // several of its tests need jsdom, which this project doesn't
    // configure). Vitest's default discovery otherwise picks up every
    // *.test.ts under the repo root, submodule included -- explicitly
    // scope to this project's own tests.
    include: ["test/**/*.test.ts"],
    exclude: ["vendor/**", "node_modules/**"],
  },
});
