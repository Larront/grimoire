// @ts-check
import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

/*
  Deployment target is GitHub Pages. Today that is a *project* site, so
  everything is served under /grimoire and every absolute link needs that
  prefix — hence `base`. Both values are env-driven so moving to a custom
  domain later is two variables in the workflow rather than a find-and-replace
  through the markup:

      SITE_URL=https://grimoire.example  SITE_BASE=/  astro build

  Never hardcode the prefix in a template. Use `withBase()` from src/lib/base.ts,
  which reads Astro's BASE_URL and is the one place the joining rule lives.
*/
const site = process.env.SITE_URL ?? "https://larront.github.io";
const base = process.env.SITE_BASE ?? "/grimoire";

export default defineConfig({
  site,
  base,
  vite: {
    plugins: [tailwindcss()],
  },
});
