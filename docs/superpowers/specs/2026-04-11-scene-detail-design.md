# Scene Detail Page Design

## Layout: Track List
Vertical list of audio slots with inline controls. Scene header at top with name, playback, and master volume.

## Page Header
- Scene name: editable input (same pattern as note title)
- Breadcrumb: Scenes > {name}
- Right side: Master volume slider + Play Scene / Stop button

## Slot Track List
Each row contains:
- Play/pause toggle (functional when scene is active)
- Source indicator icon (local vs Spotify)
- Label (renameable via context menu)
- Volume slider (horizontal, updates audio engine in real-time, persists on release)
- Loop toggle button
- Shuffle toggle (Spotify-relevant)
- Right-click context menu: Rename, Delete

## Add Track Dialog
- Triggered by dashed "+ Add Track" button
- Two tabs: Local File | Spotify
  - **Local**: Browse button → Tauri `open()` dialog (mp3/wav/ogg/flac) → `copy_audio_file` → vault
  - **Spotify**: paste URI text input
- Shared fields: Label (auto-populated from filename for local), Loop checkbox, Shuffle checkbox
- Footer: Cancel / Add

## Empty State
Music2 icon, "No tracks yet", description, Add Track CTA.

## Audio Engine Integration
- Play/Stop calls `audioEngine.playScene(id)` / `audioEngine.stopAll()`
- Per-slot volume: `audioEngine.setSlotVolume()` on input, DB save on change
- Master volume: `audioEngine.setMasterVolume()` on input
- Derived state: `audioEngine.activeSceneId`, `audioEngine.slotStates` for playback indicators

## Deferred
- Drag-to-reorder slots
- Audio waveform visualization
