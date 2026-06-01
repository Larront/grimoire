<script lang="ts" module>
  export interface AliasCollision {
    alias: string;
    other_note_id: number;
    other_note_title: string;
  }

  export interface BacklinkNote {
    id: number;
    path: string;
    title: string;
  }

  export interface OutboundLink {
    target_path: string;
    resolved_id: number | null;
    resolved_title: string | null;
    resolved_path: string | null;
  }
</script>

<script lang="ts">
  import { TriangleAlert } from '@lucide/svelte';
  import type { Note } from '$lib/types/ledger';
  import { formatBreadcrumb, formatRelativeTime } from '$lib/utils/note-meta';
  import TagChipEditor from './TagChipEditor.svelte';
  import AliasChipEditor from './AliasChipEditor.svelte';
  import DetailSection from './DetailSection.svelte';

  interface Props {
    note: Note | null;
    tags?: string[];
    allTags?: string[];
    aliases?: string[];
    aliasCollisions?: AliasCollision[];
    backlinks?: BacklinkNote[];
    outboundLinks?: OutboundLink[];
    tagsLoadError?: boolean;
    aliasesLoadError?: boolean;
    onTagsChange?: (tags: string[]) => void;
    onAliasesChange?: (aliases: string[]) => void;
    onNavigateNote?: (id: number, title: string) => void;
  }

  let {
    note,
    tags = $bindable([]),
    allTags = [],
    aliases = $bindable([]),
    aliasCollisions = [],
    backlinks = [],
    outboundLinks = [],
    tagsLoadError = false,
    aliasesLoadError = false,
    onTagsChange,
    onAliasesChange,
    onNavigateNote,
  }: Props = $props();

  const LINK_CAP = 5;

  // Track which note id the user expanded — reset to false whenever note changes.
  let expandedForNoteId = $state<number | null>(null);
  let backlinksExpandedRaw = $state(false);
  let outboundExpandedRaw = $state(false);

  const backlinksExpanded = $derived.by(() => {
    if (note?.id !== expandedForNoteId) return false;
    return backlinksExpandedRaw;
  });

  const outboundExpanded = $derived.by(() => {
    if (note?.id !== expandedForNoteId) return false;
    return outboundExpandedRaw;
  });

  function expandBacklinks() {
    expandedForNoteId = note?.id ?? null;
    backlinksExpandedRaw = true;
  }

  function expandOutbound() {
    expandedForNoteId = note?.id ?? null;
    outboundExpandedRaw = true;
  }

  const displayedBacklinks = $derived(backlinksExpanded ? backlinks : backlinks.slice(0, LINK_CAP));
  const hiddenBacklinksCount = $derived(backlinks.length - LINK_CAP);
  const displayedOutbound = $derived(outboundExpanded ? outboundLinks : outboundLinks.slice(0, LINK_CAP));
  const hiddenOutboundCount = $derived(outboundLinks.length - LINK_CAP);

  function folderLabel(path: string): string {
    const parts = path.split('/');
    parts.pop();
    return parts.join(' / ');
  }
</script>

{#if note}
  <DetailSection label="Tags" sectionKey="tags" first>
    {#if tagsLoadError}
      <p class="font-mono text-[10px] text-error">Tags unavailable</p>
    {:else}
      <TagChipEditor bind:tags suggestions={allTags} onchange={onTagsChange} />
      {#if tags.length === 0}
        <p class="font-mono text-[10px] text-foreground-faint">Enter to add · Backspace to remove</p>
      {/if}
    {/if}
  </DetailSection>

  <DetailSection label="Aliases" sectionKey="aliases">
    {#if aliasesLoadError}
      <p class="font-mono text-[10px] text-error">Aliases unavailable</p>
    {:else}
      <AliasChipEditor bind:aliases onchange={onAliasesChange} />
      {#if aliases.length === 0}
        <p class="font-mono text-[10px] text-foreground-faint">Enter or comma to add · Backspace to remove</p>
      {/if}
    {/if}
    {#each aliasCollisions as col (col.alias + col.other_note_id)}
      <p
        data-slot="alias-collision-warning"
        class="flex items-start gap-1 font-mono text-[10px] text-warning leading-[1.4]"
      >
        <TriangleAlert class="size-3 mt-px shrink-0" />
        <span>'{col.alias}' is also used by <span class="font-medium">{col.other_note_title}</span></span>
      </p>
    {/each}
  </DetailSection>

  <DetailSection label="Backlinks" sectionKey="backlinks">
    {#if backlinks.length === 0}
      <p class="font-mono text-[10px] text-foreground-faint italic">No backlinks yet</p>
    {:else}
      <div class="space-y-0.5">
        {#each displayedBacklinks as link (link.id)}
          {@const folder = folderLabel(link.path)}
          <button
            data-slot="backlink-row"
            onclick={() => onNavigateNote?.(link.id, link.title)}
            class="w-full text-left rounded px-1 py-0.5 hover:bg-primary-subtle transition-colors duration-100"
          >
            <div class="font-heading text-[11px] text-foreground leading-snug truncate">{link.title}</div>
            {#if folder}
              <div data-slot="link-folder" class="font-sans text-[10px] text-foreground-muted truncate">{folder}</div>
            {/if}
          </button>
        {/each}
        {#if hiddenBacklinksCount > 0 && !backlinksExpanded}
          <button
            data-slot="backlinks-expand"
            onclick={expandBacklinks}
            class="w-full text-left font-mono text-[10px] text-foreground-muted px-1 py-0.5 hover:text-foreground transition-colors duration-100"
          >Show {hiddenBacklinksCount} more</button>
        {/if}
      </div>
    {/if}
  </DetailSection>

  <DetailSection label="Outbound Links" sectionKey="outbound">
    {#if outboundLinks.length === 0}
      <p class="font-mono text-[10px] text-foreground-faint italic">No outbound links</p>
    {:else}
      <div class="space-y-0.5">
        {#each displayedOutbound as link (link.target_path)}
          {#if link.resolved_id !== null}
            {@const folder = link.resolved_path ? folderLabel(link.resolved_path) : ''}
            <button
              data-slot="outbound-row"
              onclick={() => onNavigateNote?.(link.resolved_id!, link.resolved_title!)}
              class="w-full text-left rounded px-1 py-0.5 hover:bg-primary-subtle transition-colors duration-100"
            >
              <div class="font-heading text-[11px] text-foreground leading-snug truncate">{link.resolved_title}</div>
              {#if folder}
                <div data-slot="link-folder" class="font-sans text-[10px] text-foreground-muted truncate">{folder}</div>
              {/if}
            </button>
          {:else}
            <div
              data-slot="outbound-broken"
              class="rounded px-1 py-0.5 opacity-50 cursor-default"
            >
              <div class="font-heading text-[11px] text-foreground leading-snug truncate">{link.target_path}</div>
              <div class="font-mono text-[10px] text-foreground-faint italic">Not yet created</div>
            </div>
          {/if}
        {/each}
        {#if hiddenOutboundCount > 0 && !outboundExpanded}
          <button
            data-slot="outbound-expand"
            onclick={expandOutbound}
            class="w-full text-left font-mono text-[10px] text-foreground-muted px-1 py-0.5 hover:text-foreground transition-colors duration-100"
          >Show {hiddenOutboundCount} more</button>
        {/if}
      </div>
    {/if}
  </DetailSection>

  <DetailSection label="Folder" sectionKey="folder">
    <div
      class="font-mono text-[10px] leading-[1.4] text-foreground-muted truncate"
      title={note.path}
    >
      {formatBreadcrumb(note.path)}
    </div>
  </DetailSection>

  <DetailSection label="Modified" sectionKey="modified">
    <div class="font-mono text-[10px] leading-[1.4] text-foreground-muted">
      {formatRelativeTime(note.modified_at)}
    </div>
  </DetailSection>
{/if}
