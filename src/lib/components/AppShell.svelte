<script>
  import AppSidebar from "./sidebar/AppSidebar.svelte";
  import * as Sidebar from "./ui/sidebar";
  import { Separator } from "./ui/separator";
  import { breadcrumbs } from "$lib/stores/breadcrumbs.svelte";

  const { children } = $props();
</script>

<Sidebar.Provider>
  <AppSidebar />
  <main class="flex flex-1 flex-col">
    <Sidebar.Inset>
      <header
        class="sticky top-0 z-10 flex h-[var(--tab-bar-h)] shrink-0 items-center gap-2 border-b border-sidebar-border bg-background px-3"
      >
        <Sidebar.Trigger class="-ml-1" />
        <Separator orientation="vertical" class="mr-1 h-4" />
        <nav class="flex items-center gap-1.5 text-sm text-muted-foreground">
          {#each breadcrumbs.segments as crumb, i}
            {#if i > 0}
              <span class="text-muted-foreground/50">/</span>
            {/if}
            {#if crumb.href}
              <a
                href={crumb.href}
                class="transition-colors hover:text-foreground">{crumb.label}</a
              >
            {:else}
              <span class="text-foreground">{crumb.label}</span>
            {/if}
          {/each}
        </nav>
      </header>
      {@render children?.()}
    </Sidebar.Inset>
  </main>
</Sidebar.Provider>
