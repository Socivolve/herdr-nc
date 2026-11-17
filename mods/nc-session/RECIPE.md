# Session

Two rail cards about the Claude Code session that the active space is running. "Usage by model"
shows what the session has cost so far at API list price, split by model, with the main agent
and its subagents shown apart. "Used in this session" shows which tools, skills and connectors it
called and which files it edited and read. There is no `preview.png`, because a live screenshot would
show your own prompts and files.

## What you see

- **One mod, two cards.** `props.view` is `"usage"` or `"used"`. With null props (how
  `herdr-app check` renders), both are stacked with a 1 px `border` line between them. The mod
  paints no background of its own. The layout's card supplies `chrome`, the 1 px `border` and
  radius 10.
- **Usage card:**
  - **Header row:** "Usage by model" on the left (11.5 px, medium, `dim`). "≈ $58.70" on the
    right (13 px, semibold, `foreground`), with " + ?" added when a model has no price.
  - **Subline** (11 px, `dim`): "API list price · not your plan · prices 2026-11-03". The date
    comes from the feed.
  - **One row per model**, sorted by USD with unpriced models last:
    - the label in 72 px ("Opus 5.5")
    - a cost-share bar: 6 px high, radius 3, `raised` track, `accent` fill, width = the model's
      USD / total USD
    - total tokens, compact ("121.7M"), 52 px, `muted`, right-aligned
    - USD, 64 px, right-aligned, "?" when the model is unpriced
  - **Under each model row**, 11 px `dim`: `in 1.7K · out 871.8K · cache read 117.7M · cache write 3.1M`.
    Cache write is 5-minute plus 1-hour writes. The model list scrolls.
  - **Footer** above a `border` line, 11 px `dim`: "main $15.72 · subagents $42.98 (19)". The
    number in brackets counts subagent transcript files.
- **Used card:**
  - **Header:** "Used in this session".
  - **Chip groups** "Tools", "Skills" and "Connectors":
    - Each group has an 11 px `dim` label and is left out when empty.
    - A chip is 20 px high with radius 5 on `raised`: the name, then the count in `dim`.
    - Each group shows at most 10 chips, then a `dim` "+N".
  - **"Edited (N)" and "Read (N)" lists:** each scrolls on its own, newest first. A row is 20 px:
    the file name in `foreground`, then its folder in `dim`, and the full path as a tooltip.
    Paths are relative to the session's folder, else `~/…`.
- **Demo:** `props: { demo: true }` draws the made-up payload in `fixture.js` and runs nothing. Use
  it to look at the design.

## How it behaves

- **Which agent it follows:** one Claude Code agent of the active space. Candidates are
  `agents()` with `app === "claude-code"` or `program.key === "claude"` whose space or tab
  belongs to the active space. A focused candidate wins. Otherwise the current one stays, and
  with no current one the highest `seq` wins. nc-folders and nc-git use the same rule, with the
  code duplicated.
- **Agent status only sets how often it refreshes.** Nothing on the cards changes colour.
  - `working`: every 5 s.
  - `blocked`, `done` and `idle`: once at the change, then every 30 s, because background
    workflows keep spending while the main agent waits.
  - A new followed agent, or a new status, refreshes at once.
- **States, one `dim` line each:**
  - "No Claude Code agent in this space"
  - "This terminal is not running claude right now" (locally: `foreground.argv[0]` is not `claude`;
    on another machine: also not an isolated session, feed error `not-isolated`)
  - "No Claude session file for this agent" (feed error `no-session`)
  - "No transcript for this session yet" (`no-transcript`)
  - "Loading…"
  - otherwise the first line of the helper's stderr or of the exception
- **Interaction:** none besides scrolling and the path tooltips. No clicks and no keys.

## Built from

- **Files:**
  - `mod.json`: `{ "place": "none", "title": "Session" }`
  - `main.js`: the view
  - `fixture.js`: the demo payload
  - `usage.py`: the feed, Python 3.9 standard library only
- **Layout:** two blocks in the `rail` column, with `{ "mod": "nc-session", "props": { "view": "usage" } }`
  and `{ "view": "used" }`, each also with `card` (its block id).
  The header ends in a ✕ that hides the card (`layout.hide` with the `card` prop, its block id); the `nc-cards` bar shows it again.
- **`herdr` calls:** `agents()`, `spaces()`, `theme()`, `props()`, `hc()`, `exec()`, `appHome()`, `readTextFile()`,
  `cx.timer.every(5000)` and `cx.spawn`.
- **Theme tokens:** `foreground`, `muted`, `dim`, `raised`, `accent` and `border`. There is no hex
  in the code.
- **What it runs:**
  - `hc get <address> --json`, which gives `foreground.pid` and `foreground.argv[0]`. Each copy
    caches the pid per address and drops it on `no-session` or when the feed exits non-zero.
  - `/usr/bin/python3 -I -B <appHome()>/mods/nc-session/usage.py --pid <pid> --since <sig>`,
    with `timeout: 20000`. The mod checks `code === 0` before `JSON.parse`. `--since` is the
    last full answer's `sig` (empty at first). When nothing changed, the feed prints
    `{"v":1,"unchanged":true,"sig":…}` and the card keeps its data.
- **On another machine** (a space with a `machine`): every command goes through `exec(…, { on })`
  as an argument vector, so nothing is shell-quoted. `hc` and `nc-work` also go through that
  machine's login shell (`sh -lc 'exec "$@"' sh …`), so PATH has `~/.local/bin`:
  - `hc get <id> --json` there, with the `<machine>/` prefix of the address stripped. Ids other than
    `[A-Za-z0-9_.:-]` are refused before anything runs.
  - The foreground is `claude`: `/usr/bin/python3 -I -B -c <usage.py> --pid … --since …` there. The
    script text is read once per load with `readTextFile` and goes along as one argument (~45 KB).
  - Anything else: `nc-work feed --pid <pid> --script=<usage.py> --since=<sig>` there. That is
    `nc-work` from [nc-infra](https://github.com/iAmSerathion/nc-infra) (optional), for isolated sessions in a container: it finds
    the session from the terminal's process line and runs the script inside the container against
    the Claude process. Its answer is the same feed JSON, or `{"error": "not-isolated"}`.
  - A non-zero exit or `not-isolated`/`no-session` drops the cached target, so a Claude started
    later in the same terminal is found.
- **What it reads:** usage.py reads files under `~/.claude` (on the machine or in the container
  where the session runs); the mod itself reads only usage.py.
  - `~/.claude/sessions/<pid>.json` for `sessionId`, `cwd` and `status`. Never the `*.key` files.
  - The main transcript `~/.claude/projects/<cwd with [^A-Za-z0-9] as ->/<sessionId>.jsonl`,
    with a glob fallback.
  - The subagent transcripts `<project>/<sessionId>/subagents/**/agent-*.jsonl`.
  - In `--orch` mode only: the workflow end records, scripts and journals under
    `<project>/<sessionId>/`, and the status file described below.
- **What it calls and writes:** no network, and it writes no files.
- **One shared run:** a module-level `inflight` is the one deliberate exception to "state per
  copy in the class". While one copy's helper run is still going, the other copy asking for the
  same `pid|sig` awaits the same promise and redraws itself with its own `cx`.
- **The feed's usage mode** (the only mode this mod uses):
  - Top-level keys: `v`, `unchanged`, `sig`, `error` (`null | "no-session" | "no-transcript"`;
    on an error only `v`, `sig`, `error` and `session`), `session {id, cwd, status}`,
    `prices_as_of` and `scan_ms`.
  - `models[]`: `{model, label, messages, input, output, cache_read, cache_write_5m, cache_write_1h, usd}`.
    `usd` is null when the model is unpriced.
  - `parts`: `{main: {messages, usd}, sub: {messages, usd, files}}`.
  - `total`: `{messages, tokens, usd, unpriced[]}`.
  - `used`: `{tools, skills, connectors}` as `[name, count]` lists, plus `edited` and `read` as
    path lists.
  - The output holds only counts, model ids, names and file paths, never message text or file
    contents.
- **The feed's `--orch` mode** belongs to nc-orchestrator, which runs this same file with
  `--orch` added. It prints `session`, `flow`, `workflows` and `subagents`; usage.py's docstring
  has the exact contract. `flow.routes` is the crew sizes `["one", "pair", "team"]`.
  - **Derived crew** in `flow.route` (no status file): `team` if a Workflow ran, an Agent/Task call had
    `isolation: "worktree"`, or 2+ Agent/Task calls had `subagent_type` implementer or tester
    (after the latest prompt); else `pair` if a `subagent_type` contains `review`; else `one`.
  - **Status file** `~/.claude/nc-orchestrator/<sessionId>.json` counts only when it parses and
    was modified less than 6 hours ago. The feed never writes it.
  - **Version 3** is written by `nc orchestrator status` from nc-harness (optional).
    `flow.source` becomes `"plan"`; `flow.route` comes from the file's `crew`, `flow.reason` and
    `flow.state` from the file; `flow.plan` is `{musts, phases: [{name, lanes: [{id, tasks}]}], counts: {total,
    pass, fail, running, pending, other}}`, validated and capped as the writer's contract says
    (unknown task status becomes `pending`, max 8 phases, 6 lanes, 40 tasks). Each task gets
    `agent`: the newest subagent whose description starts with the task id and a space or `:`,
    as `{id, status, tools, cost_usd, started, ended}`, or null. `flow.steps` is one step per
    phase, and `flow.outcome.status` is `done`/`error` for those states, else `working`.
    Without a v3 file `flow.reason`, `flow.state` and `flow.plan` are null. Other versions
    are ignored.
  - **Version 1**, written by a skill or hook of your own, stays readable; `flow.source` becomes `"skill"`:
  ```
  { "v": 1,
    "prompt": "first line of the prompt",
    "routes": ["one", "pair", "team"],
    "route": "team",
    "steps": [ { "title": "research", "status": "done|running|pending|error", "done": 3, "total": 3 } ],
    "outcome": { "status": "working|done|error", "usd": 0.0 } }
  ```
    Every key besides `v` is optional, and each one present replaces the derived value.

## Watch out

- **Saving any file in this folder reloads both cards**, usage.py included. usage.py must never
  write here: it runs with `-B`, and any future cache belongs in `~/Library/Caches/nc-session`.
- **nc-orchestrator runs this folder's usage.py.** Renaming the folder or the file breaks that
  card too.
- **`herdr-app check` only covers the empty state.** It renders once with null props and no
  agents. The data path shows only with `demo: true` or in the app.
- **`hc()` takes no timeout.** If `hc get` hung, that copy would stop refreshing, because its busy
  flag only resets when the run ends.
- **The pid check is strict.** If `foreground.argv[0]` is not literally `claude` (a wrapped
  install that runs `node …`), the card says it is not running claude.
- **Costs are estimates** at API list price, not what the plan charges.
- **Other machines need `/usr/bin/python3`**, and for isolated sessions an `nc-work` command
  with `feed`. nc-orchestrator uses the same remote path, and `nc-work feed --orch` for isolated
  sessions.
- **The script goes as an argument.** Linux caps one argument at 128 KB; usage.py must stay below
  that, or the remote path needs a copy of the file on the machine instead.
- **Sharing and refresh:**
  - Only an in-flight run is shared between the two copies, never a recent answer: a cached
    answer would reach the refresh that a status change starts, and the final cost could then
    show up 30 s late.
  - While the agent is not working, the card still refreshes every 30 s.

## Done when

- `herdr-app check mods/nc-session` prints `check passed`.
- `/usr/bin/python3 -I -B mods/nc-session/usage.py --selftest` prints `selftest ok`.
- In the app, with a Claude agent in the active space, both rail cards fill within about 5 s,
  and "≈ $…" grows while the agent works.
- A space without a Claude agent shows "No Claude Code agent in this space" on both cards.
- With `props: { demo: true }`, the card shows Opus 5.5 first and "≈ $58.70 + ?".
