<script lang="ts">
  import { editorClean, editorCalls } from "./editor-clean";

  // Mirror the real Editor's prop surface so NotePane binds/renders it the same.
  let { initialContent }: { initialContent: string; onSave?: unknown; highlightQuery?: string } = $props();

  // NotePane gates its external-reload policy on this (via bind:this).
  export function isClean(): boolean {
    return editorClean.value;
  }

  // Autosave control NotePane drives during conflict resolution (issue #129).
  export function pauseAutosave(): void {
    editorCalls.pause++;
  }
  export function resumeAutosave(): void {
    editorCalls.resume++;
  }
  export function discardPendingEdit(): void {
    editorCalls.discard++;
  }
</script>

<!-- data-content lets tests observe which body the (re)mounted editor was seeded with. -->
<div data-testid="mock-editor" data-content={initialContent}></div>
