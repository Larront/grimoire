<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { Editor, markdown } from "@tiptap/core";
  import { StarterKit } from "@tiptap/starter-kit";
  import { Markdown } from "@tiptap/markdown";

  interface Props {
    initialContent: string;
    onSave: (markdown: string) => Promise<void>;
  }

  let { initialContent, onSave }: Props = $props();

  let element = $state<Element>();
  let editor = $state<Editor | null>(null);
  let saveTimer: ReturnType<typeof setTimeout> | undefined;

  onMount(() => {
    editor = new Editor({
      element: element,
      extensions: [StarterKit, Markdown],
      content: initialContent,
      contentType: "markdown",
      onUpdate: () => {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(save, 500);
      },
    });
  });

  onDestroy(() => {
    clearTimeout(saveTimer);
    editor?.destroy();
  });

  async function save() {
    if (!editor) return;
    const markdown = editor.getMarkdown();
    await onSave(markdown);
  }

  function handleKeydown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      clearTimeout(saveTimer);
      save();
    }
  }
</script>

<div class="w-full max-w-7/10 mx-auto px-10 pt-8">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_mouse_events_have_key_events -->
  <div bind:this={element} onkeydown={handleKeydown}></div>
</div>
