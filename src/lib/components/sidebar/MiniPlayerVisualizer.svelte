<script lang="ts">
  import { audioEngine } from "$lib/stores/audio-engine.svelte";

  let canvas = $state<HTMLCanvasElement | null>(null);
  let animationId = $state(0);

  const BAR_COUNT = 4;
  const BAR_GAP = 2;
  const BAR_WIDTH = 3;
  const WIDTH = BAR_COUNT * BAR_WIDTH + (BAR_COUNT - 1) * BAR_GAP;
  const HEIGHT = 16;

  function draw() {
    const analyser = audioEngine.analyserNode;
    const ctx = canvas?.getContext("2d");
    if (!ctx) {
      animationId = requestAnimationFrame(draw);
      return;
    }

    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    const color = getComputedStyle(canvas!).color;
    ctx.fillStyle = color;

    if (!analyser) {
      // Static idle bars
      for (let i = 0; i < BAR_COUNT; i++) {
        const x = i * (BAR_WIDTH + BAR_GAP);
        ctx.fillRect(x, HEIGHT - 2, BAR_WIDTH, 2);
      }
    } else {
      const data = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(data);
      const binStep = Math.floor(data.length / (BAR_COUNT + 1));
      for (let i = 0; i < BAR_COUNT; i++) {
        const binIndex = (i + 1) * binStep;
        const value = data[binIndex] / 255;
        const barHeight = Math.max(2, value * HEIGHT);
        const x = i * (BAR_WIDTH + BAR_GAP);
        ctx.fillRect(x, HEIGHT - barHeight, BAR_WIDTH, barHeight);
      }
    }

    animationId = requestAnimationFrame(draw);
  }

  $effect(() => {
    if (canvas) {
      animationId = requestAnimationFrame(draw);
      return () => cancelAnimationFrame(animationId);
    }
  });
</script>

<canvas
  bind:this={canvas}
  width={WIDTH}
  height={HEIGHT}
  class="text-primary"
  style="width: {WIDTH}px; height: {HEIGHT}px;"
></canvas>
