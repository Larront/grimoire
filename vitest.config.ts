import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { resolve } from "path";

export default defineConfig({
  plugins: [svelte({ hot: false })],
  resolve: {
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
