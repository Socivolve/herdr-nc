// Pure helpers for nc-servers (no herdr imports, so they can be tested outside Herdr).

// `lsof -nP -iTCP -sTCP:LISTEN -Fpcn` -> [{ pid, command, host, port }], one per pid:port.
export function parseListeners(out) {
  const list = [], seen = new Set();
  let pid = 0, command = "";
  for (const line of String(out ?? "").split("\n")) {
    const v = line.slice(1);
    if (line[0] === "p") { pid = Number(v); command = ""; }
    else if (line[0] === "c") command = v;
    else if (line[0] === "n" && pid) {
      const i = v.lastIndexOf(":"), port = Number(v.slice(i + 1)), key = `${pid}:${port}`;
      if (i < 0 || !port || seen.has(key)) continue; // IPv4 and IPv6 of one port show once
      seen.add(key);
      list.push({ pid, command, host: v.slice(0, i), port });
    }
  }
  return list.sort((a, b) => a.port - b.port);
}

// `lsof -a -d cwd -Fpn -p <pids>` -> Map pid -> cwd.
export function parseCwds(out) {
  const cwd = new Map();
  let pid = 0;
  for (const line of String(out ?? "").split("\n")) {
    if (line[0] === "p") pid = Number(line.slice(1));
    else if (line[0] === "n" && pid) cwd.set(pid, line.slice(1));
  }
  return cwd;
}

// Project folders: local space folders and pane cwds, never home or "/".
export function projectRoots(spaces, panes, home) {
  const norm = (p) => String(p ?? "").replace(/\/+$/, "");
  const all = [
    ...(spaces ?? []).filter((s) => !s.machine).map((s) => s.folder),
    ...(panes ?? []).filter((p) => !String(p.tab ?? "").includes("/")).map((p) => p.cwd), // remote ids carry "machine/"
  ].map(norm);
  return [...new Set(all)].filter((r) => r.startsWith("/") && r !== norm(home));
}

export const under = (dir, roots) => Boolean(dir) && roots.some((r) => dir === r || dir.startsWith(`${r}/`));

// Wildcard listeners are reached through localhost (curl and browsers try IPv6 and IPv4).
export const urlOf = (host, port) => `http://${["*", "0.0.0.0", "[::]"].includes(host) ? "localhost" : host}:${port}/`;

export const answered = (curlOut) => /^[1-5]\d\d$/.test(String(curlOut ?? "").trim());
