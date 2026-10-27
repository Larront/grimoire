<script lang="ts">
  import { setMode, userPrefersMode } from "mode-watcher";
  import { api } from "$lib/api";
  import * as Dialog from "$lib/components/ui/dialog";
  import { Button } from "$lib/components/ui/button";
  import { Switch } from "$lib/components/ui/switch";
  import { ChoiceGroup } from "$lib/components/ui/choice-group";
  import { Tabs } from "bits-ui";
  import { ledger, type AccentPreset } from "$lib/stores/ledger.svelte";
  import { ACCENT_PRESETS } from "$lib/entity-colors";
  import { appPrefs, type DensityLevel, type MotionChoice } from "$lib/stores/app-prefs.svelte";
  import { templates } from "$lib/stores/templates.svelte";
  import { toastSuccess, toastError } from "$lib/toast";
  import { dialogs } from "$lib/stores/overlay.svelte";
  import StatblockPresetsSettings from "$lib/components/StatblockPresetsSettings.svelte";
  import { getSpotifyStatus, connectSpotify, disconnectSpotify } from "$lib/utils/spotify-auth";
  import type { SpotifyAuthStatus } from "$lib/types/ledger";
  import { Check, CircleX, LoaderCircle } from "@lucide/svelte";

  let { open = $bindable(false) }: { open: boolean } = $props();

  let section = $state("appearance");

  // App version for the About footer — resolved from the Tauri runtime so it
  // can never drift from the shipped bundle (issue #117).
  let appVersion = $state<string | null>(null);
  $effect(() => {
    if (open && appVersion === null && "__TAURI_INTERNALS__" in window) {
      import("@tauri-apps/api/app")
        .then(({ getVersion }) => getVersion())
        .then((v) => {
          appVersion = v;
        })
        .catch(() => {});
    }
  });

  function openExternal(url: string) {
    import("@tauri-apps/plugin-opener").then(({ openUrl }) => openUrl(url)).catch(() => {});
  }

  let authStatus = $state<SpotifyAuthStatus | null>(null);
  let isConnecting = $state(false);
  let isAuthLoading = $state(true);
  let connectFailed = $state(false);

  // ── Restore built-in templates ──────────────────────────────────────────────
  //
  // Asked in its own row rather than a modal (2026-10 design review): DESIGN.md §6 keeps
  // modals off destructive confirmations, and this one stacked two extra scrims over the
  // dialog until the screen was nearly black, with a crimson button that read as safe.
  let confirmingRestore = $state(false);
  let isRestoring = $state(false);

  async function handleRestoreTemplates() {
    isRestoring = true;
    try {
      await api.restoreBuiltinTemplates();
      await templates.load();
      toastSuccess("Default templates restored");
      confirmingRestore = false;
    } catch (e) {
      // The row stays open on a failure, so the GM can try again from where they were.
      console.error("restore templates failed:", e);
      toastError("Couldn't restore templates. Please try again.");
    } finally {
      isRestoring = false;
    }
  }

  // Read again every time Settings opens. It was read once a session, and the dialog is
  // always mounted — so connecting Spotify from a scene left Settings saying "Connect".
  $effect(() => {
    if (!open) return;
    connectFailed = false;
    getSpotifyStatus()
      .then((s) => {
        authStatus = s;
      })
      .catch(() => {})
      .finally(() => {
        isAuthLoading = false;
      });
  });

  async function handleConnect() {
    isConnecting = true;
    connectFailed = false;
    try {
      authStatus = await connectSpotify();
    } catch {
      // Said in the row rather than toasted: the common case is the GM closing the browser
      // tab, which is not an error worth an alarm, but it was silent and left them guessing.
      connectFailed = true;
    } finally {
      isConnecting = false;
    }
  }

  // ── Tags ────────────────────────────────────────────────────────────────────
  //
  // "Manage" hands over to the Tag Manager, a dialog of its own; Settings comes back when it
  // closes, on the section the GM left. It used to stay closed.
  let returnFromTags = $state(false);

  function openTagManager() {
    returnFromTags = true;
    open = false;
    dialogs.tagManagerOpen = true;
  }

  $effect(() => {
    if (returnFromTags && !dialogs.tagManagerOpen) {
      returnFromTags = false;
      open = true;
    }
  });

  async function handleDisconnect() {
    try {
      await disconnectSpotify();
      authStatus = null;
    } catch (e) {
      console.error("spotify disconnect failed:", e);
      toastError("Couldn't disconnect Spotify. Please try again.");
    }
  }

  /*
    No hexes. Each swatch WEARS its own preset class and paints with `var(--primary)`, so
    the colour it shows is resolved by the same declaration in app.css that will paint
    the app once it is picked — including the light-mode step, which the five hardcoded
    values here never had. They were the third copy of this table (app.css and a since-
    deleted one in ThemeWatcher were the others), and a swatch that lies about what you
    are choosing is the exact failure that duplication produces.

    The NAMES were the copy left standing, and they came out too (#222): the five are
    built from `ACCENT_PRESETS` now, and `accent-${p.name}` types itself into the store's
    `AccentPreset` union — so a preset added there and forgotten here no longer compiles.
  */
  const ACCENT_OPTIONS: { value: AccentPreset; label: string }[] = ACCENT_PRESETS.map((p) => ({
    value: `accent-${p.name}`,
    label: p.label,
  }));

  const THEME_MODES: { value: "dark" | "light" | "system"; label: string }[] = [
    { value: "dark", label: "Dark" },
    { value: "light", label: "Light" },
    { value: "system", label: "System" },
  ];

  // Reduce Motion follows the computer unless the GM says otherwise (2026-10 design
  // review: it was a switch the computer seeded once, after which the two could differ).
  const MOTION_CHOICES: { value: MotionChoice; label: string }[] = [
    { value: "system", label: "Match my computer" },
    { value: "on", label: "On" },
    { value: "off", label: "Off" },
  ];

  const DENSITY_LEVELS: { value: DensityLevel; label: string }[] = [
    { value: "cozy", label: "Cozy" },
    { value: "balanced", label: "Balanced" },
    { value: "dense", label: "Dense" },
  ];

  const SECTIONS: { value: string; label: string }[] = [
    { value: "appearance", label: "Appearance" },
    { value: "content", label: "Content" },
    { value: "statblocks", label: "Statblocks" },
    { value: "integrations", label: "Integrations" },
    { value: "about", label: "About" },
  ];

  /** One segment of a choice: the Label role's size, at the 32px every control here is. */
  const segment = (selected: boolean) =>
    `h-8 px-3 text-(length:--font-ui) transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring ${
      selected
        ? "bg-foreground/15 text-foreground font-medium"
        : "text-foreground-muted hover:bg-surface-hover hover:text-foreground"
    }`;

  /** About's links: underlined at rest, as every link in the app is, in a neutral line. */
  const aboutLink =
    "underline decoration-foreground-muted/50 underline-offset-2 hover:text-foreground hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm cursor-pointer";

  /**
   * A section's panel. It is a Tab stop — the tab pattern makes it one — and it was an
   * invisible one; it shows the focus ring every control does.
   */
  const panel =
    "rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring";

  const accentLabel = $derived(ACCENT_OPTIONS.find((o) => o.value === ledger.accent)?.label ?? "");
</script>

<!-- A label/description pair, shared by every settings row. -->
{#snippet field(title: string, description: string)}
  <div class="flex flex-col gap-0.5">
    <span class="text-(length:--font-body) font-medium text-foreground">{title}</span>
    <span class="text-(length:--font-ui) text-foreground-muted">{description}</span>
  </div>
{/snippet}

<Dialog.Root bind:open>
  <Dialog.Content
    class="sm:max-w-2xl w-full h-[80vh] max-h-[560px] flex flex-col p-0 gap-0 overflow-hidden"
  >
    <Dialog.Header class="px-5 pt-5 pb-3 border-b border-border shrink-0 text-left">
      <Dialog.Title>Settings</Dialog.Title>
      <Dialog.Description class="sr-only">
        Appearance, content, statblock presets, integrations, and about Grimoire.
      </Dialog.Description>
    </Dialog.Header>

    <Tabs.Root bind:value={section} orientation="vertical" class="flex flex-row flex-1 min-h-0">
      <!-- ── Section rail ─────────────────────────────────────────── -->
      <Tabs.List
        aria-label="Settings sections"
        class="flex flex-col gap-0.5 shrink-0 w-44 border-r border-border p-3 overflow-y-auto"
      >
        {#each SECTIONS as s (s.value)}
          <Tabs.Trigger
            value={s.value}
            data-testid="settings-tab-{s.value}"
            class="flex items-center h-(--row-h) px-3 rounded-md text-(length:--font-body) text-left text-foreground-muted transition-colors hover:bg-surface-hover data-[state=active]:bg-primary/[0.12] data-[state=active]:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          >
            {s.label}
          </Tabs.Trigger>
        {/each}
      </Tabs.List>

      <!-- ── Panel ────────────────────────────────────────────────── -->
      <div class="flex-1 min-h-0 overflow-y-auto px-5 py-4">
        <!-- Appearance -->
        <Tabs.Content value="appearance" class={panel}>
          <div class="flex flex-col divide-y divide-border">
            <!-- Each description says where the setting applies: accent is this world's,
                 the rest are everywhere (2026-10 design review). A GM who chose a colour in
                 the Example World found Crimson in their own, with nothing saying why. -->
            <!-- Theme -->
            <div class="flex items-center justify-between gap-4 py-3 first:pt-0">
              {@render field("Theme", "Light, dark, or follow the system. Every world.")}
              <ChoiceGroup
                label="Theme"
                options={THEME_MODES}
                value={userPrefersMode.current ?? "system"}
                onChange={(mode) => setMode(mode)}
                class="flex shrink-0 overflow-hidden rounded-md border border-border divide-x divide-border"
                optionClass={segment}
              />
            </div>

            <!-- Accent -->
            <div class="flex items-center justify-between gap-4 py-3">
              {@render field("Accent", "This world's colour for selection, focus and links.")}
              <div class="flex shrink-0 items-center gap-3">
                <!-- The chosen preset's name, which the swatches alone never said. -->
                <span class="text-(length:--font-ui) text-foreground-muted">{accentLabel}</span>
                <ChoiceGroup
                  label="Accent"
                  options={ACCENT_OPTIONS}
                  value={ledger.accent}
                  onChange={(preset) => ledger.setAccent(preset)}
                  class="flex items-center gap-2"
                  optionClass={() =>
                    "rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"}
                >
                  {#snippet option(preset, selected)}
                    <!-- Each swatch wears its own preset class and paints with `--primary`,
                         so it shows exactly what choosing it will paint. Chosen is a tick;
                         the ring is focus alone, so the two never look alike. -->
                    <span
                      data-testid="accent-{preset.value}"
                      class="{preset.value} flex size-6 items-center justify-center rounded-full text-primary-foreground"
                      style="background-color: var(--primary)"
                    >
                      {#if selected}<Check class="size-3.5" strokeWidth={3} />{/if}
                    </span>
                  {/snippet}
                </ChoiceGroup>
              </div>
            </div>

            <!-- Density -->
            <div class="flex items-center justify-between gap-4 py-3">
              {@render field("Density", "Spacing and text size. Every world.")}
              <ChoiceGroup
                label="Density"
                options={DENSITY_LEVELS}
                value={appPrefs.density}
                onChange={(level) => appPrefs.setDensity(level)}
                class="flex shrink-0 overflow-hidden rounded-md border border-border divide-x divide-border"
                optionClass={segment}
              />
            </div>

            <!-- Reduce Motion -->
            <div class="flex items-center justify-between gap-4 py-3">
              {@render field(
                "Reduce Motion",
                "Animations and transitions, stilled. Match my computer follows its own setting. Every world.",
              )}
              <ChoiceGroup
                label="Reduce Motion"
                options={MOTION_CHOICES}
                value={appPrefs.motionChoice}
                onChange={(choice) => appPrefs.setMotionChoice(choice)}
                class="flex shrink-0 overflow-hidden rounded-md border border-border divide-x divide-border"
                optionClass={segment}
              />
            </div>
          </div>
        </Tabs.Content>

        <!-- Content -->
        <Tabs.Content value="content" class={panel}>
          <div class="flex flex-col divide-y divide-border">
            <!-- Confirm before updating links on rename -->
            <div class="flex items-center justify-between gap-4 py-3 first:pt-0">
              {@render field(
                "Confirm before updating links on rename",
                "Ask before changing links in other notes when a note is renamed.",
              )}
              <Switch
                checked={appPrefs.confirmRenameLinks}
                onCheckedChange={(v) => appPrefs.setConfirmRenameLinks(v)}
                aria-label="Confirm before updating links on rename"
                data-testid="confirm-rename-links-toggle"
              />
            </div>

            <!-- Restore built-in templates -->
            <div class="flex flex-col gap-3 py-3">
              <div class="flex items-center justify-between gap-4">
                {@render field(
                  "Built-in templates",
                  "Reset the four built-in templates to their original content. Custom templates are left untouched.",
                )}
                {#if !confirmingRestore}
                  <Button
                    variant="outline"
                    class="shrink-0"
                    data-testid="restore-templates-btn"
                    onclick={() => (confirmingRestore = true)}>Restore defaults</Button
                  >
                {/if}
              </div>
              {#if confirmingRestore}
                <div
                  class="flex items-center justify-between gap-4 rounded-md border border-border px-3 py-2"
                  role="group"
                  aria-label="Confirm restoring templates"
                >
                  <span class="text-(length:--font-ui) text-foreground">
                    Overwrite NPC, Location, Session Log and Encounter with their originals?
                  </span>
                  <div class="flex shrink-0 items-center gap-2">
                    <Button
                      variant="ghost"
                      data-testid="restore-templates-cancel"
                      onclick={() => (confirmingRestore = false)}>Cancel</Button
                    >
                    <Button
                      variant="destructive"
                      data-testid="restore-templates-confirm"
                      disabled={isRestoring}
                      onclick={handleRestoreTemplates}
                    >
                      {#if isRestoring}
                        <LoaderCircle class="size-3.5 animate-spin" />
                        Restoring…
                      {:else}
                        Restore
                      {/if}
                    </Button>
                  </div>
                </div>
              {/if}
            </div>

            <!-- Tags -->
            <div class="flex items-center justify-between gap-4 py-3">
              {@render field(
                "Tags",
                "Rename, merge, recolour and hide tags, with how often each is used.",
              )}
              <Button
                variant="outline"
                class="shrink-0"
                data-testid="open-tag-manager-btn"
                onclick={openTagManager}>Manage</Button
              >
            </div>
          </div>
        </Tabs.Content>

        <!-- Statblocks — the app-wide preset store and this vault's default (#179) -->
        <Tabs.Content
          value="statblocks"
          class={panel}
          data-testid="statblocks-section"
        >
          <StatblockPresetsSettings {open} />
        </Tabs.Content>

        <!-- Integrations -->
        <Tabs.Content value="integrations" class={panel}>
          <div class="flex flex-col divide-y divide-border">
            {#if isAuthLoading}
              <div class="flex items-center justify-between gap-4 py-3 first:pt-0">
                {@render field("Spotify", "Checking connection…")}
                <LoaderCircle class="size-4 shrink-0 animate-spin text-foreground-muted" />
              </div>
            {:else if authStatus?.is_connected}
              <div class="flex items-center justify-between gap-4 py-3 first:pt-0">
                {@render field("Spotify", "Connected · Premium required for in-app playback")}
                <Button variant="outline" class="shrink-0" onclick={handleDisconnect}
                  >Disconnect</Button
                >
              </div>
            {:else}
              <div class="flex items-center justify-between gap-4 py-3 first:pt-0">
                <div class="flex flex-col gap-1">
                  {@render field(
                    "Spotify",
                    "Add tracks and playlists to your scenes. Requires Spotify Premium.",
                  )}
                  {#if connectFailed}
                    <span
                      class="flex items-center gap-1 text-(length:--font-ui) text-destructive"
                      role="status"
                    >
                      <CircleX class="size-3.5 shrink-0" /> Didn't connect. Try again, and finish signing
                      in on the Spotify page.
                    </span>
                  {/if}
                </div>
                <Button
                  variant="outline"
                  class="shrink-0"
                  onclick={handleConnect}
                  disabled={isConnecting}
                >
                  {#if isConnecting}
                    <LoaderCircle class="size-3.5 animate-spin" />
                    Connecting…
                  {:else}
                    Connect
                  {/if}
                </Button>
              </div>
            {/if}
          </div>
        </Tabs.Content>

        <!-- About -->
        <Tabs.Content value="about" class={panel} data-testid="about-section">
          <div class="flex flex-col gap-2">
            <div class="flex items-center justify-between gap-4">
              <span class="text-(length:--font-body) text-foreground">
                Grimoire {appVersion ? `v${appVersion}` : ""}
              </span>
              <button
                type="button"
                class="text-(length:--font-ui) text-foreground-muted {aboutLink}"
                onclick={() => openExternal("https://github.com/Larront/grimoire/issues")}
                >Report a bug</button
              >
            </div>
            <span class="text-(length:--font-ui) text-foreground-muted">
              Free software under
              <button
                type="button"
                class={aboutLink}
                onclick={() => openExternal("https://www.gnu.org/licenses/gpl-3.0.html")}
                >GPL-3.0</button
              >
              · source on
              <button
                type="button"
                class={aboutLink}
                onclick={() => openExternal("https://github.com/Larront/grimoire")}>GitHub</button
              >
            </span>
            <span class="mt-3 font-sans text-xs font-semibold text-foreground-muted">Credits</span>
            <span class="text-(length:--font-ui) text-foreground-muted">
              Sample audio by Kevin MacLeod (incompetech.com, CC-BY 4.0) and CC0 contributors.
            </span>
            <!-- SRD 5.1 attribution for the `5E SRD` statblock preset (#179). Wizards
                 supply this wording and forbid adding any other credit to them, so it
                 is reproduced verbatim and stands alone; the modification notice below
                 it is separately required by CC-BY-4.0 §3(a)(1)(B). Placed here rather
                 than behind a link because a desktop app that needs the network to be
                 licence-compliant is a bad trade. -->
            <span
              class="text-(length:--font-ui) text-foreground-muted"
              data-testid="srd-attribution"
            >
              This work includes material taken from the System Reference Document 5.1 (“SRD 5.1”)
              by Wizards of the Coast LLC and available at
              https://dnd.wizards.com/resources/systems-reference-document. The SRD 5.1 is licensed
              under the Creative Commons Attribution 4.0 International License available at
              https://creativecommons.org/licenses/by/4.0/legalcode.
            </span>
            <span class="text-(length:--font-ui) text-foreground-muted">
              The SRD 5.1 material has been modified: it was reshaped into structured field labels
              for a statblock preset.
            </span>
          </div>
        </Tabs.Content>
      </div>
    </Tabs.Root>
  </Dialog.Content>
</Dialog.Root>
