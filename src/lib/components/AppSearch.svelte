<script lang="ts">
  import { Search } from "@lucide/svelte";

  const isMac = $derived(
    typeof navigator !== "undefined" && /mac/i.test(navigator.platform)
  );
</script>

<div
  class="relative flex items-center justify-between gap-3 mx-3 mb-1 mt-2 h-7 px-2.5
         bg-muted text-muted-foreground rounded-lg text-xs font-normal
         cursor-pointer whitespace-nowrap select-none
         hover:bg-sidebar-accent hover:text-foreground transition-colors duration-100"
>
  <span class="flex items-center gap-1.5">
    <Search class="w-3.5 h-3.5 shrink-0" />
    Search vault…
  </span>
  <kbd
    class="pointer-events-none inline-flex h-4 select-none items-center gap-0.5
           rounded border border-border bg-sidebar px-1 font-mono text-[10px] opacity-60"
  >
    <span>{isMac ? "\u2318" : "Ctrl"} + K</span>
  </kbd>
</div>
