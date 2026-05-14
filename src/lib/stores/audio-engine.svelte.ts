import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import { vault } from "./vault.svelte";
import { scenes } from "./scenes.svelte";
import type { SceneSlot } from "$lib/types/vault";

const FADE_SEC = 2.5;
const FADE_SEC_COLD = 0.3;

// ---- isPlaylistSlot ----------------------------------------------------------------
// Single place that defines which slots support queue navigation (skipNext/skipPrev).
// Add new source patterns here as streaming integrations are added.

export function isPlaylistSlot(slot: SceneSlot): boolean {
  return slot.source_id.startsWith("spotify:playlist:");
}

// ---- Interfaces --------------------------------------------------------------------

interface SlotPlayer {
  start(slot: SceneSlot, initialVolume: number): Promise<void>;
  stop(): Promise<void>;
  resume(): Promise<void>;
  // targetVolume is the slot volume (0–1); player handles master scaling internally
  fadeTo(targetVolume: number, durationSec: number): Promise<void>;
  setVolume(volume: number): void;
  setMasterVolume(volume: number): void;
}

interface PlaylistSlotPlayer extends SlotPlayer {
  skipNext(): Promise<void>;
  skipPrev(): Promise<void>;
}

// ---- LocalAudioContext -------------------------------------------------------------

class LocalAudioContext {
  readonly ctx: AudioContext;
  private readonly masterGain: GainNode;
  readonly analyser: AnalyserNode;

  constructor() {
    this.ctx = new AudioContext();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 1;
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.8;
    this.masterGain.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
  }

  get destination(): GainNode {
    return this.masterGain;
  }

  setMasterVolume(v: number): void {
    this.masterGain.gain.value = v;
  }

  close(): void {
    this.ctx.close();
  }
}

// ---- LocalSlotPlayer ---------------------------------------------------------------

class LocalSlotPlayer implements SlotPlayer {
  private source: AudioBufferSourceNode | null = null;
  private gain: GainNode | null = null;
  private currentSlot: SceneSlot | null = null;
  private currentVolume = 0;

  constructor(private readonly localCtx: LocalAudioContext) {}

  async start(slot: SceneSlot, initialVolume: number): Promise<void> {
    this.currentSlot = slot;
    this.currentVolume = initialVolume;

    // Load audio via asset protocol — avoids transferring large files over the command bridge
    const absolutePath = await invoke<string>("get_audio_absolute_path", {
      relativePath: slot.source_id,
    });
    const assetUrl = convertFileSrc(absolutePath);
    const response = await fetch(assetUrl);
    const buffer = await this.localCtx.ctx.decodeAudioData(await response.arrayBuffer());

    const source = this.localCtx.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = slot.loop;

    const gain = this.localCtx.ctx.createGain();
    gain.gain.value = initialVolume;

    source.connect(gain);
    gain.connect(this.localCtx.destination);
    source.start();

    this.source = source;
    this.gain = gain;
  }

  async stop(): Promise<void> {
    if (this.source) {
      try { this.source.stop(); } catch { /* already stopped */ }
      this.source.disconnect();
    }
    this.gain?.disconnect();
    this.source = null;
    this.gain = null;
  }

  async resume(): Promise<void> {
    if (this.currentSlot) await this.start(this.currentSlot, this.currentVolume);
  }

  fadeTo(targetVolume: number, durationSec: number): Promise<void> {
    if (!this.gain) return Promise.resolve();
    this.gain.gain.linearRampToValueAtTime(
      targetVolume,
      this.localCtx.ctx.currentTime + durationSec,
    );
    return new Promise((resolve) => setTimeout(resolve, durationSec * 1000));
  }

  setVolume(volume: number): void {
    this.currentVolume = volume;
    if (this.gain) {
      this.gain.gain.cancelScheduledValues(this.localCtx.ctx.currentTime);
      this.gain.gain.value = volume;
    }
  }

  // Delegates to the shared masterGain node — multiple LocalSlotPlayers calling this
  // is idempotent since they all share the same LocalAudioContext.
  setMasterVolume(volume: number): void {
    this.localCtx.setMasterVolume(volume);
  }
}

// ---- Spotify SDK loader ------------------------------------------------------------

let sdkLoadPromise: Promise<void> | null = null;

function loadSpotifySdk(): Promise<void> {
  if (window.Spotify) return Promise.resolve();
  if (sdkLoadPromise) return sdkLoadPromise;
  sdkLoadPromise = new Promise<void>((resolve, reject) => {
    (window as any).onSpotifyWebPlaybackSDKReady = resolve;
    const script = document.createElement("script");
    script.src = "https://sdk.scdn.co/spotify-player.js";
    script.onerror = () => reject(new Error("Failed to load Spotify Web Playback SDK"));
    document.head.appendChild(script);
  });
  return sdkLoadPromise;
}

// ---- SpotifyContext ----------------------------------------------------------------
// Shared SDK infrastructure for all SpotifySlotPlayer instances.
// One context per audio engine; initialised lazily on first Spotify slot.

class SpotifyContext {
  private sdkPlayer: Spotify.Player | null = null;
  private deviceId: string | null = null;

  async initialize(): Promise<void> {
    if (this.sdkPlayer && this.deviceId) return;
    await loadSpotifySdk();

    this.sdkPlayer = new window.Spotify.Player({
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

    this.sdkPlayer.addListener("initialization_error", ({ message }: { message: string }) => {
      console.error("[SpotifyPlayer] init error:", message);
    });
    this.sdkPlayer.addListener("authentication_error", ({ message }: { message: string }) => {
      console.error("[SpotifyPlayer] auth error:", message);
    });
    this.sdkPlayer.addListener("account_error", ({ message }: { message: string }) => {
      console.error("[SpotifyPlayer] account error:", message);
    });

    await new Promise<void>((resolve, reject) => {
      this.sdkPlayer!.addListener("ready", ({ device_id }: { device_id: string }) => {
        this.deviceId = device_id;
        resolve();
      });
      this.sdkPlayer!.addListener("not_ready", () => {
        reject(new Error("Spotify player not ready"));
      });
      this.sdkPlayer!.connect().then((ok: boolean) => {
        if (!ok) reject(new Error("Spotify player failed to connect"));
      });
    });
  }

  async setVolume(volume: number): Promise<void> {
    if (this.sdkPlayer) await this.sdkPlayer.setVolume(volume);
  }

  async play(slot: SceneSlot): Promise<void> {
    if (!this.sdkPlayer || !this.deviceId) await this.initialize();
    // Normalise playlist_v2 URIs — the Web API only accepts "playlist"
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
    if (this.deviceId) await invoke("spotify_resume", { deviceId: this.deviceId });
  }

  async pause(): Promise<void> {
    try { await this.sdkPlayer?.pause(); } catch { /* ignore */ }
  }

  async skipNext(): Promise<void> {
    if (this.deviceId) await invoke("spotify_skip_next", { deviceId: this.deviceId });
  }

  async skipPrev(): Promise<void> {
    if (this.deviceId) await invoke("spotify_skip_prev", { deviceId: this.deviceId });
  }

  disconnect(): void {
    if (this.sdkPlayer) {
      this.sdkPlayer.disconnect();
      this.sdkPlayer = null;
      this.deviceId = null;
    }
  }
}

// ---- SpotifySlotPlayer -------------------------------------------------------------

class SpotifySlotPlayer implements PlaylistSlotPlayer {
  private currentVolume = 0;
  private currentMasterVolume = 1;

  constructor(private readonly ctx: SpotifyContext) {}

  async start(slot: SceneSlot, initialVolume: number): Promise<void> {
    this.currentVolume = initialVolume;
    await this.ctx.initialize();
    await this.ctx.setVolume(initialVolume * this.currentMasterVolume);
    await this.ctx.play(slot);
  }

  async stop(): Promise<void> {
    await this.ctx.pause();
  }

  async resume(): Promise<void> {
    await this.ctx.resume();
  }

  fadeTo(targetVolume: number, durationSec: number): Promise<void> {
    const durationMs = durationSec * 1000;
    const startScaled = this.currentVolume * this.currentMasterVolume;
    const targetScaled = targetVolume * this.currentMasterVolume;
    const steps = 25;
    const interval = durationMs / steps;
    let step = 0;
    this.currentVolume = targetVolume;
    return new Promise<void>((resolve) => {
      const id = setInterval(async () => {
        step++;
        const vol = startScaled + ((targetScaled - startScaled) * step) / steps;
        await this.ctx.setVolume(Math.max(0, Math.min(1, vol)));
        if (step >= steps) {
          clearInterval(id);
          resolve();
        }
      }, interval);
    });
  }

  setVolume(volume: number): void {
    this.currentVolume = volume;
    void this.ctx.setVolume(volume * this.currentMasterVolume);
  }

  setMasterVolume(volume: number): void {
    this.currentMasterVolume = volume;
    void this.ctx.setVolume(this.currentVolume * volume);
  }

  async skipNext(): Promise<void> {
    await this.ctx.skipNext();
  }

  async skipPrev(): Promise<void> {
    await this.ctx.skipPrev();
  }
}

// ---- Factory -----------------------------------------------------------------------
// The single place that knows about slot source types.

function createSlotPlayer(
  slot: SceneSlot,
  localCtx: LocalAudioContext,
  spotifyCtx: SpotifyContext,
): SlotPlayer {
  switch (slot.source) {
    case "local": return new LocalSlotPlayer(localCtx);
    case "spotify": return new SpotifySlotPlayer(spotifyCtx);
    default: throw new Error(`Unknown slot source: ${slot.source}`);
  }
}

// ---- SlotPlaybackState -------------------------------------------------------------

interface SlotPlaybackState {
  slot: SceneSlot;
  volume: number;
  playing: boolean;
}

// ---- Store -------------------------------------------------------------------------

function createAudioEngine() {
  let activeSceneId = $state<number | null>(null);
  let isPlaying = $state(false);
  let isCrossfading = $state(false);
  let loadingSceneId = $state<number | null>(null);
  let slotStates = $state(new Map<number, SlotPlaybackState>());
  let pendingSceneId = $state<number | null>(null);
  let masterVolume = $state(1);

  // Non-reactive player state — not exposed to components
  let localCtx: LocalAudioContext | null = null;
  let spotifyCtx: SpotifyContext | null = null;
  const slotPlayers = new Map<number, SlotPlayer>();
  let activePlaylistPlayer: PlaylistSlotPlayer | null = null;
  let crossfadeAborted = false;

  function getOrCreateLocalCtx(): LocalAudioContext {
    if (!localCtx) localCtx = new LocalAudioContext();
    return localCtx;
  }

  function getOrCreateSpotifyCtx(): SpotifyContext {
    if (!spotifyCtx) spotifyCtx = new SpotifyContext();
    return spotifyCtx;
  }

  async function playScene(sceneId: number): Promise<void> {
    await crossfadeTo(sceneId);
  }

  function stopAll(): void {
    crossfadeAborted = true;
    pendingSceneId = null;
    loadingSceneId = null;
    for (const player of slotPlayers.values()) {
      void player.stop();
    }
    slotPlayers.clear();
    slotStates = new Map<number, SlotPlaybackState>();
    isPlaying = false;
    isCrossfading = false;
    activeSceneId = null;
    activePlaylistPlayer = null;
  }

  function setSlotVolume(slotId: number, volume: number): void {
    const state = slotStates.get(slotId);
    if (!state) return;
    slotPlayers.get(slotId)?.setVolume(volume);
    const updated = new Map(slotStates);
    updated.set(slotId, { ...state, volume });
    slotStates = updated;
  }

  function setMasterVolume(v: number): void {
    const clamped = Math.max(0, Math.min(1, v));
    masterVolume = clamped;
    for (const player of slotPlayers.values()) {
      player.setMasterVolume(clamped);
    }
  }

  async function pauseSlot(slotId: number): Promise<void> {
    const state = slotStates.get(slotId);
    if (!state) return;
    await slotPlayers.get(slotId)?.stop();
    const updated = new Map(slotStates);
    updated.set(slotId, { ...state, playing: false });
    slotStates = updated;
  }

  async function resumeSlot(slotId: number): Promise<void> {
    const state = slotStates.get(slotId);
    if (!state) return;
    await slotPlayers.get(slotId)?.resume();
    const updated = new Map(slotStates);
    updated.set(slotId, { ...state, playing: true });
    slotStates = updated;
  }

  async function skipNext(): Promise<void> {
    await activePlaylistPlayer?.skipNext();
  }

  async function skipPrev(): Promise<void> {
    await activePlaylistPlayer?.skipPrev();
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

      if (newSlots.filter((s) => s.source === "spotify").length > 1) {
        console.warn("[audio-engine] scene has multiple Spotify slots; only first will play");
      }

      const isColdStart = slotPlayers.size === 0;
      const fadeSec = isColdStart ? FADE_SEC_COLD : FADE_SEC;

      // Snapshot outgoing players before new ones start
      const outgoing = [...slotPlayers.values()];
      const fadeOuts = outgoing.map((p) => p.fadeTo(0, fadeSec));

      // Start incoming slots concurrently while outgoing fades
      const newCtx = getOrCreateLocalCtx();
      const newSpotifyCtx = getOrCreateSpotifyCtx();
      const newStates = new Map<number, SlotPlaybackState>();
      const newPlayers = new Map<number, SlotPlayer>();
      let newPlaylistPlayer: PlaylistSlotPlayer | null = null;

      for (const slot of newSlots) {
        try {
          const player = createSlotPlayer(slot, newCtx, newSpotifyCtx);
          await player.start(slot, 0);
          // setMasterVolume must be called before fadeTo so streaming players
          // scale to the correct final volume
          player.setMasterVolume(masterVolume);
          void player.fadeTo(slot.volume, fadeSec);
          newStates.set(slot.id, { slot, volume: slot.volume, playing: true });
          newPlayers.set(slot.id, player);
          if (isPlaylistSlot(slot)) newPlaylistPlayer = player as PlaylistSlotPlayer;
        } catch (e) {
          console.error(`[audio-engine] failed to start slot ${slot.id}:`, e);
        }
      }

      await Promise.all(fadeOuts);

      // stopAll() may have fired during the await — bail without committing state
      if (crossfadeAborted) return;

      // Stop outgoing players now that their fades have completed
      for (const player of outgoing) {
        await player.stop();
      }

      // Commit new state
      slotPlayers.clear();
      for (const [id, player] of newPlayers) slotPlayers.set(id, player);
      slotStates = newStates;
      activePlaylistPlayer = newPlaylistPlayer;
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
        localCtx?.close();
        localCtx = null;
        spotifyCtx?.disconnect();
        spotifyCtx = null;
      }
    });
  });

  return {
    get activeSceneId() { return activeSceneId; },
    get isPlaying() { return isPlaying; },
    get isCrossfading() { return isCrossfading; },
    get loadingSceneId() { return loadingSceneId; },
    get slotStates() { return slotStates; },
    get masterVolume() { return masterVolume; },
    get analyserNode(): AnalyserNode | null { return localCtx?.analyser ?? null; },
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
