import { render, cleanup, waitFor } from "@testing-library/svelte";
import { describe, it, expect, vi, afterEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { vault } from "../lib/stores/vault.svelte";
import HomePage from "../routes/+page.svelte";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vault.closeVault?.();
});

describe("Home page note list loading state", () => {
  it("shows skeleton elements while notes are loading", async () => {
    // Delay notes response so isLoading stays true long enough to assert
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "get_vault_path") return "/fake/vault";
      if (cmd === "get_accent_preset") return null;
      if (cmd === "get_density_level") return null;
      if (cmd === "get_notes") return new Promise(() => {}); // never resolves
      return null;
    });

    await vault.checkExistingVault();
    const { container } = render(HomePage);

    await waitFor(() => {
      const skeletons = container.querySelectorAll('[data-slot="skeleton"]');
      if (skeletons.length === 0) throw new Error("No skeletons found");
      return skeletons;
    });

    const skeletons = container.querySelectorAll('[data-slot="skeleton"]');
    expect(skeletons.length).toBeGreaterThan(0);
  });
});
