// Include the fork-only relayer safety suites in the root runner.
await import("../../relayer/test/a1063-fork-gift-state.mjs");
await import("../../relayer/test/a1063-fork-gift-worker.mjs");
await import("../../relayer/test/a1063-fork-gift-crash.mjs");
