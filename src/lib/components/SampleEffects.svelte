<script lang="ts">
  import { ledger } from "$lib/stores/ledger.svelte";
  import { notes } from "$lib/stores/notes.svelte";
  import { tabs } from "$lib/stores/tabs.svelte";

  $effect(() => {
    if (ledger.pendingStartHere && !notes.isLoading && notes.notes.length > 0) {
      const startHere = notes.notes.find((n) => n.title === "Start Here");
      ledger.clearPendingStartHere();
      if (startHere) {
        tabs.openTab({ type: "note", id: startHere.id, title: startHere.title });
      }
    }
  });
</script>
