<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    label: string;
    sectionKey?: string;
    first?: boolean;
    children?: Snippet;
  }

  let { label, sectionKey, first = false, children }: Props = $props();
</script>

<section
  data-section={sectionKey}
  data-slot="detail-section"
  class={['space-y-2', !first && 'border-t border-background-border pt-3 mt-3']}
>
  <div class="font-mono text-[10.5px] uppercase tracking-[0.1em] text-foreground-faint">
    {label}
  </div>
  {@render children?.()}
</section>
