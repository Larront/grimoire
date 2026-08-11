import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { playwright } from "@vitest/browser-playwright";
import tailwindcss from "@tailwindcss/vite";
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
  // Two projects, because two questions need two different machines.
  //
  // Almost everything is a claim about a document, a store or a component's output, and
  // jsdom answers those in milliseconds. But jsdom performs NO LAYOUT: every box is
  // 0×0 at 0,0, so a test that measured one would pass no matter what the stylesheet
  // said. That is not hypothetical here — a tiling bug shipped green exactly that way
  // (see the statblock widths comment in app.css), and the block handle (#190) is
  // placement and nothing else.
  //
  // So anything whose subject is a *box* goes in `*.browser.test.ts` and runs in a real
  // headless Chromium, with the app's real stylesheet loaded. It is the slower machine
  // and it stays a small file count on purpose.
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["src/**/*.{test,spec}.{js,ts}"],
          exclude: ["src/**/*.browser.{test,spec}.{js,ts}"],
          environment: "jsdom",
          globals: true,
          setupFiles: ["./src/test/setup.ts"],
        },
      },
      {
        extends: true,
        // Tailwind, because the CSS these tests measure is the app's own: `app.css`
        // imports it, and without the plugin the stylesheet under test is not the one
        // that ships.
        plugins: [tailwindcss()],
        // Pre-bundled rather than discovered. The browser project serves its modules to a
        // real page, so a dependency Vite meets for the first time mid-run is optimized and
        // the page *reloads* — which Vitest reports as "failed to find the current suite"
        // and fails the whole file, once, on the run that introduced the dependency. Adding
        // jest-dom to the setup file did exactly that; a name here is the cost of a new one.
        //
        // The rest of this list is not belt-and-braces: Vite's dependency SCAN cannot run
        // here at all. It fails with five errors out of
        // `vite-plugin-svelte-module:optimize-svelte` — the plugin is not compatible with
        // the rolldown-based scanner Vite now uses (the same mismatch behind the
        // `optimizeDeps.esbuildOptions is deprecated` warning this run prints) — and Vite
        // then reports "Failed to run dependency scan. Skipping dependency pre-bundling"
        // and carries on. With nothing pre-bundled, EVERY dependency below is one Vite
        // meets mid-run, so it optimizes, reloads, and the in-flight import of the test
        // file dies as "Failed to fetch dynamically imported module".
        //
        // That makes this the difference between a green run and a red one on any COLD
        // cache — which is every CI run, always. It passes locally on a second run purely
        // because the first one left these in node_modules/.vite. To reproduce the CI
        // condition: `rm -rf node_modules/.vite && bun run test`.
        //
        // The list is what Vite itself reported optimizing on a cold run. Icons come from
        // the `@lucide/svelte` barrel as named exports, so the one entry covers every icon
        // in block-icons.ts; `icons/x` is bits-ui reaching for its own.
        optimizeDeps: {
          include: [
            "@testing-library/jest-dom",
            "@lucide/svelte",
            "@lucide/svelte/icons/x",
            "@tauri-apps/api/core",
            "@tauri-apps/plugin-dialog",
            "@tauri-apps/plugin-log",
            "@tiptap/core",
            "@tiptap/extension-blockquote",
            "@tiptap/extension-image",
            "@tiptap/markdown",
            "@tiptap/pm/history",
            "@tiptap/pm/state",
            "@tiptap/starter-kit",
            "@tiptap/suggestion",
            "bits-ui",
            "prosemirror-state",
            "prosemirror-view",
            "svelte-sonner",
            "tailwind-merge",
            "tailwind-variants",
          ],
        },
        test: {
          name: "browser",
          include: ["src/**/*.browser.{test,spec}.{js,ts}"],
          globals: true,
          setupFiles: ["./src/test/setup-browser.ts"],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
});
