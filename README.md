# herdr-nc

A custom workspace for the [Herdr](https://herdr.dev) desktop app (macOS): one layout, nine
`nc-*` mods, two themes, keys and settings. The layout keeps spaces, agents, folders and git on
the left, tabs and terminals in the middle, and a rail on the right with what the followed
Claude Code session is doing: its orchestration flow, its cost by model and what it used.

<!-- Screenshots go here. Make them from the mods' demo fixtures only (made-up data),
     never from a live window. -->
## Requirements

- macOS
- [herdr-app](https://github.com/herdrdev/herdr-app) 0.1.16. It comes with `hc`, the
  herdr-core CLI, which the mods use for machines and agent state.
- [Claude Code](https://claude.com/claude-code) for `nc-session` and `nc-orchestrator`
  (they read its session and transcript files under `~/.claude`)
- `python3` (the macOS `/usr/bin/python3` is enough) for `nc-session/usage.py` and `scripts/check`
- `jq` for the scripts (`brew install jq`), `curl` for `scripts/fetch-upstream`

Optional:

- Remote machines added with `hc machine add`: `nc-spaces` groups their spaces, and
  `nc-session`/`nc-orchestrator` follow Claude Code sessions there (they need
  `/usr/bin/python3` on that machine).
- `nc` from [nc-harness](https://github.com/iAmSerathion/nc-harness) and `nc-work` from
  [nc-infra](https://github.com/iAmSerathion/nc-infra) for the extra entries in `programs.json`
  and the orchestrator's v3 plan view. Without them those menu entries show as not installed;
  everything else works.
- `nc-orchestrator` needs `nc-session` (it runs `nc-session/usage.py --orch`).

## Install

```sh
git clone https://github.com/iAmSerathion/herdr-nc
cd herdr-nc
scripts/check              # JSON, names, theme contrast, herdr-app check for every mod
scripts/deploy --dry-run   # shows what would be copied into ~/.config/herdr-app
scripts/deploy
```

Then switch to the layout `nc` in Herdr with `cmd-shift-l` (`layout.switch`).

`deploy` copies only what changed and never overwrites a file that did not come from this repo
(for example your own `keys.json` or `settings.json`); it reports those as "Left alone".
`scripts/deploy --force` takes them over and puts the old files in `local/backup/`. If Herdr
changed a deployed file since the last deploy (settings window, layout commands), `deploy`
stops, and `scripts/pull` brings the change into the repo.

**Emergency exit:** `ctrl-alt-shift-escape` in Herdr always sets the shown layout and
`keys.json` aside and goes back to `main`.

## Contents

| File | Content |
| --- | --- |
| `layouts/nc.json` | The layout, grown from Herdr's `main`. On the left cards for Spaces, Agents, Folders and Git, in the middle tabs and terminals, on the right the column `rail` with Orchestrator, Usage, Used and Servers. Aubergine theme, light or dark with macOS. |
| `themes/nc-dark.json`, `themes/nc-light.json` | Aubergine theme, dark and light. |
| `keys.json` | Herdr's macOS default keys from 0.1.16 plus two global keys: `cmd-alt-m` (`window.maximize`) and `cmd-ctrl-w` (`window.close`). |
| `settings.json` | Settings: zoom, sounds, no ligatures, telemetry off. |
| `programs.json` | Extra programs in the menu (see "Programs"). |
| `mods/` | See "Mods". |
| `scripts/` | `check`, `deploy`, `pull`, `selftest`, `fetch-upstream`, `contrast.py` |
| `local/` | Not in git: deploy records, backups, `local/upstream/` from `scripts/fetch-upstream`. |

## Mods

| Mod | Card | Origin | What it reads and runs |
| --- | --- | --- | --- |
| `nc-spaces` | Spaces with machines | Copy of Herdr's `spaces` (0.1.16), "This computer" always visible, machines sortable by dragging | `hc machine ls`, git (read-only) |
| `nc-workspace-chrome` | Bar above the sidebar without the logo | Copy of Herdr's `workspace-chrome` (0.1.16), logo and "Herdr" removed; `layouts/nc.json` also moves the Mac window buttons out of the window (`traffic_lights: [-200, -200]`, undocumented) | nothing |
| `nc-agents` | Agents | Copy of Herdr's `agents` (0.1.16) plus a counter row | nothing |
| `nc-folders` | Folders | new | Claude session (`~/.claude/sessions`, end of the transcript), git status |
| `nc-git` | Git graph | new | git log/refs (read-only); Claude session file and transcript tail to find the agent's folder |
| `nc-orchestrator` | Orchestrator: flow, workflows, subagents | new | `nc-session/usage.py --orch`, `hc get` |
| `nc-session` | Usage by model with costs, Used in this session | new | `usage.py` reads the Claude transcripts |
| `nc-servers` | Active servers | new | `lsof`, `curl` to localhost |
| `nc-cards` | Bar at the bottom: one button per card and column to show and hide it | new | only `layout.toggle/show` |

Every mod has a `RECIPE.md` with its structure, data sources and pitfalls. Costs are an
estimate at API list price (prices in `usage.py`, as of 2026-11-03), not a subscription bill.

**Own orchestrator skill:** If a skill writes `~/.claude/nc-orchestrator/<sessionId>.json`
(`"v": 1`, optional `prompt`, `routes`, `route`, `steps`, `outcome`), that replaces the
derived flow in the orchestrator diagram. The nc-harness orchestrator writes `"v": 3` there
(`nc orchestrator status`): the card then shows its crew and plan (musts, phases, lanes, tasks), toasts on
failed tasks and state changes, and offers "Approve plan" (`hc send <agent> ok` once `hc get`
says idle or done). Format: `mods/nc-orchestrator/RECIPE.md`.

## Programs

| Entry in `programs.json` | Name in the menu | Starts | Needs |
| --- | --- | --- | --- |
| `nc-claude` | Claude (isolated) | `nc-work here` | nc-infra |
| `nc-claude-direct` | Claude (Harness) | `nc claude` | nc-harness |
| `nc-opencode` | OpenCode (isolated) | `nc-work here --runtime opencode` | nc-infra |
| `nc-opencode-direct` | OpenCode (Harness) | `nc opencode` | nc-harness |
| `nc-broker` | Broker | `nc-work broker` | nc-infra |

Herdr shows an entry as not installed when its command is missing. Herdr's own "Claude Code"
and "OpenCode" entries stay as they are.

## Themes

`themes/nc-dark.json` and `themes/nc-light.json` are the Aubergine theme. `layouts/nc.json`
picks dark or light with macOS; `"theme"` in `settings.json` or the theme picker apply it to
other layouts. `scripts/check` runs `scripts/contrast.py` so the colour pairs that matter
stay readable.

## Structure

```
layouts/nc*.json      layouts, previews as layouts/nc*.svg|png
mods/nc-<name>/       mods: mod.json ("place": "none") + main.js (+ RECIPE.md)
themes/nc*.json       themes
keys.json             all keys (see "Keys")
settings.json         zoom, sounds, no ligatures, telemetry off
scripts/              check, deploy, pull, selftest, fetch-upstream, contrast.py
local/                not in git: deploy record, backups, local/upstream/
```

- Everything here is named `nc` or `nc-…`, so it never collides with Herdr's names or
  other people's mods. `scripts/check` enforces that.
- Images, fonts and sounds live in the folder of the mod that uses them and are referenced
  with paths relative to the Herdr home (`mods/nc-x/image.png`). That way `deploy` takes
  them along.

Herdr reads only `~/.config/herdr-app/`. This repo is the source; `scripts/deploy` copies
there. Symlinks do not work well: linked mod folders load without hot reload
(herdr-app#887), linked JSON files take effect only after up to ~10 s (herdr-app#65).

## Working on it

1. Change it in the repo.
2. `scripts/check`: JSON valid, ids unique, only existing mods in the layout, names `nc*`,
   theme contrast, `herdr-app check` for every mod, no home paths or secrets.
3. `scripts/deploy --dry-run`, then `scripts/deploy`. It reports Herdr's errors afterwards
   (`errors []` means good).
4. Look at it in Herdr (layout `nc`).

After changes to `scripts/`: `scripts/selftest` tests `deploy` and `pull` in temp folders.

## Keys

`keys.json` is the whole file. As long as it is byte-identical to Herdr's default, Herdr
replaces it with the new defaults on update. From the first change on (whitespace too) it
stays as it is, and new defaults come in by hand. If `deploy` reports drift in `keys.json`
after an update, use `scripts/pull`, not `--force`.

On non-US keyboard layouts, shortcuts with `[ ] / = +` may not be reachable. Prefer letters
or digits for new shortcuts and try them out in Herdr.

## Copying and changing a Herdr mod

Herdr's own mods and layouts are replaced on every start. So change them only as a copy:

1. `scripts/fetch-upstream <version>`, then copy `local/upstream/herdr-app-<version>/mods/<name>`
   to `mods/nc-<name>`.
2. In `mod.json`, add `"cloned_from": { "name": "<name>", "version": "<version>" }`; at the top
   of `main.js`, add `// Modified from herdr-app v<version> mods/<name> (Apache-2.0); see NOTICE.`
   and list the mod in `NOTICE`.
3. In the code, switch own paths `mods/<name>/…` and overlays that open themselves
   (`openOverlay({ mod: "<name>" …`) to `nc-<name>`. Herdr's `mod.clone` does the same.
4. Switch every place that calls the mod:
   - in the layout `"mod": "<name>"`, root `"toast"` and `"terminal_menu"`
   - in `keys.json` `mod.open:<name>`, the section `mod:<name>` and `<name>.<command>`

   Mods that open other Herdr mods by name (for example `new-menu` from `tabs`, `picker`)
   take effect only once the caller is copied too.

A copy no longer gets fixes from Herdr. So copy only what you really change.

## Updating Herdr

Herdr updates itself. Afterwards fetch the old and the new release and compare them:

```sh
old=0.1.16; new=0.1.17   # new: see herdr-app --version
scripts/fetch-upstream $old && scripts/fetch-upstream $new
diff -r local/upstream/herdr-app-$old local/upstream/herdr-app-$new | less
```

- API changes are in the diff of `AGENTS.md` and `herdr.d.ts`; Herdr writes the current
  `gpui-kit.d.ts` into `~/.config/herdr-app/`.
- Take new default keys into `keys.json` by hand.
- Merge fixes into copied mods, for every changed file of the mod:
  `git merge-file mods/nc-x/main.js local/upstream/herdr-app-$old/mods/x/main.js local/upstream/herdr-app-$new/mods/x/main.js`
  - The exit code is the number of conflicts.
  - Afterwards switch the new lines back to `nc-x`:
    `grep -n 'mods/x/\|mod: "x"' mods/nc-x/*.js`
  - Update `cloned_from`, the header line and `NOTICE` to the new version.
- `scripts/check`, `scripts/deploy`, look at it in Herdr.

## Licence

Apache-2.0, see `LICENSE`. Parts are derived from
[herdr-app](https://github.com/herdrdev/herdr-app) (Apache-2.0); `NOTICE` lists them.
