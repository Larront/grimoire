// The context-menu wrappers' twin for a menu opened by a button rather than a
// right-click — same item, separator and content styling, so a menu reads the same
// whichever way it was summoned. Only the parts the app uses are wrapped.
import Root from "./dropdown-menu.svelte";
import Trigger from "./dropdown-menu-trigger.svelte";
import Portal from "./dropdown-menu-portal.svelte";
import Content from "./dropdown-menu-content.svelte";
import Item from "./dropdown-menu-item.svelte";
import Separator from "./dropdown-menu-separator.svelte";
import Shortcut from "./dropdown-menu-shortcut.svelte";

export {
  Root,
  Trigger,
  Portal,
  Content,
  Item,
  Separator,
  Shortcut,
  //
  Root as DropdownMenu,
  Trigger as DropdownMenuTrigger,
  Portal as DropdownMenuPortal,
  Content as DropdownMenuContent,
  Item as DropdownMenuItem,
  Separator as DropdownMenuSeparator,
  Shortcut as DropdownMenuShortcut,
};
