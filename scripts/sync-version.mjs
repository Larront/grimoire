// Syncs src-tauri/Cargo.toml's [package] version to match package.json.
//
// Run automatically by npm's `version` lifecycle hook (see package.json), so
// `npm version <patch|minor|major>` bumps package.json and this keeps Cargo.toml
// in lockstep. tauri.conf.json reads its version from package.json directly, so
// package.json is the single source of truth for the release version.

import { readFileSync, writeFileSync } from "node:fs";

const version = process.env.npm_package_version;
if (!version) {
  console.error(
    "npm_package_version is not set — run this via `npm version`, not directly.",
  );
  process.exit(1);
}

const path = "src-tauri/Cargo.toml";
const toml = readFileSync(path, "utf8");

// Replace the `version = "..."` key inside the [package] table only. The
// `[^[]*?` keeps the match within [package] (it can't cross into the next
// `[table]` header), so other version keys are left untouched.
const updated = toml.replace(
  /(\[package\][^[]*?\nversion\s*=\s*")[^"]*(")/,
  `$1${version}$2`,
);

if (updated === toml) {
  console.error(`Could not find a [package] version to update in ${path}.`);
  process.exit(1);
}

writeFileSync(path, updated);
console.log(`Synced ${path} to ${version}`);
