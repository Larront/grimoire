<!--
  The Templates accordion in the sidebar footer: the ledger's templates, each
  renamable and deletable in place, and a row to make a new one.

  Templates gets no strip icon — it had no rail entry, and a footer accordion a
  GM opens occasionally is not session furniture (#226), so the whole thing is
  hidden when collapsed.

  Owns its own rename state and touches nothing else in the sidebar: no file
  tree, no note map, no scenes. That is why it takes no props — a template rename
  and a file-tree drag have no reason to live in the same file.
-->
<script lang="ts">
  import { api } from "$lib/api";
  import * as Collapsible from "$lib/components/ui/collapsible";
  import * as ContextMenu from "$lib/components/ui/context-menu";
  import * as Rename from "$lib/components/ui/rename";
  import * as Sidebar from "$lib/components/ui/sidebar";
  import { ChevronDown, LayoutTemplate, Plus } from "@lucide/svelte";
  import { templates } from "$lib/stores/templates.svelte";
  import { tabs } from "$lib/stores/tabs.svelte";
  import { toastUndo } from "$lib/toast";
  import type { TemplateEntry } from "$lib/types/ledger";
  import { slide } from "svelte/transition";
  import { EXPANDED_ONLY } from "./strip-classes";

  async function handleCreateTemplate() {
    try {
      const entry = await api.createTemplate();
      await templates.load();
      tabs.openTab({
        type: "template",
        id: 0,
        title: entry.display_name,
        badge: "Template",
        templatePath: entry.path,
      });
    } catch (e) {
      console.error("create_template failed:", e);
    }
  }

  function openTemplate(tmpl: TemplateEntry) {
    tabs.openTab({
      type: "template",
      id: 0,
      title: tmpl.display_name,
      badge: "Template",
      templatePath: tmpl.path,
    });
  }

  let renamingTemplatePath = $state<string | null>(null);
  let renameTemplateValue = $state("");

  function startRenameTemplate(tmpl: TemplateEntry) {
    renameTemplateValue = tmpl.display_name;
    renamingTemplatePath = tmpl.path;
  }

  async function handleRenameTemplate(tmpl: TemplateEntry, newName: string): Promise<boolean> {
    if (!newName.trim() || newName === tmpl.display_name) {
      renamingTemplatePath = null;
      return false;
    }
    try {
      await api.renameTemplate(tmpl.path, newName.trim());
      const newPath = tmpl.path.replace(/[^/]+\.md$/, `${newName.trim()}.md`);
      tabs.updateTemplateTab(tmpl.path, newName.trim(), newPath);
      await templates.load();
      renamingTemplatePath = null;
      return true;
    } catch (e) {
      console.error("rename template failed:", e);
      return false;
    }
  }

  function deleteTemplate(tmpl: TemplateEntry) {
    toastUndo(`"${tmpl.display_name}" deleted`, async () => {
      await api.deleteTemplate(tmpl.path);
      await templates.load();
    });
  }
</script>

<Collapsible.Root class="group/collapsible {EXPANDED_ONLY}">
  <Sidebar.Group class="py-0">
    <Sidebar.GroupLabel class="font-normal opacity-50">
      {#snippet child({ props })}
        <Collapsible.Trigger {...props}>
          Templates
          <ChevronDown
            class="ms-auto transition-transform group-data-[state=open]/collapsible:rotate-180"
          />
        </Collapsible.Trigger>
      {/snippet}
    </Sidebar.GroupLabel>
    <Collapsible.Content forceMount>
      {#snippet child({ props, open })}
        {#if open}
          <div {...props} transition:slide>
            <Sidebar.GroupContent>
              {#if templates.isLoading && templates.templates.length === 0}
                <div class="space-y-1 px-2">
                  <Sidebar.MenuSkeleton showIcon />
                  <Sidebar.MenuSkeleton showIcon />
                </div>
              {:else}
                <Sidebar.Menu>
                  {#each templates.templates as tmpl (tmpl.path)}
                    <ContextMenu.Root>
                      <ContextMenu.Trigger>
                        <Sidebar.MenuButton
                          data-testid="template-row-{tmpl.display_name}"
                          onclick={() => openTemplate(tmpl)}
                        >
                          <LayoutTemplate class="size-4 shrink-0 text-muted-foreground" />
                          <Rename.Root
                            this="span"
                            class="flex-1 truncate text-sm"
                            bind:value={
                              () =>
                                renamingTemplatePath === tmpl.path
                                  ? renameTemplateValue
                                  : tmpl.display_name,
                              (val) => {
                                renameTemplateValue = val;
                              }
                            }
                            bind:mode={
                              () => (renamingTemplatePath === tmpl.path ? "edit" : "view"),
                              (val) => {
                                if (val === "view") renamingTemplatePath = null;
                              }
                            }
                            blurBehavior="exit"
                            onSave={(val) => handleRenameTemplate(tmpl, val)}
                            onCancel={() => (renamingTemplatePath = null)}
                          />
                        </Sidebar.MenuButton>
                      </ContextMenu.Trigger>
                      <ContextMenu.Portal>
                        <ContextMenu.Content>
                          <ContextMenu.Item onSelect={() => startRenameTemplate(tmpl)}
                            >Rename</ContextMenu.Item
                          >
                          <ContextMenu.Separator />
                          <ContextMenu.Item
                            variant="destructive"
                            onSelect={() => deleteTemplate(tmpl)}>Delete Template</ContextMenu.Item
                          >
                        </ContextMenu.Content>
                      </ContextMenu.Portal>
                    </ContextMenu.Root>
                  {/each}
                  <Sidebar.MenuItem>
                    <Sidebar.MenuButton
                      class="text-muted-foreground/50 hover:text-muted-foreground"
                      onclick={handleCreateTemplate}
                      data-testid="new-template-btn"
                    >
                      <Plus class="size-4 shrink-0" strokeWidth={1.5} />
                      <span>New template</span>
                    </Sidebar.MenuButton>
                  </Sidebar.MenuItem>
                </Sidebar.Menu>
              {/if}
            </Sidebar.GroupContent>
          </div>
        {/if}
      {/snippet}
    </Collapsible.Content>
  </Sidebar.Group>
</Collapsible.Root>
