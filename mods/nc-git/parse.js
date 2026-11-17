// Pure parsers for nc-git: no Herdr imports, so `selftest()` runs under plain node too.

// git's own --graph characters, drawn with box glyphs.
const GLYPH = { "*": "●", "|": "│", "/": "╱", "\\": "╲", "-": "─" };
export const glyph = (ch) => GLYPH[ch] ?? ch;
// git puts lane n at column 2n; a slash between two lanes belongs to the right one (the branch it leaves or joins).
export const lane = (col) => Math.ceil(col / 2);

// `log --graph --format=%x1f%H%x1f%P%x1f%D%x1f%ct%x1f%s`: commit lines carry the fields, the rest are graph only.
export function parseLog(text) {
  return text.split("\n").filter((l) => l.trim()).map((line) => {
    const [graph, hash, parents, refs, ct, ...subject] = line.split("\x1f");
    if (hash === undefined) return { graph: line.trimEnd() };
    return { graph, hash, parents: parents ? parents.split(" ") : [], refs, ct: Number(ct), subject: subject.join("\x1f") };
  });
}

// `status --porcelain=v2 --branch -z`: branch headers, then one field per entry (a rename adds its old path).
export function parseStatus(text) {
  const s = { oid: null, head: null, ahead: 0, behind: 0, dirty: 0 };
  const fields = text.split("\0");
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    if (f.startsWith("# branch.oid ")) s.oid = f.slice(13) === "(initial)" ? null : f.slice(13);
    else if (f.startsWith("# branch.head ")) s.head = f.slice(14) === "(detached)" ? null : f.slice(14);
    else if (f.startsWith("# branch.ab ")) { const [a, b] = f.slice(12).split(" "); s.ahead = Math.abs(Number(a)) || 0; s.behind = Math.abs(Number(b)) || 0; }
    else if (/^[12u?] /.test(f)) { s.dirty++; if (f[0] === "2") i++; }
  }
  return s;
}

// `for-each-ref --format=%(objectname) %(refname)`: which short names are local branches and which remote.
export function parseRefs(text) {
  const locals = new Set(), remotes = new Set();
  for (const line of text.split("\n")) {
    const ref = line.slice(line.indexOf(" ") + 1);
    if (ref.startsWith("refs/heads/")) locals.add(ref.slice(11));
    else if (ref.startsWith("refs/remotes/")) remotes.add(ref.slice(13));
  }
  return { locals, remotes };
}

// %D ("HEAD -> main, origin/main, tag: v1") as chips; a local branch and its remote twin share one.
export function chips(decor, { locals, remotes }) {
  const parts = decor ? decor.split(", ") : [], out = [];
  const names = new Set(parts.map((p) => p.replace(/^HEAD -> /, "")));
  for (const p of parts) {
    if (p === "HEAD") out.push({ text: "HEAD", kind: "head" });
    else if (p.startsWith("tag: ")) out.push({ text: p.slice(5), kind: "tag" });
    else if (p.startsWith("HEAD -> ") || locals.has(p)) {
      const name = p.replace(/^HEAD -> /, "");
      const twin = [...remotes].find((r) => names.has(r) && r.slice(r.indexOf("/") + 1) === name);
      out.push({ text: twin ? `${name} · ${twin.slice(0, twin.indexOf("/"))}` : name, kind: p.startsWith("HEAD -> ") ? "head" : "branch" });
    } else if (remotes.has(p)) {
      const name = p.slice(p.indexOf("/") + 1);
      if (name !== "HEAD" && !names.has(name)) out.push({ text: p, kind: "remote" });
    } else out.push({ text: p, kind: "branch" });
  }
  return out;
}

// From %ct, never %cr: git prints %cr in the user's locale.
export function age(ct, now) {
  const s = Math.max(0, now - ct);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d`;
  if (s < 86400 * 365) return `${Math.floor(s / (86400 * 30))}mo`;
  return `${Math.floor(s / (86400 * 365))}y`;
}

export function stamp(ct) {
  const d = new Date(ct * 1000), p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// `show --numstat --format=%an%x1f%ae%x1f%ct%x1f%B%x1e`: header and message, then the files.
export function parseShow(text) {
  const [head, stat = ""] = text.split("\x1e");
  const [author, email, ct, ...body] = head.split("\x1f");
  const files = stat.split("\n").filter(Boolean).map((l) => {
    const [add, del, ...path] = l.split("\t");
    return { add, del, path: path.join("\t") };
  });
  return { author, email, ct: Number(ct), body: body.join("\x1f").trimEnd().split("\n"), files };
}

// The last `cwd` in the end of a Claude transcript (the first line may be cut by `tail -c`).
export function lastCwd(text) {
  const lines = text.split("\n").slice(1);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('"cwd"')) continue;
    try { const cwd = JSON.parse(lines[i]).cwd; if (typeof cwd === "string" && cwd) return cwd; } catch {}
  }
  return null;
}

// node -e 'import("./mods/nc-git/parse.js").then((m) => m.selftest())'
export function selftest() {
  const ok = (cond, what) => { if (!cond) throw new Error(`selftest: ${what}`); };
  const log = parseLog("*   \x1fa1\x1fb1 c1\x1fHEAD -> main, tag: v1\x1f100\x1fMerge\n|\\  \n| * \x1fc1\x1fd1\x1ffeat, origin/feat\x1f40\x1ff1\n|/  \n");
  ok(log.length === 4 && log[0].hash === "a1" && log[0].parents.length === 2 && log[1].graph === "|\\" && log[2].subject === "f1", "parseLog");
  ok([...log[1].graph].map(glyph).join("") === "│╲" && lane(0) === 0 && lane(1) === 1 && lane(2) === 1 && lane(3) === 2, "glyph/lane");
  const st = parseStatus("# branch.oid abc\0# branch.head main\0# branch.ab +2 -1\x001 .M N... 1 1 1 x y a\x002 R. N... 1 1 1 x y R100 new\x001 old\x00? u\x00");
  ok(st.oid === "abc" && st.head === "main" && st.ahead === 2 && st.behind === 1 && st.dirty === 3, "parseStatus");
  ok(parseStatus("# branch.oid (initial)\0# branch.head (detached)\0").oid === null, "parseStatus initial");
  const refs = parseRefs("a refs/heads/main\nb refs/heads/feat\nc refs/remotes/origin/main\nd refs/remotes/origin/feat\ne refs/remotes/origin/HEAD\nf refs/tags/v1");
  const c = chips("HEAD -> main, origin/main, origin/HEAD, tag: v1", refs);
  ok(c.length === 2 && c[0].text === "main · origin" && c[0].kind === "head" && c[1].kind === "tag", "chips twin");
  ok(chips("origin/feat", refs)[0].kind === "remote" && chips("HEAD", refs)[0].kind === "head" && !chips("", refs).length, "chips remote");
  ok(age(1000, 1000 + 300) === "5m" && age(0, 3 * 3600) === "3h" && age(0, 2 * 86400) === "2d", "age");
  const sh = parseShow("Ann\x1fa@b\x1f100\x1fsubject\n\nbody\n\x1e\n\n1\t2\tsrc/x.js\n-\t-\timg.png\n");
  ok(sh.author === "Ann" && sh.body.length === 3 && sh.files.length === 2 && sh.files[1].add === "-", "parseShow");
  ok(lastCwd('cut"cwd":"/x"}\n{"cwd":"/a"}\n{"cwd":"/b","t":1}\n{"summary":1}\n') === "/b" && lastCwd("x") === null, "lastCwd");
  console.log("selftest ok");
}
