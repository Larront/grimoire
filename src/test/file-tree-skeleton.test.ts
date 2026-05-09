import { render, waitFor, cleanup } from "@testing-library/svelte";
import { describe, it, expect, vi, afterEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { vault } from "../lib/stores/vault.svelte";
import AppShell from "../lib/components/AppShell.svelte";

afterEach(async () => {
  cleanup();
  vi.clearAllMocks();
  await vault.closeVault();
});

describe("File tree skeleton", () => {
  it("shows MenuSkeleton elements in the sidebar while the file tree is loading", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "get_vault_path") return "/fake/vault";
      if (cmd === "get_accent_preset") return null;
      if (cmd === "get_density_level") return null;
      if (cmd === "get_notes") return [];
      if (cmd === "get_maps") return [];
      if (cmd === "get_scenes_with_slot_counts") return [];
      // Never resolve file tree — keeps treeLoading true
      if (cmd === "get_file_tree") return new Promise(() => {});
      return null;
    });

    await vault.checkExistingVault();
    const { container } = render(AppShell);

    await waitFor(() => {
      const skeletons = container.querySelectorAll(
        '[data-sidebar="menu-skeleton"]',
      );
      if (skeletons.length === 0)
        throw new Error("No file tree skeletons found");
      return skeletons;
    });

    expect(
      container.querySelectorAll('[data-sidebar="menu-skeleton"]').length,
    ).toBeGreaterThan(0);
  });
});
