import { defineConfig } from "vite";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";

// `process` is typed via @types/node, a root devDependency. It is declared
// there rather than relied on incidentally: the site workspace also pulls it
// in, and an app typecheck that passes only because of a *sibling package's*
// devDependency is one `bun remove` in site/ away from breaking here.
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [sveltekit(), tailwindcss()],

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
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
