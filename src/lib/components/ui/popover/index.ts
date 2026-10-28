// A floating panel opened by a button, for controls that are more than a list of
// commands — a dropdown menu's twin with the same surface (`bg-popover`, ring,
// `shadow-float`), so the two read as one family. Only the parts the app uses are
// wrapped.
import Root from "./popover.svelte";
import Trigger from "./popover-trigger.svelte";
import Content from "./popover-content.svelte";

export {
  Root,
  Trigger,
  Content,
  //
  Root as Popover,
  Trigger as PopoverTrigger,
  Content as PopoverContent,
};
