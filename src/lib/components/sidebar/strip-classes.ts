// What the collapsed sidebar's 48px strip does to the rows and labels it draws
// (#226) — the three decisions every entry on it shares, named once.
//
// A module rather than `const`s inside `AppSidebar.svelte` because they are the
// strip's vocabulary, not the file's: whether a thing is on the strip, and at
// what size, is asked of every group there, and `AppSidebar` already carries the
// file tree, scenes, templates and rename plumbing without also being the place
// that word is defined.

/**
 * Icon size on the collapsed strip.
 *
 * `--strip-icon` is the size the deleted `IconRail` drew at — 20px, and 22 or 18
 * as the GM's density says. A row's expanded icon is `size-4`, which is right
 * beside a label and too small alone in a 48px square, so the strip keeps the
 * size it has always had. Important, because `Sidebar.MenuButton` sets
 * `[&_svg]:size-4` on every descendant.
 */
export const STRIP_ICON = "size-(--strip-icon)!";

/** A row that shows in both states: `size-4` beside its label, the strip's size
 *  once the label is gone. */
export const ROW_ICON = "size-4 group-data-[collapsible=icon]:size-(--strip-icon)!";

/** Hidden on the 48px strip: a row's label, or a surface that cannot narrow to
 *  it. One name, because "not on the strip" is one decision. */
export const EXPANDED_ONLY = "group-data-[collapsible=icon]:hidden";
