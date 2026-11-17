# nc-agents

Herdr's shipped Agents list (0.1.16) with one row added on top: four counts, how many
agents need you, are done, are working and are idle, each with the same status glyph the
list uses. Below it the list is unchanged: agents by priority or grouped by space, with
their sub-agents as a tree. No preview.png: screenshots of this setup show private data.

## What you see

- Header, 41px: "Agents" in 11.5px `dim`, a sort icon on the right (clock: priority,
  layers: grouped by space).
- Count row (new), 11px, 16px side padding, 12px between items, in this order:
  - needs you: a 14px `blocked` "!" badge on a 15%-alpha `blocked` square
  - done: a 7px dot in `done`
  - working: the 12px spinner in `working`, turning
  - idle: a 7px ring in `idle` (or `dim`)
  - each glyph followed by its count in `foreground`. A zero count is drawn at 45% opacity
    with the number in `dim`; a zero working count shows the spinner standing still in `dim`.
- The list: section headers ("Needs you", "Done", "Working", "Idle" in their colours with a
  count, or space names when grouped), then 30px agent rows: program icon, name (and
  "· detail" in `dim`), machine name for remote agents, fold chevron when it has
  sub-agents, time since its state changed (e.g. "4m") and its status glyph. A blocked
  agent shows a "Needs you" pill instead of the badge outside the priority sections.
  Sub-agents hang under their parent as 26px rows with tree lines.
- No agents: "No agent status yet. …" under the count row (all four counts dim).
- Narrow sidebar (under 160px): numbered 26px rows with a status glyph and a » button that
  widens the sidebar again; the count row is hidden there.

## How it behaves

- Statuses: blocked (needs you) > done > working > idle. Each top-level agent is counted
  once, by its most urgent own or sub-agent status, so the counts equal the numbers on the
  priority section headers. Pinned agents count too. Unknown statuses count as idle.
- Click a row: `pane.focus` on its pane. Click a sub-agent: `pane.focus` if it has a pane,
  else `terminal.peek`. Click the program icon or chevron: fold the sub-agent tree.
- Hover a row: a pin button replaces the time; click it for `terminal.pin` (pinned rows
  go to a "Pinned" group on top).
- Click a section header: fold it. Click the sort icon: a 200×140 popup (this mod again,
  props `{sortMenu: true}`) to choose Priority or Grouped by space.
- Hover a count: tooltip "Needs you: 2" (the same text is its accessibility label).
- Every render calls `setAgentOrder` with the shown order, so `agent.next` / `agent.prev`
  follow this list. Times refresh every 30 s.
- Dock badge: the "Needs you" count (agents whose most urgent own or sub-agent status is
  blocked, each counted once by address; a sub-agent with a row of its own counts only
  through its parent) goes on the app's Dock icon with `setBadge`, also while the sidebar
  is narrow; no badge at zero. It is set only when the count changes, and cleared when the main copy
  closes.

## Built from

- Clone of Herdr's shipped `agents` mod 0.1.16 (Apache-2.0; `scripts/fetch-upstream 0.1.16` puts it in `local/upstream/herdr-app-0.1.16/mods/agents`),
  `mod.json` `{ "place": "none", "title": "Agents", "cloned_from": { "name": "agents", "version": "0.1.16" } }`.
- Layout props `{ "card": "agents" }` (its block id): the header ends in a ✕ that runs `layout.hide`
  with it; the `nc-cards` bar shows the card again. Not in the narrow rail.
- Reads: `agents()`, `terminals()`, `panes()`, `focused()`, `spaces()`, `layout()`
  (sidebar width), `window()`, `theme()`, `props()`, `shared("agents.sort")`,
  `shared("sidebar.width")`.
- Writes: `setShared("agents.sort")`, and from the » button `setShared("sidebar.width")`
  and `setShared("sidebar.collapsed")`; localStorage `changed` (when each agent's state
  last changed) and `pins` (old pins waiting to move to `terminal.pin`).
- Calls: `setAgentOrder`, `setBadge`, `pane.focus`, `terminal.peek`, `terminal.pin`, `layout.resize`,
  `layout.hide` (the ✕), `openOverlay({ mod: "nc-agents" })`, `closeOverlay`.
- Runs no programs and reads no files; one `cx.timer.every(30000)` to redraw the times.
- Art: the shipped `mods/workspace-chrome/*.svg` icons (spinner, chevrons, pin, sort icons, check).

## Watch out

- Diff against upstream, nothing else besides the licence header in line 1 (keep it this small
  so `git merge-file` stays easy):
  1. New method `counts(t, list, rankOf)` after `status()`: the count row.
  2. `render()`: one added line `.when(!collapsed, (el) => el.child(this.counts(t, list, rankOf)))`
     right after the header, before the "No agent status yet" text.
  3. The sort button opens `openOverlay({ mod: "nc-agents", … })` instead of `"agents"`:
     a self-opening overlay must name the clone, as `mod.clone` would rewrite it.
  4. A `hideCard` const after the imports: the ✕ that hides the card (`layout.hide`).
  5. The header row: `.gap(10)` instead of `.justify_between()`, and the "Agents" title
     gets `.flex_1()`, so the sort icon and the ✕ sit on the right.
  6. The header ends in `.when(Boolean(props()?.card), (el) => el.child(hideCard(t, props().card)))`.
  7. Dock badge: `setBadge` in the `herdr` import, an `async close()` after `init()` that
     clears it (the sort menu returns first: it is an overlay of this mod and closes after
     every pick), and three lines in `render()` after `setAgentOrder` that count the
     "Needs you" agents and call `setBadge` when the count changes.
- No `mods/agents/` asset paths exist; the icons are `workspace-chrome`'s and stay.
- Kept from upstream: Herdr's shared keys `agents.sort`, `sidebar.width`,
  `sidebar.collapsed` (the sort choice is shared with the shipped Agents list), and the
  `t.blocked + "26"` alpha suffix on a theme token (no hex literal).
- localStorage is per mod, so the clone starts without the shipped list's state-change
  times: the "4m" times begin at the first render of nc-agents.
- The Dock badge is updated in `render()` only (no polling of `agents()`): while the card is
  hidden (✕) the badge may keep its last count until the card shows again, and `close()`
  does not run for a hidden copy.
- Show only one agents list per layout: each one calls `setAgentOrder`, and the last
  render wins.
- A clone gets no Herdr fixes. Merge new versions with `git merge-file` (see README).

## Done when

- `herdr-app check mods/nc-agents` prints "check passed" (renders with no agents and
  null props: count row with four dim zeros).
- `git diff --no-index local/upstream/herdr-app-0.1.16/mods/agents/main.js mods/nc-agents/main.js`
  shows only the lines listed under Watch out.
- In the app: with one agent working and one waiting for input, the row reads
  "! 1  ● 0  ⟳ 1  ○ 0" with the done and idle items dim and the spinner turning.
- The sort icon opens the Priority / Grouped popup, and choosing one re-sorts the list.
- `agent.next` steps through agents in the order shown.
