<script lang="ts">
  /*
    The "this is playing" mark: four crimson bars rising and falling out of step. The
    Signal Rule's *playing*, drawn the same wherever a scene says it is sounding — the
    in-note player's strip and the scene editor's transport. Decorative to assistive tech;
    the control beside it says what is playing in words.
  */
  import { cn } from "$lib/utils.js";

  let { class: className }: { class?: string } = $props();
</script>

<span class={cn("flex h-3 shrink-0 items-end gap-[2px]", className)} aria-hidden="true">
  <span class="now-playing-bar w-[2.5px] rounded-sm bg-primary/70" style="--bar-dur: 620ms; animation-delay: 0ms"
  ></span>
  <span class="now-playing-bar w-[2.5px] rounded-sm bg-primary/70" style="--bar-dur: 780ms; animation-delay: 80ms"
  ></span>
  <span class="now-playing-bar w-[2.5px] rounded-sm bg-primary/70" style="--bar-dur: 670ms; animation-delay: 160ms"
  ></span>
  <span class="now-playing-bar w-[2.5px] rounded-sm bg-primary/70" style="--bar-dur: 730ms; animation-delay: 240ms"
  ></span>
</span>

<style>
  .now-playing-bar {
    height: 100%;
    transform-origin: bottom;
    animation: nowPlaying var(--bar-dur, 700ms) ease-in-out infinite alternate;
  }

  @keyframes nowPlaying {
    from {
      transform: scaleY(0.2);
    }
    to {
      transform: scaleY(1);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .now-playing-bar {
      animation: none;
      transform: scaleY(0.6);
    }
  }
</style>
