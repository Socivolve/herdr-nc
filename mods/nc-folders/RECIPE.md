# Folders

A sidebar card that shows the folder tree of the repo where the Claude Code agent of the shown
space works right now. It follows Claude when it `cd`s into another repo, opens and highlights
the folder Claude is in, colours files by `git status`, and marks the files Claude edited or
read. Clicking a file opens a read-only preview window.

No `preview.png`: a screenshot would show private folders and file names.

## What you see

Top to bottom, inside a bordered card (the layout draws the border and the `chrome` background;
the mod paints no background of its own). UI font, text 12 px unless noted.

- **Header, 36 px:** "Folders" (11.5 px, medium, `dim`); the root path with `~` for home
  (`muted`, truncated); a `↑` button (go up one folder, hidden at `/`); a `follow` button
  (`accent` while following, `dim` when not). Both buttons: 11 px, hover `hover` background.
- **Tree, the rest:** rows 24 px, indented 14 px per level. Each row: a chevron (folders only,
  `mods/files/chevron-down|right.svg`, 11 px, `dim`), a folder or file icon (`mods/files/folder.svg`,
  `mods/files/file.svg`, 13 px, `muted`), the name (truncated), then from left to right:
  - Claude mark: `✎` in `accent` (edited), else `◦` in `muted` (read).
  - Dirty dot `●` (8 px, `ansi3`) on folders that contain a git change.
  - Git letter (11 px), with the name in the same colour: `A` (untracked or added) `ansi2`,
    `D` and `U` (deleted, conflict) `ansi1`, `M` `ansi3`.
  - The row of Claude's current folder has the `selected` background. Hover: `hover`.
  - A vertical scrollbar over the right edge.
  - Empty states, one `dim` line: "Loading…", "Empty folder", "No folder", or the error.
  - Over the limit: "Limited to 500 entries per folder, 5,000 in all" (10.5 px, `dim`).
- **Footer, 26 px,** top border `border`, 11 px `dim`: a 6 px dot in the agent's status colour
  (`working`, `blocked`, `done`, `idle`; `border` when there is no agent), then
  "Claude Code here" or "none", and on the right "N edited". In a space on another machine the
  text is "transcript is on <machine>" and there are no Claude marks.
- **Preview window** (760×560, key `nc-folders-file`): a 36 px title bar with the file name
  (semibold), its folder (`dim`, `~` for home) and a close icon (`mods/pane/close.svg`); below, a
  read-only code view with line numbers and syntax colours from `ansi1..6` and `dim`. Binary,
  missing or unreadable files show one `dim` line instead. Text over 400,000 characters is cut.

## How it behaves

- **Which agent:** Claude Code agents in the shown space (`app === "claude-code"` or
  `program.key === "claude"`). A focused one wins; else the one followed before, while it is
  still there; else the one with the highest `seq`. Its status only colours the footer dot.
- **Which folder:** the last `cwd` in that agent's transcript (it changes when Claude `cd`s).
  Without one: the agent pane's folder, the focused pane's folder, then the space's folder.
- **Root:** the git top level of that folder, else the folder itself. Claude's folder and every
  folder above it inside the root open, and the list scrolls it to the middle, each time Claude's
  folder or the root changes. Folders you collapse stay collapsed until then.
- **When it updates:**
  - At once on a space switch, an agent switch or, with no agent, a focus change (in `render`).
  - Transcript: every 4 s while the followed agent is `working`, plus once when it stops.
  - Tree and git colours: when files under the root change (`watchFolder`, 800 ms debounce),
    and every 10 s while the Herdr window is active. A run is skipped while the last one is busy.
- **Clicks:** a folder row opens or closes it; a file row opens the preview window (one at a
  time; it opens where it was last dropped). In the window, the title bar drags it, the close
  icon closes it, and the code view keeps its presses for selecting text.
- `↑` sets the root one folder higher (repeatable). It resets when the computed root changes.
- `follow` off freezes the card on the current root: no agent or space switching, no transcript
  reads; the watch and the 10 s refresh keep running. Turning it on goes back to Claude's folder.

## Built from

- Files: `mod.json` (`{"place":"none","title":"Folders"}`), `main.js` (one `View`, ~310 lines).
  Used in `layouts/nc.json` as block `dirs`: `{ "mod": "nc-folders", "props": { "card": "dirs" } }`.
  The header ends in a ✕ that hides the card (`layout.hide` with the `card` prop, its block id); the `nc-cards` bar shows it again. The preview
  window is the same mod opened with props `{file, on}`.
- Borrowed from Herdr's shipped `files` mod 0.1.15 (Apache-2.0, noted in the code): the `sh`
  listing script, the git status letter parsing, the language map and the read-only preview.
  Icons are the shipped `files` and `pane` mods' SVGs, referenced, not copied.
- `herdr` functions: `spaces`, `agents`, `panes`, `focused`, `theme`, `settings`, `window`,
  `hc`, `exec`, `readTextFile`, `watchFolder`, `home`, `props`, `run`, `openOverlay`, `closeOverlay`.
  One command, `run("layout.hide")` from the ✕; no `shared()` state, no network.
- **Runs** (each `exec` with a 10 s timeout):
  - `hc get <address> --json`, once per agent address (the pid is cached; asked again when its
    session file is gone). The pid counts only when `basename(foreground.argv[0]) === "claude"`.
  - `/usr/bin/tail -c 2000000 <transcript>`.
  - `git --no-optional-locks -c core.fsmonitor=false rev-parse --show-toplevel` (when the folder changes).
  - `git --no-optional-locks -c core.fsmonitor=false status --porcelain=v1 -z --no-renames --untracked-files=normal`.
  - `/bin/sh -c <listing script>` per shown folder (up to 501 entries, `.git` left out).
  - In a space on another machine, `git` and `sh` run there (`on: space.machine`).
- **Reads:** `~/.claude/sessions/<pid>.json` (`sessionId`, `cwd`; never the `*.key` files next to
  it), the end of `~/.claude/projects/<cwd with [^A-Za-z0-9] → "-">/<sessionId>.jsonl`, and the
  file being previewed. It writes nothing.
- **Claude marks:** from the transcript tail, assistant `tool_use` blocks: `Edit`, `Write`,
  `MultiEdit`, `NotebookEdit` (`file_path` or `notebook_path`) are edited; `Read` (`file_path`) is
  read. The newest 80 distinct paths of each.

## Watch out

- The module runs a tiny `parseTail` self-check at load, so `herdr-app check` fails if the
  transcript parser breaks. Keep it cheap and free of side effects.
- Handlers can't go inside a `v_virtual_list` row renderer: clicks use `on_item_click` on the
  list with the row path as key. Scrolling to Claude's folder runs after the data load
  (`VirtualListScrollHandle.scroll_to_item(i, "center")`), not in `render`.
- Marks come from the main transcript only: files a sub-agent or a workflow agent edited don't
  get marks. Only the last 2 MB of the transcript are read, so very old marks drop out.
- `watchFolder` is shared by all mods and watches recursively on macOS (including
  `node_modules` and `.git`); at most 64 folders app-wide can have a pending watch. So the mod
  never watches `/` or home and watches only the root it shows. It keeps the watch's handle and
  calls `cancel()` when the root changes or empties, which releases the slot. A refused or
  reclaimed watch falls back to the 10 s timer.
  Spaces on another machine have no watch (local only) and refresh on the 10 s timer.
- `hc()` takes no timeout; every `exec` has one.
- `foreground.name` is Claude's version string; match the program by `argv[0]`.
- Unix only: the listing uses `/bin/sh` (the shipped `files` mod also has a PowerShell path for
  Windows, left out here).
- State lives in the class per copy; the module top level holds only constants and pure helpers.
- The git root is resolved with `rev-parse` only when Claude's folder changes; a `git init` in
  the same folder shows after the next folder change.

## Done when

- `herdr-app check mods/nc-folders` prints `check passed` (this also runs the parser self-check).
- `scripts/check` passes with no warning for `mods/nc-folders`.
- In the app, with Claude Code working in the shown space: the root is Claude's repo; after
  Claude `cd`s into another repo, the tree switches within about 4 s and highlights the folder.
- The git letters match `git status --porcelain` for that repo, and changed folders show a dot.
- After Claude edits a file, it shows `✎` within about 4 s and the footer count goes up.
- Clicking a file opens the preview window; clicking another file replaces it in place.
- `↑` shows the parent folder with Claude's folder still opened and highlighted; `follow` off
  keeps the tree still while switching spaces.
