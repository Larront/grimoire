<script lang="ts">
  import { Button } from "$lib/components/ui/button";

  // --- Svelte 5 Runes for state management ---
  // Placeholder data - wire up to your Diesel/Tauri logic
  let recentVaults = $state([
    {
      name: "The Shattered Isles",
      path: "/users/dm/campaigns/isles",
      lastOpened: "2 hours ago",
    },
    {
      name: "Crypts of Kalamar",
      path: "/documents/grimoire/crypts",
      lastOpened: "Yesterday",
    },
    {
      name: "Savage Worlds One-Shot",
      path: "/documents/grimoire/test",
      lastOpened: "3 days ago",
    },
  ]);

  // --- Logic placeholders ---
  function handleOpenFolder() {
    console.log("Invoke Tauri Dialog: Open Directory");
  }

  function handleCreateNew() {
    console.log("Invoke Tauri Logic: Create New Vault Directory");
  }

  function openVault(path: string) {
    console.log(`Command Tauri: Set active vault to: ${path}`);
    // Then navigate to editor
  }
</script>

<div
  class="flex flex-col items-center justify-center min-h-screen overflow-hidden relative font-body"
>
  <header class="text-center m-8">
    <h1 class="text-[150px] font-heading">Grimoire</h1>
  </header>

  <div class="flex flex-col mx-auto gap-2">
    <Button onclick={handleOpenFolder} class="text-lg py-5 px-20"
      >Open existing vault</Button
    >
    <Button
      onclick={handleOpenFolder}
      variant="outline"
      class="text-lg py-5 px-20"
    >
      Create new vault
    </Button>
  </div>
</div>
