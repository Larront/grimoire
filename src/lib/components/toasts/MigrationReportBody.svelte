<!--
  The description of a [[Format Migration]] toast, where the report is a place on
  disk the GM may want to go to rather than a string to squint at.

  It exists because the report path was previously interpolated into the
  description as raw text: a 60-character absolute path, set in Nunito, breaking
  mid-token across two lines, that the GM had to read and then navigate to by
  hand. Here the prose keeps its wording and the path collapses to the report's
  file name, in mono, as one clickable target. The full path stays available as
  the tooltip, so nothing that was on screen before is now unreachable.

  Clicking *reveals* the file rather than opening it: the report sits in the
  backup directory beside a pre-migration copy of every note it touched, which is
  what the surrounding sentence promises is "here", and what a GM checking on a
  migration actually wants to see. It is also the capability the app already
  holds — `opener:default` permits `reveal_item_in_dir` but not `open_path`, and
  handing a .md to whatever the OS associates with it is a coin flip between an
  editor, a browser and a "how do you want to open this?" dialog.
-->
<script lang="ts">
  interface Props {
    /** The sentence leading up to the report, ending in its own punctuation. */
    prose: string;
    /** Absolute path to the report; shown as its file name, revealed on click. */
    reportPath: string;
    /** Called when the reveal fails, so a dead click is never silent. */
    onError: () => void;
  }

  let { prose, reportPath, onError }: Props = $props();

  const name = $derived(reportPath.split(/[\\/]/).pop() ?? reportPath);

  function reveal() {
    // Imported here rather than at module scope: this component is reached from
    // $lib/toast, which the test suite loads outside Tauri.
    import("@tauri-apps/plugin-opener")
      .then(({ revealItemInDir }) => revealItemInDir(reportPath))
      .catch(onError);
  }
</script>

{prose}<!--
  No whitespace before the button, so the space below is the only one and the
  underline never starts on a leading space.
--> <button
  type="button"
  onclick={reveal}
  title={reportPath}
  aria-label={`Show ${name} in the file manager`}
  class="rounded-sm px-0.5 font-mono text-[13px] text-foreground underline decoration-foreground-faint underline-offset-2 transition-[background-color,text-decoration-color] duration-150 ease-out hover:bg-hover-overlay hover:decoration-foreground"
>{name}</button>
