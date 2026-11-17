# nc-servers

A small card in the right rail that lists the dev servers running in your project folders:
every TCP port something on this computer listens on, as long as that program was started
inside a local space folder or a pane's current folder. A green dot means it answers HTTP;
click a row to open it in the browser. No preview.png: screenshots of this setup show
private data.

## What you see

- Header, `px 14`, `pt 12`, `pb 4`: "Active servers" in 11.5px medium `dim`; on the right,
  the number of rows in 11.5px `dim` (hidden when there are none).
- One row per server, 24px high, 6px corner radius, `px 6`, 8px gap, 12.5px text:
  - a 7px round dot: `done` when the port answered HTTP, `dim` when it only takes TCP;
  - the port, semibold `foreground`;
  - the program name as lsof reports it (`node`, `Python`, …) in `muted`, at most 45% wide;
  - the basename of the program's folder in `dim`, truncated.
  Rows are sorted by port and scroll when the card is short. Hover: `hover` background.
  Tooltip: the URL.
- No match: "No dev servers in your project folders" in 12px `dim`. Before the first look:
  "Looking for servers…". If lsof cannot run: its error line instead.
- No background of its own: the layout block's `background` (rail cards use `chrome`) shows.

## How it behaves

- Looks every 10 s and once at start. A look that is still running makes the next tick skip.
- A new server shows within 10 s; a stopped one disappears on the next look.
- Which folders count is decided again on every render, so when a pane changes folder the
  list follows at once (a newly matching server gets its HTTP probe on the next look).
- Click a row: opens `http://<host>:<port>/` with the system browser. Wildcard listeners
  (`*`, `0.0.0.0`, `[::]`) use `localhost`.
- Agent status plays no part here.

## Built from

- Own code (no shipped or third-party mod copied). Files: `mod.json`
  `{ "place": "none", "title": "Servers" }`, `main.js` (the view and the polling),
  `parse.js` (pure helpers: lsof parsing, project folders, URL; no `herdr` import so they can
  be tested outside Herdr).
- Layout: a block in the rail, `{ "mod": "nc-servers", "props": { "card": "rail-servers" } }`.
  The header ends in a ✕ that hides the card (`layout.hide` with the `card` prop, its block id); the `nc-cards` bar shows it again.
- Reads: `spaces()` (local spaces' `folder`), `panes()` (each pane's `cwd`; remote ones, whose
  tab id has a `machine/` prefix, are skipped), `home()`, `theme()`, `props()` (the `card` id).
- Runs, every exec with an explicit timeout:
  - `/usr/sbin/lsof -nP -iTCP -sTCP:LISTEN -Fpcn` (5 s): pid, program and `host:port` of every
    listening TCP socket. Exit code 1 means none.
  - `/usr/sbin/lsof -a -d cwd -Fpn -p <pid,pid,…>` (5 s): the folder of each listener, only for
    pids not seen before (cached per pid while it keeps listening).
  - `/usr/bin/curl -s -o /dev/null -m 1 -w %{http_code} http://<host>:<port>/` (3 s), in
    parallel, only for listeners inside a project folder. Any 1xx-5xx code counts as HTTP.
    `curl` rather than `fetch()`, because `fetch()` has no timeout.
  - `/usr/bin/open <url>` (5 s) on a click.
- One Herdr command, `layout.hide` from the ✕. Reaches the network only through the local HTTP probe.

## Watch out

- A folder counts when the listener's folder is the project folder or below it (with a `/`
  boundary: `/p/app` does not match `/p/ap`). Home and `/` never count, so the many system
  and app listeners started from home stay hidden. Today all spaces have home as their
  folder, so in practice pane folders decide.
- lsof reports real paths (`/private/tmp/…`); a pane folder given through a symlink
  (`/tmp/…`) does not match it.
- IPv4 and IPv6 sockets of one pid and port show as one row; one program on two ports shows
  two rows (for example a dev server and its websocket port).
- The HTTP probe is tried up to 3 times per pid and port (one per look), not once: a dev
  server compiling its first page can take longer than curl's 1 s. After 3 failures it stays
  `dim` without being asked again, so TCP-only services (databases) are not hit every 10 s.
- Timers keep running while the card is hidden; a look is one or two lsof calls, plus curl only for
  project listeners not settled yet.
- Remote machines are out of scope: only this computer's listeners.
- State (listeners, folders, probe results, busy flag) lives in the class, one per copy.

## Done when

- `herdr-app check mods/nc-servers` prints "check passed" (first render shows "Looking for
  servers…").
- Start `python3 -m http.server 8765` in a folder that is a space folder or a pane's current
  folder: within 10 s a row "8765 Python <folder>" with a `done` dot appears; clicking it
  opens the directory listing. Stop it: the row goes on the next look.
- With no server in a project folder the card says "No dev servers in your project
  folders", even though other programs listen on this computer.
