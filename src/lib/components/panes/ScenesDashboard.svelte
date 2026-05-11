<script lang="ts">
  import { Clapperboard } from "@lucide/svelte";
</script>

<div data-scenes-dashboard class="flex flex-1 flex-col overflow-y-auto">
  <div class="mx-auto w-full max-w-5xl px-8 pt-8 pb-20">
    <h1 class="font-heading text-3xl tracking-tight text-foreground">All Scenes</h1>
    <div class="mt-3 h-px bg-linear-to-r from-primary/30 via-primary/10 to-transparent"></div>
    <div class="mt-12 flex flex-col items-center justify-center py-20 text-center">
      <div class="flex size-16 items-center justify-center rounded-xl bg-primary/10">
        <Clapperboard class="size-8 text-primary/60" strokeWidth={1.5} />
      </div>
      <p class="mt-5 font-heading text-lg text-foreground">Scene Dashboard</p>
      <p class="mt-2 max-w-sm text-sm text-muted-foreground">
        Scene grid view coming soon.
      </p>
    </div>
  </div>
</div>
