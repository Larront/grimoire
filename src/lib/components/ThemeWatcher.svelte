<script lang="ts">
  import { ModeWatcher } from "mode-watcher";
  import { ledger, type AccentPreset } from "$lib/stores/ledger.svelte";
  import { appPrefs } from "$lib/stores/app-prefs.svelte";

  const ALL_ACCENT_CLASSES: AccentPreset[] = [
    "accent-crimson",
    "accent-arcane",
    "accent-verdant",
    "accent-ice",
    "accent-amber",
  ];

  /*
    The accent is a CLASS, in both modes, and that is the whole of this effect.

    It used to be a class in light mode and four inline custom properties in dark, which
    meant the twenty preset values existed twice — once in `app.css` under `.accent-*`,
    once as a `DARK_TOKENS` table here — with nothing keeping the two in step. Editing a
    preset in the stylesheet changed light mode only, and silently, which is exactly the
    class of drift `shared/tokens.css` exists to make impossible.

    The inline path bought nothing. `app.css` already declares both halves of every
    preset: `.accent-crimson` carries the dark values and `.light.accent-crimson` the
    light ones, and the second wins under `.light` on specificity — (0,2,0) over (0,1,0)
    — rather than on source order. So one class covers both modes, `mode.current` is not
    consulted here at all, and a preset value lives in the stylesheet or nowhere.
  */
  $effect(() => {
    const root = document.documentElement;
    const preset = ledger.accent;

    for (const cls of ALL_ACCENT_CLASSES) {
      if (cls !== preset) root.classList.remove(cls);
    }
    root.classList.add(preset);
  });

  $effect(() => {
    document.documentElement.dataset.density = ledger.density;
  });

  $effect(() => {
    if (appPrefs.reduceMotion) {
      document.documentElement.dataset.reduceMotion = "true";
    } else {
      delete document.documentElement.dataset.reduceMotion;
    }
  });
</script>

<ModeWatcher defaultMode="dark" lightClassNames={["light"]} />
