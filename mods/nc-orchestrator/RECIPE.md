# nc-orchestrator

A card that shows what the Claude Code session in the current space is doing, as an animated
pipeline from top to bottom: the latest prompt, the main session, the crew it picked, the
branches with the taken one lit, the stages of the active workflow with their agents, and the
outcome with its estimated cost. At a glance: green is finished, blue and moving is being
worked on right now, dashed is still to come, amber "!" failed. When the orchestrator writes a
v3 plan (status file, see below), the card shows the plan instead of the stages: its state,
musts, phases with their lanes and tasks, and an "Approve plan" button while the plan
waits. Under the pipeline, the card lists the session's workflows and its Agent-tool
subagents, its `nc delegate` workers (OpenCode in nc-work tasks) and the background shells it
still waits for. "pipeline ↗" opens the same view, larger, in a window, with the whole plan open.

(No `preview.png`: screenshots of it show private prompts.)

## What you see

The card sits in a rail block with a radius of 10, a 1px `border` and a `chrome` background.
The mod paints no background of its own in the card.

### The state language

Every node, line, icon and dot uses one of these looks (the `KIND`/`LOOKS` tables at the top of
`main.js`, the only place that maps feed statuses to them):

| Look | Feed statuses | Colour | Border | Icon | Motion |
| --- | --- | --- | --- | --- | --- |
| running | running, working, busy; tasks: running, review, redo | `working` | solid `working`, plus a pulse ring | ring spinner | pulse ring, scanner, shimmer |
| done | done, completed; tasks: pass | `done` | solid `done` at ~55% | ✓ | none |
| pending | pending, anything unknown | `dim` | dashed `border` | hollow ring | none |
| failed | error, failed, killed, stale; tasks: fail, conflict, blocked | `blocked` | solid `blocked` | "!" in a ring | none |
| skipped | a crew not picked | `dim`, node at 60% opacity | dashed `border` | none | none |
| idle | the main session waiting | `idle` | solid `border` | hollow ring | none |

Nodes are `surface` boxes. Lines (connectors) are 2px wide: running ones are a `border` track
with a moving `working` bar, done ones `done` at 55% opacity, pending ones a dashed `border`
line, failed ones `blocked`, idle ones `border`. A line takes the look of what it leads into.

### Card, top to bottom

- **Header**, 34px: "Orchestrator" (12px, semibold, `foreground`). On the right a run-state
  chip ("awaiting approval" in `idle` while a plan waits and the session is not busy, "running" in `working` with a pulsing dot, "done" in `done`, "failed" in `blocked`,
  "idle" in `idle` when nothing is loaded) and "pipeline ↗" (11px, `dim`, `foreground` on hover).
- **Body**: scrolls (`overflow_y_scrollbar`), with 12px side padding:
  - **prompt**: a 24px `surface` pill, mono 11px: a `dim` "›" and the first line of the latest
    typed prompt in `muted`, truncated. With no prompt: "No prompt yet" in `dim`.
  - a 14px line into **main**: a full-width node (radius 8). Line 1: status icon, "main"
    (bold), the model label (`muted`), and on the right the session's age ("43:00", or
    "3h 17m" from one hour) and its cost ("$31.42", semibold). Line 2, 11px `dim`:
    "working · 2 agents running · 1 shell · 48.2M tok" (agents count workflow agents, subagents
    and nc delegate workers). Running while the session is busy, else idle.
  - a line into **crew**: a small centred node "crew → team", done once `flow.route` is set.
    A v1 status file adds a "skill" badge, a v3 status file a "plan" badge (`raised` background,
    `accent` text). Hovering the node shows `flow.reason` as a tooltip, when there is one.
  - **fork** (when `routes` has entries): a stem down to a horizontal rail, a short drop to each
    branch, and the branch nodes side by side in equal cells (normally three: one,
    pair, team). The taken branch takes the outcome's look (running with pulse ring,
    done with ✓, failed with "!") with its name and the status word. The others are skipped:
    dashed, faded, "skipped". The taken path (stem, rail part, drops) is drawn in the outcome's
    look, the rest of the rail in `border`, the drops to skipped branches dashed. Under the
    taken branch a drop and a rail lead back to the centre line.
  - **plan** (when `flow.plan` is set; it replaces the stages): a `surface` panel (radius 8,
    1px `border`):
    - a top row that wraps: the plan's state as a chip ("planning", "running" and "closing"
      in the running look with a pulsing dot, "awaiting approval" pending, "done", "error"
      failed), then one `raised` badge per must ("M1", "M2", … in `muted`), the full text
      as tooltip;
    - while the state is `awaiting_approval` and the followed agent is idle (or "done", idle
      not yet looked at): an "Approve plan" button (`solid` background, `solid_foreground` text),
      greyed (50%, not-allowed cursor) while a send runs; after a click a `dim` result line:
      "sending…", "sent", "not idle" or "error: <message>". The line stays until the plan's
      state changes or the card follows another agent;
    - per phase a row "Phase 1 · seam" with "passed/total" on the right (11px, `dim`), then
      its lanes side by side in equal columns, each headed "Lane A" (10px, `dim`); in a card
      narrower than 420px the lanes stack. Lanes keep 3px padding for the pulse rings;
    - each task a compact chip (a node, radius 6, in its look): status icon, id (semibold),
      role (`dim`), then "↻n" in `working` for redo (n = redos), "⎇" when it has a
      branch, "D" when it has a delegate, and its review as a badge (`done` for "pass", `blocked`
      for "findings:…", else `accent`);
    - a click on a chip in the card expands it (one at a time; another click closes it):
      the title (`foreground`), then `dim` labels with `muted` values: files, proof, after,
      a badge per must answer ("M1 ✓" `done` for kept, "M2 ✗" `blocked` for broken), evidence, branch,
      delegate with a "peek" button, review, and the linked subagent (icon, "running · 9 tools
      · $0.31 · 2m"). Empty fields are left out. "peek" shows only when a terminal named
      like the delegate id exists.
  - **stages** (when `steps` has entries and there is no plan): a `surface` panel, one 20px row per stage:
    icon, title, a 110px progress bar (`raised` track, fill = done/total in the stage's colour),
    "done/total", and the elapsed time. A 2px rail runs between the stage icons, each segment in
    the look of the stage it leads into: a 14px line between two stages (18px with dots) and
    4px stubs above and below each 12px icon, so the rail touches the icons. Under a running or failed stage: one dot per agent of
    that phase in feed order (done `done`, running pulsing `working`, failed `blocked`), then a
    hollow ring per agent not started yet (phase `total` − `started`, when the total is known);
    12 at most, then "+n".
  - a line into **outcome**: a full-width node: icon, "outcome" (`dim`), the state word in its
    colour and "· $6.85 so far" (running) or "· $6.85 · 14m" (done; the time is the stages'
    workflow's run time) in `muted`. With a plan a second line: "2 of 8 pass" (`muted`) and a
    4px bar with one segment per task in plan order, in its look (pending `raised`, running
    pulsing).
  - **Workflows (n)**: a section label (11px, medium, `dim`) and at most 4 workflows:
    - running: a marching `working` arrow, the name (`foreground`), "· <current phase>" (`dim`),
      the elapsed time and the cost (`muted`, 52px, right-aligned). Under it, indented 26px, one
      20px row per agent of the current phase and of every phase with a failed agent: icon,
      label, the last tool for running agents (`dim`), tokens used ("1.8M tok") and cost.
    - finished: one `dim` line with its icon: "docs-review · 4m · $1.38", or
      "dependency-audit · failed" (killed, stale and failed show their status word).
  - **Subagents (n)**: at most 6 rows, 22px: icon, type (`dim`, at most 96px), description
    (`muted` while running, else `dim`) and the elapsed time (`working` while running).
  - **Workers (n)**: at most 8 `nc delegate` workers, running first, 22px rows: icon, role (`dim`,
    at most 70px), model without "openrouter/" (`muted` while running, else `dim`), then while
    running the last tool, tokens and cost; when stopped the status word in its look (left out for
    "done"; "ended" means stopped but not collected yet) and the cost when known; the elapsed time
    (`working` while running). A failed worker's reason is the row's tooltip. A "peek" button shows
    when a terminal named like the worker's task id exists.
  - **Shells (n)**: the session's background shells (Bash `run_in_background`) not reported
    finished yet: spinner, description (`muted`), elapsed time (`working`).
- **Window** ("pipeline ↗"): a Herdr window 760×680 with the key `nc-orchestrator-window`, a
  `chrome` background and a "✕" in the header. Everything is 1.25× larger. A plan shows whole:
  phases as rows, lanes always as columns, every task expanded (with its "after: B1" line),
  chips not clickable. Every listed workflow (up to 8) opens every agent, with its phase title;
  every subagent (up to 8) shows its cost too.

## How it behaves

- **Motion**, all native (AGENTS.md, "Animate natively, never with a timer"); it runs without
  the script, only while drawn, and only on running things. Nothing done or pending moves:
  - pulse ring: a 1px `working` ring 3px outside a running node (main, the taken branch,
    outcome), `.loop("opacity", 0.25 → 1, 1400 ms)`;
  - scanner: a 2×6 `working` bar on every running line, `.loop("top", 0 → H − 6, 900 ms)`;
    every line that carries one is at least 14px tall (8px of travel); the 4px stubs beside
    the stage icons carry none;
  - shimmer: an 18px `working` highlight at 45% on the running stage's bar,
    `.loop("left", 0 → 110 − 18, 1600 ms)`;
  - pulsing dots: running agents and the chip's dot, `.loop("opacity", 0.3 → 1, 900 ms)`;
  - marching arrow: the running workflow, `.frames(["›  ", "›› ", "›››", " ››", "  ›", "   "], 140)`;
  - spinners: running icons, `svg(spinner).spin(900)` (running, review and redo tasks too);
  - running segments of the plan bar, `.loop("opacity", 0.3 → 1, 900 ms)`;
  - progress fills glide to a new width over 600 ms when the data changes (`.transition("width")`).
- **Stage data**: a stage is matched to its workflow by title: the first workflow whose phases
  contain every stage title. Its agents with that phase give the dots and the elapsed time
  (earliest start to latest end, or to now while one runs). A skill's own stage titles that no
  workflow has show the bars and counts, but no dots or times.
- **Which session it follows**: Claude Code agents in the active space
  (`app === "claude-code"` or `program.key === "claude"`). A focused one wins. Otherwise it
  keeps the one it already follows while that one is still there; with none, it takes the
  highest `seq`. This is the same rule as nc-session and nc-folders (code duplicated).
- **Which machine**: the space's `machine`, else the part of the address before a "/";
  none means this machine. This is the same rule as nc-session.
- **The pid**: `hc get <address> --json` gives `foreground.pid`. Locally it is used only when
  the basename of `foreground.argv[0]` is `claude`. On another machine `hc get <id> --json` runs
  there through its login shell (`sh -lc`), with the address minus the "<machine>/" prefix, and
  any foreground pid is used: claude itself, or else perhaps an isolated session (below).
  A failed `hc get` there shows its last stderr line. The pid is cached per address and
  dropped when the feed answers `no-session`, exits non-zero or `exec` rejects (timeout,
  machine unreachable), for example after Claude restarted. A terminal without claude in
  front is asked again only on the 15 s interval or when its status changes.
- **Another machine**: the feed runs there as `python3 -I -B -c <usage.py> --orch …`, with
  usage.py read once from the nc-session folder and sent along as one argument, the same
  path as nc-session. When the foreground there is not `claude` (an isolated nc-work session),
  it runs `nc-work feed --pid <pid> --script=<usage.py> --orch --since=<sig>` there through the
  login shell instead (25 s). Its answer `"error": "not-isolated"` shows "This terminal is not
  running claude right now" and drops the cached pid, like nc-session.
- **Approve plan**: first `hc get <address> --json`; only when its `status.state` is `idle` or
  `done` (a finished turn nobody looked at yet) it runs `hc send --json <address> ok`. On another
  machine both go through `sh -lc 'exec "$@"' sh hc …` (10 s each, the address minus the
  "<machine>/" prefix). `hc send --if` is not used: it knows only `idle` and `working`, and
  Claude Code is `done` right after showing the plan. Another state shows "not idle (<state>)";
  exit 0 is "sent"; anything else "error: <message>" (from the JSON error, else stderr). Each copy
  (card, window) has its own button and blocks a second click while its send runs. "ok" is
  what the orchestrator's procedure waits for as approval.
- **Toasts**: only the card copy (not the window) posts `notify()` when, between two loads, a
  task turns fail, conflict or blocked ("Task C1: fail", level error; body: the task title and, on a
  second line, its evidence, which Herdr after 0.1.16 shows in full), or the plan's state turns
  `awaiting_approval` (warning), `done` (success) or `error` (error). Once per transition. The
  first load of a session only records what is there, so nothing already shown toasts.
- **Peek a worker**: "peek" (a task's details or a Workers row) runs `terminal.peek { terminal: <address> }` for the terminal in
  `terminals()` whose `name` equals the task's delegate id or the worker's task id.
- **Refresh**: one `cx.timer.every(3000)`, for data only:
  - it runs the feed on every tick while the followed agent is `working`, the session is
    `busy`, a workflow or a worker is `running` or a background shell is open; otherwise once every 15 s;
  - it skips a tick while the last run is still going;
  - each tick reads the followed agent live (`spaces()`/`agents()`), because a hidden copy
    keeps ticking without rendering; a tick does nothing when that agent is gone or not the
    one the last render followed;
  - a change of the followed address or its status (seen in `render`) runs it at once;
  - it passes the last `sig` as `--since`, so an unchanged session costs one Python start
    and the card keeps what it has.
  - Times shown (ages, elapsed) are computed at render, so they step with the refresh, not
    every second.
- **Empty and error states**, one `dim` line under the header (the chip says "idle"):
  - "No Claude session in this space"
  - "Loading…"
  - "No Claude session file for this terminal" (feed `no-session`)
  - "No transcript yet" (feed `no-transcript`)
  - "Claude is not the terminal's foreground process"
  - "This terminal is not running claude right now" (`nc-work feed`: `not-isolated`)
  - "Feed missing: deploy mods/nc-session"
  - otherwise the last stderr line. A failure while data is already shown keeps the data and
    adds the error as a last line.
- **Clicks**: "pipeline ↗" opens the window, and "✕" closes it. A task chip in the card
  expands or closes it. "Approve plan" and "peek" act. In the window, "✕", "Approve plan" and
  "peek" stop the mouse-down's propagation, so they don't drag it; a press anywhere else drags it.
- **Demo**: with `"props": { "demo": true }` on the block, the card shows the made-up session
  in `fixture.js` with a running plan (task A2 expanded) and runs nothing. `"demo": "approval"`
  shows the same plan awaiting approval with the session idle (the button answers "demo: nothing
  sent"); `"demo": "closing"` shows the same plan in its closing state on crew "pair";
  `"demo": "derived"` shows the derived flow with stages. The window opened from it
  shows the same demo.

## Built from

- **Files**:
  - `mod.json`: `{ "place": "none", "title": "Orchestrator" }`.
  - `main.js`: the view. Helpers at the top: the state tables (`KIND`, `LOOKS`, `look`),
    `icon`, `pulseRing`, `node`, `connector`, `rail`, `fork`, `agentDots`, `stage`, `stages`,
    `chip`, `PLAN_STATE`, `tasksOf`, `badge`, `remoteId`, `noDrag`. Methods `plan`,
    `approveRow`, `task`, `details` draw the plan; `announce` posts the toasts, `approve` sends.
  - `fixture.js`: the demo data, in the feed's shape, in four variants (plan, approval, closing, derived).
  - `spinner.svg`: an unchanged copy of Herdr's `mods/workspace-chrome/spinner.svg`
    (Apache-2.0, Herdr app 0.1.15 and 0.1.16), referenced as `mods/nc-orchestrator/spinner.svg`.
- **In the layout**: the `rail-orchestrator` block of `layouts/nc.json`, props `{ "card": "rail-orchestrator" }`.
  The header ends in a ✕ that hides the card (`layout.hide` with the `card` prop, its block id); the `nc-cards` bar shows it again.
  The window copy has no `card` prop and no ✕.
- **herdr**: `spaces()`, `agents()`, `terminals()` (the worker to peek), `hc()`, `exec()` (with
  `on` for another machine), `notify()` (toasts), `run("terminal.peek")`, `run("layout.hide")`,
  `readTextFile()` (usage.py, for another machine), `appHome()`, `theme()`, `props()`,
  `settings()` (`font_family`, for the mono prompt and arrow; "JetBrains Mono" without it),
  `openOverlay({ kind: "window", key: "nc-orchestrator-window", width: 760, height: 680,
  props: { window: true, demo } })`, `closeOverlay()`.
- **gpui-kit**: `.loop` (opacity, top, left), `.frames`, `.spin`, `.transition` (width),
  `.tooltip` (crew reason, musts), `.on_size_change` (lanes stack below 420px).
- **What it runs**, and nothing else:
  - `hc get <address> --json`, once per followed terminal, to get the pid.
  - `/usr/bin/python3 -I -B <appHome>/mods/nc-session/usage.py --orch --pid <pid> --since <sig>`
    with a 20,000 ms timeout. The feed belongs to the nc-session mod, and this mod has no
    helper of its own.
  - On another machine instead: `sh -lc 'exec "$@"' sh hc get <id> --json` (10,000 ms) and
    `/usr/bin/python3 -I -B -c <usage.py> --orch --pid <pid> --since <sig>` (20,000 ms), both
    through `exec(…, { on: <machine> })`; for an isolated session
    `sh -lc 'exec "$@"' sh nc-work feed --pid <pid> --script=<usage.py> --orch --since=<sig>`
    (25,000 ms) instead of the python3 call.
  - Only on a click on "Approve plan": `hc get <address> --json`, then `hc send --json <address> ok`,
    or on another machine both through `sh -lc 'exec "$@"' sh hc …` (10,000 ms each).
  - Only on a click on "peek": the Herdr command `terminal.peek`.
  - `notify()` on the transitions above (card copy only).
- **What it reads**: the mod reads `<appHome>/mods/nc-session/usage.py` once, only to send it
  to another machine. Through the feed, read-only (on the session's machine):
  - `~/.claude/sessions/<pid>.json`
  - `~/.claude/projects/<cwd encoded>/<sessionId>.jsonl` and that session's `workflows/` and
    `subagents/` folders
  - `~/.claude/nc-orchestrator/<sessionId>.json` (see below)
  - for each worker the main transcript started (the JSON lines `nc delegate` prints):
    `~/.nc/delegate/<task id>/request.json`, `result.json`, `status.json` and, from
    `events.jsonl`, only event types, tool names, tokens and cost
- **Network**: none. **Writes**: no files. The only thing it types anywhere is "ok" into the
  followed agent, and only on a click on "Approve plan".

### The feed's `--orch` output (what the card reads)

```
{ "v": 1, "unchanged": false, "sig": "...", "error": null,        // null | "no-session" | "no-transcript"
  "session": { "id", "cwd", "status": "busy|idle|null", "model", "label", "started", "elapsed_s",
               "agents_running", "shells_running", "tokens", "usd" },
  "flow": { "source": "derived|skill|plan", "prompt", "routes": [...], "route",
            "reason": null | "...", "state": null | "planning|awaiting_approval|running|closing|done|error",
            "steps": [ { "title", "status": "done|running|pending|error", "done", "total" } ],
            "outcome": { "status": "working|done|error", "usd" },
            "plan": null | { "musts": [ { "id", "text" } ],
                             "phases": [ { "name", "lanes": [ { "id", "tasks": [ TASK ] } ] } ],
                             "counts": { "total", "pass", "fail", "running", "pending", "other" } } },
  "workflows": [ { "id", "name", "status": "running|completed|killed|failed|stale", "started", "ended",
                   "phases": [...], "agents": [ { "id", "label", "phase", "status", "model", "tokens",
                   "cost_usd", "tools", "last_tool", "started", "last_activity", "ended" } ],
                   "totals": { "agents", "cost_usd", "tools" } } ],
  "subagents": [ { "id", "type", "description", "status", "model", "cost_usd", "tools", "started", "ended" } ],
  "workers": [ { "id", "role", "model", "status": "running|ended|done|failed|cannot_complete|requires_user_auth|…",
                 "started", "ended", "cost_usd", "tokens", "tools", "last_tool", "reason" } ],
  "shells": [ { "id", "description", "started" } ],
  "scan_ms": 0 }

TASK = { "id", "title", "role", "status": "pending|running|review|redo|pass|fail|blocked|conflict",
         "files": [...], "proof", "after": [...], "musts": [...], "redos", "branch", "delegate", "review",
         "answers": { "M1": "kept|broken" }, "evidence",
         "agent": null | { "id", "status", "tools", "cost_usd", "started", "ended" } }
```

- `error` can also be `"not-isolated"` from `nc-work feed` (no isolated session behind that pid).

- Times are epoch ms. Agent `tokens` are the tokens it used (input, output, cache read and
  cache write summed), not its context size.
- With `"unchanged": true` only `v` and `sig` come, and the card keeps its data.
- The derived flow:
  - **prompt**: the latest typed prompt of the main transcript.
  - **crew** (`route`, one of `routes` = one, pair, team): `team` if, after that prompt, a
    Workflow ran, an Agent/Task call had isolation "worktree", or 2+ Agent/Task calls had
    subagent_type implementer or tester (an `nc delegate` worker counts as an Agent call with
    its role); else `pair` if an Agent/Task `subagent_type` contains
    "review"; else `one`.
  - **steps**: the phases of the newest workflow launched after the prompt.
  - **outcome**: `working` while the session is busy or a workflow, workflow agent,
    subagent or `nc delegate` worker is still running or a background shell is open (they go
    on after the main turn ends), else `done`. Its `usd` adds the known cost of the workers
    started after the prompt.
  - **workers**: status as `nc delegate --list` reads the run folder: `result.json`'s status once
    collected; else `running` until `status.json` exists or start + timeout + 180 s passed, then
    `ended`. Without a run folder (cleaned up, or a broker run elsewhere) the last status the
    transcript shows, turned `ended` after an `nc delegate --cleanup` line for it or 20 minutes.
  - **shells**: Bash calls with `run_in_background` in the main transcript without a
    `<task-notification>` for their tool use id; none when claude is no longer running.

### The v3 status file (the orchestrator's plan)

`nc orchestrator status` from [nc-harness](https://github.com/iAmSerathion/nc-harness) (optional) writes
`~/.claude/nc-orchestrator/<sessionId>.json` with `"v": 3`. The feed then sets `flow.source` to `"plan"`,
takes `flow.route` from its `crew` (one, pair or team) and reason and state from the file,
builds `flow.plan` (tasks with their linked subagent: the newest one whose
description starts with the task id and a space or ":"), one step per phase, and
`outcome.status` from the state (`done`, `error`, else `working`). Other versions
are ignored and the derived flow shows. The card only reads it.

### Driving the diagram from your own skill: the v1 status file

A skill (or anything else) can replace the derived flow by writing
`~/.claude/nc-orchestrator/<sessionId>.json`. `<sessionId>` is the session's UUID: the
`sessionId` in `~/.claude/sessions/<pid>.json`, which is also the main transcript's file
name.

```json
{
  "v": 1,
  "prompt": "Ship the billing export",
  "routes": ["plan", "build", "ship"],
  "route": "build",
  "steps": [
    { "title": "spec",   "status": "done",    "done": 1, "total": 1 },
    { "title": "build",  "status": "running", "done": 2, "total": 4 },
    { "title": "verify", "status": "pending", "done": 0, "total": null }
  ],
  "outcome": { "status": "working", "usd": 3.1 }
}
```

- The file counts only if it parses as JSON, has `"v": 1` and was modified less than 6 hours
  ago. Otherwise the derived flow shows.
- Every key apart from `v` is optional. Each one replaces only its derived counterpart, so
  `{ "v": 1, "route": "build" }` changes just the route.
- `routes`: any number of names. They are drawn side by side in equal cells; 2 to 4 fit the
  card.
- `route`: the box with this name lights up. A name that isn't in `routes` lights nothing,
  but the crew node still shows it.
- `steps[].status`: `done | running | pending | error`. `total` may be `null`.
- `outcome.status`: `working | done | error`. `outcome.usd` is a number. The key replaces
  the derived `outcome` as a whole, so an outcome without `usd` shows no cost.
- When the file is used, `flow.source` is `"skill"` and the crew node shows a "skill" badge.
  The file's `routes` and `route` stay free names; the derived names are one, pair, team.
  Workflows, subagents and the main node always come from the transcripts.
- Write it atomically (to a temp file, then rename), so a half-written file is never read.
  Neither this mod nor the feed ever writes or deletes it; delete it yourself to return to
  the derived flow.

## Watch out

- The feed is `mods/nc-session/usage.py`. Without nc-session deployed, the card says "Feed
  missing".
- `herdr-app check` renders with `props()` null and no agents, so it only covers the empty
  state. To check the filled card, run the check on a temporary copy outside the repo and
  outside `~/.config/herdr-app` whose `props()` returns `{ demo: true }` (also `{ demo:
  "approval" }`, `{ demo: "closing" }`, `{ demo: "derived" }`, and `{ demo: true, window: true, overlay: "x" }` for the
  window); add `--print-spec` to see every `:loop`, `:frames`, `:spin`, `:transition` and
  `:tooltip` it built. Delete the copy afterwards. The check has no size and no terminals, so
  lanes render side by side and "peek" is hidden there.
- Task ids and must ids can look alike (a lane M task "M1" next to must "M1"): musts are
  always badges in the top row or in an expanded task, tasks are chips.
- Toasts come from the card copy only, so an open window does not double them. A hidden card
  keeps ticking and still toasts.
- "Approve plan" types "ok" into the followed agent. The `hc get` check right before refuses
  when the agent is working or blocked; between the check and the send there is a short window
  in which a new turn could start. hc send itself waits for a person's unfinished draft.
- Pulse rings sit 3px outside their node. Nothing between a running node and the scroll area
  may clip (`overflow_hidden`), and branch cells keep their 3px side padding for the ring.
- Theme tokens may carry alpha (`#rrggbbaa`). The done border appends `8c` (~55%) only to
  7-character colours; others are used as they are.
- The fork's rail is made of half-cells of the same equal cells the branches sit in, with no
  `gap`, so the drops and the stem meet the rail on the cell centres. The stage rail lines up
  because stage rows and the rows between them share the 14px icon column and the 8px gap.
- The shimmer runs over the whole bar, so it shows on the empty part and blends into the
  running fill (same colour).
- Each running element runs its own native loop at about 30 fps while visible. They stop when
  the card is hidden or nothing runs. Never animate with `cx.timer`.
- The card and an open window are two copies, and each runs the feed. There is no shared
  module-level cache (the module scope is shared by copies since 0.1.14, so it was left out).
- Timers keep running while the block is hidden. They stay cheap: 15 s when nothing runs,
  and `--since` keeps unchanged runs short.
- On another machine every refresh sends usage.py (about 45 KB) as one argument. Linux caps one
  argument at 128 KB; usage.py must stay below that (the same limit as nc-session).
- Another machine needs `/usr/bin/python3`. Isolated sessions need an `nc-work` command whose
  `feed` passes `--orch` through; an older one fails with its own error line.
- Costs are estimates at API list price, not what a subscription is charged.
- The prompt line is user text. It shows on screen and in screenshots.
- The feed has no last activity for subagents; their rows show the elapsed time instead.
- At the narrowest rail (300px) the stage titles are truncated hard: the bar stays 110px.
- Caps: the feed sends at most 5 workflows (agents for the first 2), 8 subagents, 8 workers and
  6 shells; the card shows 4, 6, 8 and all.
- Workers in an nc-work container through the broker have no run folder on the session's
  machine: their rows show only what the transcript printed.

## Done when

- `herdr-app check mods/nc-orchestrator` prints `check passed`, and the null-props render
  says "No Claude session in this space" with the chip "idle".
- With `"props": { "demo": true }`, the card shows all of these:
  - the chip "running" with a pulsing dot;
  - the prompt in a mono pill after "›";
  - main "Opus 5.5 … 43:00 $31.42" and "working · 2 agents running · 48.2M tok", with a pulse
    ring and a scanner on the line into it;
  - "crew → team" (done border) with a "plan" badge and the reason as tooltip, the fork
    with "team" running (pulse ring) and "one" and "pair" dashed and "skipped";
  - the plan: chip "running", badges M1 and M2 with their texts as tooltips; "Phase 1 ·
    seam 2/2" with lanes A (A1 ✓, ⎇, "pass") and B (B1 ✓); "Phase 2 · build 0/6" with
    lanes A (A2 spinning with D, expanded: title, files, proof, after "A1", delegate "w-a2",
    agent "running · 9 tools · $0.31 · 2m"; A3 pending), B (B2 spinning with ⎇, B3 spinning
    with "↻1" and "findings:2") and C (C1 "!", C2 "!"); a click on another chip expands it
    instead (C1 shows "M2 ✗" and its evidence);
  - outcome "working · $6.85 so far" with a pulse ring and "2 of 8 pass" with an 8-segment bar
    (2 done, 3 pulsing, 2 failed, 1 empty);
  - workflows: rate-limit with the marching arrow and "· build", and its 3 build agents (✓,
    spinning with "Edit", "!"); "docs-review · 4m · $1.38" (✓) and "dependency-audit · failed" (!);
  - 4 subagent rows: Explore spinning, code-reviewer ✓ and dim, the two task agents.
- With `"demo": "approval"`: chip "awaiting approval", the "Approve plan" button; a click shows
  "demo: nothing sent". With `"demo": "closing"`: chip "closing", "crew → pair" with "one"
  and "team" dashed and "skipped". With `"demo": "derived"`: "crew → team" without a badge, and
  the stages: research ✓ 3/3 with a full green bar; build spinning 1/3 with a shimmering bar,
  the rail into it scanning, and three dots (done, pulsing, failed); review 0/2 with a dashed
  rail segment and an empty bar.
- Nothing finished or pending moves; every running piece does.
- With Claude Code working in the active space, the card fills within about 3 s, the
  elapsed time and the tokens grow, and a status change refreshes it at once. The same holds
  for a Claude Code session in a space on another machine (for example a remote server).
- Running a Workflow switches the crew to "team" and fills the stages; when a stage
  finishes, its bar glides full and the scanner moves on to the next one. An Agent call with
  a review `subagent_type` and no Workflow switches the crew to "pair".
- A valid v1 status file for the session shows its routes, steps and outcome, and the "skill"
  badge. Deleting it returns the derived flow on the next refresh.
- A v3 status file with crew `team` and a plan awaiting approval shows the plan with
  "awaiting approval", a warning toast, and (with the agent idle) "Approve plan"; a click types
  "ok" and shows "sent", or "not idle" while the agent works. A task set to `fail` toasts once;
  a `running` task with `delegate` set to `<name>` shows "D" and, with a terminal of that name,
  "peek" opens it. State `done` toasts "Orchestrator done". Opening the card on a plan that already has failed
  tasks posts no toast.
- On another machine, an isolated nc-work session shows its flow through `nc-work feed --orch`.
- "pipeline ↗" opens the 760×680 window with the whole plan expanded and every agent of every
  listed workflow, and "✕" closes it.
