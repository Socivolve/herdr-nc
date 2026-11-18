// Orchestrator card: what the followed Claude Code session is doing, as an animated pipeline
// (prompt → main → crew → branches → stages → outcome), its workflows, its subagents, its
// nc delegate workers and its background shells.
// With a v3 status file it shows the plan (musts, phases, lanes, tasks) and can approve it.
// Data: mods/nc-session/usage.py --orch (contract in RECIPE.md). It writes nothing; the only
// actions are hc send (Approve plan), terminal.peek (a worker) and notify (toasts).
// All motion is native (.spin, .loop, .frames, .transition); the only timer fetches data.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, spaces, terminals, run, hc, exec, notify, appHome, readTextFile, theme, props, settings, openOverlay, closeOverlay } from "herdr";
import { demo } from "./fixture.js";

// ✕ in a card's header hides its layout block (props.card); the nc-cards bar shows it again.
const hideCard = (t, id) => div().id("nc-card-hide").flex_none().px(4).text_size(11).text_color(t.dim).cursor_pointer()
  .hover((s) => s.text_color(t.foreground)).tooltip("Hide this card").on_click(() => run("layout.hide", { id })).child("✕");

const PY = "/usr/bin/python3";
const SPIN = "mods/nc-orchestrator/spinner.svg"; // copy of Herdr's workspace-chrome/spinner.svg (Apache-2.0)
const FAST = 3000; // while the session is busy or a workflow, worker or background shell runs
const SLOW = 15000; // otherwise
const MARCH = ["›  ", "›› ", "›››", " ››", "  ›", "   "];

// ── State language: the one place that maps a feed status to colour, border, icon and word ──
const KIND = {
  running: "run", working: "run", busy: "run",
  done: "done", completed: "done",
  error: "err", failed: "err", killed: "err", stale: "err",
  idle: "idle", skipped: "skip",
  // plan task statuses
  pass: "done", review: "run", redo: "run", fail: "err", conflict: "err", blocked: "err",
  // nc delegate worker statuses ("ended": stopped, not collected yet)
  ended: "done", cannot_complete: "err", requires_user_auth: "err", timeout: "err", unreadable: "err",
}; // anything else (pending, unknown) waits
const LOOKS = {
  run: { tone: "working", icon: "spin", word: "running" },
  done: { tone: "done", icon: "check", word: "done" },
  err: { tone: "blocked", icon: "bang", word: "failed" },
  wait: { tone: "dim", icon: "ring", word: "pending", dashed: true },
  skip: { tone: "dim", icon: null, word: "skipped", dashed: true, fade: 0.6 },
  idle: { tone: "idle", icon: "ring", word: "idle" },
};
const kind = (s) => KIND[s] ?? "wait";
// The plan's state: [the look it takes, the word the chip shows].
const PLAN_STATE = {
  planning: ["running", "planning"], awaiting_approval: ["pending", "awaiting approval"], running: ["running", "running"],
  closing: ["running", "closing"], done: ["done", "done"], error: ["error", "error"],
};
const tasksOf = (plan) => (plan?.phases ?? []).flatMap((p) => (p.lanes ?? []).flatMap((l) => l.tasks ?? []));
// Theme tokens may already carry alpha (#rrggbbaa); those are used as they are.
const alpha = (c, aa) => (c?.length === 7 ? c + aa : c);
function look(t, s) {
  const k = kind(s), L = LOOKS[k], c = t[L.tone] ?? t.dim;
  const edge = k === "run" || k === "err" ? c : k === "done" ? alpha(c, "8c") : t.border; // 8c: ~55%
  return { k, ...L, c, edge };
}

// ── Formatting ──
const money = (x) => (typeof x === "number" ? `$${x.toFixed(2)}` : "$?");
const tok = (n) => { n = Number(n) || 0; return n < 1e3 ? String(n) : n < 1e6 ? `${(n / 1e3).toFixed(n < 1e5 ? 1 : 0)}k` : `${(n / 1e6).toFixed(1)}M`; };
function dur(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}
const clock = (ms) => { // under an hour m:ss, from there dur()
  if (ms >= 3_600_000) return dur(ms);
  const secs = Math.floor(Math.max(0, ms) / 1000), rest = secs % 60;
  return `${(secs - rest) / 60}:${rest < 10 ? "0" : ""}${rest}`;
};
const span = (start, end, now) => (start ? dur((end || now) - start) : "");
const lastLine = (s) => (s ?? "").trim().split("\n").filter(Boolean).pop() ?? "";

// Another machine has no usage.py: it goes along as one argument (about 45 KB), read once per load.
// The same remote path as nc-session (code duplicated, like the follow rule).
let script = null;
async function usageScript() {
  script ??= await readTextFile(`${appHome()}/mods/nc-session/usage.py`);
  if (!script) throw new Error("Feed missing: deploy mods/nc-session");
  return script;
}

// On another machine, through its login shell so PATH has ~/.local/bin (hc).
// The command and its arguments go as "$@", never through shell quoting.
const loginExec = (on, argv, timeout) => exec("sh", ["-lc", 'exec "$@"', "sh", ...argv], { on, timeout });
const text = (size, color, value) => div().min_w(0).truncate().text_size(size).text_color(color).child(String(value ?? ""));
const badge = (v, word, color) => div().flex_none().px(5).rounded(4).bg(v.t.raised).text_size(9.5 * v.z).text_color(color ?? v.t.accent).child(word);
// The terminal id on `on` (the address minus "<machine>/"), checked before it goes to another machine.
function remoteId(addr, on) {
  const id = on && addr.startsWith(`${on}/`) ? addr.slice(on.length + 1) : addr;
  if (on && !/^[A-Za-z0-9_.:-]+$/.test(id)) throw new Error(`unexpected terminal address ${addr}`);
  return id;
}
// A press on a control in the window must not drag the window.
const noDrag = (el) => el.on_mouse_down("left", (_e, cx) => cx.stop_propagation());

// ── Pipeline pieces. v = { t, z, now, mono }: theme, scale (1 card, 1.25 window), clock, mono font ──

function icon(v, s, size = 12) {
  const { t } = v, L = look(t, s), n = size * v.z;
  if (L.icon === "spin") return svg(SPIN).size(n).flex_none().text_color(L.c).spin(900);
  const box = h_flex().size(n).flex_none().items_center().justify_center();
  if (L.icon === "check") return box.text_size(n).text_color(L.c).child("✓");
  if (L.icon === "bang") return box.rounded(n).border(1).border_color(L.c).text_size(n * 0.7).font_bold().text_color(L.c).child("!");
  if (L.icon === "ring") return box.child(div().size(n * 0.6).rounded(n).border(1.5).border_color(L.c));
  return box;
}

// A halo 3px outside a running node that breathes; the node's own border stays solid.
const pulseRing = (t, r) => div().absolute().top(-3).left(-3).right(-3).bottom(-3).rounded(r + 3)
  .border(1).border_color(t.working).loop("opacity", { from: 0.25, to: 1, period: 1400 });

// A surface box in its state's border. The caller sets width and padding.
function node(v, s, r, kids) {
  const L = look(v.t, s);
  return v_flex().relative().min_w(0).rounded(r).border(1).border_color(L.edge).bg(v.t.surface)
    .when(Boolean(L.dashed), (el) => el.border_dashed())
    .when(Boolean(L.fade), (el) => el.opacity(L.fade))
    .children(kids)
    .when(L.k === "run", (el) => el.child(pulseRing(v.t, r)));
}

// A 2px line H tall in the look of what it leads into: running carries a scanner bar when it
// has room to travel (not on the 4px stubs beside the stage icons).
function connector(t, s, H) {
  const k = kind(s), line = div().relative().w(2).h(H).flex_none();
  if (k === "run" && H > 6) return line.bg(t.border).child(div().absolute().left(0).top(0).w(2).h(6).rounded(1).bg(t.working)
    .loop("top", { from: 0, to: H - 6, period: 900 }));
  if (k === "wait" || k === "skip") return line.border_l(2).border_dashed().border_color(t.border);
  if (k === "done") return line.bg(t.done).opacity(0.55);
  return line.bg(k === "err" ? t.blocked : t.border);
}
const centre = (el) => h_flex().w_full().flex_none().justify_center().child(el);

// A 2px rail across n equal cells. Lit: the half-cells between the centre line and cell i's
// centre, in s. all: the rest of the span between the outer centres too, in border.
function rail(t, n, i, s, all) {
  const k = kind(s);
  return h_flex().w_full().h(2).flex_none().children(Array.from({ length: 2 * n }, (_, h) => {
    const m = (h + 0.5) / (2 * n), x = (2 * i + 1) / (2 * n);
    const lit = i >= 0 && (m - 0.5) * (m - x) < 0;
    return div().flex_1().h_full()
      .when(lit, (el) => el.bg(look(t, s).c).opacity(k === "done" ? 0.55 : 1))
      .when(!lit && all && h > 0 && h < 2 * n - 1, (el) => el.bg(t.border));
  }));
}

// crew → branches: a stem, a rail with a drop to every branch, and the taken branch's way
// back to the centre line. The taken path is drawn in s, the others dashed and "skipped".
function fork(v, routes, taken, s) {
  const { t, z } = v, n = routes.length, i = routes.indexOf(taken), H = 14 * z;
  const cells = (f) => h_flex().w_full().flex_none()
    .children(routes.map((r, j) => h_flex().flex_1().min_w(0).justify_center().child(f(r, j))));
  const branch = (r, j) => {
    const st = j === i ? s : "skipped", L = look(t, st);
    return div().w_full().min_w(0).px(3 * z).child(node(v, st, 7, [
      div().w_full().text_center().truncate().text_size(11.5 * z).text_color(j === i ? t.foreground : t.dim).child(String(r)),
      h_flex().w_full().justify_center().items_center().gap(3 * z)
        .when(Boolean(L.icon), (el) => el.child(icon(v, st, 9)))
        .child(text(9.5 * z, L.c, L.word)),
    ]).w_full().px(6 * z).py(4 * z).gap(1).items_center());
  };
  const els = [centre(connector(t, i < 0 ? "pending" : s, H))];
  if (n > 1) els.push(rail(t, n, i, s, true));
  els.push(cells((_r, j) => connector(t, j === i ? s : "pending", H)), cells(branch));
  if (i >= 0) {
    els.push(cells((_r, j) => (j === i ? connector(t, s, H) : div().h(H))));
    if (n > 1) els.push(rail(t, n, i, s, false));
  }
  return els;
}

// Dots for a stage's agents in feed order, then rings for the ones not started; 12 at most.
function agentDots(v, as, waiting) {
  const { t, z } = v, n = 7 * z;
  const all = [...as.map((a) => a.status), ...Array(Math.max(0, waiting)).fill("pending")];
  const dot = (s) => {
    const L = look(t, s);
    return L.k === "wait"
      ? div().size(n).flex_none().rounded(n).border(1.5).border_color(t.dim)
      : div().size(n).flex_none().rounded(n).bg(L.c).when(L.k === "run", (el) => el.loop("opacity", { from: 0.3, to: 1, period: 900 }));
  };
  return h_flex().gap(4 * z).items_center().children(all.slice(0, 12).map(dot))
    .when(all.length > 12, (el) => el.child(text(10 * z, t.dim, `+${all.length - 12}`)));
}

// From the earliest agent start to the latest end, or to now while the stage or one agent still runs.
function stageTime(as, now, running) {
  const starts = as.map((a) => a.started).filter(Boolean);
  if (!starts.length) return "";
  const end = running || as.some((a) => kind(a.status) === "run") ? now : Math.max(...as.map((a) => a.ended || a.last_activity || 0));
  return dur(end - Math.min(...starts));
}

// [icon] [title] [progress bar] [done/total] [elapsed]; the running bar shimmers.
function stage(v, st, i, as, next) {
  const { t, z } = v, L = look(t, st.status), W = 110 * z, hl = 18 * z;
  const done = Number(st.done) || 0, total = Number(st.total) || 0;
  const frac = total ? Math.min(1, done / total) : L.k === "done" ? 1 : 0;
  const bar = div().relative().w(W).h(4 * z).flex_none().rounded(2).bg(t.raised).overflow_hidden()
    .child(div().id(`st-fill-${i}`).absolute().left(0).top(0).h_full().w(W * frac).rounded(2).bg(L.c).transition("width", 600))
    .when(L.k === "run", (el) => el.child(div().absolute().left(0).top(0).h_full().w(hl).bg(t.working).opacity(0.45)
      .loop("left", { from: 0, to: W - hl, period: 1600 })));
  const ink = { run: t.foreground, err: t.blocked, done: t.muted }[L.k] ?? t.dim;
  return h_flex().id(`st-${i}`).h(20 * z).flex_none().gap(8 * z).items_center()
    // 4px stubs above and below the 12px icon join it to the rail segments in and out.
    .child(v_flex().w(14 * z).h_full().flex_none().items_center().justify_center()
      .child(i > 0 ? connector(t, st.status, 4 * z) : div().h(4 * z))
      .child(icon(v, st.status, 12))
      .child(next ? connector(t, next.status, 4 * z) : div().h(4 * z)))
    .child(text(12 * z, ink, st.title).flex_1())
    .child(bar)
    .child(text(11 * z, L.k === "wait" ? t.dim : t.muted, total ? `${done}/${total}` : done).w(30 * z).flex_none().text_right())
    .child(text(11 * z, t.dim, stageTime(as, v.now, L.k === "run")).w(34 * z).flex_none().text_right());
}

// The taken branch's stages. A rail left of the icons joins them, each segment in the look of
// the stage it leads into; running and failed stages show their agents as dots.
function stages(v, steps, wf) {
  const { t, z } = v, rows = [];
  steps.forEach((st, i) => {
    const ph = (wf?.phases ?? []).find((p) => p.title === st.title);
    const as = (wf?.agents ?? []).filter((a) => a.phase === st.title);
    const waiting = ph?.total != null ? ph.total - (ph.started ?? 0) : 0;
    const dots = ["run", "err"].includes(kind(st.status)) && (as.length > 0 || waiting > 0);
    const next = steps[i + 1];
    rows.push(stage(v, st, i, as, next));
    if (!next && !dots) return;
    const H = (dots ? 18 : 14) * z;
    rows.push(h_flex().h(H).flex_none().gap(8 * z).items_center()
      .child(h_flex().w(14 * z).h_full().flex_none().justify_center().when(Boolean(next), (el) => el.child(connector(t, next.status, H))))
      .when(dots, (el) => el.child(agentDots(v, as, waiting))));
  });
  return v_flex().w_full().px(10 * z).py(6 * z).rounded(8).border(1).border_color(t.border).bg(t.surface).children(rows);
}

// The run's state in one word, top right (and the plan's state).
function chip(v, s, word) {
  const { t, z } = v, L = look(t, s);
  return h_flex().flex_none().gap(5 * z).items_center()
    .when(L.k === "run", (el) => el.child(div().size(6 * z).rounded(6 * z).bg(L.c).loop("opacity", { from: 0.3, to: 1, period: 900 })))
    .child(text(11 * z, L.c, word ?? L.word));
}

// Phase that is running now, else the last one that started.
const currentPhase = (w) => (w.phases ?? []).find((p) => p.running)?.title
  ?? [...(w.phases ?? [])].reverse().find((p) => p.started)?.title ?? null;

export default class Orchestrator extends View {
  init(_props, cx) {
    this.pids = new Map(); // address → Claude pid (from hc get)
    this.addr = null; // followed agent
    this.key = null; // address|status the last refresh started for
    this.sig = ""; // the feed's change signature
    this.data = null;
    this.err = null;
    this.busy = false;
    this.ran = 0;
    this.noClaude = null; // address whose foreground was not claude at the last look
    this.w = 0; // width from on_size_change: lanes stack below 420
    this.open = null; // the expanded task's id (one at a time)
    this.seen = null; // plan state and task statuses at the last load, for toasts
    this.sending = false; // Approve plan in flight
    this.sent = null; // its result line
    if (props()?.demo) {
      this.fixture = demo(Date.now(), props().demo);
      this.open = "A2"; // the demo shows one expanded task
    } else cx.timer.every(FAST, (cx) => this.tick(cx));
  }

  // The agent to follow: the same rule as nc-session and nc-folders.
  follow() {
    const space = spaces().find((s) => s.active);
    const cands = space ? agents().filter((a) => a.space === space.id && (a.app === "claude-code" || a.program?.key === "claude")) : [];
    const cur = cands.find((a) => a.focused) ?? cands.find((a) => a.address === this.addr)
      ?? cands.reduce((m, a) => (!m || a.seq > m.seq ? a : m), null);
    const addr = cur?.address ?? null;
    // The machine the session runs on (null: this one), as nc-session works it out.
    const machine = space?.machine ?? (addr?.includes("/") ? addr.split("/")[0] : null);
    return { addr, status: cur?.status ?? null, machine };
  }

  tick(cx) {
    // Live, not this.target: a hidden copy keeps ticking but no longer renders.
    const g = this.follow();
    if (this.busy || !g.addr || g.addr !== this.addr) return;
    // A terminal without claude in front is asked again only every 15 s (or at once on a status change, in render).
    const fast = this.noClaude !== g.addr && (g.status === "working" || this.data?.session?.status === "busy"
      || (this.data?.workflows ?? []).some((w) => w.status === "running")
      || (this.data?.workers ?? []).some((w) => w.status === "running") || (this.data?.shells ?? []).length > 0);
    if (fast || Date.now() - this.ran >= SLOW) this.refresh(cx);
  }

  // The terminal's foreground pid, on this machine or on `on` (hc get there, through its login shell):
  // { pid, kind: "claude" | "nc-work" }, or null. Locally only claude itself counts; on another
  // machine anything else may be an isolated session, which only `nc-work feed` there can tell.
  async targetOf(addr, on) {
    const r = on ? await loginExec(on, ["hc", "get", remoteId(addr, on), "--json"], 10000) : await hc(["get", addr, "--json"]);
    if (r.code !== 0) {
      if (on) throw new Error(lastLine(r.stderr) || `hc get on ${on} exited ${r.code}`); // e.g. hc not on PATH there
      return null;
    }
    const f = JSON.parse(r.stdout)?.foreground;
    const claude = (f?.argv?.[0] ?? "").split("/").pop() === "claude";
    return f?.pid && (claude || on) ? { pid: f.pid, kind: claude ? "claude" : "nc-work" } : null;
  }

  // usage.py --orch: from this folder, sent along and run with python3 -c on the session's machine,
  // or there through `nc-work feed --orch` for an isolated session (the same paths as nc-session).
  async feed(target, on) {
    const args = ["--orch", "--pid", String(target.pid), "--since", this.sig];
    if (!on) return exec(PY, ["-I", "-B", appHome() + "/mods/nc-session/usage.py", ...args], { timeout: 20000 });
    const code = await usageScript();
    if (target.kind === "claude") return exec(PY, ["-I", "-B", "-c", code, ...args], { on, timeout: 20000 });
    return loginExec(on, ["nc-work", "feed", "--pid", String(target.pid), `--script=${code}`, "--orch", `--since=${this.sig}`], 25000);
  }

  refresh(cx) {
    const addr = this.target?.addr, on = this.target?.machine ?? null;
    if (!addr || this.busy) return;
    this.busy = true;
    this.ran = Date.now();
    cx.spawn(async (cx) => {
      try {
        let target = this.pids.get(addr);
        if (!target) {
          target = await this.targetOf(addr, on);
          this.noClaude = target ? null : addr;
          if (!target) {
            if (addr === this.addr) this.err = "Claude is not the terminal's foreground process";
            return;
          }
          this.pids.set(addr, target);
        }
        const r = await this.feed(target, on);
        if (addr !== this.addr) return;
        if (r.code !== 0) {
          this.pids.delete(addr); // look the pid up again next time (Claude may have restarted)
          this.err = /can't open file/.test(r.stderr) ? "Feed missing: deploy mods/nc-session"
            : lastLine(r.stderr) || `${target.kind === "nc-work" ? "nc-work feed" : "Feed"} exited with ${r.code}`;
          return;
        }
        const j = JSON.parse(r.stdout);
        this.err = null;
        if (j.unchanged) return;
        // Claude restarted or exited, or the isolated session is gone: look the pid up again.
        if (j.error === "no-session" || j.error === "not-isolated") this.pids.delete(addr);
        this.sig = j.sig ?? "";
        this.data = j;
        if (!j.error) this.announce(j.flow);
      } catch (e) {
        this.pids.delete(addr); // exec rejects on a timeout or an unreachable machine: look the pid up again
        if (addr === this.addr) this.err = lastLine(String(e?.message ?? e)) || "Feed failed";
      } finally {
        this.busy = false;
        cx.notify();
      }
    });
  }

  // Toasts for what changed since the last load, from the card copy only. The first load of a
  // session only records what is there.
  announce(f) {
    const tasks = tasksOf(f?.plan), prev = this.seen, state = f?.state ?? null;
    this.seen = { state, tasks: new Map(tasks.map((x) => [x.id, x.status])) };
    if (prev && prev.state !== state) this.sent = null; // an old Approve result belongs to the old state
    if (!prev || props()?.window) return;
    for (const x of tasks) {
      if (kind(x.status) === "err" && prev.tasks.get(x.id) !== x.status) notify({ title: `Task ${x.id}: ${x.status}`, body: x.title ?? "", level: "error" });
    }
    if (state === prev.state) return;
    if (state === "awaiting_approval") notify({ title: "Plan awaits approval", body: f.reason ?? "", level: "warning" });
    if (state === "done") notify({ title: "Orchestrator done", level: "success" });
    if (state === "error") notify({ title: "Orchestrator stopped with an error", level: "error" });
  }

  // "Approve plan": hc send <address> ok, here or on the session's machine, only after hc get says the
  // agent is idle or done ("done" = a finished turn nobody looked at yet; hc send --if knows only idle|working).
  approve(cx) {
    if (this.sending) return;
    if (this.fixture) { this.sent = "demo: nothing sent"; return; }
    const addr = this.target?.addr, on = this.target?.machine ?? null;
    if (!addr) return;
    this.sending = true;
    this.sent = "sending…";
    cx.spawn(async (cx) => {
      try {
        const id = on ? remoteId(addr, on) : addr;
        const run = (argv) => on ? loginExec(on, ["hc", ...argv], 10000) : hc(argv);
        let state = null;
        try { state = JSON.parse((await run(["get", id, "--json"])).stdout)?.status?.state ?? null; } catch { /* unknown: refuse below */ }
        if (state !== "idle" && state !== "done") { this.sent = `not idle (${state ?? "unknown"})`; return; }
        const r = await run(["send", "--json", id, "ok"]);
        let e = null;
        try { e = JSON.parse(r.stdout || r.stderr)?.error ?? null; } catch { /* not JSON: use stderr */ }
        const msg = e ? `${e.kind ?? ""} ${e.message ?? ""}` : lastLine(r.stderr);
        this.sent = r.code === 0 && !e ? "sent" : /idle|status|working|blocked/i.test(msg) ? "not idle" : `error: ${msg.trim() || `hc send exited ${r.code}`}`;
      } catch (err) {
        this.sent = `error: ${lastLine(String(err?.message ?? err)) || "hc send failed"}`;
      } finally {
        this.sending = false;
        cx.notify();
      }
    });
  }

  // prompt → main → crew → fork → stages or plan → outcome
  flow(v, d) {
    const { t, z, now } = v, f = d.flow ?? {}, s = d.session ?? {}, out = f.outcome ?? {};
    const routes = f.routes ?? [], steps = f.steps ?? [], H = 14 * z;
    const mainSt = s.status === "busy" ? "running" : "idle";
    const ost = out.status ?? (s.status === "busy" ? "working" : "done");
    const pathSt = routes.length && !routes.includes(f.route) ? "pending" : ost; // nothing taken: nothing lit
    // The workflow the stages belong to: the first that has every stage title as a phase.
    // The newest matching run, like the feed (steps come from the newest workflow after the prompt).
    const wf = steps.length ? (d.workflows ?? []).filter((w) => steps.every((st) => (w.phases ?? []).some((p) => p.title === st.title)))
      .reduce((m, w) => (!m || (w.started ?? 0) > (m.started ?? 0) ? w : m), null) : null;

    const running = Number(s.agents_running) || 0;
    const age = s.started ? now - s.started : (Number(s.elapsed_s) || 0) * 1000;
    const shells = Number(s.shells_running) || 0;
    const facts = [s.status === "busy" ? "working" : "idle", running ? `${running} agent${running === 1 ? "" : "s"} running` : null,
      shells ? `${shells} shell${shells === 1 ? "" : "s"}` : null, `${tok(s.tokens)} tok`];

    const prompt = h_flex().w_full().min_w(0).h(24 * z).flex_none().px(9 * z).gap(6 * z).items_center().rounded(6).bg(t.surface)
      .font_family(v.mono).text_size(11 * z)
      .child(div().flex_none().text_color(t.dim).child("›"))
      .child(text(11 * z, f.prompt ? t.muted : t.dim, f.prompt || "No prompt yet").flex_1());

    const main = node(v, mainSt, 8, [
      h_flex().w_full().min_w(0).gap(6 * z).items_center()
        .child(icon(v, mainSt, 12))
        .child(div().flex_none().text_size(12.5 * z).font_bold().text_color(t.foreground).child("main"))
        .child(text(11.5 * z, t.muted, s.label || s.model || "Claude").flex_1())
        .when(age > 0, (el) => el.child(text(11.5 * z, t.muted, clock(age)).flex_none()))
        .child(text(12 * z, t.foreground, money(s.usd)).flex_none().font_semibold()),
      text(11 * z, t.dim, facts.filter(Boolean).join(" · ")),
    ]).w_full().px(10 * z).py(7 * z).gap(3 * z);

    const route = node(v, f.route ? "done" : "pending", 7, [h_flex().gap(5 * z).items_center()
      .child(text(11 * z, t.dim, "crew"))
      .child(text(12 * z, t.foreground, `→ ${f.route ?? "–"}`))
      .when(f.source === "skill" || f.source === "plan", (el) => el.child(badge(v, f.source)))])
      .id("orch-crew").when(Boolean(f.reason), (el) => el.tooltip(String(f.reason)))
      .max_w(260 * z).px(10 * z).py(4 * z);

    const OL = look(t, ost), plan = f.plan ? tasksOf(f.plan) : null;
    const tail = OL.k === "run" ? (typeof out.usd === "number" ? `${money(out.usd)} so far` : "")
      : [typeof out.usd === "number" ? money(out.usd) : null, OL.k === "done" && wf ? span(wf.started, wf.ended, now) : null].filter(Boolean).join(" · ");
    const outcome = node(v, ost, 8, [h_flex().w_full().min_w(0).gap(6 * z).items_center()
      .child(icon(v, ost, 12))
      .child(text(11 * z, t.dim, "outcome").flex_none())
      .child(text(12 * z, OL.c, OL.k === "run" ? "working" : OL.word).flex_none())
      .when(Boolean(tail), (el) => el.child(text(11.5 * z, t.muted, `· ${tail}`).flex_1())),
      // With a plan: "k of n pass" and one segment per task in its look.
      ...(plan?.length ? [h_flex().w_full().gap(8 * z).items_center()
        .child(text(11 * z, t.muted, `${plan.filter((x) => x.status === "pass").length} of ${plan.length} pass`).flex_none())
        .child(h_flex().flex_1().h(4 * z).gap(2).children(plan.map((x) => {
          const L = look(t, x.status);
          return div().flex_1().h_full().rounded(1).bg(L.k === "wait" ? t.raised : L.c)
            .when(L.k === "run", (el) => el.loop("opacity", { from: 0.3, to: 1, period: 900 }));
        })))] : [])])
      .w_full().px(10 * z).py(6 * z).gap(4 * z);

    const els = [prompt, centre(connector(t, mainSt, H)), main, centre(connector(t, f.route ? "done" : "pending", H)), centre(route)];
    if (routes.length) els.push(...fork(v, routes, f.route, ost));
    // A plan replaces the stages (its steps are its phases).
    if (f.plan) els.push(centre(connector(t, pathSt, H)), this.plan(v, f));
    else if (steps.length) els.push(centre(connector(t, pathSt, H)), stages(v, steps, wf));
    els.push(centre(connector(t, pathSt, H)), outcome);
    return els;
  }

  // The plan: its state, musts, Approve, then per phase its lanes side by side (stacked in a
  // narrow card), each task a chip. The window draws every task expanded.
  plan(v, f) {
    const { t, z, big } = v, st = PLAN_STATE[f.state] ?? ["pending", f.state ?? "–"];
    const rows = [h_flex().w_full().flex_wrap().gap(5 * z).items_center()
      .child(chip(v, st[0], st[1]))
      .children((f.plan.musts ?? []).map((m) => badge(v, m.id, t.muted).id(`must-${m.id}`).tooltip(`${m.id} ${m.text ?? ""}`)))];
    if (f.state === "awaiting_approval" || this.sent) rows.push(this.approveRow(v, f));
    const stack = !big && this.w > 0 && this.w < 420;
    (f.plan.phases ?? []).forEach((ph, i) => {
      const tasks = (ph.lanes ?? []).flatMap((l) => l.tasks ?? []);
      rows.push(h_flex().w_full().pt(6 * z).gap(6 * z).items_center()
        .child(text(11 * z, t.dim, `Phase ${i + 1} · ${ph.name ?? ""}`).flex_1())
        .child(text(10.5 * z, t.dim, `${tasks.filter((x) => x.status === "pass").length}/${tasks.length}`).flex_none()));
      const lanes = (ph.lanes ?? []).map((l) => {
        // 3px padding: room for the pulse rings of running tasks.
        const lane = v_flex().min_w(0).p(3).gap(5 * z).child(text(10 * z, t.dim, `Lane ${l.id}`))
          .children((l.tasks ?? []).map((x) => this.task(v, x, big || this.open === x.id)));
        return stack ? lane.w_full() : lane.flex_1();
      });
      rows.push(stack ? v_flex().w_full().children(lanes) : h_flex().w_full().items_start().gap(2 * z).children(lanes));
    });
    return v_flex().w_full().px(8 * z).py(6 * z).rounded(8).border(1).border_color(t.border).bg(t.surface).children(rows);
  }

  // The button while the plan awaits approval and the agent is idle ("done" is idle not yet
  // looked at), greyed while a send runs; then the result line.
  approveRow(v, f) {
    const { t, z } = v;
    const idle = this.fixture ? this.fixture.session?.status === "idle" : ["idle", "done"].includes(this.target?.status);
    const show = f.state === "awaiting_approval" && idle;
    return h_flex().w_full().gap(8 * z).items_center()
      .when(show, (el) => el.child(noDrag(div().id("orch-approve").flex_none().px(8 * z).py(2 * z).rounded(5)
        .bg(t.solid).text_size(11 * z).font_medium().text_color(t.solid_foreground)
        .when(this.sending, (b) => b.opacity(0.5).cursor_not_allowed())
        .when(!this.sending, (b) => b.cursor_pointer().on_click((_e, cx) => { this.approve(cx); cx.notify(); }))
        .child("Approve plan"))))
      .when(Boolean(this.sent), (el) => el.child(text(10.5 * z, t.dim, this.sent).flex_1()));
  }

  // A task chip: status icon, id, role, ↻n, ⎇ (branch), D (delegate), review. A click on it in
  // the card expands it (one at a time).
  task(v, x, open) {
    const { t, z, big } = v;
    const head = h_flex().id(`task-${x.id}`).w_full().min_w(0).gap(4 * z).items_center()
      .child(icon(v, x.status, 10))
      .child(div().flex_none().text_size(11 * z).font_semibold().text_color(t.foreground).child(String(x.id)))
      .child(text(10.5 * z, t.dim, x.role ?? "").flex_1())
      .when(x.status === "redo", (el) => el.child(div().flex_none().text_size(10 * z).text_color(t.working).child(`↻${x.redos || 1}`)))
      .when(Boolean(x.branch), (el) => el.child(div().flex_none().text_size(10.5 * z).text_color(t.dim).child("⎇")))
      .when(Boolean(x.delegate), (el) => el.child(div().flex_none().text_size(10 * z).font_bold().text_color(t.dim).child("D")))
      .when(Boolean(x.review), (el) => el.child(badge(v, x.review, x.review === "pass" ? t.done : x.review.startsWith("findings") ? t.blocked : t.accent)))
      .when(!big, (el) => el.cursor_pointer().on_click((_e, cx) => { this.open = this.open === x.id ? null : x.id; cx.notify(); }));
    return node(v, x.status, 6, [head, ...(open ? this.details(v, x) : [])]).w_full().px(6 * z).py(3 * z).gap(2 * z);
  }

  details(v, x) {
    const { t, z, now } = v;
    const row = (k, val, extra) => h_flex().w_full().min_w(0).gap(6 * z).items_center()
      .child(div().w(50 * z).flex_none().text_size(10 * z).text_color(t.dim).child(k))
      .child(text(10.5 * z, t.muted, val).flex_1())
      .when(Boolean(extra), (el) => el.child(extra));
    const ans = Object.entries(x.answers ?? {}), a = x.agent;
    // The worker's terminal, named after the delegate id (hidden when there is none).
    const term = x.delegate ? terminals().find((m) => m.name === x.delegate) : null;
    const peek = term && noDrag(div().id(`peek-${x.id}`).flex_none().px(5).rounded(4).bg(t.raised).text_size(10 * z)
      .text_color(t.accent).cursor_pointer().hover((s) => s.bg(t.hover))
      .on_click(() => run("terminal.peek", { terminal: term.address })).child("peek"));
    return [
      x.title && text(11 * z, t.foreground, x.title),
      x.files?.length && row("files", x.files.join(", ")),
      x.proof && row("proof", x.proof),
      x.after?.length && row("after", x.after.join(", ")),
      ans.length && h_flex().w_full().flex_wrap().gap(4 * z).children(ans.map(([m, r]) => badge(v, `${m} ${r === "kept" ? "✓" : "✗"}`, r === "kept" ? t.done : t.blocked))),
      x.evidence && row("evidence", x.evidence),
      x.branch && row("branch", `⎇ ${x.branch}`),
      x.delegate && row("delegate", x.delegate, peek),
      x.review && row("review", x.review),
      a && row("agent", [a.status, `${Number(a.tools) || 0} tools`, money(a.cost_usd), span(a.started, a.ended, now)].filter(Boolean).join(" · "), icon(v, a.status, 10)),
    ].filter(Boolean);
  }

  section(v, label, count) {
    return h_flex().pt(14 * v.z).pb(4).gap(6).items_center().flex_none()
      .child(div().text_size(11 * v.z).font_medium().text_color(v.t.dim).child(label))
      .child(div().text_size(11 * v.z).text_color(v.t.dim).child(String(count)));
  }

  agentRow(v, w, a, big) {
    const { t, z } = v, on = kind(a.status) === "run";
    return h_flex().id(`wf-${w.id}-${a.id}`).h(20 * z).flex_none().pl(26 * z).gap(6 * z).items_center()
      .child(icon(v, a.status, 11))
      .child(text(11.5 * z, on ? t.foreground : t.muted, a.label || a.id).flex_1())
      .when(on && Boolean(a.last_tool), (el) => el.child(text(11 * z, t.dim, a.last_tool).flex_none().max_w(90 * z)))
      .when(big && Boolean(a.phase), (el) => el.child(text(11 * z, t.dim, a.phase).flex_none().max_w(120 * z)))
      .child(text(11 * z, t.dim, `${tok(a.tokens)} tok`).flex_none())
      .child(text(11 * z, t.dim, money(a.cost_usd)).w(52 * z).flex_none().text_right());
  }

  // Running: marching arrow, name, phase, elapsed, cost, and the agents of the current and
  // failed phases. Finished: one dim line. The window opens every agent of every workflow.
  workflows(v, d, big) {
    const { t, z, now } = v, all = d.workflows ?? [], list = all.slice(0, big ? 8 : 4);
    if (!list.length) return [];
    const rows = [this.section(v, "Workflows", all.length)];
    for (const w of list) {
      const on = kind(w.status) === "run", cur = currentPhase(w), name = String(w.name || w.id);
      if (on) {
        rows.push(h_flex().id(`wf-${w.id}`).h(22 * z).flex_none().gap(6 * z).items_center()
          .child(div().w(20 * z).flex_none().font_family(v.mono).text_size(11 * z).text_color(t.working).frames(MARCH, 140))
          .child(h_flex().flex_1().min_w(0).gap(4 * z).items_center()
            .child(text(12 * z, t.foreground, name))
            .when(Boolean(cur), (el) => el.child(text(11 * z, t.dim, `· ${cur}`).flex_none())))
          .child(text(11 * z, t.dim, span(w.started, w.ended, now)).flex_none())
          .child(text(11 * z, t.muted, money(w.totals?.cost_usd)).w(52 * z).flex_none().text_right()));
      } else {
        const what = kind(w.status) === "done" ? [name, span(w.started, w.ended, now), money(w.totals?.cost_usd)] : [name, w.status ?? "unknown"];
        rows.push(h_flex().id(`wf-${w.id}`).h(20 * z).flex_none().gap(6 * z).items_center()
          .child(h_flex().w(20 * z).flex_none().justify_center().child(icon(v, w.status, 10)))
          .child(text(11.5 * z, t.dim, what.filter(Boolean).join(" · ")).flex_1()));
      }
      // Killed and stale agents count as failed too (the feed's p.error only counts errors).
      const failed = new Set([...(w.phases ?? []).filter((p) => p.error).map((p) => p.title),
        ...(w.agents ?? []).filter((a) => kind(a.status) === "err").map((a) => a.phase)]);
      const shown = big ? w.agents ?? [] : on ? (w.agents ?? []).filter((a) => a.phase === cur || failed.has(a.phase)) : [];
      rows.push(...shown.map((a) => this.agentRow(v, w, a, big)));
    }
    return rows;
  }

  subagents(v, d, big) {
    const { t, z, now } = v, all = d.subagents ?? [], list = all.slice(0, big ? 8 : 6);
    if (!list.length) return [];
    return [this.section(v, "Subagents", all.length), ...list.map((s) => {
      const on = kind(s.status) === "run";
      return h_flex().id(`sa-${s.id}`).h(22 * z).flex_none().gap(7 * z).items_center()
        .child(icon(v, s.status, 12))
        .child(text(11 * z, t.dim, s.type || "agent").flex_none().max_w(96 * z))
        .child(text(12 * z, on ? t.muted : t.dim, s.description).flex_1())
        .when(big, (el) => el.child(text(11 * z, t.dim, money(s.cost_usd)).w(52 * z).flex_none().text_right()))
        .child(text(11 * z, on ? t.working : t.dim, span(s.started, s.ended, now)).flex_none());
    })];
  }

  // nc delegate workers (OpenCode in an nc-work task): role, model, last tool while running,
  // tokens, cost, time. A worker whose terminal is there gets "peek".
  workers(v, d, big) {
    const { t, z, now } = v, all = d.workers ?? [], list = all.slice(0, 8);
    if (!list.length) return [];
    const terms = terminals();
    return [this.section(v, "Workers", all.length), ...list.map((w) => {
      const on = kind(w.status) === "run", word = kind(w.status) === "done" && w.status !== "ended" ? null : w.status;
      const term = terms.find((m) => m.name === w.id);
      const model = String(w.model || "").replace(/^openrouter\//, "");
      return h_flex().id(`wk-${w.id}`).h(22 * z).flex_none().gap(7 * z).items_center()
        .when(Boolean(w.reason), (el) => el.tooltip(String(w.reason)))
        .child(icon(v, w.status, 12))
        .child(text(11 * z, t.dim, w.role || "worker").flex_none().max_w(70 * z))
        .child(text(12 * z, on ? t.muted : t.dim, model || w.id).flex_1())
        .when(on && Boolean(w.last_tool), (el) => el.child(text(11 * z, t.dim, w.last_tool).flex_none().max_w(70 * z)))
        .when(!on && Boolean(word), (el) => el.child(text(11 * z, look(t, w.status).c, word.replace(/_/g, " ")).flex_none()))
        .when(big || on, (el) => el.child(text(11 * z, t.dim, `${tok(w.tokens)} tok`).flex_none()))
        .when(big || typeof w.cost_usd === "number", (el) => el.child(text(11 * z, t.dim, money(w.cost_usd)).flex_none()))
        .child(text(11 * z, on ? t.working : t.dim, span(w.started, w.ended, now)).flex_none())
        .when(Boolean(term), (el) => el.child(noDrag(div().id(`wk-peek-${w.id}`).flex_none().px(5).rounded(4).bg(t.raised)
          .text_size(10 * z).text_color(t.accent).cursor_pointer().hover((s) => s.bg(t.hover))
          .on_click(() => run("terminal.peek", { terminal: term.address })).child("peek"))));
    })];
  }

  // Background shells (Bash run_in_background) the session still waits for.
  shells(v, d) {
    const { t, z, now } = v, all = d.shells ?? [];
    if (!all.length) return [];
    return [this.section(v, "Shells", all.length), ...all.map((x) => h_flex().id(`sh-${x.id}`).h(22 * z).flex_none()
      .gap(7 * z).items_center()
      .child(icon(v, "running", 12))
      .child(text(12 * z, t.muted, x.description).flex_1())
      .child(text(11 * z, t.working, span(x.started, null, now)).flex_none()))];
  }

  render(cx) {
    const t = theme(), p = props(), big = Boolean(p?.window), z = big ? 1.25 : 1;
    const v = { t, z, big, now: Date.now(), mono: settings().font_family ?? "JetBrains Mono" };
    let d = this.fixture ?? null, note = null;
    if (!d) {
      const g = (this.target = this.follow());
      if (g.addr !== this.addr) Object.assign(this, { addr: g.addr, data: null, sig: "", err: null, key: null, seen: null, sent: null, open: null });
      const key = g.addr ? `${g.addr}|${g.status}` : null;
      // A switch of agent or status refreshes now; while busy, the run's notify brings us back here.
      if (key && key !== this.key && !this.busy) { this.key = key; this.refresh(cx); }
      if (!g.addr) note = "No Claude session in this space";
      else if (this.data?.error === "no-session") note = "No Claude session file for this terminal";
      else if (this.data?.error === "no-transcript") note = "No transcript yet";
      else if (this.data?.error === "not-isolated") note = "This terminal is not running claude right now";
      else if (this.data) d = this.data;
      else note = this.err ?? "Loading…";
    }
    // A plan waiting for approval is not running: the chip says so while the session waits.
    const waiting = d?.flow?.state === "awaiting_approval" && d?.session?.status !== "busy";
    const runState = d ? (waiting ? "idle" : d.flow?.outcome?.status ?? (d.session?.status === "busy" ? "working" : "done")) : "idle";

    const head = h_flex().px(12).h(34 * z).flex_none().gap(10).items_center()
      .child(div().text_size(12 * z).font_semibold().text_color(t.foreground).child("Orchestrator"))
      .child(div().flex_1())
      .child(chip(v, runState, waiting ? "awaiting approval" : undefined))
      .when(!big, (el) => el.child(div().id("orch-open").text_size(11).text_color(t.dim).cursor_pointer()
        .hover((s) => s.text_color(t.foreground))
        .on_click(() => openOverlay({ mod: "nc-orchestrator", kind: "window", key: "nc-orchestrator-window", width: 760, height: 680, props: { window: true, demo: p?.demo ?? false } }))
        .child("pipeline ↗")))
      .when(big && Boolean(p?.overlay), (el) => el.child(div().id("orch-close").px(6).py(2).rounded(5).text_size(12).text_color(t.dim).cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation()) // a press on a control must not drag the window
        .on_click(() => closeOverlay(p.overlay))
        .child("✕")))
      .when(Boolean(p?.card), (el) => el.child(hideCard(t, p.card)));

    const body = v_flex().id("orch-body").flex_1().min_h(0).overflow_y_scrollbar().px(12).pt(2).pb(10);
    return v_flex().id("root").size_full().min_h(0).text_color(t.foreground)
      .on_size_change((size, cx) => { if (size.width !== this.w) { this.w = size.width; cx.notify(); } })
      .when(big, (el) => el.bg(t.chrome).rounded(10))
      .child(head)
      .child(d
        ? body.children([...this.flow(v, d), ...this.workflows(v, d, big), ...this.subagents(v, d, big),
          ...this.workers(v, d, big), ...this.shells(v, d)])
          .when(Boolean(this.err), (el) => el.child(div().pt(8).text_size(11).text_color(t.dim).truncate().child(String(this.err))))
        : body.child(div().text_size(12 * z).text_color(t.dim).child(note)));
  }
}
