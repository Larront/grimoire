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

  // SvelteKit's server bundle must carry its own `cookie`, not find one at runtime.
  //
  // Kit emits `import { parse, serialize } from "cookie"` into
  // `.svelte-kit/output/server/index.js` and leaves the specifier external, so Node resolves
  // it when the prerender step runs — from the *output file's* location, which walks up to
  // the repo root rather than into Kit's own node_modules. Kit depends on `cookie@^0.6.0`
  // and has that copy nested correctly; the root has `cookie@2`, hoisted there by the Astro
  // site workspace. Version 2 renamed the whole API (`parseCookie`, `stringifyCookie`), so
  // the build dies at prerender with "does not provide an export named 'parse'".
  //
  // Inlining it moves the resolution to build time, where Vite resolves from the importer —
  // Kit's own dist — and gets the 0.6.0 it asked for. The alternatives are worse: pinning
  // the root to 0.6.0 breaks Astro, which genuinely needs v2, and both packages having a
  // correct nested copy already is exactly why hoisting order is the only thing that decides
  // which one the app gets today. That is not a thing to leave a release build resting on.
  ssr: {
    noExternal: ["cookie"],
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
