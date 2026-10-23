<script lang="ts">
  /*
    The Splash: what a GM sees whenever no world is open.

    This page owns the state — the recent worlds, what is under way, the create form —
    and `SplashColumns` draws it. Revised in the 2026-10 design review:
    - Two columns: what Grimoire is and the ways to start; then the GM's last world
      as the subject, with Continue, and the others beneath it.
    - It says "world", as the rest of the app now does; "ledger" is the code's word.
    - A launch focuses the obvious next step, so Enter carries on.
    - The example world can be continued as it was left, or started over, rather than
      wiped on every visit without a word.
    - Every failure is said once, by the toast the call already raises; the red line
      that repeated it under the page is gone.
    - The glow and the crimson rule behind the wordmark are gone: decoration the
      design system refuses, and a brown smudge in light mode.
  */
  import { tick } from "svelte";
  import { ledger, type RecentLedger } from "$lib/stores/ledger.svelte";
  import { api } from "$lib/api";
  import { fieldsReady, ledgerDestination } from "$lib/utils/ledger-name";
  import SplashCreate from "$lib/components/splash/SplashCreate.svelte";
  import SplashColumns from "$lib/components/splash/SplashColumns.svelte";
  import type { SplashProps } from "$lib/components/splash/splash";

  let worlds = $state<RecentLedger[]>([]);
  let loaded = $state(false);
  let exampleSaved = $state(false);
  /** What is under way: a world's path, "__folder__", "__example__" or "__creating__". */
  let busy = $state<string | null>(null);

  let creating = $state(false);
  let newName = $state("");
  let newParent = $state<string | null>(null);
  /** Whether Create has been pressed — the fields show their problems from then. */
  let attempted = $state(false);

  async function load() {
    try {
      const [recents, example] = await Promise.all([
        api.getRecentLedgers(),
        ledger.existingSample(),
      ]);
      worlds = recents;
      exampleSaved = example !== null;
    } catch (e) {
      console.error(e);
    } finally {
      loaded = true;
    }
  }

  $effect(() => {
    if (!ledger.isOpen) {
      void load().then(focusPrimary);
    }
  });

  /** The obvious next step takes focus, so a launch and Enter carry on. */
  async function focusPrimary() {
    await tick();
    document.querySelector<HTMLElement>("[data-splash-primary]")?.focus();
  }

  /** Run an action that opens something; its failure has already been said by a toast. */
  async function run(what: string, action: () => Promise<unknown>) {
    busy = what;
    try {
      await action();
    } catch (e) {
      console.error(e);
    } finally {
      busy = null;
    }
  }

  const props: SplashProps = $derived({
    worlds,
    busy,
    exampleSaved,
    onOpen: (path) => void run(path, () => ledger.openLedger(path)),
    onRemove: async (path) => {
      try {
        await api.removeRecentLedger(path);
        worlds = worlds.filter((w) => w.path !== path);
        void focusPrimary();
      } catch (e) {
        console.error(e);
      }
    },
    onLookAgain: () => void load(),
    onOpenFolder: () => void run("__folder__", () => ledger.openLedger()),
    onNewWorld: () => {
      creating = true;
      newName = "";
      newParent = null;
      attempted = false;
    },
    onExplore: () => void run("__example__", () => ledger.exploreSample()),
    onContinueExample: () => void run("__example__", () => ledger.continueSample()),
  });

  async function cancelCreate() {
    creating = false;
    attempted = false;
    await tick();
    document.querySelector<HTMLElement>("[data-splash-new]")?.focus();
  }

  function createWorld() {
    attempted = true;
    if (busy !== null || !fieldsReady(newName, newParent)) return;
    const destination = ledgerDestination(newParent, newName);
    void run("__creating__", () => ledger.openLedger(destination));
  }
</script>

{#snippet createForm()}
  <SplashCreate
    bind:name={newName}
    bind:parent={newParent}
    {attempted}
    creating={busy === "__creating__"}
    onSubmit={createWorld}
    onCancel={() => void cancelCreate()}
  />
{/snippet}

{#if !ledger.isOpen}
  <main class="relative min-h-screen overflow-y-auto" aria-busy={!loaded}>
    {#if loaded}
      <SplashColumns {...props} create={creating ? createForm : undefined} />
    {/if}
  </main>
{/if}
