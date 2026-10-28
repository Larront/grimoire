/*
  Resolve the real per-OS installers from the latest GitHub release.

  Asset filenames carry the version (e.g. `Grimoire_0.1.1_x64_en-US.msi`), so a
  hardcoded URL would rot on every release. This runs once at build time — the
  site is fully static — and falls back to the generic releases page if the
  API is unreachable.

  ON THE FALLBACK BEING LOUD. The unauthenticated API allows 60 requests/hour
  *per IP*, and GitHub Actions runners share IPs, so a rate-limited build is a
  routine event rather than an exotic one. Degrading silently is the dangerous
  outcome: the page still renders, still looks finished, and quietly ships
  "Get on GitHub ↗" links instead of real downloads until somebody notices by
  eye. So the deploy workflow sets REQUIRE_RELEASE_ASSETS=1 and the build fails
  instead. Locally the flag is unset and the fallback keeps `astro dev` working
  offline, which is the only place that trade is worth making.

  The workflow also passes GITHUB_TOKEN, which lifts the limit to 5000/hour and
  makes the failure path rare in the first place.
*/

const REPO = "Larront/grimoire";
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;

/**
  `detail` is the file type; `size` is human-readable ("14 MB") when the API gave one;
  `direct` is false for a link to the releases page rather than an installer.
*/
export type Asset = { label: string; detail: string; size?: string; url: string; direct: boolean };
export type OsKey = "windows" | "macos" | "linux";
export type Platform = {
  key: OsKey;
  os: string;
  /** What the platform needs and which file to pick. */
  note: string;
  /** How to get past the unsigned-build warning, shown beside this OS's downloads. */
  firstRun: string;
  assets: Asset[];
};

export type ReleaseInfo = {
  version: string | null;
  publishedAt: string | null;
  platforms: Platform[];
  resolved: boolean;
};

type GithubAsset = { name: string; size?: number; browser_download_url: string };
type GithubRelease = {
  tag_name: string;
  published_at: string;
  assets: GithubAsset[];
};

/*
  Everything about a platform that is not a URL, written once. The resolved list and
  the fallback both read it, so the two cannot drift apart — they used to be two copies.

  The first-run steps are the unsigned-build warning each OS shows, said beside that
  OS's downloads rather than in a paragraph after the list. macOS 15 Sequoia removed
  the right-click → Open bypass the old copy described; Open Anyway in Privacy &
  Security is the route on every version since. The .deb is built on ubuntu-24.04
  (.github/workflows/release.yml), so it needs that release's glibc or newer.
*/
const PLATFORMS: Record<OsKey, Omit<Platform, "assets">> = {
  windows: {
    key: "windows",
    os: "Windows",
    note: "Windows 10 and 11, 64-bit. The .msi suits managed installs.",
    firstRun: "Windows may say it protected your PC. Choose More info, then Run anyway.",
  },
  macos: {
    key: "macos",
    os: "macOS",
    note: "macOS 11 or later. Apple Silicon for M1 and newer, Intel for older Macs.",
    firstRun:
      "macOS won't open it the first time. Go to System Settings → Privacy & Security and choose Open Anyway.",
  },
  linux: {
    key: "linux",
    os: "Linux",
    note: "x86-64. The AppImage runs on most distributions; the .deb needs Ubuntu 24.04 or newer.",
    firstRun: "Make the AppImage executable (chmod +x) before you run it.",
  },
};

const ORDER: OsKey[] = ["windows", "macos", "linux"];

function formatSize(bytes: number | undefined): string | undefined {
  if (!bytes) return undefined;
  const mb = bytes / 1_048_576;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

function resolvePlatforms(assets: GithubAsset[]): Platform[] {
  const lower = (name: string) => name.toLowerCase();
  // `.sig` files are the updater's signatures, not something a human downloads.
  const find = (pred: (name: string) => boolean): GithubAsset | undefined =>
    assets.find((a) => !a.name.endsWith(".sig") && pred(lower(a.name)));

  const asset = (found: GithubAsset | undefined, label: string, detail: string) =>
    found
      ? [
          {
            label,
            detail,
            size: formatSize(found.size),
            url: found.browser_download_url,
            direct: true,
          },
        ]
      : [];

  // The first asset of each platform is the one to recommend.
  const byOs: Record<OsKey, Asset[]> = {
    windows: [
      ...asset(
        find((n) => n.endsWith(".exe")),
        "Setup",
        ".exe",
      ),
      ...asset(
        find((n) => n.endsWith(".msi")),
        "Installer",
        ".msi",
      ),
    ],
    macos: [
      ...asset(
        find((n) => n.includes("aarch64") && n.endsWith(".dmg")),
        "Apple Silicon",
        ".dmg",
      ),
      ...asset(
        find((n) => n.includes("x64") && n.endsWith(".dmg")),
        "Intel",
        ".dmg",
      ),
    ],
    linux: [
      ...asset(
        find((n) => n.endsWith(".appimage")),
        "AppImage",
        ".AppImage",
      ),
      ...asset(
        find((n) => n.endsWith(".deb")),
        "Debian / Ubuntu",
        ".deb",
      ),
    ],
  };

  return ORDER.filter((key) => byOs[key].length).map((key) => ({
    ...PLATFORMS[key],
    assets: byOs[key],
  }));
}

const FALLBACK_DETAIL: Record<OsKey, string> = {
  windows: ".exe / .msi",
  macos: ".dmg",
  linux: ".AppImage / .deb",
};

/** A platform row that links to the releases page instead of an installer. */
function fallbackFor(key: OsKey): Platform {
  return {
    ...PLATFORMS[key],
    assets: [
      { label: "Get on GitHub", detail: FALLBACK_DETAIL[key], url: RELEASES_PAGE, direct: false },
    ],
  };
}

const FALLBACK: Platform[] = ORDER.map(fallbackFor);

/*
  WHICH RELEASE THIS BUILD IS SUPPOSED TO BE ADVERTISING, when anything knows.

  `/releases/latest` is CACHED, and a release-triggered build outruns that cache. The
  numbers from 0.3.1: the release published at 00:36:40, the pages run started three
  seconds later, and the whole build took twenty-one — so it asked what the latest
  release was about twenty seconds after publishing, and GitHub still said v0.3.0. The
  build passed every check it had (a real release, all its assets present, links that
  resolve) and shipped a download page for the previous version. Nothing was broken
  enough to notice; it was simply a release behind.

  The tag is therefore passed in from the workflow on `release: published`, where the
  event payload already knows it, and left empty everywhere else. That distinction is
  load-bearing: a plain push to `main` after a promotion PR merges legitimately has a
  `package.json` version ahead of the newest release — 0.3.1 was in the tree an hour
  before the tag existed — so comparing against the tree's version would fail every
  merge build. Only a release run knows what it is waiting for.
*/
const EXPECTED_TAG = process.env.EXPECTED_RELEASE_TAG?.trim() || null;

/** Retry budget for the cache catching up: ~45s across five attempts. */
const RETRY_DELAYS_MS = [3000, 6000, 12000, 24000];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchLatest(token: string | undefined): Promise<GithubRelease> {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: {
      Accept: "application/vnd.github+json",
      // Ask the CDN for a fresh answer rather than whatever it last stored.
      // On its own this is not enough — hence the retry — but it costs nothing.
      "Cache-Control": "no-cache",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status} ${res.statusText}`);
  return (await res.json()) as GithubRelease;
}

export async function getLatestRelease(): Promise<ReleaseInfo> {
  const token = process.env.GITHUB_TOKEN;
  const strict = process.env.REQUIRE_RELEASE_ASSETS === "1";

  try {
    let release = await fetchLatest(token);

    // Wait for the cache to agree, when we know what it should be agreeing with.
    for (const delay of RETRY_DELAYS_MS) {
      if (!EXPECTED_TAG || release.tag_name === EXPECTED_TAG) break;
      console.warn(
        `[releases] Expected ${EXPECTED_TAG} but the API still reports ` +
          `${release.tag_name}; retrying in ${delay}ms.`,
      );
      await sleep(delay);
      release = await fetchLatest(token);
    }

    // Loud rather than a version behind. This is the one failure the old code could
    // not see: everything below it would have passed.
    if (EXPECTED_TAG && release.tag_name !== EXPECTED_TAG) {
      throw new Error(
        `expected release ${EXPECTED_TAG} but the API kept reporting ` +
          `${release.tag_name} after ${RETRY_DELAYS_MS.length} retries`,
      );
    }

    const resolved = resolvePlatforms(release.assets ?? []);
    if (!resolved.length) throw new Error("no installable assets resolved");

    // A release missing one OS's files used to drop that OS's row without a word, so a
    // Mac visitor saw no macOS at all. Strict builds refuse; local builds keep the row
    // and point it at the releases page.
    const missing = ORDER.filter((key) => !resolved.some((p) => p.key === key));
    if (missing.length && strict) {
      throw new Error(`no installers resolved for ${missing.join(", ")}`);
    }
    if (missing.length) {
      console.warn(
        `[releases] No installers for ${missing.join(", ")}; linking the releases page.`,
      );
    }
    const platforms = ORDER.map((key) => resolved.find((p) => p.key === key) ?? fallbackFor(key));

    return {
      version: release.tag_name ?? null,
      publishedAt: release.published_at ?? null,
      platforms,
      resolved: true,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    if (strict) {
      throw new Error(
        `Could not resolve release assets (${reason}). REQUIRE_RELEASE_ASSETS=1, so ` +
          `refusing to publish a download page with placeholder links.`,
      );
    }
    console.warn(
      `[releases] Falling back to the releases page — download links will NOT be ` +
        `direct installers. Reason: ${reason}`,
    );
    return {
      version: null,
      publishedAt: null,
      platforms: FALLBACK,
      resolved: false,
    };
  }
}
