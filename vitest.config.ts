import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { resolve } from "path";

export default defineConfig({
  plugins: [svelte({ hot: false })],
  // ProseMirror must be ONE instance of each package, or nothing works: its classes are
  // compared with `instanceof`, so a Node built by one copy of prosemirror-model is not a
  // Node to another, and the failure surfaces as "Can not convert <> to a Fragment
  // (looks like multiple versions of prosemirror-model were loaded)".
  //
  // Duplicates are the package manager's normal output here — the prosemirror-* packages
  // depend on each other with ranges, so a hoisted copy plus nested older copies is a
  // legal resolution — and no amount of lockfile surgery reliably removes them. Deduping
  // at the bundler is the fix that actually holds: one module, whatever node_modules says.
  // Needed in vitest.config.ts too, which is a separate config and runs the tests.
  resolve: {
    dedupe: [
      "prosemirror-changeset",
      "prosemirror-collab",
      "prosemirror-commands",
      "prosemirror-dropcursor",
      "prosemirror-gapcursor",
      "prosemirror-history",
      "prosemirror-inputrules",
      "prosemirror-keymap",
      "prosemirror-markdown",
      "prosemirror-menu",
      "prosemirror-model",
      "prosemirror-schema-basic",
      "prosemirror-schema-list",
      "prosemirror-state",
      "prosemirror-tables",
      "prosemirror-trailing-node",
      "prosemirror-transform",
      "prosemirror-view",
    ],
    conditions: ["browser"],
    alias: {
      $lib: resolve("./src/lib"),
      "$app/navigation": resolve("./src/test/mocks/app-navigation.ts"),
      "$app/state": resolve("./src/test/mocks/app-state.ts"),
    },
  },
  test: {
    include: ["src/**/*.{test,spec}.{js,ts}"],
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
});
