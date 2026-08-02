// The one Node API a test needs, declared rather than pulled in.
//
// `infobox-presentation.test.ts` asserts against `app.css` itself, because the
// Infobox's float is CSS and nothing else and jsdom performs no layout;
// `encounter-grouping.test.ts` asserts against the bundled sample world's own note,
// because a copy of it could pass while the shipped file was broken. Reading a file
// needs `readFileSync`, and this project carries no `@types/node` — one
// declaration for one function is cheaper than a dependency that would newly type
// every global in the app's own code. If `@types/node` ever does land, delete this
// file — the real declarations replace it, and this one would collide with them.
declare module "node:fs" {
  export function readFileSync(path: string, encoding: "utf8"): string;
}
