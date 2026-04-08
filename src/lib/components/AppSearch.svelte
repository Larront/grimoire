<script lang="ts">
  import { Search } from "@lucide/svelte";
</script>

<div
  class="relative flex items-center justify-between gap-3 mx-3 mb-1 mt-2 h-7 px-2.5
         bg-muted text-foreground-muted rounded-lg text-xs font-normal
         cursor-pointer whitespace-nowrap select-none
         hover:bg-accent-subtle hover:text-foreground transition-colors duration-100"
>
  <span class="flex items-center gap-1.5">
    <Search class="w-3.5 h-3.5 shrink-0" />
    Search vault…
  </span>
  <kbd
    class="pointer-events-none inline-flex h-4 select-none items-center gap-0.5
           rounded border border-border bg-surface px-1 font-mono text-[10px] opacity-60"
  >
    <span class="">⌘ + K</span>
  </kbd>
</div>
