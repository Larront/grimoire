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
