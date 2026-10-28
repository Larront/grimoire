<script lang="ts">
  import MiddleTruncate from "$lib/components/MiddleTruncate.svelte";
  import { api } from "$lib/api";
  import { shortcut } from "$lib/utils/keyboard";
  import { setMode, userPrefersMode } from "mode-watcher";
  import { toastSuccess } from "$lib/toast";
  import {
    Tag,
    FileText,
    Map,
    MapPin,
    FileWarning,
    Clapperboard,
    FilePlus,
    Settings,
    Sun,
    FolderOpen,
    RefreshCw,
    Link2Off,
    LayoutTemplate,
    SquarePen,
    FileDown,
    Network,
    NotebookPen,
    BookOpen,
    Pause,
    Play,
    Square,
    Volume2,
    VolumeOff,
  } from "@lucide/svelte";
  import * as Command from "$lib/components/ui/command";
  import * as Dialog from "$lib/components/ui/dialog";
  import TagChipEditor from "./TagChipEditor.svelte";
  import { tabs } from "$lib/stores/tabs.svelte";
  import { notes } from "$lib/stores/notes.svelte";
  import { templates } from "$lib/stores/templates.svelte";
  import type { TemplateEntry } from "$lib/types/ledger";
  import { maps } from "$lib/stores/maps.svelte";
  import { scenes } from "$lib/stores/scenes.svelte";
  import { audioEngine } from "$lib/stores/audio-engine.svelte";
  import { ledger } from "$lib/stores/ledger.svelte";
  import { searchPalette } from "$lib/stores/search.svelte";
  import { dialogs } from "$lib/stores/overlay.svelte";
  import { unlinkedPins } from "$lib/stores/unlinked-pins.svelte";
  import { unreadableNotes } from "$lib/stores/unreadable-notes.svelte";
  import { linkRepairs } from "$lib/stores/link-repairs.svelte";
  import {
    createNamedNote,
    createNoteFromTemplate,
    createUntitledNote,
    newNoteFolder,
  } from "$lib/utils/note-actions";
  import type { Note, Map as LedgerMap, FileNode } from "$lib/types/ledger";
  import { compareNames } from "$lib/utils/file-name";
  import { focusPane } from "$lib/utils/pane-focus";

  interface NoteSearchResult {
    id: number;
    title: string;
    path: string;
    excerpt: string | null;
    match_count: number;
  }

  interface MapSearchResult {
    id: number;
    title: string;
  }

  interface SceneSearchResult {
    id: number;
    name: string;
  }

  interface TagFacet {
    name: string;
    note_count: number;
  }

  interface SearchAllResult {
    notes: NoteSearchResult[];
    maps: MapSearchResult[];
    scenes: SceneSearchResult[];
    tags?: TagFacet[];
  }

  interface RecentEntityResult {
    entity_kind: string;
    entity_id: number;
    title: string;
    accessed_at: string;
  }

  let addTagOpen = $state(false);
  let tags = $state<string[]>([]);
  let allTags = $state<string[]>([]);
  let loadedForPath = $state<string | null>(null);
  let searchQuery = $state("");
  let templatePickerMode = $state(false);
  let noteResults = $state<NoteSearchResult[]>([]);
  /** The query the results on screen answer — the last search back, not the typing. */
  let searchedFor = $state("");
  let mapResults = $state<MapSearchResult[]>([]);
  let sceneResults = $state<SceneSearchResult[]>([]);
  let tagResults = $state<TagFacet[]>([]);
  let recentEntities = $state<RecentEntityResult[]>([]);
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingModifier = $state<"ctrl" | "shift" | null>(null);

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "k" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      searchPalette.open = true;
    }
  }

  $effect(() => {
    function captureEnterModifier(e: KeyboardEvent) {
      if (e.key === "Enter" && searchPalette.open) {
        if (e.ctrlKey || e.metaKey) pendingModifier = "ctrl";
        else if (e.shiftKey) pendingModifier = "shift";
        else pendingModifier = null;
      }
    }
    window.addEventListener("keydown", captureEnterModifier, { capture: true });
    return () => window.removeEventListener("keydown", captureEnterModifier, { capture: true });
  });

  const activeTabIsNote = $derived(tabs.activeTab?.type === "note");

  const activeTagFilters = $derived(
    searchQuery
      .trim()
      .split(/\s+/)
      .filter((t) => t.startsWith("tag:") && t.length > 4)
      .map((t) => t.slice(4).toLowerCase()),
  );

  const freeSearchText = $derived(
    searchQuery
      .trim()
      .split(/\s+/)
      .filter((t) => !(t.startsWith("tag:") && t.length > 4))
      .join(" "),
  );

  const visibleTagResults = $derived(
    tagResults.filter((t) => !activeTagFilters.includes(t.name.toLowerCase())),
  );

  const activeNote = $derived.by(() => {
    const t = tabs.activeTab;
    if (!t || t.type !== "note") return null;
    return notes.notes.find((n) => n.id === t.id) ?? null;
  });

  function openAddTag() {
    searchPalette.open = false;
    addTagOpen = true;
  }

  // Shared with `Ctrl/Cmd+N` (#227) and the empty ledger's first-note button, so
  // the three cannot drift apart.
  async function cmdCreateNote() {
    searchPalette.open = false;
    try {
      await createUntitledNote();
    } catch (e) {
      console.error("create_note failed:", e);
    }
  }

  async function cmdCreateScene() {
    searchPalette.open = false;
    try {
      const newScene = await api.createScene("Untitled Scene");
      await scenes.load();
      tabs.openTab({ type: "scene", id: newScene.id, title: newScene.name });
    } catch (e) {
      console.error("create_scene failed:", e);
    }
  }

  async function cmdCreateMap() {
    searchPalette.open = false;
    try {
      const newMap = await api.createMapEmpty("Untitled Map");
      await maps.load();
      tabs.openTab({ type: "map", id: newMap.id, title: "Untitled Map" });
    } catch (e) {
      console.error("create_map_empty failed:", e);
    }
  }

  function cmdOpenGraphView() {
    searchPalette.open = false;
    tabs.openTab({ type: "graph", id: 0, title: "Graph" });
  }

  // One tab, never two: `openTab`'s dedup switches to the pane wherever it is
  // already open, across both panes, exactly as the Graph does.
  function cmdOpenQuickNotes() {
    searchPalette.open = false;
    tabs.openTab({ type: "quickNotes", id: 0, title: "Quick Notes" });
  }

  // The dialog's shortcut is `Ctrl/Cmd+Shift+N`, and a shortcut must also be
  // reachable from here (docs/design-system.md §Keyboard & Accessibility) — the palette is
  // where a GM looks for a thing whose key they have not learned yet. It sets the
  // same flag the keystroke does: one surface, two ways in.
  // A command with a key says so, in Meta: the palette is where a GM looks for a
  // thing whose key they have not learned, so it is where the key gets taught.
  // Spelled by `shortcut`, as the menus spell it.

  function cmdCaptureQuickNote() {
    searchPalette.open = false;
    dialogs.quickNoteOpen = true;
  }

  function cmdOpenSettings() {
    searchPalette.open = false;
    dialogs.settingsOpen = true;
  }

  function cmdOpenTagManager() {
    searchPalette.open = false;
    dialogs.tagManagerOpen = true;
  }

  function cmdToggleTheme() {
    const cur = userPrefersMode.current;
    if (cur === "light") setMode("dark");
    else if (cur === "dark") setMode("system");
    else setMode("light");
    searchPalette.open = false;
  }

  function cmdSwitchLedger() {
    searchPalette.open = false;
    ledger.openLedger().catch((e) => console.error("open ledger failed:", e));
  }

  async function cmdRebuildIndex() {
    searchPalette.open = false;
    try {
      await api.rebuildSearchIndex();
      toastSuccess("Search index rebuilt");
    } catch (e) {
      console.error("rebuild_search_index failed:", e);
    }
  }

  // A template is named before it exists, in the Templates dialog, so a new one is
  // never a file called "Untitled" offered in every list (2026-10 design review).
  function cmdCreateTemplate() {
    searchPalette.open = false;
    dialogs.templatesNaming = true;
    dialogs.templatesOpen = true;
  }

  function cmdManageTemplates() {
    searchPalette.open = false;
    dialogs.templatesOpen = true;
  }

  // Read afresh each time: templates live where the Ledger Watcher doesn't look.
  async function cmdCreateNoteFromTemplate() {
    try {
      await templates.load();
      templatePickerMode = true;
      searchQuery = "";
    } catch (e) {
      console.error("list_templates failed:", e);
    }
  }

  /** The picker's rows: every template, narrowed by what has been typed. */
  const pickerTemplates = $derived.by(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return templates.templates;
    return templates.templates.filter(
      (t) =>
        t.display_name.toLowerCase().includes(q) ||
        t.tags.some((tag) => tag.toLowerCase().includes(q)),
    );
  });

  async function selectTemplate(template: TemplateEntry) {
    templatePickerMode = false;
    searchPalette.open = false;
    try {
      await createNoteFromTemplate(template.path, searchPalette.templateFolder ?? newNoteFolder());
    } catch (e) {
      console.error("create_note_from_template failed:", e);
    }
  }

  // Carries on an earlier exploration rather than wiping it; only the Splash's
  // "Start it over" makes a fresh copy (2026-10 design review).
  async function cmdExploreSample() {
    searchPalette.open = false;
    try {
      await ledger.continueSample();
    } catch (e) {
      console.error("explore sample failed:", e);
    }
  }

  async function cmdSaveNoteAsTemplate() {
    const note = activeNote;
    if (!note) return;
    searchPalette.open = false;
    try {
      // It used to say nothing at all, and open nothing.
      const entry = await api.saveNoteAsTemplate(note.path);
      await templates.load();
      toastSuccess(`Saved “${note.title}” as a template`, {
        label: "Open",
        onClick: () =>
          tabs.openTab({
            type: "template",
            id: 0,
            title: entry.display_name,
            templatePath: entry.path,
          }),
      });
    } catch (e) {
      console.error("save_note_as_template failed:", e);
    }
  }

  interface PaletteCommand {
    label: string;
    testid: string;
    noteOnly: boolean;
    icon: typeof Settings;
    action: () => void;
    /** The command's own key, after Ctrl/Cmd — shown on the row. */
    keys?: string[];
    /** Offered only while this holds. */
    when?: () => boolean;
    /** Other words a GM might search for it by. */
    also?: string[];
  }

  const ALL_COMMANDS: PaletteCommand[] = [
    {
      label: "Create new note",
      testid: "cmd-create-note",
      noteOnly: false,
      icon: FilePlus,
      action: cmdCreateNote,
    },
    {
      label: "Create new scene",
      testid: "cmd-create-scene",
      noteOnly: false,
      icon: Clapperboard,
      action: cmdCreateScene,
    },
    // Add tag is note-context-sensitive; placed 3rd so it's in the visible cap when a note is active
    {
      label: "Add tag to current note",
      testid: "cmd-add-tag",
      noteOnly: true,
      icon: Tag,
      action: openAddTag,
    },
    {
      label: "Open graph view",
      testid: "cmd-open-graph",
      noteOnly: false,
      icon: Network,
      action: cmdOpenGraphView,
    },
    {
      label: "Open Quick Notes",
      testid: "cmd-open-quick-notes",
      noteOnly: false,
      icon: NotebookPen,
      action: cmdOpenQuickNotes,
    },
    {
      // While a repair's unlinked pins remain: the toast is not the only way back to
      // the list, and a GM who closed it still has pins to fix.
      label: "Show pins to re-link",
      testid: "cmd-show-unlinked-pins",
      noteOnly: false,
      icon: MapPin,
      action: () => {
        searchPalette.open = false;
        unlinkedPins.show();
      },
      when: () => unlinkedPins.count > 0,
    },
    {
      label: "Show notes that couldn't open",
      testid: "cmd-show-unreadable-notes",
      noteOnly: false,
      icon: FileWarning,
      action: () => {
        searchPalette.open = false;
        unreadableNotes.show();
      },
      when: () => unreadableNotes.count > 0,
    },
    {
      label: "Capture a Quick Note",
      testid: "cmd-capture-quick-note",
      noteOnly: false,
      icon: NotebookPen,
      keys: ["Shift", "N"],
      action: cmdCaptureQuickNote,
    },
    {
      label: "Create note from template",
      testid: "cmd-create-note-from-template",
      noteOnly: false,
      icon: LayoutTemplate,
      action: cmdCreateNoteFromTemplate,
    },
    {
      label: "Create new template",
      testid: "cmd-create-template",
      noteOnly: false,
      icon: LayoutTemplate,
      action: cmdCreateTemplate,
    },
    {
      label: "Manage templates",
      testid: "cmd-manage-templates",
      noteOnly: false,
      icon: LayoutTemplate,
      action: cmdManageTemplates,
    },
    {
      label: "Save note as template",
      testid: "cmd-save-note-as-template",
      noteOnly: true,
      icon: FileDown,
      action: cmdSaveNoteAsTemplate,
    },
    {
      label: "Create new map",
      testid: "cmd-create-map",
      noteOnly: false,
      icon: Map,
      action: cmdCreateMap,
    },
    {
      label: "Open Settings",
      testid: "cmd-open-settings",
      noteOnly: false,
      icon: Settings,
      keys: [","],
      action: cmdOpenSettings,
    },
    {
      label: "Manage tags",
      testid: "cmd-manage-tags",
      noteOnly: false,
      icon: Tag,
      action: cmdOpenTagManager,
    },
    {
      label: "Toggle theme",
      testid: "cmd-toggle-theme",
      noteOnly: false,
      icon: Sun,
      action: cmdToggleTheme,
    },
    {
      label: "Open a ledger folder…",
      testid: "cmd-switch-ledger",
      also: ["switch ledger", "open ledger", "switch world", "open world"],
      noteOnly: false,
      icon: FolderOpen,
      action: cmdSwitchLedger,
    },
    {
      label: "Rebuild search index",
      testid: "cmd-rebuild-index",
      noteOnly: false,
      icon: RefreshCw,
      action: cmdRebuildIndex,
    },
    {
      // Found afresh each time: links broken by moves outside Grimoire, healed only
      // where the GM ticks (ADR-0014's escape hatch for the bulk path).
      label: "Repair links…",
      testid: "cmd-repair-links",
      also: ["broken links", "fix links", "moved notes"],
      noteOnly: false,
      icon: Link2Off,
      action: () => {
        searchPalette.open = false;
        void linkRepairs.review();
      },
    },
    {
      label: "Explore example world",
      testid: "cmd-explore-sample",
      noteOnly: false,
      icon: BookOpen,
      action: cmdExploreSample,
    },
  ];

  // While a scene is the active one, the audio commands come first: mid-session, cutting
  // or pausing the music is what a GM opens the palette for, and these are the only way
  // to it without reaching for the sidebar. Named for the scene, so "pause" finds it.
  const audioCommands = $derived.by(() => {
    const id = audioEngine.loadingSceneId ?? audioEngine.activeSceneId;
    if (id === null) return [];
    const name = scenes.scenes.find((s) => s.id === id)?.name ?? "scene";
    const paused = audioEngine.sceneState(id) === "paused";
    const muted = audioEngine.isMasterMuted;
    const close = (act: () => unknown) => () => {
      searchPalette.open = false;
      void act();
    };
    return [
      {
        label: paused ? `Resume ${name}` : `Pause ${name}`,
        testid: "cmd-pause-scene",
        noteOnly: false,
        icon: paused ? Play : Pause,
        action: close(() => audioEngine.togglePauseScene()),
      },
      {
        label: "Stop audio",
        testid: "cmd-stop-audio",
        noteOnly: false,
        icon: Square,
        action: close(() => audioEngine.stopAll()),
      },
      {
        label: muted ? "Unmute all audio" : "Mute all audio",
        testid: "cmd-mute-all",
        noteOnly: false,
        icon: muted ? Volume2 : VolumeOff,
        action: close(() => audioEngine.toggleMasterMute()),
      },
    ];
  });

  const visibleRecent = $derived(searchQuery.length === 0 ? recentEntities.slice(0, 5) : []);

  function iconForKind(kind: string) {
    if (kind === "note") return FileText;
    if (kind === "map") return Map;
    return Clapperboard;
  }

  function relativeTime(isoString: string): string {
    const now = new Date();
    const then = new Date(isoString);
    const diffMs = now.getTime() - then.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 60) {
      return diffMin <= 0 ? "just now" : `${diffMin}m ago`;
    }
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 86400000);
    const thenDate = new Date(then.getFullYear(), then.getMonth(), then.getDate());
    if (thenDate.getTime() === today.getTime()) return "today";
    if (thenDate.getTime() === yesterday.getTime()) return "yesterday";
    return `${Math.floor(diffMs / 86400000)}d ago`;
  }

  const allMatchedCommands = $derived.by(() => {
    const q = searchQuery.trim().toLowerCase();
    const eligible = ([...audioCommands, ...ALL_COMMANDS] as PaletteCommand[]).filter(
      (c) => (!c.noteOnly || activeTabIsNote) && (c.when?.() ?? true),
    );
    return q
      ? eligible.filter(
          (c) =>
            c.label.toLowerCase().includes(q) || (c.also ?? []).some((w) => w.includes(q)),
        )
      : eligible;
  });

  const DEFAULT_CAPS = { commands: 3, tags: 5, notes: 6, maps: 3, scenes: 3 } as const;

  let expandedGroups = $state(new Set<string>());

  $effect(() => {
    const _q = searchQuery;
    expandedGroups = new Set();
  });

  function expandGroup(group: string) {
    expandedGroups = new Set([...expandedGroups, group]);
  }

  // PDFs aren't in the search index (a PDF is read-only, and its text isn't the
  // world's), so the palette found none (2026-10 design review). It matches them by
  // name, from the file tree read as it opens.
  let pdfs = $state<{ name: string; path: string }[]>([]);
  $effect(() => {
    if (!searchPalette.open) return;
    api.silent
      .getFileTree()
      .then((tree) => {
        const found: { name: string; path: string }[] = [];
        const walk = (node: FileNode) => {
          for (const child of node.children ?? []) {
            if (child.is_dir) walk(child);
            else if (child.path.toLowerCase().endsWith(".pdf"))
              found.push({ name: child.name, path: child.path });
          }
        };
        walk(tree);
        pdfs = found;
      })
      .catch(() => (pdfs = []));
  });
  const pdfResults = $derived.by(() => {
    const q = freeSearchText.trim().toLowerCase();
    if (q.length < 2 || templatePickerMode) return [];
    return pdfs
      .filter((p) => p.name.toLowerCase().includes(q))
      .sort((a, b) => compareNames(a.name, b.name))
      .slice(0, 5);
  });

  // A search that came back with nothing offers to make the note it was looking for —
  // a dead end, "No results found.", until the 2026-10 design review. Only once the
  // search for exactly what is typed is back, so it doesn't flicker in mid-word; and
  // not for a tag filter, which names a tag rather than a note.
  const offerCreate = $derived(
    !templatePickerMode &&
      searchQuery.trim().length >= 2 &&
      searchedFor === searchQuery &&
      activeTagFilters.length === 0 &&
      noteResults.length +
        mapResults.length +
        sceneResults.length +
        visibleTagResults.length +
        pdfResults.length ===
        0 &&
      allMatchedCommands.length === 0,
  );

  async function cmdCreateNamedNote() {
    const title = searchQuery.trim();
    searchPalette.open = false;
    try {
      await createNamedNote(title);
    } catch (e) {
      // Said by the toast the call raised.
      console.error("create note failed:", e);
    }
  }

  const activeGroupCount = $derived(
    (visibleTagResults.length > 0 ? 1 : 0) +
      (noteResults.length > 0 ? 1 : 0) +
      (mapResults.length > 0 ? 1 : 0) +
      (sceneResults.length > 0 ? 1 : 0),
  );

  const commandsCap = $derived(expandedGroups.has("commands") ? Infinity : DEFAULT_CAPS.commands);
  const visibleCommands = $derived(allMatchedCommands.slice(0, commandsCap));
  const commandsShowMore = $derived(allMatchedCommands.length - visibleCommands.length);

  const tagsCap = $derived(expandedGroups.has("tags") ? Infinity : DEFAULT_CAPS.tags);
  const visibleTags = $derived(visibleTagResults.slice(0, tagsCap));
  const tagsShowMore = $derived(visibleTagResults.length - visibleTags.length);

  const notesCap = $derived.by(() => {
    if (expandedGroups.has("notes")) return Infinity;
    if (activeGroupCount === 1 && noteResults.length > 0) return 15;
    return DEFAULT_CAPS.notes;
  });
  const visibleNotes = $derived(noteResults.slice(0, notesCap));
  const notesShowMore = $derived(noteResults.length - visibleNotes.length);

  const mapsCap = $derived(expandedGroups.has("maps") ? Infinity : DEFAULT_CAPS.maps);
  const visibleMaps = $derived(mapResults.slice(0, mapsCap));
  const mapsShowMore = $derived(mapResults.length - visibleMaps.length);

  const scenesCap = $derived(expandedGroups.has("scenes") ? Infinity : DEFAULT_CAPS.scenes);
  const visibleScenes = $derived(sceneResults.slice(0, scenesCap));
  const scenesShowMore = $derived(sceneResults.length - visibleScenes.length);

  // What the palette opened takes focus as it closes; it used to be left nowhere, so
  // the next key went to the page (2026-10 design review). Escape, opening nothing,
  // still returns focus to where it was.
  let handOff: { note: boolean } | null = null;
  function onCloseAutoFocus(e: Event) {
    if (!handOff) return;
    e.preventDefault();
    const { note } = handOff;
    handOff = null;
    void focusPane(tabs.focusedPane, note);
  }

  function openPdf(pdf: { name: string; path: string }) {
    const mod = pendingModifier;
    pendingModifier = null;
    searchPalette.open = false;
    handOff = { note: false };
    const tab = { type: "pdf" as const, id: 0, title: pdf.name, pdfPath: pdf.path };
    if (mod === "ctrl") tabs.openTabForceNew(tab);
    else if (mod === "shift") tabs.openTabOpposite(tab);
    else tabs.openTab(tab);
  }

  function openNote(result: NoteSearchResult) {
    const mod = pendingModifier;
    pendingModifier = null;
    api.silent.recordRecent("note", result.id, result.title).catch(() => {});
    searchPalette.activeQuery = searchQuery;
    searchPalette.open = false;
    handOff = { note: true };
    const tab = { type: "note" as const, id: result.id, title: result.title };
    if (mod === "ctrl") tabs.openTabForceNew(tab);
    else if (mod === "shift") tabs.openTabOpposite(tab);
    else tabs.openTab(tab);
  }

  function openMap(result: MapSearchResult) {
    const mod = pendingModifier;
    pendingModifier = null;
    api.silent.recordRecent("map", result.id, result.title).catch(() => {});
    searchPalette.open = false;
    handOff = { note: false };
    const tab = { type: "map" as const, id: result.id, title: result.title };
    if (mod === "ctrl") tabs.openTabForceNew(tab);
    else if (mod === "shift") tabs.openTabOpposite(tab);
    else tabs.openTab(tab);
  }

  function openScene(result: SceneSearchResult) {
    const mod = pendingModifier;
    pendingModifier = null;
    api.silent.recordRecent("scene", result.id, result.name).catch(() => {});
    searchPalette.open = false;
    handOff = { note: false };
    const tab = { type: "scene" as const, id: result.id, title: result.name };
    if (mod === "ctrl") tabs.openTabForceNew(tab);
    else if (mod === "shift") tabs.openTabOpposite(tab);
    else tabs.openTab(tab);
  }

  function openRecent(entity: RecentEntityResult) {
    const mod = pendingModifier;
    pendingModifier = null;
    api.silent.recordRecent(entity.entity_kind, entity.entity_id, entity.title).catch(() => {});
    searchPalette.open = false;
    handOff = { note: entity.entity_kind === "note" };
    const tab = {
      type: entity.entity_kind as "note" | "map" | "scene",
      id: entity.entity_id,
      title: entity.title,
    };
    if (mod === "ctrl") tabs.openTabForceNew(tab);
    else if (mod === "shift") tabs.openTabOpposite(tab);
    else tabs.openTab(tab);
  }

  function onSelectTag(tag: string) {
    const tokens = searchQuery
      .trim()
      .split(/\s+/)
      .filter((t) => t.length > 0);
    const tagTokens = tokens.filter((t) => t.startsWith("tag:") && t.length > 4);
    const freeTokens = tokens.filter((t) => !(t.startsWith("tag:") && t.length > 4));
    if (tagTokens.length > 0) {
      searchQuery = [...tagTokens, `tag:${tag}`, ...freeTokens].join(" ");
    } else {
      searchQuery = `tag:${tag}`;
    }
  }

  function splitExcerpt(text: string, query: string): Array<{ text: string; isMatch: boolean }> {
    const terms = query
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length >= 2);
    if (!terms.length) return [{ text, isMatch: false }];

    const lower = text.toLowerCase();
    let firstMatch: { start: number; end: number } | null = null;
    for (const term of terms) {
      const idx = lower.indexOf(term);
      if (idx !== -1 && (!firstMatch || idx < firstMatch.start)) {
        firstMatch = { start: idx, end: idx + term.length };
      }
    }

    if (!firstMatch) return [{ text, isMatch: false }];

    return [
      { text: text.slice(0, firstMatch.start), isMatch: false },
      { text: text.slice(firstMatch.start, firstMatch.end), isMatch: true },
      { text: text.slice(firstMatch.end), isMatch: false },
    ].filter((p) => p.text.length > 0);
  }

  $effect(() => {
    const q = searchQuery;
    if (debounceTimer) clearTimeout(debounceTimer);
    if (q.length < 2) {
      noteResults = [];
      mapResults = [];
      sceneResults = [];
      return;
    }
    debounceTimer = setTimeout(async () => {
      try {
        const res = await api.searchAll(q);
        noteResults = res?.notes ?? [];
        mapResults = res?.maps ?? [];
        sceneResults = res?.scenes ?? [];
        tagResults = res?.tags ?? [];
      } catch {
        noteResults = [];
        mapResults = [];
        sceneResults = [];
        tagResults = [];
      }
      searchedFor = q;
    }, 80);
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  });

  $effect(() => {
    if (!searchPalette.open) {
      searchQuery = "";
      noteResults = [];
      mapResults = [];
      sceneResults = [];
      tagResults = [];
      recentEntities = [];
      pendingModifier = null;
      templatePickerMode = false;
      searchPalette.templateFolder = null;
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
    }
  });

  $effect(() => {
    if (searchPalette.openToTemplatePicker) {
      searchPalette.openToTemplatePicker = false;
      cmdCreateNoteFromTemplate();
    }
  });

  $effect(() => {
    if (searchPalette.open) {
      api
        .getRecentEntities()
        .then((res) => {
          recentEntities = res ?? [];
        })
        .catch(() => {
          recentEntities = [];
        });
    }
  });

  $effect(() => {
    if (!addTagOpen) {
      loadedForPath = null;
      tags = [];
      return;
    }
    const note = activeNote;
    if (!note) return;
    const path = note.path;
    if (path === loadedForPath) return;
    loadedForPath = path;
    api
      .readNoteTags(path)
      .then((loaded) => {
        if (loadedForPath === path) tags = loaded;
      })
      .catch(() => {
        tags = [];
      });
    api
      .listAllTags()
      .then((t) => {
        allTags = t ?? [];
      })
      .catch(() => {
        allTags = [];
      });
  });

  async function onTagsChange(next: string[]) {
    const note = activeNote;
    if (!note) return;
    try {
      await api.writeNoteTags(note.path, next);
    } catch (e) {
      console.error("write_note_tags failed:", e);
    }
    addTagOpen = false;
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#snippet showMoreRow(group: string, count: number)}
  {#if count > 0}
    <Command.Item
      data-testid="cmd-show-more-{group}"
      value="__show-more-{group}__"
      onSelect={() => expandGroup(group)}
      class="flex items-center gap-2 text-xs text-muted-foreground"
    >
      Show {count} more in {group[0].toUpperCase() + group.slice(1)}
    </Command.Item>
  {/if}
{/snippet}

<!-- 560px, as DESIGN.md §5 says — it had drifted to the dialog default (384px), and the
     Quick Notes Dialog takes this width and place too. -->
<Command.Dialog
  bind:open={searchPalette.open}
  shouldFilter={false}
  class="sm:max-w-[560px]"
  {onCloseAutoFocus}
>
  <Command.Input
    placeholder={templatePickerMode ? "Choose a template…" : "Type a command or search..."}
    bind:value={searchQuery}
  />
  <Command.List>
    <Command.Empty class="text-muted-foreground">Nothing matches.</Command.Empty>
    {#if offerCreate}
      <Command.Group heading="No notes match">
        <Command.Item
          data-testid="cmd-create-named-note"
          value="__create-named-note__"
          onSelect={cmdCreateNamedNote}
          class="flex items-center gap-2"
        >
          <FilePlus class="size-4 shrink-0 text-muted-foreground" />
          <span class="min-w-0 truncate">Create note “{searchQuery.trim()}”</span>
        </Command.Item>
      </Command.Group>
    {/if}
    {#if templatePickerMode}
      <!-- Typing narrows the list by name or tag; it used to filter nothing. Each row
           says what the note will be tagged, the half of a template that isn't text. -->
      <Command.Group heading="Templates">
        {#each pickerTemplates as template (template.path)}
          <Command.Item
            data-testid="cmd-template-result"
            value={template.path}
            onSelect={() => selectTemplate(template)}
            class="flex items-center gap-2"
          >
            <LayoutTemplate class="size-4 shrink-0 text-muted-foreground" />
            <span class="min-w-0 flex-1 truncate text-sm font-medium" title={template.display_name}
              >{template.display_name}</span
            >
            {#if template.tags.length}
              <span class="max-w-[40%] shrink-0 truncate text-xs text-muted-foreground"
                >{template.tags.join(", ")}</span
              >
            {/if}
          </Command.Item>
        {/each}
        <Command.Item
          data-testid="cmd-template-manage"
          value="manage-templates"
          onSelect={cmdManageTemplates}
          class="flex items-center gap-2 text-muted-foreground"
        >
          <SquarePen class="size-4 shrink-0" />
          <span class="text-sm">Manage templates…</span>
        </Command.Item>
      </Command.Group>
      {#if pickerTemplates.length === 0}
        <p class="px-3 pb-3 text-sm text-muted-foreground" data-testid="cmd-template-none">
          {templates.templates.length
            ? `No template matches “${searchQuery.trim()}”.`
            : "This ledger has no templates yet."}
        </p>
      {/if}
    {:else}
      {#if visibleRecent.length > 0}
        <Command.Group heading="Recent">
          {#each visibleRecent as entity (entity.entity_kind + ":" + entity.entity_id)}
            {@const Icon = iconForKind(entity.entity_kind)}
            <Command.Item
              data-testid="cmd-recent-result"
              value={entity.entity_kind + ":" + entity.entity_id}
              onSelect={() => openRecent(entity)}
              class="flex items-center gap-2"
            >
              <Icon class="size-4 shrink-0 text-muted-foreground" />
              <MiddleTruncate text={entity.title} class="text-sm font-medium flex-1" />
              <span data-testid="recent-time-hint" class="shrink-0 text-xs text-muted-foreground"
                >{relativeTime(entity.accessed_at)}</span
              >
              <span
                data-testid="recent-kind-chip"
                class="shrink-0 rounded border border-border px-1 text-xs text-muted-foreground capitalize"
                >{entity.entity_kind}</span
              >
            </Command.Item>
          {/each}
        </Command.Group>
      {/if}
      {#if visibleCommands.length > 0}
        <Command.Group heading="Commands">
          {#each visibleCommands as cmd (cmd.testid)}
            {@const Icon = cmd.icon}
            <Command.Item
              data-testid={cmd.testid}
              value={cmd.label}
              onSelect={cmd.action}
              class="flex items-center gap-2"
            >
              <Icon class="size-4 shrink-0 text-muted-foreground" />
              <span class="text-sm font-medium">{cmd.label}</span>
              {#if cmd.keys}
                <Command.Shortcut class="font-mono text-[11px] tracking-normal"
                  >{shortcut(cmd.keys)}</Command.Shortcut
                >
              {/if}
            </Command.Item>
          {/each}
          {@render showMoreRow("commands", commandsShowMore)}
        </Command.Group>
      {/if}
      {#if visibleTagResults.length > 0}
        <Command.Group heading="Tags">
          {#each visibleTags as tag (tag.name)}
            <Command.Item
              data-testid="cmd-tag-result"
              value={tag.name}
              onSelect={() => onSelectTag(tag.name)}
              class="flex items-center gap-2"
            >
              <Tag class="size-4 shrink-0 text-muted-foreground" />
              <span class="font-mono text-xs">{tag.name}</span>
              <span
                data-testid="tag-count-chip"
                class="ml-auto shrink-0 text-xs text-muted-foreground"
              >
                {tag.note_count} notes
              </span>
            </Command.Item>
          {/each}
          {@render showMoreRow("tags", tagsShowMore)}
        </Command.Group>
      {/if}
      {#if noteResults.length > 0}
        <Command.Group heading="Notes">
          {#each visibleNotes as result (result.id)}
            <Command.Item
              data-testid="cmd-note-result"
              value={result.title}
              onSelect={() => openNote(result)}
              class="flex items-start gap-2 py-2"
            >
              <FileText class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div class="min-w-0 flex-1">
                <div class="text-sm font-medium">{result.title}</div>
                {#if result.excerpt}
                  <div
                    data-testid="note-excerpt"
                    class="mt-0.5 truncate text-xs text-muted-foreground"
                  >
                    <!-- The match in the text's own colour, at weight: crimson is for a
                         signal, and a found word is none (2026-10 design review). A
                         heading's "#" is the Markdown's, not the GM's words. -->
                    {#each splitExcerpt(result.excerpt.replace(/(^|\s)#{1,6}\s+/g, "$1"), freeSearchText) as part}
                      {#if part.isMatch}
                        <span class="font-semibold text-foreground">{part.text}</span>
                      {:else}
                        {part.text}
                      {/if}
                    {/each}
                  </div>
                {/if}
              </div>
              {#if result.match_count > 1}
                <span
                  data-testid="match-count-chip"
                  class="ml-auto shrink-0 text-xs text-muted-foreground"
                >
                  {result.match_count} matches
                </span>
              {/if}
            </Command.Item>
          {/each}
          {@render showMoreRow("notes", notesShowMore)}
        </Command.Group>
      {/if}
      {#if mapResults.length > 0}
        <Command.Group heading="Maps">
          {#each visibleMaps as result (result.id)}
            <Command.Item
              data-testid="cmd-map-result"
              value={result.title}
              onSelect={() => openMap(result)}
              class="flex items-center gap-2"
            >
              <Map class="size-4 shrink-0 text-muted-foreground" />
              <span class="text-sm font-medium">{result.title}</span>
            </Command.Item>
          {/each}
          {@render showMoreRow("maps", mapsShowMore)}
        </Command.Group>
      {/if}
      {#if sceneResults.length > 0}
        <Command.Group heading="Scenes">
          {#each visibleScenes as result (result.id)}
            <Command.Item
              data-testid="cmd-scene-result"
              value={result.name}
              onSelect={() => openScene(result)}
              class="flex items-center gap-2"
            >
              <Clapperboard class="size-4 shrink-0 text-muted-foreground" />
              <span class="text-sm font-medium">{result.name}</span>
            </Command.Item>
          {/each}
          {@render showMoreRow("scenes", scenesShowMore)}
        </Command.Group>
      {/if}
      {#if pdfResults.length > 0}
        <Command.Group heading="PDFs">
          {#each pdfResults as pdf (pdf.path)}
            <Command.Item
              data-testid="cmd-pdf-result"
              value={pdf.path}
              onSelect={() => openPdf(pdf)}
              class="flex items-center gap-2"
            >
              <BookOpen class="size-4 shrink-0 text-muted-foreground" />
              <span class="text-sm font-medium">{pdf.name}</span>
            </Command.Item>
          {/each}
        </Command.Group>
      {/if}
    {/if}
  </Command.List>
</Command.Dialog>

<Dialog.Root bind:open={addTagOpen}>
  <Dialog.Content showCloseButton={false}>
    <Dialog.Header class="sr-only">
      <Dialog.Title>Add tag</Dialog.Title>
      <Dialog.Description>Add a tag to the active note.</Dialog.Description>
    </Dialog.Header>
    <div data-testid="add-tag-picker" class="space-y-3">
      <p class="text-sm font-medium">
        Add tag{activeNote ? ` to "${activeNote.title}"` : ""}
      </p>
      <TagChipEditor bind:tags suggestions={allTags} onchange={onTagsChange} />
    </div>
  </Dialog.Content>
</Dialog.Root>
