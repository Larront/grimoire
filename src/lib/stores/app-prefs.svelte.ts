const REDUCE_MOTION_KEY = "grimoire-reduce-motion";
const CONFIRM_RENAME_LINKS_KEY = "grimoire-confirm-rename-links";
const SAMPLE_BANNER_DISMISSED_KEY = "grimoire-sample-banner-dismissed";

function createAppPrefs() {
  let reduceMotion = $state(
    typeof window !== "undefined"
      ? window.localStorage.getItem(REDUCE_MOTION_KEY) === "true"
      : false,
  );

  let confirmRenameLinks = $state(
    typeof window !== "undefined"
      ? window.localStorage.getItem(CONFIRM_RENAME_LINKS_KEY) === "true"
      : false,
  );

  let sampleBannerDismissed = $state(
    typeof window !== "undefined"
      ? window.localStorage.getItem(SAMPLE_BANNER_DISMISSED_KEY) === "true"
      : false,
  );

  function setReduceMotion(value: boolean) {
    reduceMotion = value;
    if (typeof window !== "undefined") {
      window.localStorage.setItem(REDUCE_MOTION_KEY, String(value));
    }
  }

  function setConfirmRenameLinks(value: boolean) {
    confirmRenameLinks = value;
    if (typeof window !== "undefined") {
      window.localStorage.setItem(CONFIRM_RENAME_LINKS_KEY, String(value));
    }
  }

  function setSampleBannerDismissed(value: boolean) {
    sampleBannerDismissed = value;
    if (typeof window !== "undefined") {
      if (value) {
        window.localStorage.setItem(SAMPLE_BANNER_DISMISSED_KEY, "true");
      } else {
        window.localStorage.removeItem(SAMPLE_BANNER_DISMISSED_KEY);
      }
    }
  }

  return {
    get reduceMotion() {
      return reduceMotion;
    },
    setReduceMotion,
    get confirmRenameLinks() {
      return confirmRenameLinks;
    },
    setConfirmRenameLinks,
    get sampleBannerDismissed() {
      return sampleBannerDismissed;
    },
    setSampleBannerDismissed,
  };
}

export const appPrefs = createAppPrefs();
