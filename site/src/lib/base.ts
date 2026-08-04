/*
  Join a root-relative path onto the deployment's base path.

  The site is served from /grimoire on GitHub Pages today and from / if it
  ever moves to a custom domain (see astro.config.mjs). Astro rewrites neither
  `href` nor `src` for you, so every absolute internal URL — pages and public/
  assets alike — has to go through here or it 404s on exactly one of those two
  deployments, which is the kind of break that only shows up in production.

  BASE_URL is normalised by Astro to always have a leading slash, but whether
  it has a trailing one depends on config, so both ends are trimmed and
  rejoined rather than concatenated.

  Anchors and external URLs do not need this — only paths starting with "/".
*/
export function withBase(path: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/+$/, "");
  const rest = path.replace(/^\/+/, "");
  return rest ? `${base}/${rest}` : `${base}/`;
}
