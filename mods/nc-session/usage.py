#!/usr/bin/python3
"""Feed for the nc-session and nc-orchestrator mods: token usage, estimated API-list cost and the
orchestration state of one Claude Code session. Read-only. Python 3.9 standard library, one file.

The mods run it as  /usr/bin/python3 -I -B <appHome>/mods/nc-session/usage.py ...
  --pid <claude pid> [--since <sig>]          usage mode: models, cost, tools/skills/connectors/files used
  --pid <claude pid> [--since <sig>] --orch   orchestrator mode: flow, workflows, subagents
  --selftest                                  asserts on the prices and on a temp ~/.claude-like folder
Bad arguments exit 2. Every other outcome exits 0 with one JSON object on stdout. When --since equals the
current signature (sizes of every file involved) it prints only {"v":1,"unchanged":true,"sig":...}.

Reads, never writes: ~/.claude/sessions/<pid>.json (never the *.key files next to it), the main transcript
~/.claude/projects/<project>/<session>.jsonl, everything under <session>/subagents and <session>/workflows,
and in --orch mode ~/.claude/nc-orchestrator/<session>.json.
Prints only ids, labels, model ids, counts, statuses, times (epoch ms), tool/skill/connector names, file paths
(usage mode) and the first line of the latest typed prompt, max 100 chars (orch mode). Never message text,
results, scripts or file contents.

Status file (orch mode). If ~/.claude/nc-orchestrator/<sessionId>.json exists, parses and was modified less
than 6 hours ago, it replaces parts of the derived flow. Version 2 is written by `nc orchestrator status` (nc-harness):
flow.source becomes "plan", flow.route/reason/state come from the file, flow.plan holds its
constraints and phases (validated and capped as the writer's contract says; each task gets "agent", the newest
subagent whose description starts with "<task id> " or "<task id>:"), flow.steps is one step per phase and
flow.outcome.status follows the state (done, error, else working). Without a v2 file flow.reason, flow.state
and flow.plan are null.
Version 1, written by a skill or hook of your own: its keys replace the derived flow and flow.source becomes "skill". Every key
is optional; a key with the wrong type is ignored.
    {"v": 1,
     "prompt": "one line",                       (cut to 100 chars)
     "routes": ["plain", "reviewed", "orchestrate"],  (max 6 names, 40 chars each)
     "route": "reviewed",                         (the branch taken)
     "steps": [{"title": "research", "status": "done|running|pending|error", "done": 3, "total": 3}],  (max 12)
     "outcome": {"status": "working|done|error", "usd": 1.25}}   (merged over the derived outcome)
This script never writes that file.
"""
import glob, json, os, re, sys, time
from collections import Counter
from datetime import datetime, timezone

# USD per million tokens: input, output, cache read, cache write 5m, cache write 1h (Claude API reference, cached 2026-11-03)
PRICES_AS_OF = "2026-11-03"
PRICES = {
    "claude-fable-5-2": (8, 40, 0.20, 10, 16),
    "claude-fable-5-1": (10, 50, 0.25, 12.5, 20),
    "claude-fable-5": (10, 50, 1, 12.5, 20),
    "claude-opus-5-5": (4, 20, 0.20, 5, 8),
    "claude-opus-5": (5, 25, 0.5, 6.25, 10),
    "claude-opus-4-8": (5, 25, 0.5, 6.25, 10),
    "claude-opus-4-7": (5, 25, 0.5, 6.25, 10),
    "claude-opus-4-6": (5, 25, 0.5, 6.25, 10),
    "claude-sonnet-5-5": (2, 10, 0.10, 2.5, 4),
    "claude-sonnet-5": (2, 10, 0.2, 2.5, 4),
    "claude-sonnet-4-6": (3, 15, 0.3, 3.75, 6),
    "claude-haiku-5-5": (0.10, 0.50, 0.01, 0.125, 0.2),  # cache read assumed 0.1x input
    "claude-haiku-4-5": (1, 5, 0.1, 1.25, 2),
}
HAIKU55_LONG = (0.50, 2.50, 0.05, 0.625, 1.0)  # prompt > 100K tokens
FAST, US_GEO = 2.0, 1.1  # usage.speed == "fast", usage.inference_geo == "us"
TOKEN_KEYS = ("input", "output", "cache_read", "cache_write_5m", "cache_write_1h")
EDIT_TOOLS = ("Edit", "Write", "MultiEdit", "NotebookEdit")
STALE_MS = 15 * 60 * 1000  # shortcut: no write for 15 min = stale; a long Bash call or generation can exceed it
OVERRIDE_MAX_S = 6 * 3600
ROUTES = ["plain", "reviewed", "orchestrate"]
TASK_STATUS = ("pending", "running", "review", "sent_back", "pass", "fail", "blocked", "conflict")
STATES = ("planning", "awaiting_approval", "running", "final_check", "done", "error")
NOTE_ID, NOTE_STATUS = re.compile(r"<task-id>(.*?)</task-id>"), re.compile(r"<status>(.*?)</status>")
UUID = re.compile(r"[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}")


def num(x):
    return x if isinstance(x, (int, float)) and not isinstance(x, bool) else 0


def s(x):
    return x if isinstance(x, str) and x else None


def cut(x, n):
    return x[:n] if isinstance(x, str) else None


def strs(x, n, k):
    """At most k strings of a list, each cut to n chars; other items dropped."""
    return [v[:n] for v in x if isinstance(v, str)][:k] if isinstance(x, list) else []


def dicts(x, k=None):
    return [v for v in x if isinstance(v, dict)][:k] if isinstance(x, list) else []


def norm(model):
    return re.sub(r"(\[.*\]|-\d{8})$", "", model or "")  # "claude-haiku-4-5-20251001" / "x[1m]" -> base id


def label(model):
    m = re.match(r"claude-([a-z]+)-(\d+(?:-\d+)*)$", model or "")
    return f"{m.group(1).capitalize()} {m.group(2).replace('-', '.')}" if m else (model or "?")


def split(u):
    """usage -> (input, output, cache_read, cache_write_5m, cache_write_1h). Thinking is inside output already."""
    cc = u.get("cache_creation") if isinstance(u.get("cache_creation"), dict) else {}
    w1h, w5m = num(cc.get("ephemeral_1h_input_tokens")), num(cc.get("ephemeral_5m_input_tokens"))
    w5m += max(0, num(u.get("cache_creation_input_tokens")) - w5m - w1h)  # older lines without the split: 5m
    return (num(u.get("input_tokens")), num(u.get("output_tokens")), num(u.get("cache_read_input_tokens")), w5m, w1h)


def parts(model, u):
    """One API message -> [(model, usage)]. usage.iterations is the per-attempt truth: a server-side refusal
    fallback lists the declined attempt (its own model) next to the fallback; top-level usage has only the last."""
    its = [it for it in u.get("iterations") or [] if isinstance(it, dict)] if isinstance(u.get("iterations"), list) else []
    if not its:
        return [(model, u)]
    keep = {k: u[k] for k in ("speed", "inference_geo") if k in u}
    return [(s(it.get("model")) or model, dict(it, **keep)) for it in its]


def cost(model, u):
    """USD for one attempt, or None when the model has no known price (exact id match only)."""
    p = PRICES.get(norm(model))
    if p is None:
        return None
    t = split(u)
    if norm(model) == "claude-haiku-5-5" and t[0] + t[2] + t[3] + t[4] > 100_000:
        p = HAIKU55_LONG
    mult = (FAST if u.get("speed") == "fast" else 1.0) * (US_GEO if u.get("inference_geo") == "us" else 1.0)
    return sum(n * r for n, r in zip(t, p)) / 1e6 * mult


def ms(iso):
    try:
        return round(datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp() * 1000)
    except (AttributeError, TypeError, ValueError):
        return None


def alive(pid):
    try:
        os.kill(pid, 0)
        return True
    except PermissionError:
        return True
    except (OSError, ValueError, OverflowError):
        return False


def connector(name):
    srv = re.sub(r"^claude_ai_", "", name.split("__")[1] if name.count("__") >= 2 else name[5:])
    return "connector " + srv[:8] if UUID.fullmatch(srv) else srv.replace("_", " ")


def route_of(uses):
    """[(tool name, subagent_type, worktree isolation)] after the prompt -> the derived route."""
    agents = [((t or "").lower(), wt) for n, t, wt in uses if n in ("Agent", "Task")]
    if (any(n == "Workflow" for n, _, _ in uses) or any(wt for _, wt in agents)
            or sum(t.split(":")[-1] in ("implementer", "tester") for t, _ in agents) >= 2):
        return "orchestrate"
    if any("review" in t for t, _ in agents):
        return "reviewed"
    return "plain"


class Scan:
    """One reader for every transcript; usage is deduped by message id across all files."""

    def __init__(self):
        self.msgs, self.uses, self.errored, self.first, self.notes, self.errors = {}, {}, set(), {}, {}, []
        self.worktree = set()  # tool_use ids of Agent/Task calls with isolation "worktree"
        self.prompt = ("", "")  # (timestamp, first line) of the latest typed prompt in the main transcript

    def err(self, path, what):
        if len(self.errors) < 10:
            self.errors.append(f"{os.path.basename(path)}: {what}")

    def jload(self, path):
        try:
            with open(path, encoding="utf-8") as f:
                return json.load(f)
        except FileNotFoundError:
            return None
        except (OSError, ValueError) as e:
            self.err(path, type(e).__name__)
            return None

    def jlines(self, path):
        try:
            with open(path, "rb") as f:
                for raw in f:
                    if raw.endswith(b"\n"):
                        try:
                            o = json.loads(raw)
                        except ValueError:
                            self.err(path, "bad line")
                            continue
                        if isinstance(o, dict):
                            yield o
        except OSError:
            return

    def read(self, path, main=False):
        """Complete lines only (a half-written last line waits for the next run); a byte filter runs before json.loads."""
        bad, probe = 0, 20  # probe: parse the first lines for the file's first timestamp
        try:
            with open(path, "rb") as f:
                for raw in f:
                    if not raw.endswith(b"\n"):
                        break
                    a = b'"type":"assistant"' in raw
                    e = not a and b'"is_error":true' in raw
                    u = main and not a and (b"<task-notification>" in raw or
                                            (b'"type":"user"' in raw and b'"tool_use_id"' not in raw))
                    if not (a or e or u or probe):
                        continue
                    try:
                        o = json.loads(raw)
                    except ValueError:
                        bad += 1
                        continue
                    if not isinstance(o, dict):
                        continue
                    if probe:
                        probe = 0 if s(o.get("timestamp")) and self.first.setdefault(path, o["timestamp"]) else probe - 1
                    if a or e or u:
                        self.line(o, path, main)
        except OSError as x:
            self.err(path, type(x).__name__)
        if bad:
            self.err(path, f"{bad} bad lines")

    def line(self, o, path, main):
        t, ts = o.get("type"), s(o.get("timestamp")) or ""
        msg = o.get("message") if isinstance(o.get("message"), dict) else {}
        content = msg.get("content")
        blocks = [b for b in content if isinstance(b, dict)] if isinstance(content, list) else []
        if t == "assistant":
            model, usage = msg.get("model"), msg.get("usage")
            if s(model) and not model.startswith("<") and isinstance(usage, dict):  # "<synthetic>": not from the API
                self.msgs[msg.get("id") or o.get("uuid")] = (model, usage, path, ts)  # one message spans lines: last wins
            for b in blocks:
                if b.get("type") == "tool_use" and s(b.get("id")):
                    i = b.get("input") if isinstance(b.get("input"), dict) else {}
                    self.uses[b["id"]] = (s(b.get("name")) or "?", s(i.get("file_path")) or s(i.get("notebook_path")),
                                          s(i.get("skill")), s(i.get("subagent_type")), ts, path)
                    if i.get("isolation") == "worktree":
                        self.worktree.add(b["id"])
            return
        for b in blocks:
            if b.get("type") == "tool_result" and b.get("is_error") is True:
                self.errored.add(b.get("tool_use_id"))
        if not main:
            return
        text = content if isinstance(content, str) else next((b.get("text") for b in blocks if b.get("type") == "text"), None)
        note = o.get("content") if t == "queue-operation" else text
        if isinstance(note, str) and "<task-notification>" in note:
            i, st = NOTE_ID.search(note), NOTE_STATUS.search(note)
            if i and st:
                self.notes[i.group(1).strip()] = st.group(1).strip()
            return
        origin = o.get("origin")
        if (t != "user" or o.get("isMeta") or o.get("isCompactSummary") or o.get("isVisibleInTranscriptOnly")
                or not isinstance(text, str) or any(b.get("type") == "tool_result" for b in blocks)
                or (isinstance(origin, dict) and origin.get("kind") not in (None, "human"))):
            return
        text = text.strip()
        if text and not text.startswith(("<", "[Request interrupted")) and ts >= self.prompt[0]:
            self.prompt = (ts, text.splitlines()[0].strip()[:100])

    def account(self, since=""):
        """-> per-model rows, per-file totals, USD spent at or after timestamp `since`."""
        models, files, since_usd = {}, {}, 0.0
        for model, u, path, ts in self.msgs.values():
            f = files.setdefault(path, dict(messages=0, tokens=0, usd=0.0, model=None, mts=""))
            f["messages"] += 1
            if ts >= f["mts"]:
                f["model"], f["mts"] = norm(model), ts
            for m2, u2 in parts(model, u):
                t, c, k = split(u2), cost(m2, u2), norm(m2)
                r = models.setdefault(k, dict(model=k, label=label(k), messages=0, **dict.fromkeys(TOKEN_KEYS, 0), usd=0.0))
                r["messages"] += 1
                for key, n in zip(TOKEN_KEYS, t):
                    r[key] += n
                r["usd"] = None if c is None or r["usd"] is None else r["usd"] + c
                f["tokens"] += sum(t)
                f["usd"] += c or 0
                if ts >= since:
                    since_usd += c or 0
        return models, files, since_usd

    def tools_by_file(self):
        count, last = Counter(), {}
        for name, _, _, _, ts, path in self.uses.values():
            count[path] += 1
            if ts >= last.get(path, ("",))[0]:
                last[path] = (ts, name)
        return count, {p: v[1] for p, v in last.items()}


def stats(paths):
    out = {}
    for p in paths:
        try:
            st = os.stat(p)
            out[p] = (st.st_size, int(st.st_mtime * 1000))
        except OSError:
            pass
    return out


def locate(base, pid, sc):
    """-> (session dict or None, main transcript path or None, raw sessions json)."""
    reg = sc.jload(f"{base}/sessions/{pid}.json")
    sid = reg.get("sessionId") if isinstance(reg, dict) else None
    if not (isinstance(sid, str) and re.fullmatch(r"[A-Za-z0-9-]+", sid)):
        return None, None, None
    cwd = s(reg.get("cwd")) or ""
    sess = dict(id=sid, cwd=cwd, status=reg.get("status") if reg.get("status") in ("busy", "idle") else None)
    main = f"{base}/projects/{re.sub(r'[^A-Za-z0-9]', '-', cwd)}/{sid}.jsonl"
    if not os.path.isfile(main):
        main = next(iter(sorted(glob.glob(f"{glob.escape(base)}/projects/*/{sid}.jsonl"))), None)
    return sess, main, reg


def run(base, pid, since=None, orch=False, home=None, now=None):
    t0 = time.time()
    now = now or int(t0 * 1000)
    home = (home or os.path.expanduser("~")).rstrip("/")
    sc = Scan()
    sess, main, reg = locate(base, pid, sc)
    if sess is None:
        return dict(v=1, sig="no-session", error="no-session")
    if main is None:
        return dict(v=1, sig=f"{sess['id']}:no-transcript", error="no-transcript", session=sess)
    sdir = glob.escape(main[:-6])
    subs = sorted(glob.glob(f"{sdir}/subagents/**/agent-*.jsonl", recursive=True))
    files = [main] + subs
    if not orch:
        st = stats(files)
        sig = f"{sess['id']}:{len(st)}:{sum(v[0] for v in st.values())}"
        if sig == since:
            return dict(v=1, unchanged=True, sig=sig)
        for p in files:
            sc.read(p, main=p == main)
        out = usage_out(sc, sess, main, len(subs), home)
    else:
        extra = (glob.glob(f"{sdir}/subagents/workflows/wf_*/journal.jsonl") + glob.glob(f"{sdir}/workflows/wf_*.json")
                 + glob.glob(f"{sdir}/workflows/scripts/*.js") + glob.glob(f"{sdir}/subagents/agent-*.meta.json"))
        st = stats(files + extra)
        ovp = f"{base}/nc-orchestrator/{sess['id']}.json"
        ov = stats([ovp]).get(ovp)
        ov_ok = ov is not None and now - ov[1] < OVERRIDE_MAX_S * 1000
        live = alive(pid)
        fresh = sum(1 for v in st.values() if now - v[1] < STALE_MS)
        sig = (f"o:{sess['id']}:{sess['status']}:{int(live)}:{len(st)}:{sum(v[0] for v in st.values())}:{fresh}:"
               f"{ov[0] if ov else '-'}-{ov[1] if ov else '-'}-{int(ov_ok)}")
        if sig == since:
            return dict(v=1, unchanged=True, sig=sig)
        for p in files:
            sc.read(p, main=p == main)
        out = orch_out(sc, sess, reg, main, st, live, now, ovp if ov_ok else None)
    out.update(v=1, unchanged=False, sig=sig, error=None)
    out["errors"] = sc.errors
    out["scan_ms"] = int((time.time() - t0) * 1000)
    return {k: out[k] for k in ["v", "unchanged", "sig", "error"] + [k for k in out if k not in ("v", "unchanged", "sig", "error")]}


def usage_out(sc, sess, main, n_subs, home):
    models, files, _ = sc.account()
    part = dict(main=dict(messages=0, usd=0.0), sub=dict(messages=0, usd=0.0, files=n_subs))
    for path, f in files.items():
        d = part["main" if path == main else "sub"]
        d["messages"] += f["messages"]
        d["usd"] += f["usd"]
    for d in part.values():
        d["usd"] = round(d["usd"], 4)
    rows = sorted(models.values(), key=lambda r: (-(r["usd"] or 0), -sum(r[k] for k in TOKEN_KEYS)))
    for r in rows:
        r["usd"] = None if r["usd"] is None else round(r["usd"], 4)
    tools, skills, conns, edited, read = Counter(), Counter(), Counter(), {}, {}
    for uid, (name, fp, skill, _, ts, _) in sc.uses.items():
        if uid in sc.errored:
            continue
        if name.startswith("mcp__"):
            conns[connector(name)] += 1
        elif name == "Skill":
            if skill:
                skills[skill] += 1
        else:
            tools[name] += 1
        target = read if name == "Read" else edited if name in EDIT_TOOLS else None
        if fp and target is not None and ts >= target.get(fp, ""):
            target[fp] = ts
    cwd = sess["cwd"].rstrip("/")

    def rel(p):
        if cwd and p.startswith(cwd + "/"):
            return p[len(cwd) + 1:]
        return "~/" + p[len(home) + 1:] if p.startswith(home + "/") else p

    top = lambda c, n: [[k, v] for k, v in sorted(c.items(), key=lambda kv: (-kv[1], kv[0]))[:n]]
    newest = lambda d: [rel(p) for p, _ in sorted(d.items(), key=lambda kv: kv[1], reverse=True)[:50]]
    return dict(
        session=sess, prices_as_of=PRICES_AS_OF, models=rows, parts=part,
        total=dict(messages=len(sc.msgs), tokens=sum(sum(r[k] for k in TOKEN_KEYS) for r in rows),
                   usd=round(sum(r["usd"] or 0 for r in rows), 4), unpriced=[r["model"] for r in rows if r["usd"] is None]),
        used=dict(tools=top(tools, 30), skills=top(skills, 20), connectors=top(conns, 20), edited=newest(edited), read=newest(read)))


def script_meta(path):
    """(name, [phase titles]) from the script's `export const meta = {...}`; never more."""
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            src = f.read(20000)
    except OSError:
        return None, []
    m = re.search(r"export\s+const\s+meta\s*=\s*\{", src)
    if not m:
        return None, []
    blk, q = src[m.end():], r"""\s*:\s*(['"`])((?:\\.|(?!\1).)*)\1"""
    name, ph = re.search(r"\bname" + q, blk), re.search(r"\bphases\s*:\s*\[(.*?)\]", blk, re.S)
    return (name.group(2) if name else None), ([t[1] for t in re.findall(r"\btitle" + q, ph.group(1))] if ph else [])


def orch_out(sc, sess, reg, main, st, live, now, override):
    since = sc.prompt[0]
    _, files, since_usd = sc.account(since)
    ntools, last_tool = sc.tools_by_file()
    sdir = main[:-6]
    is_fresh = lambda p: p in st and now - st[p][1] < STALE_MS

    def agent(aid, path, **kw):
        f = files.get(path, {})
        return dict(id=aid, label=kw.get("label"), phase=kw.get("phase"), status=kw.get("status"), model=f.get("model"),
                    tokens=f.get("tokens", 0), cost_usd=round(f.get("usd", 0.0), 4), tools=ntools.get(path, 0),
                    last_tool=last_tool.get(path), started=ms(sc.first.get(path)), last_activity=st.get(path, (0, None))[1],
                    ended=None)

    wids = {os.path.basename(d) for d in glob.glob(f"{glob.escape(sdir)}/subagents/workflows/wf_*")}
    wids |= {os.path.basename(p)[:-5] for p in st if p.startswith(sdir + "/workflows/wf_") and p.endswith(".json")}
    workflows = []
    for wid in sorted(wids):
        try:
            workflows.append(workflow(sc, wid, sdir, st, agent, is_fresh, live))
        except Exception as e:  # internal formats vary by Claude Code version: report, never crash
            sc.err(wid, type(e).__name__)
    workflows.sort(key=lambda w: (w["status"] != "running", -(w["started"] or 0)))

    subagents = []
    for mp in sorted(p for p in st if p.startswith(sdir + "/subagents/agent-") and p.endswith(".meta.json")):
        aid, meta = os.path.basename(mp)[6:-10], sc.jload(mp)
        meta = meta if isinstance(meta, dict) else {}
        path = f"{sdir}/subagents/agent-{aid}.jsonl"
        note = sc.notes.get(aid)
        status = ({"completed": "done"}.get(note, "error") if note else "done" if meta.get("finished") is True
                  else "running" if live and is_fresh(path) else "stale")
        a = agent(aid, path, status=status)
        a["started"] = a["started"] or st[mp][1]
        subagents.append(dict(id=aid, type=s(meta.get("agentType")), description=(s(meta.get("description")) or "")[:60],
                              status=status, model=a["model"], cost_usd=a["cost_usd"], tools=a["tools"], started=a["started"],
                              ended=None if status == "running" else a["last_activity"]))
    subagents.sort(key=lambda a: -(a["started"] or 0))

    # flow derived from the latest typed prompt; the skill file may replace it
    after = [(n, sat, uid in sc.worktree) for uid, (n, _, _, sat, ts, p) in sc.uses.items() if p == main and ts > since]
    pms = ms(since) or 0
    launched = [w for w in workflows if (w["started"] or 0) >= pms]
    steps = steps_of(max(launched, key=lambda w: w["started"])) if launched else []
    running = sum(a["status"] == "running" for w in workflows for a in w["agents"]) + sum(a["status"] == "running" for a in subagents)
    # a Workflow or subagent keeps working after the main turn ends (registry status "waiting" → null)
    working = sess["status"] == "busy" or running or any(w["status"] == "running" for w in workflows)
    flow = dict(source="derived", prompt=sc.prompt[1], routes=list(ROUTES), route=route_of(after), reason=None, state=None,
                steps=steps, outcome=dict(status="working" if working else "done", usd=round(since_usd, 4)), plan=None)
    if override:
        apply_override(sc, flow, override, subagents)

    model = files.get(main, {}).get("model")
    started = reg.get("startedAt") if isinstance(reg.get("startedAt"), int) else None
    for i, w in enumerate(workflows):
        if i >= 2:
            w["agents"] = []
    session = dict(sess, model=model, label=label(model) if model else None, started=started,
                   elapsed_s=(now - started) // 1000 if started else None, agents_running=running,
                   tokens=sum(f["tokens"] for f in files.values()), usd=round(sum(f["usd"] for f in files.values()), 4))
    return dict(session=session, flow=flow, workflows=workflows[:5], subagents=subagents[:8])


def workflow(sc, wid, sdir, st, agent, is_fresh, live):
    wdir = f"{sdir}/subagents/workflows/{wid}"
    rec = sc.jload(f"{sdir}/workflows/{wid}.json")
    rec = rec if isinstance(rec, dict) else None
    info, final = {}, {}  # agentId -> journal fields; agentId -> done|error
    for e in sc.jlines(f"{wdir}/journal.jsonl"):
        a = s(e.get("agentId"))
        if a and e.get("type") == "started":
            info[a] = dict(label=s(e.get("label")), phase=s(e.get("phase")), started=True)
        elif a and e.get("type") in ("result", "failed"):
            final[a] = "done" if e["type"] == "result" else "error"
    for a, i in info.items():
        if not (i["label"] and i["phase"]):  # older versions: label/phase only in the meta file
            meta = sc.jload(f"{wdir}/agent-{a}.meta.json") or {}
            i["label"] = i["label"] or s(meta.get("description")) if isinstance(meta, dict) else i["label"]
            i["phase"] = i["phase"] or s(meta.get("workflowPhase")) if isinstance(meta, dict) else i["phase"]
    agents = {a: agent(a, f"{wdir}/agent-{a}.jsonl", label=i["label"], phase=i["phase"]) for a, i in info.items()}
    started_ids = set(info)
    scripts = [p for p in st if p.startswith(sdir + "/workflows/scripts/") and p.endswith(f"-{wid}.js")]
    if rec:
        status = rec.get("status") if rec.get("status") in ("completed", "killed", "failed") else "completed"
        start = num(rec.get("startTime")) or None
        end = start + num(rec.get("durationMs")) if start else None
        name = s(rec.get("workflowName"))
        titles = [s(p.get("title")) for p in rec.get("phases") or [] if isinstance(p, dict) and s(p.get("title"))]
        total = Counter()
        for n, it in enumerate(rec.get("workflowProgress") or []):
            if not (isinstance(it, dict) and it.get("type") == "workflow_agent"):
                continue
            a = s(it.get("agentId")) or f"queued-{n}"
            total[s(it.get("phaseTitle"))] += 1
            if a not in agents:
                agents[a] = agent(a, f"{wdir}/agent-{a}.jsonl", label=s(it.get("label")), phase=s(it.get("phaseTitle")))
                agents[a].update(model=agents[a]["model"] or s(it.get("model")), tools=agents[a]["tools"] or num(it.get("toolCalls")),
                                 last_tool=agents[a]["last_tool"] or s(it.get("lastToolName")))
            if it.get("state") != "start" or s(it.get("agentId")):
                started_ids.add(a)
            ag = agents[a]
            ag["label"], ag["phase"] = ag["label"] or s(it.get("label")), ag["phase"] or s(it.get("phaseTitle"))
            ag["status"] = final.get(a) or {"done": "done", "error": "error"}.get(it.get("state"), "killed")
            t0 = num(it.get("startedAt"))
            ag["started"] = ag["started"] or t0 or None
            ag["ended"] = t0 + num(it.get("durationMs")) if t0 and num(it.get("durationMs")) else ag["last_activity"]
        for a, ag in agents.items():  # in the journal but not in the record
            if ag["status"] is None:
                ag["status"], ag["ended"] = final.get(a) or "killed", ag["last_activity"]
    else:
        name, titles = script_meta(scripts[0]) if scripts else (None, [])
        start = st[scripts[0]][1] if scripts else min([a["started"] for a in agents.values() if a["started"]], default=None)
        end, total = None, None
        for a, ag in agents.items():
            ag["status"] = final.get(a) or ("running" if live and is_fresh(f"{wdir}/agent-{a}.jsonl") else "stale")
            ag["ended"] = ag["last_activity"] if a in final else None
        mine = [p for p in st if p.startswith(wdir + "/")] + scripts
        status = "running" if live and any(is_fresh(p) for p in mine) else "stale"
    if not name and scripts:
        name = os.path.basename(scripts[0])[:-len(f"-{wid}.js")]
    for ag in agents.values():
        if ag["phase"] and ag["phase"] not in titles:
            titles.append(ag["phase"])
    phases = [dict(title=t, started=sum(a["phase"] == t and a["id"] in started_ids for a in agents.values()),
                   **{k: sum(a["phase"] == t and a["status"] == k for a in agents.values()) for k in ("running", "done", "error")},
                   total=total[t] if total is not None else None) for t in titles]
    out = list(agents.values())
    return dict(id=wid, name=name or wid, status=status, started=start, ended=end, phases=phases, agents=out,
                totals=dict(agents=len(out), cost_usd=round(sum(a["cost_usd"] for a in out), 4), tools=sum(a["tools"] for a in out)))


def steps_of(w):
    steps = []
    for i, p in enumerate(w["phases"]):
        later = any(q["started"] for q in w["phases"][i + 1:])
        gone = p["started"] - p["running"] - p["done"] - p["error"] > 0  # killed or stale agents
        status = ("running" if p["running"] else "pending" if not p["started"] else "error" if p["error"] or gone
                  else "running" if w["status"] == "running" and not later else "done")
        steps.append(dict(title=p["title"], status=status, done=p["done"], total=p["total"] if p["total"] is not None else p["started"]))
    return steps


def plan_of(o, subagents):
    """v2 status file -> flow.plan, capped as in the writer's contract; subagents are newest first."""
    def agent(tid):
        a = next((a for a in subagents if a["description"].startswith((tid + " ", tid + ":"))), None)
        return a and {k: a[k] for k in ("id", "status", "tools", "cost_usd", "started", "ended")}

    tasks, phases = [], []
    for p in dicts(o.get("phases"), 8):
        lanes = []
        for ln in dicts(p.get("lanes"), 6):
            out = []
            for t in dicts(ln.get("tasks")):
                tid, sb = cut(t.get("id"), 20), t.get("sendbacks")
                if not tid or len(tasks) >= 40:
                    continue
                c = t.get("constraints") if isinstance(t.get("constraints"), dict) else {}
                out.append(dict(
                    id=tid, title=cut(t.get("title"), 60), role=cut(t.get("role"), 20),
                    status=t.get("status") if t.get("status") in TASK_STATUS else "pending",
                    files=strs(t.get("files"), 80, 8), check=cut(t.get("check"), 80), after=strs(t.get("after"), 20, 40),
                    c=strs(t.get("c"), 20, 12), sendbacks=sb if type(sb) is int and sb >= 0 else 0,
                    branch=cut(t.get("branch"), 60), delegate=cut(t.get("delegate"), 40), review=cut(t.get("review"), 20),
                    constraints={k[:20]: v for k, v in list(c.items())[:12] if isinstance(k, str) and v in ("pass", "fail")},
                    evidence=cut(t.get("evidence"), 100), agent=agent(tid)))
                tasks.append(out[-1])
            lanes.append(dict(id=cut(ln.get("id"), 20), tasks=out))
        phases.append(dict(name=cut(p.get("name"), 40), lanes=lanes))
    n = Counter(t["status"] for t in tasks)
    counts = dict(total=len(tasks), **{k: n[k] for k in ("pass", "fail", "running", "pending")})
    counts["other"] = len(tasks) - sum(n[k] for k in ("pass", "fail", "running", "pending"))
    return dict(constraints=[dict(id=cut(c.get("id"), 20), text=cut(c.get("text"), 80)) for c in dicts(o.get("constraints"), 12)],
                phases=phases, counts=counts)


def phase_step(p):
    ts = [t for ln in p["lanes"] for t in ln["tasks"]]
    st = {t["status"] for t in ts}
    status = ("error" if st & {"fail", "conflict", "blocked"} else "running" if st & {"running", "review", "sent_back"}
              else "done" if st == {"pass"} else "pending")
    return dict(title=p["name"] or "", status=status, done=sum(t["status"] == "pass" for t in ts), total=len(ts))


def apply_override(sc, flow, path, subagents):
    o = sc.jload(path)
    if isinstance(o, dict) and o.get("v") == 2:
        flow.update(source="plan", reason=cut(o.get("reason"), 80), state=o["state"] if o.get("state") in STATES else None,
                    plan=plan_of(o, subagents))
        if o.get("route") in ROUTES:
            flow["route"] = o["route"]
        flow["steps"] = [phase_step(p) for p in flow["plan"]["phases"]]
        flow["outcome"]["status"] = {"done": "done", "error": "error"}.get(flow["state"], "working")
        return
    if not (isinstance(o, dict) and o.get("v") == 1):
        return
    flow["source"] = "skill"
    if isinstance(o.get("prompt"), str):
        flow["prompt"] = o["prompt"].strip().splitlines()[0][:100] if o["prompt"].strip() else ""
    if isinstance(o.get("routes"), list):
        flow["routes"] = [r[:40] for r in o["routes"] if isinstance(r, str)][:6]
    if isinstance(o.get("route"), str):
        flow["route"] = o["route"][:40]
    if isinstance(o.get("steps"), list):
        flow["steps"] = [dict(title=(s(x.get("title")) or "")[:40],
                              status=x.get("status") if x.get("status") in ("done", "running", "pending", "error") else "pending",
                              done=int(num(x.get("done"))), total=int(num(x.get("total"))) if num(x.get("total")) else None)
                         for x in o["steps"] if isinstance(x, dict)][:12]
    if isinstance(o.get("outcome"), dict):
        oc = o["outcome"]
        if oc.get("status") in ("working", "done", "error"):
            flow["outcome"]["status"] = oc["status"]
        if num(oc.get("usd")) or oc.get("usd") == 0:
            flow["outcome"]["usd"] = round(num(oc["usd"]), 4)


# shortcut: full rescan whenever sig changes; add byte-offset + message-id cache (in ~/Library/Caches/nc-session,
# never the mod folder — saving there reloads the mod) once sessions >100 MB get polled while busy.


def selftest():
    import tempfile  # only here: it costs ~80 ms of import on every gated poll
    u = {"input_tokens": 1_000_000, "output_tokens": 1_000_000, "cache_read_input_tokens": 1_000_000,
         "cache_creation_input_tokens": 2_000_000,
         "cache_creation": {"ephemeral_5m_input_tokens": 1_000_000, "ephemeral_1h_input_tokens": 1_000_000}}
    assert abs(cost("claude-opus-5-5", u) - 37.2) < 1e-9
    assert abs(cost("claude-opus-5-5", dict(u, speed="fast")) - 2 * 37.2) < 1e-9
    assert abs(cost("claude-opus-5-5", dict(u, inference_geo="us")) - 1.1 * 37.2) < 1e-9
    assert abs(cost("claude-haiku-4-5-20251001", u) - (1 + 5 + 0.1 + 1.25 + 2)) < 1e-9
    assert cost("claude-unknown-9", u) is None and cost("claude-opus-5-5-x", u) is None
    assert abs(cost("claude-haiku-5-5", {"input_tokens": 50_000, "output_tokens": 1_000_000}) - (0.005 + 0.5)) < 1e-9
    assert abs(cost("claude-haiku-5-5", {"input_tokens": 100_001}) - 100_001 * 0.5 / 1e6) < 1e-12
    assert split({"cache_creation_input_tokens": 1_000_000}) == (0, 0, 0, 1_000_000, 0)
    fb = {"input_tokens": 1, "output_tokens": 1, "speed": "fast", "iterations": [
        {"type": "message", "model": "claude-fable-5", "input_tokens": 10, "output_tokens": 20},
        {"type": "fallback_message", "model": "claude-opus-4-8", "input_tokens": 1, "output_tokens": 1}]}
    p = parts("claude-opus-4-8", fb)
    assert [m for m, _ in p] == ["claude-fable-5", "claude-opus-4-8"] and all(x["speed"] == "fast" for _, x in p)
    assert abs(sum(cost(m, x) for m, x in p) - 2 * (10 * 10 + 20 * 50 + 5 + 25) / 1e6) < 1e-12
    assert parts("claude-opus-5-5", u) == [("claude-opus-5-5", u)]
    assert label("claude-opus-5-5") == "Opus 5.5" and label("claude-fable-5") == "Fable 5"
    assert connector("mcp__claude_ai_Google_Docs__search") == "Google Docs"
    assert route_of([("Agent", "my-plugin:code-reviewer", False)]) == "reviewed"
    assert route_of([("Bash", None, False)]) == "plain" and route_of([("Agent", "implementer", False)]) == "plain"
    assert route_of([("Agent", "reviewer", False), ("Workflow", None, False)]) == "orchestrate"
    assert route_of([("Task", "Explore", True)]) == "orchestrate" and route_of([("Bash", None, True)]) == "plain"
    assert route_of([("Agent", "implementer", False), ("Task", "tester", False)]) == "orchestrate"
    sc = Scan()
    sc.line({"type": "assistant", "message": {"content": [{"type": "tool_use", "id": "w", "name": "Agent", "input": {
        "subagent_type": "implementer", "isolation": "worktree"}}, {"type": "tool_use", "id": "n", "name": "Agent", "input": {}}]}}, "p", True)
    assert sc.worktree == {"w"} and sc.uses["w"][3] == "implementer"
    many = dict(v=2, constraints=[dict(id="C1", text="t" * 99)] * 20, phases=[dict(name="P" * 50, lanes=[
        dict(id="A", tasks=[dict(id=f"A{i}", title="x" * 70, status="odd", files=["f" * 90, 3] * 9, sendbacks=-1,
                                 constraints={"C1": "pass", "C2": "maybe"}, evidence=7) for i in range(30)] + ["junk"])] * 9)] * 9)
    pl = plan_of(many, [])
    tk = [t for p in pl["phases"] for ln in p["lanes"] for t in ln["tasks"]]
    assert len(pl["phases"]) == 8 and len(pl["phases"][0]["lanes"]) == 6 and len(tk) == 40 and len(pl["constraints"]) == 12
    assert pl["counts"] == {"total": 40, "pass": 0, "fail": 0, "running": 0, "pending": 40, "other": 0}
    t = tk[0]
    assert (t["status"], len(t["title"]), t["files"], t["sendbacks"], t["constraints"], t["evidence"], t["agent"]) == \
        ("pending", 60, ["f" * 80] * 8, 0, {"C1": "pass"}, None, None), t
    assert len(pl["phases"][0]["name"]) == 40 and len(pl["constraints"][0]["text"]) == 80
    with tempfile.TemporaryDirectory() as tmp:
        e2e(tmp)
    print("selftest ok")


def e2e(tmp):
    base, home, pid, now = f"{tmp}/claude", f"{tmp}/home", os.getpid(), int(time.time() * 1000)
    cwd = f"{home}/proj x"
    iso = lambda t: datetime.fromtimestamp(t / 1000, timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + f"{t % 1000:03d}Z"
    proj = f"{base}/projects/{re.sub(r'[^A-Za-z0-9]', '-', cwd)}"
    sd = f"{proj}/sid1"

    def put(path, rows, tail=""):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            f.write("".join((r if isinstance(r, str) else json.dumps(r, separators=(",", ":"))) + "\n" for r in rows) + tail)

    def A(mid, model, t, out=1, tools=()):
        return {"type": "assistant", "timestamp": iso(t), "uuid": "u-" + mid, "message": {
            "id": mid, "model": model, "usage": {"input_tokens": 1, "output_tokens": out, "cache_read_input_tokens": 1_000_000},
            "content": [{"type": "tool_use", "id": i, "name": n, "input": inp} for i, n, inp in tools]}}

    def U(t, content, **kw):
        return dict({"type": "user", "timestamp": iso(t), "message": {"role": "user", "content": content}}, **kw)

    put(f"{base}/sessions/{pid}.json", [{"pid": pid, "sessionId": "sid1", "cwd": cwd, "status": "busy", "startedAt": now - 900_000}])
    put(f"{base}/sessions/1.json", [{"pid": 1, "sessionId": "nope", "cwd": cwd, "status": "idle"}])
    put(f"{proj}/sid1.jsonl", [
        {"type": "permission-mode", "permissionMode": "default"},
        U(now - 600_000, "old prompt", origin={"kind": "human"}),
        A("m1", "claude-opus-5-5", now - 590_000, 10, [("t1", "Read", {"file_path": f"{cwd}/README.md"}),
                                                       ("t2", "Read", {"file_path": "/etc/hosts"})]),
        A("m1", "claude-opus-5-5", now - 589_000, 20),  # same message id, more output: this line wins
        U(now - 588_000, [{"type": "tool_result", "tool_use_id": "t2", "is_error": True, "content": "denied"}]),
        A("m2", "<synthetic>", now - 587_000, 0),
        U(now - 100_000, "meta text", isMeta=True),
        U(now - 60_000, [{"type": "text", "text": "  second prompt\nmore lines"}], origin={"kind": "human"}),
        U(now - 59_000, "<command-name>/x</command-name>"),
        U(now - 59_000, "a peer message", origin={"kind": "peer"}),
        A("m4", "claude-unknown-9", now - 58_000, 5),
        U(now - 57_000, "This session is being continued from a previous conversation.", isCompactSummary=True,
          isVisibleInTranscriptOnly=True),
        U(now - 56_000, [{"type": "text", "text": "[Request interrupted by user]"}]),
        A("m3", "claude-opus-5-5", now - 50_000, 1, [
            ("t3", "Workflow", {"script": "x"}), ("t4", "Agent", {"subagent_type": "code-reviewer"}),
            ("t5", "Skill", {"skill": "my-skill"}), ("t6", "mcp__claude_ai_Calendar__add", {}),
            ("t7", "mcp__12345678-aaaa-bbbb-cccc-1234567890ab__x", {}), ("t8", "Edit", {"file_path": f"{home}/docs/x.md"}),
            ("t9", "Bash", {"command": "ls"})]),
        {"type": "queue-operation", "operation": "enqueue", "timestamp": iso(now - 10_000),
         "content": "<task-notification>\n<task-id>s1</task-id>\n<status>completed</status>\n</task-notification>"},
    ], tail='{"type":"assistant","message":{"id":"m9"')  # half-written last line
    w = f"{sd}/subagents/workflows/wf_run1"
    put(f"{sd}/workflows/scripts/demo-wf_run1.js", ["export const meta = {", "  name: 'demo',",
        "  phases: [{ title: 'Research', detail: 'a' }, { title: 'Write', detail: 'b' }],", "}"])
    put(f"{w}/journal.jsonl", [{"type": "launched"},
        {"type": "started", "agentId": "a1", "key": "k", "label": "r:1", "phase": "Research"},
        {"type": "started", "agentId": "a2", "key": "k", "label": "r:2", "phase": "Research"},
        {"type": "result", "agentId": "a1", "key": "k", "result": {"secret": "never shown"}},
        {"type": "failed", "agentId": "a2", "key": "k"},
        {"type": "started", "agentId": "a3", "key": "k", "label": "w:1", "phase": "Write"}])
    put(f"{w}/agent-a1.jsonl", [A("w1", "claude-sonnet-5-5", now - 40_000, 100)])
    put(f"{w}/agent-a2.jsonl", [A("w2", "claude-sonnet-5-5", now - 39_000, 100)])
    put(f"{w}/agent-a3.jsonl", [U(now - 31_000, "go"), A("w3", "claude-sonnet-5-5", now - 30_000, 300, [("b1", "Bash", {})])])
    put(f"{sd}/workflows/wf_old1.json", [{"runId": "wf_old1", "status": "completed", "startTime": now - 3_600_000,
        "durationMs": 60_000, "workflowName": "old", "phases": [{"title": "Only"}], "script": "never shown",
        "workflowProgress": [{"type": "workflow_phase", "index": 1, "title": "Only"},
                             {"type": "workflow_agent", "agentId": "b1", "label": "o:1", "phaseTitle": "Only", "state": "done",
                              "startedAt": now - 3_599_000, "durationMs": 50_000, "tokens": 99999, "toolCalls": 3}]}])
    put(f"{sd}/subagents/workflows/wf_old1/journal.jsonl", [{"type": "started", "agentId": "b1", "label": "o:1", "phase": "Only"},
                                                             {"type": "result", "agentId": "b1", "result": "x"}])
    put(f"{sd}/subagents/workflows/wf_old1/agent-b1.jsonl", [A("o1", "claude-sonnet-5-5", now - 3_590_000, 7)])
    put(f"{sd}/subagents/agent-s1.meta.json", [{"agentType": "Explore", "description": "d" * 80, "toolUseId": "t4"}])
    put(f"{sd}/subagents/agent-s1.jsonl", [A("s1m", "claude-haiku-4-5", now - 20_000, 50)])

    # usage mode
    r = run(base, pid, home=home)
    assert r["error"] is None and r["errors"] == [] and r["session"] == {"id": "sid1", "cwd": cwd, "status": "busy"}, r
    rows = {m["model"]: m for m in r["models"]}
    assert rows["claude-opus-5-5"]["output"] == 21 and rows["claude-opus-5-5"]["messages"] == 2  # m1 last line wins + m3
    assert "<synthetic>" not in rows and rows["claude-unknown-9"]["usd"] is None and r["total"]["unpriced"] == ["claude-unknown-9"]
    assert r["parts"]["main"]["messages"] == 3 and r["parts"]["sub"] == dict(messages=5, usd=r["parts"]["sub"]["usd"], files=5)
    one = lambda o: cost("claude-opus-5-5", {"input_tokens": 1, "output_tokens": o, "cache_read_input_tokens": 1_000_000})
    assert abs(r["parts"]["main"]["usd"] - (one(20) + one(1))) < 1e-4
    assert abs(r["total"]["usd"] - (r["parts"]["main"]["usd"] + r["parts"]["sub"]["usd"])) < 1e-3
    used = r["used"]
    assert used["read"] == ["README.md"] and used["edited"] == ["~/docs/x.md"], used  # errored Read t2 is dropped
    assert dict(used["tools"])["Read"] == 1 and dict(used["tools"])["Bash"] == 2 and "Skill" not in dict(used["tools"])
    assert used["skills"] == [["my-skill", 1]] and dict(used["connectors"]) == {"Calendar": 1, "connector 12345678": 1}
    assert "never shown" not in json.dumps(r) and run(base, pid, r["sig"], home=home) == {"v": 1, "unchanged": True, "sig": r["sig"]}

    # orchestrator mode
    o = run(base, pid, orch=True, home=home)
    assert o["error"] is None and o["errors"] == [] and "never shown" not in json.dumps(o) and "more lines" not in json.dumps(o), o
    ss = o["session"]
    assert ss["model"] == "claude-opus-5-5" and ss["label"] == "Opus 5.5" and ss["agents_running"] == 1
    assert ss["tokens"] == r["total"]["tokens"] and abs(ss["usd"] - r["total"]["usd"]) < 1e-3 and ss["elapsed_s"] >= 900
    f = o["flow"]
    assert (f["source"], f["prompt"], f["route"], f["routes"]) == ("derived", "second prompt", "orchestrate", ROUTES), f
    assert (f["reason"], f["state"], f["plan"]) == (None, None, None), f
    assert f["steps"] == [dict(title="Research", status="error", done=1, total=2), dict(title="Write", status="running", done=0, total=1)]
    old = one(20) + cost("claude-sonnet-5-5", {"input_tokens": 1, "output_tokens": 7, "cache_read_input_tokens": 1_000_000})
    assert f["outcome"]["status"] == "working" and abs(f["outcome"]["usd"] - (ss["usd"] - old)) < 1e-3
    w1, w2 = o["workflows"]
    assert (w1["id"], w1["name"], w1["status"], w1["ended"]) == ("wf_run1", "demo", "running", None)
    assert [(a["id"], a["status"]) for a in w1["agents"]] == [("a1", "done"), ("a2", "error"), ("a3", "running")]
    assert w1["phases"] == [dict(title="Research", started=2, running=0, done=1, error=1, total=None),
                            dict(title="Write", started=1, running=1, done=0, error=0, total=None)]
    a3 = w1["agents"][2]
    assert a3["tokens"] == 1_000_301 and a3["last_tool"] == "Bash" and a3["tools"] == 1 and a3["started"] == now - 31_000
    assert (w2["id"], w2["status"], w2["ended"]) == ("wf_old1", "completed", now - 3_600_000 + 60_000)
    assert w2["phases"] == [dict(title="Only", started=1, running=0, done=1, error=0, total=1)] and w2["agents"][0]["tokens"] == 1_000_008
    assert w2["agents"][0]["ended"] == now - 3_599_000 + 50_000
    sa = o["subagents"]
    assert len(sa) == 1 and (sa[0]["type"], sa[0]["status"], len(sa[0]["description"])) == ("Explore", "done", 60)
    assert run(base, pid, o["sig"], orch=True, home=home)["unchanged"] is True

    # skill override: valid, then too old
    put(f"{base}/nc-orchestrator/sid1.json", [{"v": 1, "route": "custom", "routes": ["plan", "custom", 3],
        "steps": [{"title": "plan", "status": "done", "done": 1, "total": 1}, {"title": 5, "status": "weird"}], "outcome": {"status": "done"}}])
    k = run(base, pid, o["sig"], orch=True, home=home)
    kf = k["flow"]
    assert (kf["source"], kf["route"], kf["routes"], kf["prompt"]) == ("skill", "custom", ["plan", "custom"], "second prompt"), kf
    assert kf["steps"] == [dict(title="plan", status="done", done=1, total=1), dict(title="", status="pending", done=0, total=None)]
    assert kf["outcome"] == dict(status="done", usd=f["outcome"]["usd"])
    t7h = time.time() - 7 * 3600
    os.utime(f"{base}/nc-orchestrator/sid1.json", (t7h, t7h))
    assert run(base, pid, k["sig"], orch=True, home=home)["flow"]["source"] == "derived"

    # v2 status file (nc orchestrator status): plan, counts, steps per phase, task <-> subagent join; then too old
    for aid, desc, age in (("s2", "A1 write interface", 30), ("s3", "A1: retry", 20), ("s4", "A10 other", 10)):
        put(f"{sd}/subagents/agent-{aid}.meta.json", [{"agentType": "implementer", "description": desc, "finished": True}])
        os.utime(f"{sd}/subagents/agent-{aid}.meta.json", (time.time() - age, time.time() - age))
    task = lambda i, st, **kw: dict(id=i, title="t " + i, role="implementer", status=st, **kw)
    v2 = {"v": 2, "updated": now, "route": "orchestrate", "reason": "r" * 90, "state": "running",
          "constraints": [{"id": "C1", "text": "no new deps"}, {"id": 5}],
          "phases": [{"name": "Build", "lanes": [
                         {"id": "A", "tasks": [task("A1", "pass", branch="b1", review="pass", constraints={"C1": "pass"},
                                                    files=["a.py"], c=["C1"], sendbacks=1)]},
                         {"id": "B", "tasks": [task("B1", "running"), task("A10", "sent_back")]}]},
                     {"name": "Check", "lanes": [{"id": "C", "tasks": [task("C1", "pending", after=["A1", "B1"])]}]},
                     {"name": "Ship", "lanes": [{"id": "D", "tasks": [task("D1", "pass"), task("D2", "conflict")]}]}]}
    put(f"{base}/nc-orchestrator/sid1.json", [v2])
    v = run(base, pid, orch=True, home=home)["flow"]
    assert (v["source"], v["route"], v["routes"], v["reason"], v["state"]) == ("plan", "orchestrate", ROUTES, "r" * 80, "running"), v
    assert v["steps"] == [dict(title="Build", status="running", done=1, total=3), dict(title="Check", status="pending", done=0, total=1),
                          dict(title="Ship", status="error", done=1, total=2)], v["steps"]
    assert v["outcome"]["status"] == "working" and v["outcome"]["usd"] == f["outcome"]["usd"]
    assert v["plan"]["counts"] == {"total": 6, "pass": 2, "fail": 0, "running": 1, "pending": 1, "other": 2}, v["plan"]["counts"]
    assert v["plan"]["constraints"] == [dict(id="C1", text="no new deps"), dict(id=None, text=None)]
    lb = v["plan"]["phases"][0]["lanes"]
    t1 = lb[0]["tasks"][0]
    assert (t1["agent"]["id"], t1["agent"]["status"], t1["branch"], t1["sendbacks"], t1["check"], t1["after"]) == \
        ("s3", "done", "b1", 1, None, []), t1
    assert set(t1["agent"]) == {"id", "status", "tools", "cost_usd", "started", "ended"}
    assert lb[1]["tasks"][1]["agent"]["id"] == "s4" and lb[1]["tasks"][0]["agent"] is None
    for state, oc in (("done", "done"), ("error", "error"), ("bogus", "working")):
        put(f"{base}/nc-orchestrator/sid1.json", [dict(v2, state=state, route="nope")])
        v = run(base, pid, orch=True, home=home)["flow"]
        assert (v["outcome"]["status"], v["state"], v["route"]) == (oc, state if state != "bogus" else None, "orchestrate"), v
    os.utime(f"{base}/nc-orchestrator/sid1.json", (t7h, t7h))
    v = run(base, pid, orch=True, home=home)["flow"]
    assert (v["source"], v["plan"], v["reason"], v["state"]) == ("derived", None, None, None), v

    # the main turn ended (registry "waiting" → null) while the workflow still runs: the outcome stays working
    put(f"{base}/sessions/{pid}.json", [{"pid": pid, "sessionId": "sid1", "cwd": cwd, "status": "waiting", "startedAt": now - 900_000}])
    assert run(base, pid, orch=True, home=home)["flow"]["outcome"]["status"] == "working"

    # nothing written for 20 min: the running workflow and agent turn stale
    t20 = time.time() - 20 * 60
    for p in glob.glob(f"{w}/*") + [f"{sd}/workflows/scripts/demo-wf_run1.js"]:
        os.utime(p, (t20, t20))
    z = run(base, pid, o["sig"], orch=True, home=home)
    assert z["workflows"][0]["status"] == "stale" and z["workflows"][0]["agents"][2]["status"] == "stale"
    assert z["session"]["agents_running"] == 0 and z["flow"]["outcome"]["status"] == "done"
    assert [x["status"] for x in steps_of(z["workflows"][0])] == ["error", "error"]  # a stale phase is not done

    # a killed run: the phase it stopped in is an error, not a done pill
    put(f"{sd}/workflows/wf_old1.json", [{"runId": "wf_old1", "status": "killed", "startTime": now - 3_600_000,
        "durationMs": 60_000, "workflowName": "old", "phases": [{"title": "Only"}, {"title": "Next"}],
        "workflowProgress": [{"type": "workflow_agent", "agentId": "b1", "phaseTitle": "Only", "state": "done"},
                             {"type": "workflow_agent", "agentId": "b2", "phaseTitle": "Only", "state": "start"}]}])
    kw = next(x for x in run(base, pid, orch=True, home=home)["workflows"] if x["id"] == "wf_old1")
    assert kw["status"] == "killed" and steps_of(kw) == [dict(title="Only", status="error", done=1, total=2),
                                                         dict(title="Next", status="pending", done=0, total=0)], kw

    # errors
    assert run(base, 999_999_999) == {"v": 1, "sig": "no-session", "error": "no-session"}
    assert run(base, 1)["error"] == "no-transcript"


def main(argv):
    if argv == ["--selftest"]:
        selftest()
        return 0
    args, orch = list(argv), "--orch" in argv
    if orch:
        args.remove("--orch")
    opts = dict(zip(args[::2], args[1::2]))
    if len(args) % 2 or set(opts) - {"--pid", "--since"} or not opts.get("--pid", "").isdigit():
        sys.stderr.write("usage: usage.py --pid <pid> [--since <sig>] [--orch] | --selftest\n")
        return 2
    out = run(os.path.expanduser("~/.claude"), int(opts["--pid"]), opts.get("--since") or None, orch)
    sys.stdout.write(json.dumps(out, separators=(",", ":")) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
