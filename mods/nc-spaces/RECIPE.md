# nc-spaces

Herdr's shipped Spaces list (0.1.16) with two visible changes: the spaces always sit
under a "This computer" header, even when no remote machine is added, and the machine
headers can be dragged into any order. Each space is a
row with a coloured letter avatar, its name and, where unusual, its repo, branch and
ahead/behind. No preview.png: a live screenshot would show your own folders and prompts.

## What you see

- Top bar, 31px: "Spaces" in 11.5px `dim`, a 26px + button on the right (new space).
- Machine headers, 26px, 11px `dim`: monitor icon (this computer) or server icon (remote),
  the name ("This computer" for the local one), a "+" (new space on that machine), a 6px
  state dot (`ansi2` connected, `dim` otherwise) and a fold chevron. A remote machine that
  is away shows its state word; one that needs a login shows the `hc machine login` line
  with a Copy button; a rebuilt one shows "rebuilt · Connect". A remote machine whose agents
  stop on logout (`keeps_running_after_logout === false`) shows a ⚠ in `blocked` with a
  tooltip; a click opens Herdr's `machine-add` dialog with the fix.
- Space rows, under their machine: 18px rounded avatar in the space's colour with the first
  letter in white, the name (truncated; it shares the row with the git tail and stays at
  least 48px wide), then right-aligned in 11.5px `dim`:
  repo and branch only where they differ from the name (main/master hidden), `↑n` in
  `ansi2`, `↓n` in `ansi1`. Worktree spaces sit under their repo's space with a branch icon
  instead of an avatar. The active space has the `selected` background.
- A machine with no spaces shows "+ New space there"; while its layout loads, "Loading…".
- Narrow sidebar (under 160px): a rail of numbered cells with each space's status glyph;
  machine headers become icons with a state badge and a tooltip.

## How it behaves

- Agent status is not shown on wide rows (the Agents card does that); in the rail a space
  shows a glyph only when something in it needs you.
- Click a row: `space.select`. Right-click: Herdr's `menu` mod as a popup for that space.
  Drag a row onto another row of the same machine: `space.move`.
- Click a machine header: fold or unfold it (remembered per copy in localStorage).
  Drag a header onto another header: the machine moves there (below it when dragged down,
  above when dragged up; an accent line shows where). The order is kept in Herdr's shared
  `nc.machines.order` (`null` = this computer), so every copy and every restart uses it.
  Machines not in it yet come after those that are, in the shipped order (this computer,
  then by name); a machine that is gone keeps its place for when it comes back.
  "+" on a header: `space.new` on that machine. + in the top bar: `space.new`.
- The active space scrolls into view when it or its place in the list changes, and again
  when the list is resized (window, or a block above it growing).
- New spaces get the least-used colour of six (`ansi6`, `ansi3`, `ansi4`, `ansi5`, `ansi2`,
  `ansi1`), stored in Herdr's shared `space.colors`, so other mods show the same colour.
- Git info refreshes when a space is new, its first terminal moves to another folder, a
  command or agent turn ends there, a machine comes back, or the repo's git folder changes
  (watched locally); otherwise every 60 s while the window is in front.

## Built from

- Clone of Herdr's shipped `spaces` mod 0.1.16 (Apache-2.0; `scripts/fetch-upstream 0.1.16` puts it in `local/upstream/herdr-app-0.1.16/mods/spaces`),
  `mod.json` `{ "place": "none", "title": "Spaces", "cloned_from": { "name": "spaces", "version": "0.1.16" } }`.
- Layout props `{ "card": "spaces" }` (its block id): the header ends in a ✕ that runs `layout.hide`
  with it; the `nc-cards` bar shows the card again. Not in the narrow rail.
- Reads: `spaces()`, `machines()`, `panes()`, `layout()` (sidebar width), `window()`,
  `theme()`, `shared("space.colors")`, `shared("nc.machines.order")`. Writes
  `setShared("space.colors")`, `setShared("nc.machines.order")`.
- Calls: `space.select`, `space.move`, `space.new`, `app.settings {section: "machines"}`,
  `openOverlay({ mod: "menu" })`,
  `openOverlay({ mod: "machine-add", kind: "dialog" })`.
- Runs: `hc machine ls --json` at start and every 15 s; on a click on "Connect" for a rebuilt
  machine, `hc machine rm <name>` then `hc machine add …` with its saved target.
  `git --no-optional-locks rev-parse --path-format=absolute --show-toplevel` and
  `--git-common-dir`, `git --no-optional-locks symbolic-ref -q HEAD`,
  `git --no-optional-locks rev-list --left-right --count HEAD...@{upstream}` in each space's
  folder (also on remote machines via `exec`'s `on`), 30 s timeout each.
  `watchFolder` on each local repo's git common dir.
- Art: the shipped `mods/workspace-chrome/*.svg` icons (monitor, server, chevron, plus, branch).

## Watch out

- Diff against upstream, nothing else besides the licence header in line 1 (keep it this small
  so `git merge-file` stays easy):
  1. `grouped()`: upstream's whole `if (!remote.length) { … }` block (loading row, `activeAt`,
     plain rows) is deleted, so the list always goes through the per-machine grouping, which
     also sets `activeAt`. Keeping its loading line would hide every remote machine while the
     local layout loads, and the grouping already shows "Loading…" under the header itself.
  2. Machine order (all marked `// nc:`): `machineOrder()` and `moveMachine()` before
     `grouped()`, `machineNames` goes through `machineOrder()`, the header gets `.relative()`,
     the drop line and mouse down/move/up handlers, a space row's mouse move clears the drop target, `init` sets `this.machineDrag`, and the
     list's mouse up also clears `this.machineDrag`. Folding stays on `on_click`, which
     doesn't fire when the press and release land on different headers.
  3. The four `exec("git", …)` calls get `"--no-optional-locks"` as the first argument and
     `timeout: 30000` (the default, now explicit), each on the same line.
  4. The `herdr` import adds `props`, and a `hideCard` const follows the imports: the ✕
     that hides the card (`layout.hide`).
  5. Top bar: the title is `div().flex_1().child("Spaces")`, and the bar ends in
     `.when(!collapsed && Boolean(props()?.card), el => el.child(hideCard(t, props().card)))`.
- Kept from upstream on purpose: bare `git` (it must resolve on remote machines too), the
  avatar palette `MARK` and the white avatar letter as hex values (Herdr's palette, shared
  by every mod that draws space avatars; `scripts/check` warns about them), the 250 ms
  `checkNew` timer that compares `spaces()`/`panes()` to decide which git reads are due.
- The header comment at the top still says "grouped by machine when more than one is
  known"; left as is to keep the diff small.
- A clone gets no Herdr fixes. Merge new versions with `git merge-file` (see README).
- Also carries Herdr's upstream fixes #1001 (a bare repo in `<project>/.bare` is named after its project: `repoName()`), taken unchanged from Herdr's `master` after 0.1.16.
  They show in the diff against 0.1.16 too; the next release contains them, so `git merge-file` takes them cleanly.

## Done when

- `herdr-app check mods/nc-spaces` prints "check passed".
- `git diff --no-index local/upstream/herdr-app-0.1.16/mods/spaces/main.js mods/nc-spaces/main.js`
  shows only the lines listed under Watch out.
- With a remote machine: dragging its header above "This computer" puts it (and its spaces)
  first, also after a restart; a plain click on a header still folds it.
- In the app with no remote machine: "This computer" with monitor icon, +, green dot and
  chevron heads the list; clicking it folds the spaces away and back.
- A repo space shows its branch when it isn't main/master, and `↑1` after a local commit.
