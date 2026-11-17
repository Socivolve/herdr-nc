// nc-servers: TCP listeners on this computer whose folder is inside a project (a local space
// folder or a pane's cwd). Click a row to open it in the browser.
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, spaces, panes, home, theme, run, props } from "herdr";
import { parseListeners, parseCwds, projectRoots, under, urlOf, answered } from "./parse.js";

// ✕ in a card's header hides its layout block (props.card); the nc-cards bar shows it again.
const hideCard = (t, id) => div().id("nc-card-hide").flex_none().px(4).text_size(11).text_color(t.dim).cursor_pointer()
  .hover((s) => s.text_color(t.foreground)).tooltip("Hide this card").on_click(() => run("layout.hide", { id })).child("✕");

const LSOF = "/usr/sbin/lsof", CURL = "/usr/bin/curl", OPEN = "/usr/bin/open";
const TRIES = 3; // a dev server still compiling its first page may answer HTTP only on a later tick

export default class Servers extends View {
  init(_props, cx) {
    this.list = [];          // every listener: { pid, command, host, port }
    this.cwd = new Map();    // pid -> cwd (null when lsof can't read it)
    this.http = new Map();   // "pid:port" -> true (answered) or failed tries
    this.busy = false; this.loaded = false; this.err = null;
    cx.timer.every(10000, (cx) => this.tick(cx));
    this.tick(cx);
  }

  tick(cx) {
    if (this.busy) return;
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        // Exit code 1 means no listeners (or a pid lsof can't read): the output still counts.
        const r = await exec(LSOF, ["-nP", "-iTCP", "-sTCP:LISTEN", "-Fpcn"], { timeout: 5000 });
        const list = parseListeners(r.stdout);
        const pids = [...new Set(list.map((l) => l.pid))];
        const want = pids.filter((p) => !this.cwd.has(p));
        const found = want.length
          ? parseCwds((await exec(LSOF, ["-a", "-d", "cwd", "-Fpn", "-p", want.join(",")], { timeout: 5000 })).stdout)
          : new Map();
        this.cwd = new Map(pids.map((p) => [p, this.cwd.has(p) ? this.cwd.get(p) : found.get(p) ?? null]));

        const roots = projectRoots(spaces(), panes(), home());
        const keys = new Set(list.map((l) => `${l.pid}:${l.port}`));
        for (const k of [...this.http.keys()]) if (!keys.has(k)) this.http.delete(k);
        const probe = list.filter((l) => {
          const v = this.http.get(`${l.pid}:${l.port}`);
          return under(this.cwd.get(l.pid), roots) && v !== true && !(v >= TRIES);
        });
        // curl, not fetch(): fetch has no timeout.
        await Promise.all(probe.map(async (l) => {
          const key = `${l.pid}:${l.port}`;
          const c = await exec(CURL, ["-s", "-o", "/dev/null", "-m", "1", "-w", "%{http_code}", urlOf(l.host, l.port)], { timeout: 3000 }).catch(() => null);
          this.http.set(key, answered(c?.stdout) || (Number(this.http.get(key)) || 0) + 1);
        }));
        Object.assign(this, { list, err: null });
      } catch (e) {
        Object.assign(this, { list: [], err: String(e?.message ?? e).split("\n")[0].slice(0, 200) });
      } finally {
        this.busy = false; this.loaded = true;
        cx.notify();
      }
    });
  }

  render(_cx) {
    const t = theme();
    const roots = projectRoots(spaces(), panes(), home());
    const rows = this.list.filter((l) => under(this.cwd.get(l.pid), roots));
    const row = (l) => {
      const url = urlOf(l.host, l.port), dir = this.cwd.get(l.pid), ok = this.http.get(`${l.pid}:${l.port}`) === true;
      return h_flex().id(`srv-${l.pid}-${l.port}`).h(24).flex_none().px(6).gap(8).items_center().rounded(6)
        .cursor_pointer().hover((s) => s.bg(t.hover)).tooltip(url)
        .on_click(() => { exec(OPEN, [url], { timeout: 5000 }).catch(() => {}); })
        .child(div().w(7).h(7).flex_none().rounded(4).bg(ok ? t.done : t.dim))
        .child(div().flex_none().font_semibold().child(String(l.port)))
        .child(div().flex_none().max_w("45%").truncate().text_color(t.muted).child(l.command))
        .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(dir.slice(dir.lastIndexOf("/") + 1)));
    };
    const note = this.err ?? (this.loaded ? "No dev servers in your project folders" : "Looking for servers…");
    return v_flex().size_full().min_h(0).text_size(12.5).text_color(t.foreground)
      .child(h_flex().px(14).pt(12).pb(4).flex_none().items_center().gap(8)
        .child(div().flex_1().text_size(11.5).font_medium().text_color(t.dim).child("Active servers"))
        .when(rows.length > 0, (el) => el.child(div().text_size(11.5).text_color(t.dim).child(String(rows.length))))
        .when(Boolean(props()?.card), (el) => el.child(hideCard(t, props().card))))
      .child(rows.length
        ? v_flex().id("servers").flex_1().min_h(0).px(8).pb(8).overflow_y_scrollbar().children(rows.map(row))
        : div().px(14).py(2).text_size(12).text_color(t.dim).child(note));
  }
}
