# nc-git

A sidebar card with the git history of the repository you are working in, drawn the way
`git log --graph` draws it in a terminal: commit dots and lane lines as box glyphs, each lane
in its own theme colour, with branch and tag chips, the subject and a short age on every row.
It follows the repository on its own: a plain terminal you focus, else the folder Claude Code
is working in. A window shows the longer history and opens any commit.

No `preview.png`: screenshots show private repositories.

## What you see

- **Header** (41 px, like the shipped Agents card): "Git" in `dim` 11.5 px medium, the repo's
  folder name in `dim` 11 px (truncated), an `all` / `head` toggle and a `⤢` button that opens
  the window (both `dim` 11 px text, `foreground` on `hover`).
- **Branch line** (22 px): the branch in `foreground` semibold, or "detached" in `muted`;
  then `↑n` and `↓n` (ahead and behind its upstream, `dim`, only when not 0) and `● n`
  (changed files, `ansi3`, only when not 0).
- **Graph list**, rows 20 px, newest first, 80 commits:
  - the graph: git's `*` `|` `/` `\` `-` drawn as `●` `│` `╱` `╲` `─` in the layout's
    monospace font at 15 px, 9 px per column. Lane n is coloured from the twelve tokens
    `ansi1..6, ansi9..14` in turn. The sidebar shows at most 5 lanes (10 columns).
  - Rows that are only graph (git's connector lines) stay, as in the terminal.
  - chips from `%D`: the checked-out branch in `ansi6` semibold, other local branches
    `ansi2`, remote-only branches `ansi1`, tags `ansi3`; 10 px, `border` outline, 4 px corners.
    A local branch and its remote twin share one chip: `main · origin`.
  - the subject (`muted`, `foreground` on the HEAD row), truncated, and the age on the right
    (`dim` 11 px): `now`, `5m`, `3h`, `2d`, `4mo`, `1y`.
  - The HEAD row has the `selected` background. With uncommitted changes, a row
    "Uncommitted changes · n files" (`muted`, italic) sits right above HEAD with `◌` on HEAD's lane.
- Messages in `dim` 12 px when there is no list: "Loading…", "No folder",
  "Not a git repository", "No commits yet", or git's error.
- **Window** (820×640, Herdr's window frame): the same card with 300 commits, up to 16 lanes,
  the short hash (`dim`, monospace 11 px) before the chips, and `✕` instead of `⤢`.
  An opened commit shows below its row: author, email and date (`YYYY-MM-DD HH:MM`, local
  time), the full message (up to 30 lines), then one line per file with `+added` (`ansi2`),
  `−deleted` (`ansi1`) and the path (`muted`), up to 40 files.

## How it behaves

- **Which repository:** a focused plain terminal pane (no agent status) wins. Otherwise the
  Claude Code agent it follows in the active space: the focused one, else the one it already
  followed, else the most recently changed (`seq`). Its folder is the last `cwd` in its
  transcript, so it follows Claude's `cd`s; then that agent pane's folder, then the focused
  pane's folder, then the space's folder. The repository is that folder's `--show-toplevel`.
- **Agent statuses:** the card shows none. A status change of the followed agent re-reads its
  transcript once; while it is `working` every refresh re-reads it. `blocked`, `done` and
  `idle` use the folder read last.
- **Refresh:** a change under the repository's git common dir (commit, checkout, fetch,
  index) refreshes after 300 ms. The watch's handle is kept and `cancel()`ed when the repository
  changes or the card empties. A 15 s timer refreshes while the Herdr window is active, which
  also catches edits in the work tree (the dirty count). A refresh that finds HEAD and every
  ref unchanged does not run the log again. Switching space, focus or followed agent
  refreshes at once.
- **Clicks:** `all` / `head` switches between every ref (`--all`) and HEAD's history only.
  `⤢` opens the window for the repository shown. A commit row in the sidebar opens the window
  with that commit open and scrolled to the middle. In the window a commit row opens or closes
  its details (a click on the open details closes them too); `✕` closes the window. The list and
  the buttons stop the press, so only the header and
  empty space drag the window. Hover: rows `hover` background, chips have no hover.
- Nothing moves on its own: no spinner, no animation.

## Built from

- `mods/nc-git/mod.json`: `{ "place": "none", "title": "Git" }`. The layout puts it in the
  sidebar card `git` (`{ "mod": "nc-git", "props": { "card": "git" } }`).
  The header ends in a ✕ that hides the card (`layout.hide` with the `card` prop, its block id); the `nc-cards` bar shows it again. The
  window copy has no `card` prop and no ✕.
- `main.js`: the card and the window (same class; the window gets props
  `{ overlay, dir, on, all, open }` and stays on `dir`). `parse.js`: pure parsers (log, status,
  refs, chips, ages, commit details, transcript cwd) with `selftest()`.
- Herdr functions: `spaces()`, `panes()`, `agents()`, `focused()`, `theme()`, `settings()`
  (`font_family`), `props()`, `window().active`, `watchFolder()`, `openOverlay` (kind
  `window`, key `nc-git`, 820×640), `closeOverlay`, `exec`, `hc`, `home()`, `readTextFile`.
- **Runs** (every exec has a 10 s timeout; git runs on the space's machine for a remote
  space): `git --no-optional-locks -c core.fsmonitor=false -c core.quotepath=off` with
  - `rev-parse --path-format=absolute --show-toplevel --git-common-dir`
  - `status --porcelain=v2 --branch -z --untracked-files=normal`
  - `for-each-ref --format=%(objectname) %(refname)`
  - `log --graph [--all] --date-order --color=never -n80|300 --format=%x1f%H%x1f%P%x1f%D%x1f%ct%x1f%s`
  - `show --numstat --diff-merges=first-parent --format=%an%x1f%ae%x1f%ct%x1f%B%x1e <hash>` (window, on click)
  - `hc get <agent address> --json` for `foreground.pid`, cached per agent; asked again while no
    claude pid is known and after the session file is gone
  - `/usr/bin/tail -c 2000000 <transcript>`
- **Reads:** `~/.claude/sessions/<pid>.json` (`sessionId`, `cwd`; never the `*.key` files) and
  the end of the transcript `~/.claude/projects/<folder>/<sessionId>.jsonl`, where `<folder>`
  is that `cwd` with every `[^A-Za-z0-9]` replaced by `-`. Only on this computer. Nothing is
  written, nothing goes to the network.
- Patterns from Herdr's shipped `changes` and `files` mods (Apache-2.0): the read-only git
  flags and the `v_virtual_list` + `Scrollbar.vertical(...).viewport_from_layout()` pairing.
  No art files.

## Watch out

- Ages come from `%ct`, never `%cr`: git prints `%cr` in the user's locale.
- Every git call stays read-only and writes nothing under `.git`, or the folder watch would
  trigger itself. The helper is one line so the repo check sees `--no-optional-locks`.
- Importing Herdr's `window` hides the global `window.paint_path`; it is imported as
  `window as appWindow`.
- `foreground.name` from `hc get` is Claude's version, not its name: match `argv[0]`.
- Transcripts are mostly over 1 MiB, so `readTextFile` can't read them; `tail -c` can. The
  first line of the tail may be cut.
- The graph columns line up only in a monospace font; lane lines join between rows only when
  the glyph fills the 20 px row (JetBrains Mono at 15 px does).
- `--path-format=absolute` and `--diff-merges` need git 2.31 or newer (also on remote machines).
- Limits: 80 commits and 5 lanes in the card, 300 commits and 16 lanes in the window; details
  show 30 message lines and 40 files. A remote space is polled every 15 s only (no folder
  watch there) and never follows Claude (its session files are on that machine).
- `hc()` takes no timeout; the other programs have 10 s.
- The card paints no background, so the card's own colour shows through.

## Done when

- `herdr-app check mods/nc-git` prints `check passed`.
- `node -e 'import("./mods/nc-git/parse.js").then((m) => m.selftest())'` prints `selftest ok`.
- In a repo with branches, the card's graph has the same shape as `git log --graph --all -n20`.
- Ages show as `5m` / `3h` / `2d`; the HEAD row is tinted; `main · origin` is one chip.
- Editing a file and waiting 15 s shows the WIP row and `● n`; `git commit` updates the list
  within a second.
- Focusing a plain terminal in another repo switches the card to that repo; focusing the
  Claude pane switches back to Claude's folder.
- `⤢` opens the window; a click on a commit shows its message and files.
