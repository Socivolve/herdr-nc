// Follows patterns from herdr-app v0.1.16 mods/changes and mods/files (Apache-2.0); see NOTICE.
// nc-git: the followed repository's history in git's own --graph look, box glyphs on theme ansi lanes.
// ⤢ widens it to the last 300 commits; clicking one lists its message and the files it touched. nc-git only reads git, it never writes.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, v_virtual_list, Scrollbar, VirtualListScrollHandle } from "gpui-base";
// `window` as appWindow: the bare name would hide the global window.paint_path if curves are added later.
import { spaces, panes, agents, focused, run, exec, hc, home, readTextFile, watchFolder, theme, settings, props, openOverlay, closeOverlay, window as appWindow } from "herdr";
import { parseLog, parseStatus, parseRefs, chips, age, stamp, parseShow, lastCwd, glyph, lane } from "./parse.js";

// ✕ in a card's header hides its layout block (props.card); the nc-cards bar shows it again.
const hideCard = (t, id) => div().id("nc-card-hide").flex_none().px(4).text_size(11).text_color(t.dim).cursor_pointer()
  .hover((s) => s.text_color(t.foreground)).tooltip("Hide this card").on_click(() => run("layout.hide", { id })).child("✕");

const ROW = 20, CW = 9, LINE = 16;
// Lane colours: git's six, then their bright twins.
const LANES = [1, 2, 3, 4, 5, 6, 9, 10, 11, 12, 13, 14];
// Chip colours as git decorates: HEAD cyan, branches green, remotes red, tags yellow.
const CHIP = { head: "ansi6", branch: "ansi2", remote: "ansi1", tag: "ansi3" };
// Reads write nothing under .git (no index lock, no fsmonitor cookie), so the .git watch never fires on our own reads.
const git = (args, cwd, on) => exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "core.quotepath=off", ...args], { cwd, on, timeout: 10000 });
const base = (path) => path.split("/").filter(Boolean).pop() ?? path;

// The uncommitted changes as a row right above HEAD, on HEAD's lane.
function withWip(rows, s) {
  if (!s.dirty) return rows;
  const i = rows.findIndex((r) => r.hash === s.oid);
  const wip = { wip: true, graph: i < 0 ? "◌" : rows[i].graph.replace("*", "◌").replace(/[\\/_.-]/g, " ") };
  return i < 0 ? [wip, ...rows] : [...rows.slice(0, i), wip, ...rows.slice(i)];
}

export default class Git extends View {
  init(arg, cx) {
    const p = arg ?? props() ?? {};
    this.overlay = p.overlay ?? null;
    this.fixed = p.dir ? { dir: p.dir, on: p.on ?? null } : null; // a window keeps the repository it was opened for
    this.limit = this.overlay ? 300 : 80;
    this.all = p.all ?? true;
    this.open = p.open ?? null; this.reveal = Boolean(p.open);
    this.pids = {}; this.details = new Map(); this.rows = []; this.items = []; this.repo = null; this.note = null;
    this.scroll = VirtualListScrollHandle.new();
    if (!this.fixed) this.key = JSON.stringify(this.where());
    this.refresh(cx);
    cx.timer.every(15000, (cx) => { if (appWindow().active && !this.busy) this.refresh(cx); });
  }

  // The Claude Code agent to follow; the same rule as nc-folders and nc-session (duplicated: a mod imports nothing outside its folder).
  follow(space) {
    const c = agents().filter((a) => a.space === space?.id && (a.app === "claude-code" || a.program?.key === "claude"));
    const pick = c.find((a) => a.focused) ?? c.find((a) => a.address === this.agent) ?? c.reduce((m, a) => (!m || a.seq > m.seq ? a : m), null);
    this.agent = pick?.address ?? null;
    return pick;
  }

  // Which folder: a focused plain terminal's, else the followed Claude Code's, else the focused pane's, else the space's.
  where() {
    const space = spaces().find((s) => s.active), f = focused();
    const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
    const on = space?.machine ?? null;
    const agent = on ? null : this.follow(space); // the Claude session files live on that machine
    return {
      on, agent: agent?.address ?? null, status: agent?.status ?? null,
      plain: pane?.terminal && !pane.status && !pane.program?.agent ? pane.cwd : null,
      agentCwd: agent ? panes().find((p) => p.pane === agent.pane)?.cwd ?? null : null,
      cwd: pane?.cwd || f?.cwd || null, folder: space?.folder || null,
    };
  }

  // Claude's own folder follows its `cd`s: the last `cwd` in its transcript. Re-read while it works and once when it changes state.
  async claudeDir(w) {
    if (!w.agent) return null;
    const seen = `${w.agent} ${w.status}`;
    if (this.claude?.seen === seen && w.status !== "working") return this.claude.dir;
    let dir = null;
    try {
      let pid = this.pids[w.agent];
      if (!pid) {
        const fg = JSON.parse((await hc(["get", w.agent, "--json"])).stdout).foreground;
        // foreground.name is a version string; the program is argv[0].
        if (String(fg?.argv?.[0] ?? "").split("/").pop() === "claude") pid = this.pids[w.agent] = fg.pid;
      }
      // Only <pid>.json: never the *.key files next to it.
      const s = pid ? JSON.parse((await readTextFile(`${home()}/.claude/sessions/${pid}.json`)) ?? "null") : null;
      if (!s) delete this.pids[w.agent];
      else if (s.sessionId && s.cwd) {
        const path = `${home()}/.claude/projects/${s.cwd.replace(/[^A-Za-z0-9]/g, "-")}/${s.sessionId}.jsonl`;
        // Most transcripts pass readTextFile's 1 MiB limit: read the end only.
        const r = await exec("/usr/bin/tail", ["-c", "2000000", path], { timeout: 10000 });
        dir = (r.code === 0 && lastCwd(r.stdout)) || s.cwd;
      }
    } catch { /* falls back to the agent pane's folder */ }
    this.claude = { seen, dir: dir || w.agentCwd };
    return this.claude.dir;
  }

  refresh(cx) {
    if (this.busy) { this.again = true; return; }
    this.busy = true; this.again = false;
    cx.spawn(async (cx) => {
      try { await this.load(cx); }
      catch (e) { this.note = String(e?.message ?? e); }
      finally {
        this.busy = false; cx.notify();
        if (this.again) this.refresh(cx);
      }
    });
  }

  async load(cx) {
    const w = this.fixed ?? this.where(), on = w.on;
    const dir = this.fixed ? w.dir : w.plain || (await this.claudeDir(w)) || w.cwd || w.folder;
    if (!dir) return this.empty("No folder", cx);
    const top = await git(["rev-parse", "--path-format=absolute", "--show-toplevel", "--git-common-dir"], dir, on);
    if (top.code !== 0) return this.empty("Not a git repository", cx);
    const [root, common] = top.stdout.trim().split("\n");
    const [st, refs] = await Promise.all([
      git(["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=normal"], root, on),
      git(["for-each-ref", "--format=%(objectname) %(refname)"], root, on),
    ]);
    if (st.code !== 0) throw new Error(st.stderr.trim() || "Cannot read the status");
    const status = parseStatus(st.stdout), sig = [root, on, status.oid, refs.stdout, this.all, this.limit].join("\n");
    // The log runs again only when HEAD or a ref moved.
    if (sig !== this.sig) {
      const args = ["log", "--graph", ...(this.all ? ["--all"] : []), "--date-order", "--color=never", `-n${this.limit}`, "--format=%x1f%H%x1f%P%x1f%D%x1f%ct%x1f%s"];
      const log = status.oid ? await git(args, root, on) : { code: 0, stdout: "" };
      if (log.code !== 0) throw new Error(log.stderr.trim() || "Cannot read the history");
      this.rows = parseLog(log.stdout); this.sig = sig;
    }
    this.repo = { root, on, status, refs: parseRefs(refs.stdout) };
    this.items = withWip(this.rows, status);
    this.graphLen = Math.max(1, ...this.items.map((i) => i.graph.trimEnd().length));
    this.note = null;
    this.watch(on ? null : common, cx); // watchFolder works on this machine only; a remote one has the timer
    if (this.open && !this.details.has(this.open)) this.fetch(this.open, cx);
    if (this.reveal) {
      const i = this.items.findIndex((it) => it.hash === this.open);
      if (i >= 0) { this.scroll.scroll_to_item(i, "center"); this.reveal = false; }
    }
  }

  empty(note, cx) {
    this.note = note; this.repo = null; this.rows = []; this.items = []; this.sig = null;
    this.watch(null, cx);
  }

  // One pending watch, kept as a handle: a new dir cancels the old one, and a loop ends once
  // the stored handle is no longer its own (so A→B→A never leaves two loops).
  watch(dir, cx) {
    if (this.watched === dir) return;
    this.watching?.cancel();
    this.watching = null;
    this.watched = dir;
    if (!dir) return;
    let current = this.watching = watchFolder(dir);
    cx.spawn(async (cx) => {
      try {
        for (;;) {
          const paths = await current;
          if (this.watching !== current) return;
          if (!paths.length) break; // reclaimed by the app: the next refresh watches again
          await cx.sleep(300); // a commit is a burst of writes
          if (this.watching !== current) return;
          this.refresh(cx);
          this.watching = current = watchFolder(dir);
        }
      } catch {} // refused (64 folders app-wide): the next refresh tries again
      if (this.watching === current) { this.watching = null; this.watched = null; }
    });
  }

  fetch(hash, cx) {
    const { root, on } = this.repo;
    this.details.set(hash, null);
    cx.spawn(async (cx) => {
      try {
        const r = await git(["show", "--numstat", "--diff-merges=first-parent", "--format=%an%x1f%ae%x1f%ct%x1f%B%x1e", hash], root, on);
        this.details.set(hash, r.code === 0 ? parseShow(r.stdout) : { error: r.stderr.trim() || "Cannot read this commit" });
      } catch (e) { this.details.set(hash, { error: String(e?.message ?? e) }); }
      cx.notify();
    });
  }

  toggle(hash, cx) {
    this.open = this.open === hash ? null : hash;
    if (this.open && this.repo && !this.details.has(hash)) this.fetch(hash, cx);
    cx.notify();
  }

  openWindow(hash) {
    if (!this.repo) return;
    openOverlay({ mod: "nc-git", kind: "window", key: "nc-git", width: 820, height: 640,
      props: { dir: this.repo.root, on: this.repo.on, all: this.all, open: hash ?? null } });
  }

  button(id, label, tip, t, onClick) {
    return div().id(id).flex_none().px(5).rounded(4).text_size(11).text_color(t.dim).cursor_pointer()
      .hover((s) => s.text_color(t.foreground).bg(t.hover)).tooltip(tip)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation()) // a press on a window's control must not drag it
      .on_click(onClick).child(label);
  }

  cells(graph, cap, pal) {
    return [...graph.slice(0, cap)].map((ch, col) => div().w(CW).flex_none().text_color(pal[lane(col) % pal.length]).child(glyph(ch)));
  }

  detailLines(d) {
    return !d || d.error ? 1 : 1 + Math.min(d.body.length, 30) + Math.min(d.files.length, 40) + (d.files.length > 40 ? 1 : 0);
  }

  detail(d, t) {
    const line = (text, color) => div().h(LINE).flex_none().truncate().text_color(color).child(text || " ");
    if (!d) return [line("Loading…", t.dim)];
    if (d.error) return [line(d.error, t.ansi1)];
    return [
      line(`${d.author} <${d.email}> · ${stamp(d.ct)}`, t.dim),
      ...d.body.slice(0, 30).map((l) => line(l, t.foreground)),
      ...d.files.slice(0, 40).map((f) => h_flex().h(LINE).flex_none().gap(8)
        .child(div().w(40).flex_none().text_right().text_color(t.ansi2).child(f.add === "-" ? "bin" : `+${f.add}`))
        .child(div().w(40).flex_none().text_color(t.ansi1).child(f.del === "-" ? "" : `−${f.del}`))
        .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(f.path))),
      ...(d.files.length > 40 ? [line(`… ${d.files.length - 40} more files`, t.dim)] : []),
    ];
  }

  row(item, i, t, v) {
    const graph = h_flex().w(v.width).h(ROW).flex_none().overflow_hidden().font_family(v.mono).text_size(15).line_height(`${ROW}px`).children(this.cells(item.graph, v.cap, v.pal));
    const line = h_flex().id(item.hash ?? (item.wip ? "wip" : `g${i}`)).h(ROW).flex_none().px(8).gap(6).items_center().child(graph);
    if (item.wip) return line.child(div().flex_1().min_w(0).truncate().italic().text_color(t.muted).child(`Uncommitted changes · ${this.repo.status.dirty} files`));
    if (!item.hash) return line;
    const head = item.hash === this.repo.status.oid, open = this.overlay && this.open === item.hash;
    // no handlers here: the virtual-list renderer throws on them; clicks go through on_item_click in render()
    const commit = line.rounded(5).cursor_pointer().when(head, (el) => el.bg(t.selected)).hover((s) => s.bg(t.hover))
      .when(Boolean(this.overlay), (el) => el.child(div().flex_none().font_family(v.mono).text_size(11).text_color(t.dim).child(item.hash.slice(0, 7))))
      .children(chips(item.refs, this.repo.refs).map((c) => div().flex_none().max_w(150).truncate().px(4).rounded(4).border_1().border_color(t.border)
        .text_size(10).text_color(t[CHIP[c.kind]]).when(c.kind === "head", (el) => el.font_semibold()).child(c.text)))
      .child(div().flex_1().min_w(0).truncate().text_color(head ? t.foreground : t.muted).child(item.subject))
      .child(div().flex_none().text_size(11).text_color(t.dim).child(age(item.ct, v.now)));
    if (!open) return commit;
    return v_flex().flex_none().child(commit)
      .child(v_flex().pl(8 + v.width + 6).pr(12).py(6).text_size(11.5).children(this.detail(this.details.get(item.hash), t)));
  }

  render(cx) {
    if (!this.fixed) {
      const k = JSON.stringify(this.where());
      if (k !== this.key) { this.key = k; this.refresh(cx); }
    }
    const t = theme(), s = this.repo?.status, items = this.items;
    const cap = this.overlay ? 32 : 10; // 5 lanes in the sidebar
    const v = { now: Date.now() / 1000, mono: settings().font_family ?? "JetBrains Mono", cap, width: Math.min(cap, this.graphLen ?? 1) * CW, pal: LANES.map((n) => t[`ansi${n}`]) };
    const openRow = this.overlay && this.open ? this.details.get(this.open) : undefined;
    const sizes = this.overlay && this.open ? items.map((it) => (it.hash === this.open ? ROW + 12 + LINE * this.detailLines(openRow) : ROW)) : ROW;

    const header = h_flex().px(16).h(41).pt(14).pb(5).flex_none().items_center().gap(8)
      .child(div().flex_none().text_size(11.5).font_medium().text_color(t.dim).child("Git"))
      .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(this.repo ? base(this.repo.root) : ""))
      .child(this.button("nc-git-all", this.all ? "all" : "head", this.all ? "Showing every branch: click for HEAD only" : "Showing HEAD only: click for every branch", t,
        (_e, cx) => { this.all = !this.all; this.refresh(cx); cx.notify(); }))
      .child(this.overlay
        ? this.button("nc-git-close", "✕", "Close", t, () => closeOverlay(this.overlay))
        : this.button("nc-git-window", "⤢", "Open the history window", t, () => this.openWindow(null)))
      .when(Boolean(props()?.card), (el) => el.child(hideCard(t, props().card)));
    const branch = s && h_flex().px(16).h(22).flex_none().items_center().gap(8)
      .child(div().min_w(0).truncate().font_semibold().text_color(s.head ? t.foreground : t.muted).child(s.head ?? "detached"))
      .when(s.ahead > 0, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(`↑${s.ahead}`)))
      .when(s.behind > 0, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(`↓${s.behind}`)))
      .when(s.dirty > 0, (el) => el.child(div().flex_none().text_size(11).text_color(t.ansi3).child(`● ${s.dirty}`)));
    const list = div().id("nc-git-list").flex_1().min_h(0).relative().pb(4)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation()) // a press on the list must not drag the window
      .child(v_virtual_list("nc-git-rows", items.length, sizes, (i) => items[i].hash ?? (items[i].wip ? "wip" : `g${i}`),
        (range) => items.slice(range.start, range.end).map((it, k) => this.row(it, range.start + k, t, v))).track_scroll(this.scroll).size_full()
        .on_item_click((key, cx) => {
          if (!this.repo || !this.items.some((it) => it.hash === key)) return; // "wip" and "g<i>" rows are not commits
          if (this.overlay) this.toggle(key, cx); else this.openWindow(key);
        }))
      .child(Scrollbar.vertical("nc-git-rows").viewport_from_layout().absolute().inset_0());
    const message = this.note ?? (!this.repo ? "Loading…" : !items.length ? "No commits yet" : null);

    return v_flex().id("nc-git").size_full().min_h(0).text_color(t.foreground).text_size(12.5)
      .child(header)
      .when(Boolean(s), (el) => el.child(branch))
      .when(Boolean(message), (el) => el.child(div().px(16).py(4).text_size(12).text_color(t.dim).child(message)))
      .when(items.length > 0, (el) => el.child(list));
  }
}
