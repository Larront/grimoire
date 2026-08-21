import { tabs } from "$lib/stores/tabs.svelte";
import { searchPalette } from "$lib/stores/search.svelte";
import { dialogs } from "$lib/stores/overlay.svelte";

/**
 * What the shell's navigation controls do, named once.
 *
 * The [[Icon Rail]] and the sidebar offer the same destinations at two widths,
 * and until #235 they reached them through two copies of the same one-liner —
 * which is how a rail entry and its sidebar twin drift into meaning slightly
 * different things. Each destination is one function here, and every surface
 * calls it: the rail today, the collapsed sidebar that replaces it (#226), and
 * the sidebar's own rows.
 *
 * Deliberately not the [[Command Palette]]'s commands, which close the palette
 * before they navigate and so are those plus a dismissal.
 */
export const shell = {
  openSearch: () => (searchPalette.open = true),
  openSettings: () => (dialogs.settingsOpen = true),
  openScenes: () => tabs.navigateOpen({ type: "scenes", id: 0, title: "All Scenes" }),
  openGraph: () => tabs.openTab({ type: "graph", id: 0, title: "Graph" }),
  openQuickNotes: () => tabs.navigateOpen({ type: "quickNotes", id: 0, title: "Quick Notes" }),
};
