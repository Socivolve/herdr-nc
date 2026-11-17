# Rules for coding agents and contributors

This repo is a custom workspace for the Herdr desktop app. Read `README.md` first.

## Sources

- Herdr's API and rules: `~/.config/herdr-app/AGENTS.md`, `herdr.d.ts` and `gpui-kit.d.ts`.
  Herdr writes them on every start to match the installed version. Read them, never copy them.
- `scripts/fetch-upstream <version>` puts Herdr's unchanged defaults for a release into
  `local/upstream/herdr-app-<version>/` (not in git), for looking things up and comparing.
- Herdr's bundled mods in `local/upstream/…/mods/` are the best examples.

## Steps for every change

1. Change only this repo.
2. `scripts/check` must say "check passed".
3. `scripts/deploy --dry-run`, then `scripts/deploy`. Afterwards the output must show
   `errors []`, and no `*.error` may be reported.
4. Look at it: `herdr-app shot "$TMPDIR/herdr-shot.png"` (always with a path outside the repo,
   the screenshot shows private data). `herdr-app check` only checks the first render.
5. Do not commit or push without being asked.

Run experiments that put the window at risk in a sandbox: your own short `HERDR_APP_HOME`, your
own `HC_SESSION`, your own XDG paths. Never stop or restart the running herdr-core: all agents
run in it.

## Never

- Write to `~/.config/herdr-app` by hand. Only `scripts/deploy` writes there, and without
  `--force` only files from this repo. The folder may hold files and mods that are not from
  this repo; leave them alone.
- Use git inside `~/.config/herdr-app`.
- Run `scripts/deploy --force` without consent. It replaces files there that did not come
  from this repo (old ones go to `local/backup/`).
- Edit files under `local/upstream/`. New Herdr versions go into a new folder next to it.
- Touch `layouts/.state/`.
- Without an explicit request, run anything that ends or resets terminals, agents or the
  layout: `pane.close`, `tab.close`, `space.close`, `terminal.kill`, `app.reset`,
  `layout.reset`, `hc kill|rm|interrupt`, `hc server stop|restart`.
- Put absolute home paths, host names, or names of people, companies or projects in files.
  They belong in `local/` (not in git) or in Herdr's `shared()` state.

## Conventions

- Everything here is named `nc` or `nc-…`: layouts, mod folders, themes, `mod:<name>`
  sections in `keys.json`, `shared()` keys (`nc.…`). Never take a name that Herdr ships.
- Images, fonts and sounds go into the folder of the mod that uses them, so `deploy` takes
  them along. Layout previews as `layouts/nc*.svg`.
- After changes to `scripts/`, `scripts/selftest` must pass.
- Mod names are permanent: mod panes are stored with their tab in herdr-core. Renaming a mod
  breaks them.
- `mod.json` always with `"place": "none"`.
- One mod per idea, with a `RECIPE.md` (structure as in AGENTS.md, "Layouts and mods other
  people made"). In it, also state what the mod runs, reads or fetches.
- Use Herdr's mods unchanged where possible. Copy only what you really change (see README).
  A copy gets `cloned_from` in `mod.json`, a `Modified from herdr-app …` header in `main.js`
  and a line in `NOTICE`.
- All text in this repo is English.
- Screenshots for docs come only from the demo fixtures (`fixture.js`), never from a live window.

## Writing mods

- Colours only through `theme()` tokens, no hex in mod code.
- No `setTimeout` or `setInterval`: `cx.timer`, `cx.sleep`, `cx.spawn`. Never keep a `cx`.
  Animate with `.frames`, `.spin`, `.loop`, `.transition`, never with timers.
- Do not poll Herdr's data (`spaces()`, `agents()`, `terminals()`, `focused()`, `theme()`,
  `shared()`): `render` runs by itself on changes. Poll external things (git, gh, vercel)
  slowly and only for what is visible. Skip a tick while the last one is still running.
  Timers run even when the block is hidden.
- git only read-only, and always with `--no-optional-locks`.
- State per copy of a mod goes in the class, not at module level: all copies share the module
  level (since 0.1.14).
- A mod cannot import anything outside its folder. Duplicate shared code.
- Images and SVGs with paths relative to the Herdr home: `svg("mods/nc-x/icon.svg")`.

## Keys

- On non-US keyboard layouts, keys with `[ ] / = +` may not be reachable. Use letters and
  digits for `cmd` shortcuts, and try new shortcuts out in Herdr.
- `keys.json` is the whole file. If it is byte-identical to Herdr's default, Herdr replaces it
  on update. From the first change on, Herdr merges nothing into it any more; new defaults
  come in by hand.
- `ctrl-alt-shift-escape` is the emergency exit and cannot be bound.
