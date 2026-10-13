import { untrack } from "svelte";
import { convertFileSrc } from "@tauri-apps/api/core";
import { api } from "$lib/api";
import { ledger } from "./ledger.svelte";
import { scenes } from "./scenes.svelte";
import { toastError } from "$lib/toast";
import { logError } from "$lib/log";
import type { SceneSlot } from "$lib/types/ledger";

const FADE_SEC = 2.5;
const FADE_SEC_COLD = 0.3;

// ---- isPlaylistSlot ----------------------------------------------------------------
// Single place that defines which slots support queue navigation (skipNext/skipPrev).
// Add new source patterns here as streaming integrations are added.

export function isPlaylistSlot(slot: SceneSlot): boolean {
  return slot.source_id.startsWith("spotify:playlist:");
}

/** GM-facing name for a slot in failure toasts: the audio file's name for
 *  local slots, a generic label for Spotify (URIs mean nothing to the GM). */
function slotDisplayName(slot: SceneSlot): string {
  if (slot.source === "spotify") {
    return isPlaylistSlot(slot) ? "the Spotify playlist" : "the Spotify track";
  }
  return `"${slot.source_id.split("/").pop() ?? slot.source_id}"`;
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
  /** Loop on or off for the sound already playing. Optional: a Spotify track takes its
   *  repeat setting when it is next played. */
  setLoop?(loop: boolean): void;
}

interface PlaylistSlotPlayer extends SlotPlayer {
  skipNext(): Promise<void>;
  skipPrev(): Promise<void>;
}

// ---- LocalAudioContext -------------------------------------------------------------

class LocalAudioContext {
  readonly ctx: AudioContext;
  private readonly masterGain: GainNode;

  constructor() {
    this.ctx = new AudioContext();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 1;
    this.masterGain.connect(this.ctx.destination);
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
  // Pausing is stopping and resuming is starting again — an AudioBufferSourceNode can be
  // played only once — so the player keeps what a resume needs: the decoded audio, and
  // where in it playback had reached. It used to keep neither: resume() fetched and
  // decoded the file again and started it from the top, so Pause then Play restarted
  // every track, a second or more late.
  private buffer: AudioBuffer | null = null;
  /** Seconds into the file the current source began at. */
  private offset = 0;
  /** The context time the current source began. */
  private startedAt = 0;

  constructor(private readonly localCtx: LocalAudioContext) {}

  async start(slot: SceneSlot, initialVolume: number): Promise<void> {
    this.currentSlot = slot;
    this.currentVolume = initialVolume;

    // Load audio via asset protocol — avoids transferring large files over the command bridge
    const absolutePath = await api.getAudioAbsolutePath(slot.source_id);
    const assetUrl = convertFileSrc(absolutePath);
    const response = await fetch(assetUrl);
    this.buffer = await this.localCtx.ctx.decodeAudioData(await response.arrayBuffer());
    this.offset = 0;
    this.play(initialVolume);
  }

  private play(volume: number): void {
    if (!this.buffer || !this.currentSlot) return;
    const source = this.localCtx.ctx.createBufferSource();
    source.buffer = this.buffer;
    source.loop = this.currentSlot.loop;

    const gain = this.localCtx.ctx.createGain();
    gain.gain.value = volume;

    source.connect(gain);
    gain.connect(this.localCtx.destination);
    source.start(0, this.offset);
    this.startedAt = this.localCtx.ctx.currentTime;

    this.source = source;
    this.gain = gain;
  }

  async stop(): Promise<void> {
    if (this.source) {
      this.offset = this.positionNow();
      try {
        this.source.stop();
      } catch {
        /* already stopped */
      }
      this.source.disconnect();
    }
    this.gain?.disconnect();
    this.source = null;
    this.gain = null;
  }

  // Where playback has reached. A looping track wraps; one that played to its end and
  // stopped starts again from the top when resumed.
  private positionNow(): number {
    const duration = this.buffer?.duration ?? 0;
    const reached = this.offset + (this.localCtx.ctx.currentTime - this.startedAt);
    if (duration <= 0) return 0;
    if (this.currentSlot?.loop) return reached % duration;
    return reached >= duration ? 0 : reached;
  }

  async resume(): Promise<void> {
    if (this.buffer) this.play(this.currentVolume);
    else if (this.currentSlot) await this.start(this.currentSlot, this.currentVolume);
  }

  // Loop changed while the track plays. Where it has reached is first counted from the
  // loop it is in, so turning loop off mid-way plays out this pass rather than reading
  // as already past the end.
  setLoop(loop: boolean): void {
    if (!this.currentSlot || this.currentSlot.loop === loop) return;
    if (this.source) {
      this.offset = this.positionNow();
      this.startedAt = this.localCtx.ctx.currentTime;
      this.source.loop = loop;
    }
    this.currentSlot = { ...this.currentSlot, loop };
  }

  // A fade is where the slot's volume is decided, so it is also what a resume must
  // return to. Every slot starts at 0 and fades up; when only start() and setVolume()
  // recorded the volume, a paused local track resumed at the 0 it was started at —
  // playing, by every indicator in the app, and silent.
  fadeTo(targetVolume: number, durationSec: number): Promise<void> {
    this.currentVolume = targetVolume;
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
  // The SDK re-emits auth errors on every retry — toast the first only.
  private authErrorToasted = false;

  private toastAuthErrorOnce(message: string): void {
    if (this.authErrorToasted) return;
    this.authErrorToasted = true;
    toastError(message);
  }

  async initialize(): Promise<void> {
    if (this.sdkPlayer && this.deviceId) return;
    this.authErrorToasted = false;
    await loadSpotifySdk();

    this.sdkPlayer = new window.Spotify.Player({
      name: "Notaret",
      getOAuthToken: async (cb: (token: string) => void) => {
        // Silent surface: a failure here surfaces through the SDK's
        // authentication_error listener below, with a reconnect hint.
        try {
          cb(await api.silent.spotifyGetAccessToken());
        } catch {
          // One refresh retry before giving up — mid-session token expiry
          // should recover invisibly (issue #115).
          try {
            await api.silent.spotifyRefreshToken();
            cb(await api.silent.spotifyGetAccessToken());
          } catch (e) {
            logError("[SpotifyPlayer] token refresh failed:", e);
            cb("");
          }
        }
      },
      volume: 0,
    });

    this.sdkPlayer.addListener("initialization_error", ({ message }: { message: string }) => {
      logError("[SpotifyPlayer] init error:", message);
    });
    this.sdkPlayer.addListener("authentication_error", ({ message }: { message: string }) => {
      logError("[SpotifyPlayer] auth error:", message);
      this.toastAuthErrorOnce("Spotify session expired — reconnect in Settings → Integrations.");
    });
    this.sdkPlayer.addListener("account_error", ({ message }: { message: string }) => {
      logError("[SpotifyPlayer] account error:", message);
      this.toastAuthErrorOnce("Spotify playback requires a Premium account.");
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
      sourceUri.startsWith("spotify:playlist:") || sourceUri.startsWith("spotify:album:");
    // All Spotify Web API calls are made from Rust — token never crosses IPC bridge
    await api.spotifyPlayTrack(
      sourceUri,
      usesContext,
      slot.loop,
      !!slot.shuffle,
      this.deviceId!, // initialize() above guarantees it's set
    );
  }

  async resume(): Promise<void> {
    if (this.deviceId) await api.spotifyResume(this.deviceId);
  }

  async pause(): Promise<void> {
    try {
      await this.sdkPlayer?.pause();
    } catch {
      /* ignore */
    }
  }

  async skipNext(): Promise<void> {
    if (this.deviceId) await api.spotifySkipNext(this.deviceId);
  }

  async skipPrev(): Promise<void> {
    if (this.deviceId) await api.spotifySkipPrev(this.deviceId);
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
    case "local":
      return new LocalSlotPlayer(localCtx);
    case "spotify":
      return new SpotifySlotPlayer(spotifyCtx);
    default:
      throw new Error(`Unknown slot source: ${slot.source}`);
  }
}

// ---- SceneState --------------------------------------------------------------------

/**
 * Where one scene stands, for any surface that shows or plays it. Every surface used to
 * work this out for itself from the engine's flags, and they disagreed: the engine's
 * playing flag stays up through a pause, so a paused scene drew the playing bars on a
 * PDF passage and kept the mini player crimson, while the in-note player had learned to
 * subtract the pause. One answer, asked by scene:
 *
 * - `loading` — starting: its tracks are loading or fading in.
 * - `playing` — sounding.
 * - `paused` — the active scene, with every track paused.
 * - `idle` — anything else, including the scene a crossfade is leaving.
 */
export type SceneState = "idle" | "loading" | "playing" | "paused";

// ---- SlotPlaybackState -------------------------------------------------------------

interface SlotPlaybackState {
  slot: SceneSlot;
  volume: number;
  playing: boolean;
}

// ---- Store -------------------------------------------------------------------------

// The slot-player factory is the injectable seam (issue #97): production wires the
// real createSlotPlayer + lazily-created WebAudio/Spotify contexts, while a test can
// pass a fake adapter to drive the crossfade state machine with no AudioContext/SDK.
type MakeSlotPlayer = (slot: SceneSlot) => SlotPlayer;

function createAudioEngine({ makeSlotPlayer }: { makeSlotPlayer?: MakeSlotPlayer } = {}) {
  let activeSceneId = $state<number | null>(null);
  let isPlaying = $state(false);
  let isCrossfading = $state(false);
  let loadingSceneId = $state<number | null>(null);
  let slotStates = $state(new Map<number, SlotPlaybackState>());
  let pendingSceneId = $state<number | null>(null);
  // The slot a queued preview is for, so a preview that waits behind a crossfade is still
  // a preview when it runs.
  let pendingSoloSlotId: number | null = null;
  let masterVolume = $state(1);
  let preMuteVolume = $state<number | null>(null);
  // Muted tracks, by slot id. The engine's rather than each surface's, so a track muted
  // in the mini player is muted in the note's mixer too; and kept for a scene that is not
  // playing, so a track muted before its scene starts starts silent. A mute is for the
  // session: it is not saved, and a track's volume is untouched by it.
  let mutedSlotIds = $state(new Set<number>());

  // Non-reactive player state — not exposed to components
  let localCtx: LocalAudioContext | null = null;
  let spotifyCtx: SpotifyContext | null = null;
  const slotPlayers = new Map<number, SlotPlayer>();
  // The players a crossfade is bringing in, before it commits them. They sound from the
  // moment they start, so a Stop mid-crossfade has to reach them as well as the
  // committed ones — otherwise the incoming scene plays on with nothing left to stop it.
  const incomingPlayers = new Set<SlotPlayer>();
  let activePlaylistPlayer: PlaylistSlotPlayer | null = null;
  // Bumped by every stopAll. A crossfade remembers the value it started under and treats
  // any change as "stopped while I was working": a boolean reset by the next crossfade let
  // a stopped one carry on and commit when the GM pressed Play again straight after Stop.
  let stopGeneration = 0;
  // The tracks a scene Pause silenced, so Resume brings back those and not the ones the
  // GM had already paused by hand (or a preview had parked).
  let pausedBySceneIds = new Set<number>();

  function getOrCreateLocalCtx(): LocalAudioContext {
    if (!localCtx) localCtx = new LocalAudioContext();
    return localCtx;
  }

  function getOrCreateSpotifyCtx(): SpotifyContext {
    if (!spotifyCtx) spotifyCtx = new SpotifyContext();
    return spotifyCtx;
  }

  // Default factory: real adapters over lazily-created contexts. Contexts are
  // created on first slot construction rather than eagerly per crossfade.
  const slotPlayerFactory: MakeSlotPlayer =
    makeSlotPlayer ??
    ((slot) => createSlotPlayer(slot, getOrCreateLocalCtx(), getOrCreateSpotifyCtx()));

  async function playScene(sceneId: number): Promise<void> {
    await crossfadeTo(sceneId);
  }

  // Play one track of a scene that is not playing, so a GM building a scene can hear a
  // track on its own. It is the scene starting with every other slot parked — loaded,
  // paused at its own volume — so the rest of the transport works as it does for any
  // playing scene: each parked row's play button brings that track in, Pause and Stop
  // act on the whole scene, and playing another scene crossfades away from it.
  async function previewSlot(sceneId: number, slotId: number): Promise<void> {
    await crossfadeTo(sceneId, slotId);
  }

  function stopAll(): void {
    stopGeneration++;
    pendingSceneId = null;
    pendingSoloSlotId = null;
    loadingSceneId = null;
    for (const player of slotPlayers.values()) {
      void player.stop();
    }
    for (const player of incomingPlayers) {
      void player.stop();
    }
    slotPlayers.clear();
    incomingPlayers.clear();
    pausedBySceneIds = new Set();
    slotStates = new Map<number, SlotPlaybackState>();
    isPlaying = false;
    isCrossfading = false;
    activeSceneId = null;
    activePlaylistPlayer = null;
    preMuteVolume = null;
  }

  // Moving a track's level unmutes it: the GM is setting what they want to hear.
  function setSlotVolume(slotId: number, volume: number): void {
    if (mutedSlotIds.has(slotId)) {
      const next = new Set(mutedSlotIds);
      next.delete(slotId);
      mutedSlotIds = next;
    }
    const state = slotStates.get(slotId);
    if (!state) return;
    slotPlayers.get(slotId)?.setVolume(volume);
    const updated = new Map(slotStates);
    updated.set(slotId, { ...state, volume });
    slotStates = updated;
  }

  function toggleSlotMute(slotId: number): void {
    const next = new Set(mutedSlotIds);
    const muted = !next.has(slotId);
    if (muted) next.add(slotId);
    else next.delete(slotId);
    mutedSlotIds = next;
    const state = slotStates.get(slotId);
    if (state) slotPlayers.get(slotId)?.setVolume(muted ? 0 : state.volume);
  }

  function isSlotMuted(slotId: number): boolean {
    return mutedSlotIds.has(slotId);
  }

  function applyMasterVolume(v: number): void {
    masterVolume = v;
    for (const player of slotPlayers.values()) {
      player.setMasterVolume(v);
    }
  }

  function setMasterVolume(v: number): void {
    const clamped = Math.max(0, Math.min(1, v));
    preMuteVolume = null;
    applyMasterVolume(clamped);
  }

  function toggleMasterMute(): void {
    if (preMuteVolume !== null) {
      const restore = preMuteVolume;
      preMuteVolume = null;
      applyMasterVolume(restore);
    } else {
      preMuteVolume = masterVolume;
      applyMasterVolume(0);
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
    if (!state) {
      await joinSlot(slotId);
      return;
    }
    await slotPlayers.get(slotId)?.resume();
    const updated = new Map(slotStates);
    updated.set(slotId, { ...state, playing: true });
    slotStates = updated;
  }

  // Play on a track of the playing scene that the engine never started: one added while
  // the scene played, or one whose file failed to load. Its play button used to do
  // nothing at all. It starts now and joins the scene, or says why it cannot.
  async function joinSlot(slotId: number): Promise<void> {
    const sceneId = activeSceneId;
    if (sceneId === null) return;
    const slot = (await scenes.getSlots(sceneId)).find((s) => s.id === slotId);
    if (!slot || activeSceneId !== sceneId || slotStates.has(slotId)) return;
    const generation = stopGeneration;
    const player = slotPlayerFactory(slot);
    try {
      await player.start(slot, 0);
    } catch (e) {
      logError(`[audio-engine] failed to start slot ${slot.id}:`, e);
      toastError(`Couldn't play ${slotDisplayName(slot)}`);
      return;
    }
    if (generation !== stopGeneration || activeSceneId !== sceneId) {
      void player.stop();
      return;
    }
    player.setMasterVolume(masterVolume);
    void player.fadeTo(mutedSlotIds.has(slot.id) ? 0 : slot.volume, FADE_SEC_COLD);
    slotPlayers.set(slot.id, player);
    if (isPlaylistSlot(slot)) activePlaylistPlayer = player as PlaylistSlotPlayer;
    const updated = new Map(slotStates);
    updated.set(slot.id, { slot, volume: slot.volume, playing: true });
    slotStates = updated;
  }

  async function pauseScene(): Promise<void> {
    const silenced = new Set<number>();
    for (const [slotId, state] of slotStates) {
      if (state.playing) {
        silenced.add(slotId);
        await pauseSlot(slotId);
      }
    }
    pausedBySceneIds = silenced;
  }

  async function resumeScene(): Promise<void> {
    // Nothing recorded (every track was paused by hand): Resume means all of them.
    const bringBack = pausedBySceneIds.size > 0 ? pausedBySceneIds : new Set(slotStates.keys());
    pausedBySceneIds = new Set();
    for (const [slotId, state] of slotStates) {
      if (!state.playing && bringBack.has(slotId)) await resumeSlot(slotId);
    }
  }

  function isSceneActive(id: number): boolean {
    return activeSceneId === id;
  }

  function allSlotsPaused(): boolean {
    return (
      activeSceneId !== null &&
      slotStates.size > 0 &&
      [...slotStates.values()].every((s) => !s.playing)
    );
  }

  function sceneState(id: number | null): SceneState {
    if (id === null) return "idle";
    if (loadingSceneId === id) return "loading";
    // Being crossfaded away from: the GM has already chosen the next scene.
    if (loadingSceneId !== null) return "idle";
    if (activeSceneId !== id || !isPlaying) return "idle";
    return allSlotsPaused() ? "paused" : "playing";
  }

  function isSlotPlaying(slotId: number): boolean {
    return slotStates.get(slotId)?.playing ?? false;
  }

  function slotVolume(slotId: number): number | undefined {
    return slotStates.get(slotId)?.volume;
  }

  async function skipNext(): Promise<void> {
    await activePlaylistPlayer?.skipNext();
  }

  async function skipPrev(): Promise<void> {
    await activePlaylistPlayer?.skipPrev();
  }

  async function crossfadeTo(newSceneId: number, soloSlotId?: number): Promise<void> {
    if (newSceneId === activeSceneId) return;
    if (isCrossfading) {
      pendingSceneId = newSceneId;
      pendingSoloSlotId = soloSlotId ?? null;
      return;
    }

    const generation = stopGeneration;
    const stopped = () => generation !== stopGeneration;
    isCrossfading = true;
    loadingSceneId = newSceneId;

    try {
      const newSlots = await scenes.getSlots(newSceneId);
      if (stopped()) return;

      if (newSlots.filter((s) => s.source === "spotify").length > 1) {
        console.warn("[audio-engine] scene has multiple Spotify slots; only first will play");
      }

      const isColdStart = slotPlayers.size === 0;
      const fadeSec = isColdStart ? FADE_SEC_COLD : FADE_SEC;

      // Snapshot outgoing players before new ones start
      const outgoing = [...slotPlayers.values()];
      const fadeOuts = outgoing.map((p) => p.fadeTo(0, fadeSec));

      // Start incoming slots concurrently while outgoing fades
      const newStates = new Map<number, SlotPlaybackState>();
      const newPlayers = new Map<number, SlotPlayer>();
      let newPlaylistPlayer: PlaylistSlotPlayer | null = null;

      const failedSlots: string[] = [];
      for (const slot of newSlots) {
        try {
          const player = slotPlayerFactory(slot);
          incomingPlayers.add(player);
          await player.start(slot, 0);
          // Stopped while this one was loading. stopAll reached it (it was registered
          // above), but before it had begun to sound, so stop it again now that it has;
          // and start none of the rest.
          if (stopped()) {
            void player.stop();
            return;
          }
          // setMasterVolume must be called before fadeTo so streaming players
          // scale to the correct final volume
          player.setMasterVolume(masterVolume);
          const sounding = soloSlotId === undefined || slot.id === soloSlotId;
          const level = mutedSlotIds.has(slot.id) ? 0 : slot.volume;
          if (sounding) {
            void player.fadeTo(level, fadeSec);
          } else {
            // Parked: started at 0 and stopped before it is heard, with its own volume
            // recorded for the resume that brings it in.
            await player.stop();
            player.setVolume(level);
          }
          newStates.set(slot.id, { slot, volume: slot.volume, playing: sounding });
          newPlayers.set(slot.id, player);
          if (isPlaylistSlot(slot)) newPlaylistPlayer = player as PlaylistSlotPlayer;
        } catch (e) {
          logError(`[audio-engine] failed to start slot ${slot.id}:`, e);
          failedSlots.push(slotDisplayName(slot));
        }
      }

      // One toast per scene start (issue #115) — silence with no explanation
      // is the GM's worst case. Spotify auth failures get their own toast via
      // the SDK listeners, so this covers unreadable/deleted local files.
      if (failedSlots.length > 0) {
        toastError(
          failedSlots.length === 1
            ? `Couldn't play ${failedSlots[0]}`
            : `Couldn't play ${failedSlots.length} tracks: ${failedSlots.join(", ")}`,
        );
      }

      await Promise.all(fadeOuts);

      // stopAll() may have fired during the await — bail without committing state
      if (stopped()) return;

      // Stop outgoing players now that their fades have completed
      for (const player of outgoing) {
        await player.stop();
      }

      // Commit new state
      slotPlayers.clear();
      incomingPlayers.clear();
      pausedBySceneIds = new Set();
      for (const [id, player] of newPlayers) slotPlayers.set(id, player);
      slotStates = newStates;
      activePlaylistPlayer = newPlaylistPlayer;
      activeSceneId = newStates.size > 0 ? newSceneId : null;
      isPlaying = newStates.size > 0;
    } catch (e) {
      console.error("[audio-engine] crossfadeTo failed:", e);
    } finally {
      // A stopped crossfade's state belongs to whatever started since; leave it alone.
      if (!stopped()) {
        isCrossfading = false;
        loadingSceneId = null;
      }
    }

    if (stopped()) return;
    if (pendingSceneId !== null && pendingSceneId !== activeSceneId) {
      const next = pendingSceneId;
      const solo = pendingSoloSlotId ?? undefined;
      pendingSceneId = null;
      pendingSoloSlotId = null;
      crossfadeTo(next, solo);
    }
  }

  // Ledger teardown — on a close, and on a switch to another ledger.
  //
  // Keyed on the path rather than on `isOpen`, which never lowers when a second
  // ledger is opened from inside the first: watching the flag alone leaves the
  // previous campaign's scene playing under the new one's notes, with no scene in
  // the open ledger that the mini player's stop button belongs to. The contexts
  // are built lazily on the next play, so tearing them down costs nothing.
  //
  // `undefined` until the first ledger is observed, which is not the same as `null`: the
  // first run has nothing bound and so nothing to tear down. Treating it as a change
  // would fire a teardown during start-up, whose only reachable effect is to stop audio
  // something else had already begun.
  let boundLedgerPath: string | null | undefined;
  $effect.root(() => {
    // A track of the playing scene changed on some surface: take its new settings. A
    // loop turned on or off reaches a local track that is already playing.
    $effect(() => {
      void scenes.slotsRevision;
      const sceneId = untrack(() => activeSceneId);
      if (sceneId === null) return;
      void scenes.getSlots(sceneId).then((fresh) => {
        if (activeSceneId !== sceneId) return;
        const updated = new Map(slotStates);
        let changed = false;
        for (const slot of fresh) {
          const state = updated.get(slot.id);
          if (!state || state.slot === slot) continue;
          if (state.slot.loop !== slot.loop) slotPlayers.get(slot.id)?.setLoop?.(slot.loop);
          updated.set(slot.id, { ...state, slot });
          changed = true;
        }
        if (changed) slotStates = updated;
      });
    });

    $effect(() => {
      const path = ledger.isOpen ? ledger.path : null;
      if (path === boundLedgerPath) return;
      const firstBinding = boundLedgerPath === undefined;
      boundLedgerPath = path;
      if (firstBinding) return;
      stopAll();
      mutedSlotIds = new Set();
      localCtx?.close();
      localCtx = null;
      spotifyCtx?.disconnect();
      spotifyCtx = null;
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
    get isMasterMuted() {
      return preMuteVolume !== null;
    },
    get isScenePaused() {
      return allSlotsPaused();
    },
    /** Something is audible: a scene is playing and not every track of it is paused. */
    get isSounding() {
      return isPlaying && !allSlotsPaused();
    },
    playScene,
    previewSlot,
    stopAll,
    setSlotVolume,
    toggleSlotMute,
    isSlotMuted,
    setMasterVolume,
    toggleMasterMute,
    pauseScene,
    resumeScene,
    pauseSlot,
    resumeSlot,
    isSceneActive,
    sceneState,
    isSlotPlaying,
    slotVolume,
    skipNext,
    skipPrev,
    crossfadeTo,
  };
}

// Exported for unit tests, which inject a fake slot-player factory to drive the
// crossfade state machine. Production code uses the singleton below.
export { createAudioEngine };
// The local player is exported for its own tests: the fake factory above stands in for
// it, so the engine's tests cannot see what it remembers between a stop and a resume.
export { LocalSlotPlayer };
export type { SlotPlayer, MakeSlotPlayer };

export const audioEngine = createAudioEngine();
