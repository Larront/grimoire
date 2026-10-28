// The one look of a menu, shared by the context menu and the dropdown menu
// primitives so a right-click and a "⋯" are the same thing (2026-10 design
// review). The rows are the Block Handle menu's — the house standard in
// DESIGN.md — rather than the library's defaults, which every menu drew until
// then and which matched neither it nor each other.

/** The floating surface: Iron Raised, Iron Border, the one shared shadow. */
export const menuSurface =
  "bg-popover text-popover-foreground border border-border rounded-lg p-1 shadow-float min-w-36 z-50 overflow-x-hidden overflow-y-auto outline-none " +
  "data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 duration-(--motion-quick) ease-out " +
  "data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2";

/**
 * A row. Muted at rest; the highlighted one — pointer or keyboard, the library
 * moves focus with both — takes Crimson Tint and full-strength text, as the
 * active row of any list does. Icons are 14px at 70%, lit with their row.
 *
 * A destructive row is Ember Error. Highlighted, its words go full strength on a
 * red tint and only the icon stays red: Ember Error clears 4.5:1 on the menu
 * itself, and any tint behind it takes it under.
 */
export const menuItem =
  "group relative flex w-full cursor-default items-center gap-2.5 rounded-sm px-2 py-1.5 text-left font-sans text-[0.8125rem] text-muted-foreground outline-hidden select-none " +
  "focus:bg-surface-selected focus:text-foreground data-[state=open]:bg-surface-selected data-[state=open]:text-foreground " +
  "data-disabled:pointer-events-none data-disabled:opacity-50 data-inset:pl-8 " +
  "[&>svg]:pointer-events-none [&>svg]:size-3.5 [&>svg]:shrink-0 [&>svg]:opacity-70 focus:[&>svg]:opacity-100 " +
  "data-[variant=destructive]:text-destructive data-[variant=destructive]:[&>svg]:opacity-100 " +
  "data-[variant=destructive]:focus:bg-destructive/15 data-[variant=destructive]:focus:text-foreground data-[variant=destructive]:focus:[&>svg]:text-destructive";

export const menuSeparator = "bg-border -mx-1 my-1 h-px";

/** A key that does the same thing from the row the menu was opened on (Meta). */
export const menuShortcut =
  "ml-auto pl-4 font-mono text-[0.6875rem] text-muted-foreground group-focus:text-foreground";
