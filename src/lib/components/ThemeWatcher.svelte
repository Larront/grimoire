<script lang="ts">
  import { ModeWatcher, mode } from 'mode-watcher';
  import { vault, type AccentPreset } from '$lib/stores/vault.svelte';
  import { appPrefs } from '$lib/stores/app-prefs.svelte';

  const ALL_ACCENT_CLASSES: AccentPreset[] = [
    'accent-crimson',
    'accent-arcane',
    'accent-verdant',
    'accent-ice',
    'accent-amber',
  ];

  const DARK_TOKENS: Record<AccentPreset, {
    primary: string;
    foreground: string;
    subtle: string;
    muted: string;
  }> = {
    'accent-crimson': {
      primary: '#c2483d',
      foreground: '#f9f1f0',
      subtle: 'rgba(194, 72, 61, 0.12)',
      muted: 'rgba(194, 72, 61, 0.24)',
    },
    'accent-arcane': {
      primary: '#9b6bbf',
      foreground: '#f5f0fa',
      subtle: 'rgba(155, 107, 191, 0.12)',
      muted: 'rgba(155, 107, 191, 0.24)',
    },
    'accent-verdant': {
      primary: '#5c9e6e',
      foreground: '#f0f9f3',
      subtle: 'rgba(92, 158, 110, 0.12)',
      muted: 'rgba(92, 158, 110, 0.24)',
    },
    'accent-ice': {
      primary: '#5b9ec9',
      foreground: '#f0f6fb',
      subtle: 'rgba(91, 158, 201, 0.12)',
      muted: 'rgba(91, 158, 201, 0.24)',
    },
    'accent-amber': {
      primary: '#c49a3c',
      foreground: '#1a1614',
      subtle: 'rgba(196, 154, 60, 0.12)',
      muted: 'rgba(196, 154, 60, 0.24)',
    },
  };

  const CSS_PROPS = [
    '--primary',
    '--primary-foreground',
    '--primary-subtle',
    '--primary-muted',
  ] as const;

  $effect(() => {
    const root = document.documentElement;
    const currentMode = mode.current ?? 'dark';
    const preset = vault.accent;
    const tokens = DARK_TOKENS[preset];

    // 1. Remove all accent classes
    for (const cls of ALL_ACCENT_CLASSES) {
      root.classList.remove(cls);
    }

    if (currentMode === 'light') {
      // 2. Light mode: class-driven, remove inline overrides
      root.classList.add(preset);
      for (const prop of CSS_PROPS) {
        root.style.removeProperty(prop);
      }
    } else {
      // 3. Dark / undefined: inline token overrides
      root.style.setProperty('--primary', tokens.primary);
      root.style.setProperty('--primary-foreground', tokens.foreground);
      root.style.setProperty('--primary-subtle', tokens.subtle);
      root.style.setProperty('--primary-muted', tokens.muted);
    }
  });

  $effect(() => {
    document.documentElement.dataset.density = vault.density;
  });

  $effect(() => {
    if (appPrefs.reduceMotion) {
      document.documentElement.dataset.reduceMotion = 'true';
    } else {
      delete document.documentElement.dataset.reduceMotion;
    }
  });
</script>

<ModeWatcher defaultMode="dark" lightClassNames={["light"]} />
