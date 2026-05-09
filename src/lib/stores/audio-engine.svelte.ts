import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import { vault } from "./vault.svelte";
import { scenes } from "./scenes.svelte";
import type { SceneSlot } from "$lib/types/vault";

const FADE_SEC = 2.5;
const FADE_SEC_COLD = 0.3; // used when no audio is currently playing (cold start)

// ---- LocalPlayer ----------------------------------------------------------------
// One AudioBufferSourceNode + GainNode per active slot. Manages its own nodes map.

interface LocalNodes {
  source: AudioBufferSourceNode;
  gain: GainNode;
}

class LocalPlayer {
  private nodes = new Map<number, LocalNodes>();
  private masterGain: GainNode;
  private analyser: AnalyserNode;

  constructor(private ctx: AudioContext) {
    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = 1;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.8;
    this.masterGain.connect(this.analyser);
    this.analyser.connect(ctx.destination);
  }

  getAnalyser(): AnalyserNode {
    return this.analyser;
  }

  async startAtVolume(slot: SceneSlot, initialVolume: number): Promise<void> {
    // Load audio via asset protocol — avoids transferring large files over the command bridge
    const absolutePath = await invoke<string>("get_audio_absolute_path", {
      relativePath: slot.source_id,
    });
    const assetUrl = convertFileSrc(absolutePath);
    const response = await fetch(assetUrl);
    const buffer = await this.ctx.decodeAudioData(await response.arrayBuffer());

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = slot.loop;

    const gain = this.ctx.createGain();
    gain.gain.value = initialVolume;

    source.connect(gain);
    gain.connect(this.masterGain);
    source.start();

    this.nodes.set(slot.id, { source, gain });
  }

  fadeTo(slotId: number, target: number, durationSec: number): Promise<void> {
    const n = this.nodes.get(slotId);
    if (!n) return Promise.resolve();
    n.gain.gain.linearRampToValueAtTime(
      target,
      this.ctx.currentTime + durationSec,
    );
    return new Promise((resolve) => setTimeout(resolve, durationSec * 1000));
  }

  setVolume(slotId: number, volume: number): void {
    const n = this.nodes.get(slotId);
    if (n) {
      n.gain.gain.cancelScheduledValues(this.ctx.currentTime);
      n.gain.gain.value = volume;
    }
  }

  setMasterVolume(v: number): void {
    this.masterGain.gain.value = v;
  }

  isPlaying(slotId: number): boolean {
    return this.nodes.has(slotId);
  }

  stop(slotId: number): void {
    const n = this.nodes.get(slotId);
    if (n) {
      try {
        n.source.stop();
      } catch {
        /* already stopped */
      }
      n.source.disconnect();
      n.gain.disconnect();
      this.nodes.delete(slotId);
    }
  }

  stopAll(): void {
    for (const id of [...this.nodes.keys()]) {
      this.stop(id);
    }
  }
}

// ---- Spotify SDK loader ---------------------------------------------------------

let sdkLoadPromise: Promise<void> | null = null;

function loadSpotifySdk(): Promise<void> {
  if (window.Spotify) return Promise.resolve();
  if (sdkLoadPromise) return sdkLoadPromise;
  sdkLoadPromise = new Promise<void>((resolve, reject) => {
    // The SDK calls window.onSpotifyWebPlaybackSDKReady when loaded
    (window as any).onSpotifyWebPlaybackSDKReady = resolve;
    const script = document.createElement("script");
    script.src = "https://sdk.scdn.co/spotify-player.js";
    script.onerror = () =>
      reject(new Error("Failed to load Spotify Web Playback SDK"));
    document.head.appendChild(script);
  });
  return sdkLoadPromise;
}

// ---- SpotifyPlayer --------------------------------------------------------------
// Single SDK instance. Volume crossfade via setInterval ramp.

class SpotifyPlayer {
  private player: Spotify.Player | null = null;
  private deviceId: string | null = null;
  private currentVolume = 0;
  currentSlot: SceneSlot | null = null;

  async initialize(): Promise<void> {
    await loadSpotifySdk();

    this.player = new window.Spotify.Player({
      name: "Notaret",
      getOAuthToken: async (cb: (token: string) => void) => {
        try {
          const token = await invoke<string>("spotify_get_access_token");
          cb(token);
        } catch {
          cb("");
        }
      },
      volume: 0,
    });

    this.player.addListener(
      "initialization_error",
      ({ message }: { message: string }) => {
        console.error("[SpotifyPlayer] init error:", message);
      },
    );
    this.player.addListener(
      "authentication_error",
      ({ message }: { message: string }) => {
        console.error("[SpotifyPlayer] auth error:", message);
      },
    );
    this.player.addListener(
      "account_error",
      ({ message }: { message: string }) => {
        console.error("[SpotifyPlayer] account error:", message);
      },
    );

    await new Promise<void>((resolve, reject) => {
      this.player!.addListener(
        "ready",
        ({ device_id }: { device_id: string }) => {
          this.deviceId = device_id;
          resolve();
        },
      );
      this.player!.addListener("not_ready", () => {
        reject(new Error("Spotify player not ready"));
      });
      this.player!.connect().then((ok: boolean) => {
        if (!ok) reject(new Error("Spotify player failed to connect"));
      });
    });
  }

  async playAtVolume(slot: SceneSlot, initialVolume: number): Promise<void> {
    if (!this.player || !this.deviceId) {
      await this.initialize();
    }
    await this.player!.setVolume(initialVolume);
    this.currentVolume = initialVolume;
    this.currentSlot = slot;

    // Normalize playlist_v2 URIs — the Web API only accepts "playlist"
    const sourceUri = slot.source_id.replace(/playlist_v2/g, "playlist");
    const usesContext =
      sourceUri.startsWith("spotify:playlist:") ||
      sourceUri.startsWith("spotify:album:");

    // All Spotify Web API calls are made from Rust — token never crosses IPC bridge
    await invoke("spotify_play_track", {
      sourceId: sourceUri,
      useContext: usesContext,
      loopMode: slot.loop,
      shuffle: !!slot.shuffle,
      deviceId: this.deviceId,
    });
  }

  async resume(): Promise<void> {
    if (!this.player || !this.deviceId) return;
    await invoke("spotify_resume", { deviceId: this.deviceId });
  }

  async skipNext(): Promise<void> {
    if (!this.deviceId) return;
    await invoke("spotify_skip_next", { deviceId: this.deviceId });
  }

  async skipPrev(): Promise<void> {
    if (!this.deviceId) return;
    await invoke("spotify_skip_prev", { deviceId: this.deviceId });
  }

  async stop(): Promise<void> {
    if (this.player) {
      try {
        await this.player.pause();
      } catch {
        /* ignore */
      }
    }
    this.currentSlot = null;
  }

  fadeTo(target: number, durationSec: number): Promise<void> {
    if (!this.player) return Promise.resolve();
    const durationMs = durationSec * 1000;
    const startVol = this.currentVolume;
    const steps = 25;
    const interval = durationMs / steps;
    let step = 0;
    return new Promise<void>((resolve) => {
      const id = setInterval(async () => {
        if (!this.player) {
          clearInterval(id);
          resolve();
          return;
        }
        step++;
        const vol = startVol + ((target - startVol) * step) / steps;
        const clamped = Math.max(0, Math.min(1, vol));
        await this.player.setVolume(clamped);
        this.currentVolume = clamped;
        if (step >= steps) {
          clearInterval(id);
          resolve();
        }
      }, interval);
    });
  }

  async setVolume(volume: number): Promise<void> {
    if (this.player) {
      await this.player.setVolume(volume);
      this.currentVolume = volume;
    }
  }

  disconnect(): void {
    if (this.player) {
      this.player.disconnect();
      this.player = null;
      this.deviceId = null;
    }
    this.currentSlot = null;
  }
}

// ---- SlotPlaybackState ----------------------------------------------------------

interface SlotPlaybackState {
  slot: SceneSlot;
  volume: number;
  playing: boolean;
}

// ---- Store ----------------------------------------------------------------------

function createAudioEngine() {
  let activeSceneId = $state<number | null>(null);
  let isPlaying = $state(false);
  let isCrossfading = $state(false);
  let loadingSceneId = $state<number | null>(null);
  let slotStates = $state(new Map<number, SlotPlaybackState>());
  let pendingSceneId = $state<number | null>(null);
  let masterVolume = $state(1);

  let ctx: AudioContext | null = null;
  let localPlayer: LocalPlayer | null = null;
  let spotifyPlayer: SpotifyPlayer | null = null;
  let crossfadeAborted = false;

  function getOrCreateCtx(): AudioContext {
    if (!ctx) ctx = new AudioContext();
    return ctx;
  }

  async function playScene(sceneId: number): Promise<void> {
    await crossfadeTo(sceneId);
  }

  function stopAll(): void {
    crossfadeAborted = true;
    pendingSceneId = null;
    loadingSceneId = null;
    localPlayer?.stopAll();
    spotifyPlayer?.stop();
    slotStates = new Map<number, SlotPlaybackState>();
    isPlaying = false;
    isCrossfading = false;
    activeSceneId = null;
  }

  function setSlotVolume(slotId: number, volume: number): void {
    const state = slotStates.get(slotId);
    if (!state) return;
    if (state.slot.source === "local") {
      localPlayer?.setVolume(slotId, volume);
    } else {
      spotifyPlayer?.setVolume(volume * masterVolume);
    }
    const updated = new Map(slotStates);
    updated.set(slotId, { ...state, volume });
    slotStates = updated;
  }

  function setMasterVolume(v: number): void {
    const clamped = Math.max(0, Math.min(1, v));
    masterVolume = clamped;
    localPlayer?.setMasterVolume(clamped);

    for (const [, state] of slotStates.entries()) {
      if (state.slot.source === "spotify") {
        spotifyPlayer?.setVolume(state.volume * clamped);
        break;
      }
    }
  }

  async function pauseSlot(slotId: number): Promise<void> {
    const state = slotStates.get(slotId);
    if (!state) return;
    if (state.slot.source === "local") {
      localPlayer?.stop(slotId);
    } else {
      await spotifyPlayer?.stop();
    }
    const updated = new Map(slotStates);
    updated.set(slotId, { ...state, playing: false });
    slotStates = updated;
  }

  async function resumeSlot(slotId: number): Promise<void> {
    const state = slotStates.get(slotId);
    if (!state) return;
    if (state.slot.source === "local") {
      if (localPlayer)
        await localPlayer.startAtVolume(state.slot, state.volume);
    } else {
      await spotifyPlayer?.resume();
    }
    const updated = new Map(slotStates);
    updated.set(slotId, { ...state, playing: true });
    slotStates = updated;
  }

  async function skipNext(): Promise<void> {
    await spotifyPlayer?.skipNext();
  }

  async function skipPrev(): Promise<void> {
    await spotifyPlayer?.skipPrev();
  }

  async function crossfadeTo(newSceneId: number): Promise<void> {
    if (newSceneId === activeSceneId) return;
    if (isCrossfading) {
      pendingSceneId = newSceneId;
      return;
    }

    crossfadeAborted = false;
    isCrossfading = true;
    loadingSceneId = newSceneId;

    try {
      const newSlots = await scenes.getSlots(newSceneId);
      const newLocalSlots = newSlots.filter((s) => s.source === "local");
      const newSpotifySlot =
        newSlots.find((s) => s.source === "spotify") ?? null;

      if (newSlots.filter((s) => s.source === "spotify").length > 1) {
        console.warn(
          "[audio-engine] scene has multiple Spotify slots; only first will play",
        );
      }

      const outgoingLocalIds = [...slotStates.entries()]
        .filter(([, s]) => s.slot.source === "local")
        .map(([id]) => id);
      const hadSpotify = [...slotStates.values()].some(
        (s) => s.slot.source === "spotify",
      );

      const isColdStart = outgoingLocalIds.length === 0 && !hadSpotify;
      const fadeSec = isColdStart ? FADE_SEC_COLD : FADE_SEC;

      // Kick off fade-outs, collecting promises to await
      const fadeOuts: Promise<void>[] = outgoingLocalIds.map((id) =>
        localPlayer!.fadeTo(id, 0, fadeSec),
      );
      if (hadSpotify && spotifyPlayer) {
        fadeOuts.push(spotifyPlayer.fadeTo(0, fadeSec));
      }

      // Start incoming slots concurrently while outgoing fades
      const audioCtx = getOrCreateCtx();
      if (!localPlayer) localPlayer = new LocalPlayer(audioCtx);

      const newStates = new Map<number, SlotPlaybackState>();

      for (const slot of newLocalSlots) {
        try {
          await localPlayer.startAtVolume(slot, 0);
          void localPlayer.fadeTo(slot.id, slot.volume, fadeSec);
          newStates.set(slot.id, { slot, volume: slot.volume, playing: true });
        } catch (e) {
          console.error(
            `[audio-engine] failed to start local slot ${slot.id}:`,
            e,
          );
        }
      }

      if (newSpotifySlot) {
        if (!spotifyPlayer) spotifyPlayer = new SpotifyPlayer();
        try {
          await spotifyPlayer.playAtVolume(newSpotifySlot, 0);
          void spotifyPlayer.fadeTo(
            newSpotifySlot.volume * masterVolume,
            fadeSec,
          );
          newStates.set(newSpotifySlot.id, {
            slot: newSpotifySlot,
            volume: newSpotifySlot.volume,
            playing: true,
          });
        } catch (e) {
          console.error("[audio-engine] Spotify playback failed:", e);
        }
      }

      await Promise.all(fadeOuts);

      // stopAll() may have fired during the await — bail without committing state
      if (crossfadeAborted) return;

      for (const id of outgoingLocalIds) {
        localPlayer?.stop(id);
      }
      if (hadSpotify && !newSpotifySlot) {
        spotifyPlayer?.stop();
      }

      slotStates = newStates;
      activeSceneId = newStates.size > 0 ? newSceneId : null;
      isPlaying = newStates.size > 0;
    } catch (e) {
      console.error("[audio-engine] crossfadeTo failed:", e);
    } finally {
      isCrossfading = false;
      loadingSceneId = null;
    }

    if (pendingSceneId !== null && pendingSceneId !== activeSceneId) {
      const next = pendingSceneId;
      pendingSceneId = null;
      crossfadeTo(next);
    }
  }

  // Vault close cleanup
  $effect.root(() => {
    $effect(() => {
      if (!vault.isOpen) {
        stopAll();
        if (ctx) {
          ctx.close();
          ctx = null;
        }
        localPlayer = null;
        spotifyPlayer?.disconnect();
        spotifyPlayer = null;
      }
    });
  });

  return {
    get activeSceneId() {
      return activeSceneId;
    },
    get isPlaying() {
      return isPlaying;
    },
    get isCrossfading() {
      return isCrossfading;
    },
    get loadingSceneId() {
      return loadingSceneId;
    },
    get slotStates() {
      return slotStates;
    },
    get masterVolume() {
      return masterVolume;
    },
    get analyserNode(): AnalyserNode | null {
      return localPlayer?.getAnalyser() ?? null;
    },
    playScene,
    stopAll,
    setSlotVolume,
    setMasterVolume,
    pauseSlot,
    resumeSlot,
    skipNext,
    skipPrev,
    crossfadeTo,
  };
}

export const audioEngine = createAudioEngine();
