<script lang="ts">
  import IconRail from "./sidebar/IconRail.svelte";
  import AppSidebar from "./sidebar/AppSidebar.svelte";
  import RightRail from "./RightRail.svelte";
  import SettingsDialog from "./SettingsDialog.svelte";
  import * as Sidebar from "./ui/sidebar";
  import { Separator } from "./ui/separator";
  import { breadcrumbs } from "$lib/stores/breadcrumbs.svelte";
  import { RightRailState } from "$lib/stores/right-rail.svelte";
  import PanelRightIcon from "@lucide/svelte/icons/panel-right";

  const { children } = $props();

  const rail = new RightRailState();
  let filesSectionEl = $state<HTMLElement | null>(null);
  let settingsOpen = $state(false);

  function handleFilesClick() {
    // Scroll the files section into view after the sidebar open animation settles
    setTimeout(() => {
      filesSectionEl?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 200);
  }
</script>

<!--
  --rail-w sets the fixed sidebar container's left offset so it sits flush
  against the icon rail. The ml-12 wrapper pushes the flex content area
  right by the same amount so nothing slides under the rail.
-->
<div class="relative" style="--rail-w: 3rem">
  <Sidebar.Provider>
    <IconRail onFilesClick={handleFilesClick} onSettingsClick={() => settingsOpen = true} />
    <SettingsDialog bind:open={settingsOpen} />
    <div class="ml-12 flex min-h-svh flex-1">
      <AppSidebar bind:filesSectionEl />
      <main class="flex min-w-0 flex-1 flex-col">
        <Sidebar.Inset>
          <header
            class="sticky top-0 z-10 flex h-[var(--tab-bar-h)] shrink-0 items-center gap-2 border-b border-sidebar-border bg-background px-3"
          >
            <Sidebar.Trigger class="-ml-1" />
            <Separator orientation="vertical" class="mr-1 h-4" />
            <nav class="flex items-center gap-1.5 text-sm text-muted-foreground">
              {#each breadcrumbs.segments as crumb, i (crumb.href ?? crumb.label)}
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
            <div class="ml-auto">
              <button
                data-testid="right-rail-trigger"
                onclick={rail.toggle}
                class="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                aria-label="Toggle details panel"
              >
                <PanelRightIcon class="size-4" />
              </button>
            </div>
          </header>
          {@render children?.()}
        </Sidebar.Inset>
      </main>
      <RightRail {rail} />
    </div>
  </Sidebar.Provider>
</div>
