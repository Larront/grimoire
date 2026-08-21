// The staleness guard every [[Details Source]] fetch settles through.
//
// A source's fan-out is keyed — by note path, by pin id, by map id — and a
// selection can move while a read is still in flight. Both settle paths have to
// check: guarding only the resolve is what let note A's *rejection* clear note
// B's state and raise B's "unavailable" flag, showing the GM another entity's
// data with an error attached (#202).
//
// Bind one guard per fetch, at the point the key is captured:
//
//   const whenCurrent = staleGuard(targetPath, () => loadedForPath);
//   api.silent.readNoteTags(targetPath)
//     .then((loaded) => whenCurrent(() => { tags = loaded; }))
//     .catch(() => whenCurrent(() => { tags = []; tagsLoadError = true; }));

/**
 * Build the guard for one in-flight fetch keyed on `key`.
 *
 * `currentKey` is read at settle time, not at bind time — that lag is the whole
 * point, since it is what moved while the request was out.
 */
export function staleGuard<K>(key: K, currentKey: () => K) {
  return function whenCurrent(apply: () => void) {
    if (currentKey() !== key) return;
    apply();
  };
}
