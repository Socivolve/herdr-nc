// nc-session: what the Claude Code session followed in this space costs ("usage") and what it
// used ("used"), from usage.py next to this file. props.view picks one; null props draw both.
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, spaces, exec, hc, appHome, readTextFile, theme, props, run } from "herdr";
import { DEMO } from "./fixture.js";

// ✕ in a card's header hides its layout block (props.card); the nc-cards bar shows it again.
const hideCard = (t, id) => div().id("nc-card-hide").flex_none().px(4).text_size(11).text_color(t.dim).cursor_pointer()
  .hover((s) => s.text_color(t.foreground)).tooltip("Hide this card").on_click(() => run("layout.hide", { id })).child("✕");

const isClaude = (a) => a.app === "claude-code" || a.program?.key === "claude";
const first = (s) => String(s ?? "").trim().split("\n")[0].slice(0, 200);
const usd = (v) => (v == null ? "?" : `$${v.toFixed(2)}`);
const ERRORS = {
  "no-session": "No Claude session file for this agent",
  "no-transcript": "No transcript for this session yet",
  "not-isolated": "This terminal is not running claude right now",
};

function compact(n) {
  for (const [d, s] of [[1e9, "B"], [1e6, "M"], [1e3, "K"]]) if (n >= d) return `${+(n / d).toFixed(1)}${s}`;
  return String(n || 0);
}

// Another machine has no usage.py: it goes along as one argument (about 45 KB), read once per load.
let script = null;
async function usageScript() {
  script ??= await readTextFile(`${appHome()}/mods/nc-session/usage.py`);
  if (!script) throw new Error("usage.py not found in the Herdr home");
  return script;
}

// On another machine, through its login shell so PATH has ~/.local/bin (hc, nc-work).
// The command and its arguments go as "$@", never through shell quoting.
const loginExec = (on, argv, timeout) => exec("sh", ["-lc", 'exec "$@"', "sh", ...argv], { on, timeout });

// Where the feed runs, from what the terminal's foreground process is:
//   local claude       usage.py from this folder
//   remote claude      the same script, run on that machine with python3 -c
//   remote other       `nc-work feed` there: maybe an isolated session in a container
async function runFeed(target, since) {
  const { pid, on, kind } = target;
  if (!on) return exec("/usr/bin/python3", ["-I", "-B", `${appHome()}/mods/nc-session/usage.py`, "--pid", String(pid), "--since", since], { timeout: 20000 });
  const code = await usageScript();
  if (kind === "claude") return exec("/usr/bin/python3", ["-I", "-B", "-c", code, "--pid", String(pid), "--since", since], { on, timeout: 20000 });
  return loginExec(on, ["nc-work", "feed", "--pid", String(pid), `--script=${code}`, `--since=${since}`], 25000);
}

// Deliberate exception to "state per copy in the class": while a helper run is in
// flight, the other copy asking for the same target and sig awaits it instead of starting its own.
// Only in flight: a finished answer handed to a status-change refresh could hide the final cost.
let inflight = null;
function feed(target, since) {
  const key = `${target.on}|${target.pid}|${target.kind}|${since}`;
  if (inflight?.key !== key) {
    const promise = runFeed(target, since).finally(() => { if (inflight?.key === key) inflight = null; });
    inflight = { key, promise };
  }
  return inflight.promise;
}

export default class Session extends View {
  init(_props, cx) {
    this.pids = new Map(); // agent address -> { pid, on, kind } (dropped when the feed finds nothing)
    this.addr = null; this.remote = null; this.data = null; this.sig = ""; this.err = null;
    this.loaded = null; this.busy = false; this.again = false; this.slow = 0; this.seen = null;
    if (!props()?.demo) cx.timer.every(5000, (cx) => this.tick(cx));
  }

  // The Claude agent to follow in the active space (same rule as nc-folders and nc-git):
  // a focused candidate, else the current one, else the most recently changed.
  follow() {
    const space = spaces().find((s) => s.active);
    const tabs = new Set(space?.tabs.map((t) => t.id));
    const list = space ? agents().filter((a) => isClaude(a) && (a.space === space.id || tabs.has(a.tab))) : [];
    const agent = list.find((a) => a.focused) ?? list.find((a) => a.address === this.addr)
      ?? list.reduce((m, a) => (!m || a.seq > m.seq ? a : m), null);
    const addr = agent?.address ?? null;
    if (addr !== this.addr) Object.assign(this, { addr, data: null, sig: "", err: null, loaded: null });
    this.remote = space?.machine ?? (addr?.includes("/") ? addr.split("/")[0] : null);
    return agent;
  }

  tick(cx) {
    const agent = this.follow();
    if (!agent || this.busy) return;
    // Not working and loaded: only every 6th tick (30 s), so background workflows still show up.
    if (agent.status !== "working" && this.loaded === agent.address && ++this.slow % 6) return;
    this.refresh(cx);
  }

  // The process to read. Locally only claude itself. On another machine anything else may be an
  // isolated session (nc-work), which only `nc-work feed` there can tell.
  async targetOf(addr) {
    if (this.pids.has(addr)) return this.pids.get(addr);
    const on = this.remote;
    const id = on && addr.startsWith(`${on}/`) ? addr.slice(on.length + 1) : addr;
    if (on && !/^[A-Za-z0-9_.:-]+$/.test(id)) throw new Error(`unexpected terminal address ${addr}`);
    const r = on ? await loginExec(on, ["hc", "get", id, "--json"], 10000) : await hc(["get", addr, "--json"]);
    if (r.code !== 0) throw new Error(first(r.stderr) || `hc get exited ${r.code}`);
    const fg = JSON.parse(r.stdout).foreground;
    const claude = (fg?.argv?.[0] ?? "").split("/").pop() === "claude";
    if (!fg?.pid || (!claude && !on)) return null;
    const target = { pid: fg.pid, on, kind: claude ? "claude" : "nc-work" };
    this.pids.set(addr, target);
    return target;
  }

  refresh(cx) {
    const addr = this.addr;
    if (!addr) return;
    if (this.busy) { this.again = true; return; }
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        const target = await this.targetOf(addr);
        if (this.addr !== addr) return;
        if (!target) Object.assign(this, { data: null, sig: "", err: ERRORS["not-isolated"] });
        else {
          const r = await feed(target, this.sig);
          if (this.addr !== addr) return;
          if (r.code !== 0) {
            this.pids.delete(addr);
            throw new Error(first(r.stderr) || `${target.kind === "nc-work" ? "nc-work feed" : "usage.py"} exited ${r.code}`);
          }
          const out = JSON.parse(r.stdout);
          if (out.error) {
            if (out.error === "no-session" || out.error === "not-isolated") this.pids.delete(addr);
            Object.assign(this, { data: null, sig: "", err: ERRORS[out.error] ?? out.error });
          } else if (!out.unchanged) Object.assign(this, { data: out, sig: out.sig ?? "", err: null });
        }
        this.loaded = addr;
      } catch (e) {
        if (this.addr === addr) Object.assign(this, { data: null, sig: "", err: first(e?.message ?? e), loaded: addr });
      } finally {
        this.busy = false;
        cx.notify();
        if (this.again) { this.again = false; this.refresh(cx); }
      }
    });
  }

  header(t, title, right) {
    return h_flex().px(14).pt(12).pb(4).flex_none().items_center().gap(8)
      .child(div().flex_1().text_size(11.5).font_medium().text_color(t.dim).child(title))
      .when(Boolean(right), (el) => el.child(div().text_size(13).font_semibold().text_color(t.foreground).child(right)))
      .when(Boolean(props()?.card), (el) => el.child(hideCard(t, props().card)));
  }

  note(t, text) {
    return div().px(14).py(2).text_size(12).text_color(t.dim).child(text);
  }

  usage(t, data, msg) {
    const total = data?.total;
    const right = total ? `≈ ${usd(total.usd)}${total.unpriced?.length ? " + ?" : ""}` : null;
    const el = v_flex().flex_1().min_h(0).child(this.header(t, "Usage by model", right));
    if (!data) return el.child(this.note(t, msg));
    const models = [...(data.models ?? [])].sort((a, b) => (b.usd ?? -1) - (a.usd ?? -1));
    const row = (m) => {
      const tokens = m.input + m.output + m.cache_read + m.cache_write_5m + m.cache_write_1h;
      const pct = total.usd > 0 && m.usd != null ? Math.min(100, (m.usd / total.usd) * 100) : 0;
      return v_flex().flex_none().gap(2)
        .child(h_flex().gap(8).items_center()
          .child(div().w(72).flex_none().truncate().child(m.label || m.model))
          .child(div().flex_1().h(6).rounded(3).bg(t.raised).child(div().h_full().rounded(3).bg(t.accent).w(`${pct}%`)))
          .child(div().w(52).flex_none().text_right().text_color(t.muted).child(compact(tokens)))
          .child(div().w(64).flex_none().text_right().child(usd(m.usd))))
        .child(div().truncate().text_size(11).text_color(t.dim)
          .child(`in ${compact(m.input)} · out ${compact(m.output)} · cache read ${compact(m.cache_read)} · cache write ${compact(m.cache_write_5m + m.cache_write_1h)}`));
    };
    const parts = data.parts ?? {};
    return el
      .child(div().px(14).pb(8).flex_none().truncate().text_size(11).text_color(t.dim)
        .child(`API list price · not your plan${data.prices_as_of ? ` · prices ${data.prices_as_of}` : ""}`))
      .child(v_flex().id("usage-models").flex_1().min_h(0).px(14).gap(8).overflow_y_scrollbar()
        .when(!models.length, (el) => el.child(div().text_size(12).text_color(t.dim).child("No usage yet")))
        .children(models.map(row)))
      .child(div().mx(14).py(7).flex_none().border_t(1).border_color(t.border).truncate().text_size(11).text_color(t.dim)
        .child(`main ${usd(parts.main?.usd ?? 0)} · subagents ${usd(parts.sub?.usd ?? 0)} (${parts.sub?.files ?? 0})`));
  }

  used(t, data, msg) {
    const el = v_flex().flex_1().min_h(0).child(this.header(t, "Used in this session"));
    if (!data) return el.child(this.note(t, msg));
    const u = data.used ?? {};
    const label = (text) => div().pt(6).pb(3).text_size(11).text_color(t.dim).child(text);
    const chips = (title, list, max) => (list?.length ? [label(title), h_flex().flex_wrap().gap(4).children([
      ...list.slice(0, max).map(([name, n]) => h_flex().h(20).px(6).gap(4).rounded(5).bg(t.raised).items_center().text_size(11.5)
        .child(name).child(div().text_color(t.dim).child(String(n)))),
      ...(list.length > max ? [div().h(20).px(4).text_size(11.5).text_color(t.dim).child(`+${list.length - max}`)] : []),
    ])] : []);
    const paths = (id, title, list = []) => [
      label(`${title} (${list.length})`),
      v_flex().id(id).flex_1().min_h(40).overflow_y_scrollbar().children(list.map((p, i) => {
        const cut = p.lastIndexOf("/");
        return h_flex().id(`${id}-${i}`).h(20).flex_none().gap(6).items_center().tooltip(p)
          .child(div().min_w(0).flex_none().max_w("60%").truncate().child(p.slice(cut + 1)))
          .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(cut > 0 ? p.slice(0, cut) : ""));
      })),
    ];
    return el.child(v_flex().flex_1().min_h(0).px(14).pb(8)
      .children([...chips("Tools", u.tools, 10), ...chips("Skills", u.skills, 10), ...chips("Connectors", u.connectors, 10)])
      .children([...paths("edited", "Edited", u.edited), ...paths("read", "Read", u.read)]));
  }

  render(cx) {
    const t = theme();
    const view = props()?.view;
    let data = DEMO, msg = null;
    if (!props()?.demo) {
      const agent = this.follow();
      // A new agent or a status change asks right away instead of waiting for the tick.
      const seen = `${agent?.address}|${agent?.status}`;
      if (seen !== this.seen) { this.seen = seen; this.refresh(cx); }
      data = this.data;
      msg = !agent ? "No Claude Code agent in this space" : this.err ?? "Loading…";
    }
    return v_flex().size_full().min_h(0).text_size(12.5).text_color(t.foreground)
      .when(view !== "used", (el) => el.child(this.usage(t, data, msg)))
      .when(!view, (el) => el.child(div().flex_none().h(1).bg(t.border)))
      .when(view !== "usage", (el) => el.child(this.used(t, data, msg)));
  }
}
