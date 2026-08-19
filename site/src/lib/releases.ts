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

export type Asset = { label: string; detail?: string; url: string };
export type Platform = { os: string; note: string; assets: Asset[] };

export type ReleaseInfo = {
  version: string | null;
  publishedAt: string | null;
  platforms: Platform[];
  resolved: boolean;
};

type GithubAsset = { name: string; browser_download_url: string };
type GithubRelease = {
  tag_name: string;
  published_at: string;
  assets: GithubAsset[];
};

function resolvePlatforms(assets: GithubAsset[]): Platform[] {
  const find = (pred: (name: string) => boolean): string | undefined =>
    assets.find((a) => pred(a.name))?.browser_download_url;

  const lower = (name: string) => name.toLowerCase();
  // `.sig` files are the updater's signatures, not something a human downloads.
  const isInstaller = (name: string) => !name.endsWith(".sig");

  const msi = find((n) => isInstaller(n) && lower(n).endsWith(".msi"));
  const exe = find((n) => isInstaller(n) && lower(n).endsWith(".exe"));
  const dmgArm = find(
    (n) => isInstaller(n) && lower(n).includes("aarch64") && lower(n).endsWith(".dmg"),
  );
  const dmgIntel = find(
    (n) => isInstaller(n) && lower(n).includes("x64") && lower(n).endsWith(".dmg"),
  );
  const deb = find((n) => isInstaller(n) && lower(n).endsWith(".deb"));
  const appimage = find((n) => isInstaller(n) && lower(n).endsWith(".appimage"));

  const platforms: Platform[] = [];

  const windows: Asset[] = [];
  if (msi) windows.push({ label: "Installer", detail: ".msi", url: msi });
  if (exe) windows.push({ label: "Setup", detail: ".exe", url: exe });
  if (windows.length)
    platforms.push({
      os: "Windows",
      note: "Windows 10 & 11 · 64-bit",
      assets: windows,
    });

  const macos: Asset[] = [];
  if (dmgArm) macos.push({ label: "Apple Silicon", detail: ".dmg", url: dmgArm });
  if (dmgIntel) macos.push({ label: "Intel", detail: ".dmg", url: dmgIntel });
  if (macos.length)
    platforms.push({
      os: "macOS",
      note: "macOS 11 Big Sur & later",
      assets: macos,
    });

  const linux: Asset[] = [];
  if (deb) linux.push({ label: "Debian / Ubuntu", detail: ".deb", url: deb });
  if (appimage) linux.push({ label: "AppImage", detail: "universal", url: appimage });
  if (linux.length) platforms.push({ os: "Linux", note: "x86-64", assets: linux });

  return platforms;
}

const FALLBACK: Platform[] = [
  {
    os: "Windows",
    note: "Windows 10 & 11 · 64-bit",
    assets: [{ label: "Get on GitHub", detail: ".msi / .exe", url: RELEASES_PAGE }],
  },
  {
    os: "macOS",
    note: "macOS 11 Big Sur & later",
    assets: [{ label: "Get on GitHub", detail: ".dmg", url: RELEASES_PAGE }],
  },
  {
    os: "Linux",
    note: "x86-64",
    assets: [
      {
        label: "Get on GitHub",
        detail: ".deb / .AppImage",
        url: RELEASES_PAGE,
      },
    ],
  },
];

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

    const platforms = resolvePlatforms(release.assets ?? []);
    if (!platforms.length) throw new Error("no installable assets resolved");

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
