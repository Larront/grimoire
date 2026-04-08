<script>
  import AppSidebar from "./AppSidebar.svelte";
  import * as Sidebar from "./ui/sidebar";

  const { children } = $props();
</script>

<Sidebar.Provider>
  <AppSidebar />
  <main class="flex flex-1 flex-col">
    <Sidebar.Inset>
      {@render children?.()}
    </Sidebar.Inset>
  </main>
</Sidebar.Provider>
