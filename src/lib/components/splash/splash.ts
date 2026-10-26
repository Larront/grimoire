// What every Splash layout takes from the page. The words it uses about a world —
// how long ago, what is in it — are shared with the world's own home page, in
// `$lib/utils/world-words`.
import type { RecentLedger } from "$lib/stores/ledger.svelte";

/** Everything a Splash layout needs from the page; the page owns the state. */
export interface SplashProps {
  worlds: RecentLedger[];
  /** Which action is under way: a world's path, or "__folder__" / "__example__". */
  busy: string | null;
  /** An earlier exploration of the example exists, so it can be continued. */
  exampleSaved: boolean;
  onOpen: (path: string) => void;
  onRemove: (path: string) => void;
  onLookAgain: () => void;
  onOpenFolder: () => void;
  onNewWorld: () => void;
  onExplore: () => void;
  onContinueExample: () => void;
}
