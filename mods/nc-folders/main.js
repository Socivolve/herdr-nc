// Folders: the repo the followed Claude Code agent works in, as a tree with git and Claude marks.
// directory(), the git status parsing, LANG and the preview are adapted from Herdr's shipped
// `files` mod 0.1.15 (Apache-2.0, see NOTICE); the rest is ours.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, v_virtual_list, Scrollbar, VirtualListScrollHandle, Editor, EditorState } from "gpui-base";
import { spaces, panes, agents, focused, run, props, exec, hc, home, readTextFile, watchFolder, openOverlay, closeOverlay, theme, settings, window } from "herdr";

// ✕ in a card's header hides its layout block (props.card); the nc-cards bar shows it again.
const hideCard = (t, id) => div().id("nc-card-hide").flex_none().px(4).text_size(11).text_color(t.dim).cursor_pointer()
  .hover((s) => s.text_color(t.foreground)).tooltip("Hide this card").on_click(() => run("layout.hide", { id })).child("✕");

const PER_FOLDER = 500, TOTAL = 5000, MARKS = 80, ROW = 24;
const EDIT = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const LANG = { ts: "js", tsx: "js", mts: "js", cts: "js", jsx: "js", mjs: "js", toml: "yaml", jsonc: "json", svelte: "html", vue: "html" };

const git = (args, cwd, on) => exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", ...args], { cwd, on, timeout: 10000 });
const json = (s) => { try { return JSON.parse(s); } catch { return null; } };
const parent = (p) => p.replace(/\/[^/]*$/, "") || "/";
const base = (p) => p.split("/").pop() || p;
const tilde = (p) => (p && p.startsWith(home() + "/") ? "~" + p.slice(home().length) : p ?? "");

// From files/main.js:28 (Unix only): name and kind of up to 501 entries, .git left out.
async function directory(path, on) {
  const script = 'n=0; for p in "$1"/* "$1"/.[!.]* "$1"/..?*; do [ -e "$p" ] || [ -L "$p" ] || continue; name=${p##*/}; [ "$name" = .git ] && continue; if [ -d "$p" ]; then kind=d; else kind=f; fi; printf "%s\\0%s\\0" "$kind" "$name"; n=$((n+1)); [ "$n" -gt 500 ] && break; done; test -d "$1"';
  const r = await exec("/bin/sh", ["-c", script, "nc-folders", path], { on, timeout: 10000 });
  if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
  const parts = r.stdout.split("\0"), out = [];
  while (parts.length > 1) { const kind = parts.shift(), name = parts.shift(); out.push({ name, dir: kind === "d" }); }
  return out.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
}

// The Claude Code agent to follow. Same rule as nc-session, duplicated because a mod can't import another's files.
function pick(space, current) {
  const c = agents().filter((a) => a.space === space?.id && (a.app === "claude-code" || a.program?.key === "claude"));
  return c.find((a) => a.focused) ?? c.find((a) => a.address === current) ?? c.reduce((b, a) => (!b || a.seq > b.seq ? a : b), null);
}

// The newest cwd and the newest MARKS edited/read files in a transcript tail (newest first).
function parseTail(text) {
  const out = { cwd: null, edited: [], read: [] }, lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i], wantCwd = !out.cwd && l.includes('"cwd"');
    const wantTools = l.includes('"tool_use"') && (out.edited.length < MARKS || out.read.length < MARKS);
    if (!wantCwd && !wantTools) continue;
    const o = json(l); // tail cuts the first line: it fails to parse and is skipped
    if (!o) continue;
    if (wantCwd && typeof o.cwd === "string") out.cwd = o.cwd;
    const content = o.type === "assistant" ? o.message?.content : null;
    if (Array.isArray(content)) for (let j = content.length - 1; j >= 0; j--) {
      const c = content[j], p = c?.type === "tool_use" ? c.input?.file_path ?? c.input?.notebook_path : null;
      const list = typeof p !== "string" ? null : EDIT.has(c.name) ? out.edited : c.name === "Read" ? out.read : null;
      if (list && list.length < MARKS && !list.includes(p)) list.push(p);
    }
  }
  return out;
}
// Self-check, run on module load (so `herdr-app check` fails if the parser breaks): cut first line, cwd from the end, marks newest first.
const probe = parseTail('cut"}\n{"type":"assistant","cwd":"/a","message":{"content":[{"type":"tool_use","name":"Edit","input":{"file_path":"/a/x"}},{"type":"tool_use","name":"Read","input":{"file_path":"/a/y"}}]}}\n{"type":"assistant","cwd":"/a","message":{"content":[{"type":"tool_use","name":"Write","input":{"file_path":"/a/z"}}]}}\n{"type":"user","cwd":"/b"}');
if (probe.cwd !== "/b" || probe.edited.join() !== "/a/z,/a/x" || probe.read.join() !== "/a/y") throw new Error("nc-folders: parseTail self-check failed");

export default class Folders extends View {
  init(p, cx) {
    if (p?.file) return this.preview(p, cx);
    this.follow = true; this.ups = 0; this.pids = new Map(); this.gen = 0;
    this.entries = new Map(); this.folders = new Set(); this.marks = {}; this.dirty = new Set();
    this.edited = new Set(); this.read = new Set();
    this.list = VirtualListScrollHandle.new();
    cx.timer.every(4000, (cx) => { if (this.follow && agents().find((a) => a.address === this.addr)?.status === "working") this.locate(cx); });
    cx.timer.every(10000, (cx) => { if (window()?.active) this.reload(cx); });
  }

  async close() { this.code?.release(); }

  // Where Claude works now: hc get → sessions/<pid>.json → transcript tail; else the panes' and space's folders.
  locate(cx) {
    if (this.locating) { this.again = true; return; }
    this.locating = true;
    cx.spawn(async (cx) => {
      try {
        const space = spaces().find((s) => s.active), on = space?.machine ?? null, f = focused();
        const a = agents().find((x) => x.address === this.addr), cwdOf = (id) => panes().find((p) => p.pane === id)?.cwd;
        let tail = null, folder = null;
        if (a && !on) {
          const pid = await this.pid(a.address);
          const s = pid ? json(await readTextFile(`${home()}/.claude/sessions/${pid}.json`).catch(() => null)) : null;
          if (s?.sessionId && s.cwd) {
            const file = `${home()}/.claude/projects/${s.cwd.replace(/[^A-Za-z0-9]/g, "-")}/${s.sessionId}.jsonl`;
            const r = await exec("/usr/bin/tail", ["-c", "2000000", file], { timeout: 10000 }).catch(() => null);
            tail = r?.code === 0 ? parseTail(r.stdout) : { cwd: null, edited: [], read: [] };
            folder = tail.cwd || s.cwd;
          } else this.pids.delete(a.address); // Claude restarted in that terminal: ask hc again next time
        }
        folder ||= (a && cwdOf(a.pane)) || (f?.pane && cwdOf(f.pane)) || f?.cwd || space?.folder || null;
        this.edited = new Set(tail?.edited); this.read = new Set(tail?.read);
        this.remote = a && on ? on : null;
        await this.setFolder(folder, on, cx);
      } catch (e) { this.error = String(e); }
      finally {
        this.locating = false; cx.notify();
        if (this.again) { this.again = false; this.locate(cx); }
      }
    });
  }

  async pid(address) {
    if (!this.pids.has(address)) {
      const r = await hc(["get", address, "--json"]).catch(() => null);
      const fg = r?.code === 0 ? json(r.stdout)?.foreground : null;
      // foreground.name is a version string, so match the program by argv[0].
      if (fg?.pid && base(String(fg.argv?.[0] ?? "")) === "claude") this.pids.set(address, fg.pid);
    }
    return this.pids.get(address) ?? null;
  }

  async setFolder(folder, on, cx) {
    const moved = folder !== this.folder || on !== this.on;
    if (moved) { // rev-parse only when the folder changed, not on every 4 s tail read
      const top = folder ? await git(["rev-parse", "--show-toplevel"], folder, on).catch(() => null) : null;
      this.top = top?.code === 0 ? top.stdout.trim() : null;
      this.folder = folder; this.on = on;
    }
    if ((this.top || folder) !== this.base) { this.base = this.top || folder; this.ups = 0; }
    this.setRoot(cx, moved);
  }

  // Root = the repo (or the folder), `ups` levels up. Opens and scrolls to Claude's folder when it moved.
  setRoot(cx, moved) {
    let root = this.base ?? null;
    for (let i = 0; i < this.ups && root && root !== "/"; i++) root = parent(root);
    const fresh = root !== this.root;
    if (fresh) {
      this.root = root; this.gen++; this.entries = new Map(); this.folders = new Set();
      this.marks = {}; this.dirty = new Set(); this.error = null; this.limited = false;
      this.loading = false; // a run for the old root bails at its gen checks and leaves the flag alone
      this.watch(cx);
    }
    if (fresh || moved) {
      const rel = this.rel(this.folder), parts = rel ? rel.split("/") : [];
      parts.forEach((_, i) => this.folders.add(parts.slice(0, i + 1).join("/")));
      this.target = rel; this.scrollPending = Boolean(rel);
      this.reload(cx);
    }
  }

  rel(abs) {
    const r = this.root;
    if (!abs || !r) return null;
    if (abs === r) return "";
    const pre = r.endsWith("/") ? r : r + "/";
    return abs.startsWith(pre) ? abs.slice(pre.length) : null;
  }
  abs(rel) { return rel ? (this.root.endsWith("/") ? this.root : this.root + "/") + rel : this.root; }

  // One pending watch, kept as a handle: a new root cancels the old one, and a loop ends once
  // the stored handle is no longer its own (so A→B→A never leaves two loops).
  watch(cx) {
    this.watching?.cancel();
    this.watching = null;
    const root = this.root;
    // watchFolder is local and recursive, and at most 64 folders app-wide can have a pending watch: not home or /.
    if (this.on || !root || root === "/" || root === home()) return;
    let current = this.watching = watchFolder(root);
    cx.spawn(async (cx) => {
      try {
        for (;;) {
          const paths = await current;
          if (this.watching !== current) return;
          if (!paths.length) break; // reclaimed by the app: the 10 s fallback takes over
          await cx.sleep(800); // debounce: a burst of writes gives one reload
          if (this.watching !== current) return;
          this.reload(cx);
          this.watching = current = watchFolder(root);
        }
      } catch {} // watch refused: the 10 s fallback still runs
      if (this.watching === current) this.watching = null;
    });
  }

  // Lists the root and every open folder, then git status. Skips while the last run is still going.
  reload(cx) {
    if (!this.root || this.loading) return;
    const gen = this.gen, root = this.root, on = this.on, top = this.top, open = [...this.folders].sort();
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const entries = new Map();
        let total = 0, limited = false;
        for (const path of ["", ...open]) {
          if (gen !== this.gen) return;
          let list;
          try { list = await directory(path ? `${root}/${path}` : root, on); }
          catch (e) { if (!path) throw e; this.folders.delete(path); continue; } // an open folder that went away
          if (list.length > PER_FOLDER || total + list.length > TOTAL) limited = true;
          list = list.slice(0, Math.max(0, Math.min(PER_FOLDER, TOTAL - total)));
          total += list.length; entries.set(path, list);
        }
        const marks = {}, dirty = new Set();
        if (top) {
          const st = await git(["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=normal"], top, on).catch(() => null);
          if (st?.code === 0) for (const e of st.stdout.split("\0").filter(Boolean).slice(0, TOTAL)) {
            const xy = e.slice(0, 2), abs = `${top}/${e.slice(3).replace(/\/$/, "")}`;
            marks[abs] = xy === "??" || xy.includes("A") ? "A" : xy.includes("U") ? "U" : xy.includes("D") ? "D" : "M";
            for (let d = parent(abs); this.rel(d); d = parent(d)) dirty.add(d);
          }
        }
        if (gen !== this.gen) return;
        for (const p of this.folders) if (!entries.has(p) && this.entries.has(p)) entries.set(p, this.entries.get(p)); // opened meanwhile
        this.entries = entries; this.marks = marks; this.dirty = dirty; this.limited = limited; this.error = null;
        if (this.scrollPending) {
          const i = this.flatten().findIndex((r) => r.path === this.target);
          if (i >= 0) { this.list.scroll_to_item(i, "center"); this.scrollPending = false; }
        }
      } catch (e) { if (gen === this.gen) this.error = String(e); }
      finally { if (gen === this.gen) this.loading = false; cx.notify(); }
    });
  }

  flatten(prefix = "", depth = 0, out = []) {
    for (const e of this.entries.get(prefix) ?? []) {
      if (out.length >= TOTAL) break;
      const path = prefix ? `${prefix}/${e.name}` : e.name;
      out.push({ path, name: e.name, dir: e.dir, depth });
      if (e.dir && depth < 40 && this.folders.has(path)) this.flatten(path, depth + 1, out);
    }
    return out;
  }

  click(path, cx) {
    const row = this.flatten().find((r) => r.path === path);
    if (!row) return;
    if (!row.dir) {
      openOverlay({ kind: "window", key: "nc-folders-file", mod: "nc-folders", props: { file: this.abs(path), on: this.on }, width: 760, height: 560 });
      return;
    }
    if (this.folders.has(path)) {
      for (const f of [...this.folders]) if (f === path || f.startsWith(path + "/")) { this.folders.delete(f); this.entries.delete(f); }
    } else {
      this.folders.add(path);
      const gen = this.gen, root = this.root, on = this.on;
      cx.spawn(async (cx) => {
        try { const list = await directory(`${root}/${path}`, on); if (gen === this.gen && this.folders.has(path)) this.entries.set(path, list.slice(0, PER_FOLDER)); }
        catch (e) { if (gen === this.gen) this.error = String(e); }
        finally { cx.notify(); }
      });
    }
    cx.notify();
  }

  // A read-only preview window (props.file), opened by a click on a file.
  preview(p, cx) {
    this.file = p.file; this.overlay = p.overlay;
    cx.spawn(async (cx) => {
      try {
        const text = await readTextFile(p.file, { on: p.on ?? null });
        if (text === null) { this.fileError = "This file is no longer available"; return; }
        if (text.includes("\0")) { this.fileError = "Binary file · no text preview"; return; }
        const t = theme(), name = base(p.file), ext = name.includes(".") ? name.split(".").pop() : "txt";
        this.code = EditorState.new({ language: LANG[ext] ?? ext, readonly: true,
          value: text.length > 400000 ? text.slice(0, 400000) + "\n… (file truncated)" : text,
          font_family: settings().font_family, font_size: 12,
          syntax: { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6 } });
      } catch { this.fileError = "Cannot preview this file (binary, too large, or unreadable)"; }
      finally { cx.notify(); }
    });
  }

  drawPreview(t) {
    const stop = (_e, cx) => cx.stop_propagation(); // a press the window doesn't get would drag it
    return v_flex().id("nc-folders-file").size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(13)
      .child(h_flex().h(36).flex_none().px(12).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().flex_none().font_semibold().child(base(this.file)))
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(tilde(parent(this.file))))
        .child(div().id("nc-folders-close").cursor_pointer().text_color(t.dim).hover((s) => s.text_color(t.foreground))
          .on_mouse_down("left", stop).on_click(() => closeOverlay(this.overlay)).child(svg("mods/pane/close.svg").size(12))))
      .child(this.code
        ? div().id("nc-folders-code").flex_1().min_h(0).on_mouse_down("left", stop).child(Editor.new(this.code).size_full())
        : div().p(12).text_color(t.dim).child(this.fileError || "Loading file…"));
  }

  row(r, t) {
    const abs = this.abs(r.path), mark = this.marks[abs], here = r.path === this.target;
    const color = mark === "A" ? t.ansi2 : mark === "D" || mark === "U" ? t.ansi1 : mark ? t.ansi3 : null;
    const claude = this.edited.has(abs) ? ["✎", t.accent] : this.read.has(abs) ? ["◦", t.muted] : null;
    return h_flex().w_full().h(ROW).flex_none().pl(6 + r.depth * 14).pr(8).gap(6).items_center().rounded(6).cursor_pointer()
      .when(here, (el) => el.bg(t.selected)).hover((s) => s.bg(t.hover))
      .child(r.dir ? svg(`mods/files/chevron-${this.folders.has(r.path) ? "down" : "right"}.svg`).size(11).flex_none().text_color(t.dim) : div().w(11).flex_none())
      .child(svg(`mods/files/${r.dir ? "folder" : "file"}.svg`).size(13).flex_none().text_color(here ? t.foreground : t.muted))
      .child(div().flex_1().min_w(0).truncate().text_color(color ?? t.foreground).child(r.name))
      .when(Boolean(claude), (el) => el.child(div().flex_none().text_color(claude[1]).child(claude[0])))
      .when(r.dir && this.dirty.has(abs), (el) => el.child(div().flex_none().text_size(8).text_color(t.ansi3).child("●")))
      .when(Boolean(mark), (el) => el.child(div().flex_none().w(10).text_size(11).text_color(color).child(mark)));
  }

  render(cx) {
    const t = theme();
    if (this.file) return this.drawPreview(t);
    if (this.follow) {
      const space = spaces().find((s) => s.active), a = pick(space, this.addr), f = focused();
      const fp = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
      const key = JSON.stringify([space?.id ?? null, a?.address ?? null, a ? null : fp?.cwd || f?.cwd || space?.folder || null]);
      const stopped = this.status === "working" && a?.address === this.addr && a?.status !== "working"; // read the tail once when it stops
      this.addr = a?.address ?? null; this.status = a?.status ?? null;
      if (key !== this.key || stopped) { this.key = key; this.locate(cx); }
    }
    const rows = this.flatten(), button = (id, label, tip, on, act) => div().id(id).px(6).rounded(5).text_size(11).cursor_pointer()
      .text_color(on ? t.accent : t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip(tip).on_click(act).child(label);
    return v_flex().id("nc-folders").size_full().min_h(0).text_color(t.foreground).text_size(12)
      .child(h_flex().h(36).flex_none().pl(14).pr(8).gap(6).items_center()
        .child(div().flex_none().text_size(11.5).font_medium().text_color(t.dim).child("Folders"))
        .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(tilde(this.root)))
        .when(Boolean(this.root) && this.root !== "/", (el) => el.child(button("nc-folders-up", "↑", "Up one folder", false, (_e, cx) => { this.ups++; this.setRoot(cx, true); cx.notify(); })))
        .child(button("nc-folders-follow", "follow", this.follow ? "Following Claude Code: click to stop" : "Not following: click to follow Claude Code", this.follow,
          (_e, cx) => { this.follow = !this.follow; if (this.follow) { this.ups = 0; this.key = null; } cx.notify(); }))
        .when(Boolean(props()?.card), (el) => el.child(hideCard(t, props().card))))
      .child(div().flex_1().min_h(0).relative().px(4)
        .child(v_virtual_list("nc-folders-tree", rows.length, ROW, (i) => rows[i].path, (range) => rows.slice(range.start, range.end).map((r) => this.row(r, t)))
          .track_scroll(this.list).on_item_click((key, cx) => this.click(key, cx)).size_full())
        .child(Scrollbar.vertical("nc-folders-tree").absolute().inset_0())
        .when(!rows.length, (el) => el.child(div().absolute().top(2).left(14).text_color(t.dim)
          .child(this.error || (this.loading || this.locating ? "Loading…" : this.root ? "Empty folder" : "No folder")))))
      .when(this.limited, (el) => el.child(div().px(14).py(2).text_size(10.5).text_color(t.dim).child("Limited to 500 entries per folder, 5,000 in all")))
      .child(h_flex().h(26).flex_none().px(14).gap(6).items_center().border_t(1).border_color(t.border).text_size(11).text_color(t.dim)
        .child(div().flex_none().w(6).h(6).rounded(3).bg(this.addr ? t[this.status] ?? t.idle : t.border))
        .child(div().flex_1().min_w(0).truncate().child(this.remote ? `transcript is on ${this.remote}` : this.addr ? "Claude Code here" : "none"))
        .when(Boolean(this.addr) && !this.remote, (el) => el.child(div().flex_none().child(`${this.edited.size} edited`))));
  }
}
