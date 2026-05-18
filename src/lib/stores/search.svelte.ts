function createSearchPalette() {
  let open = $state(false);
  return {
    get open() {
      return open;
    },
    set open(v: boolean) {
      open = v;
    },
  };
}

export const searchPalette = createSearchPalette();
