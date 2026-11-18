// Demo data in the shape of `usage.py --orch` (see RECIPE.md). main.js uses it only when the
// block's props say { "demo": ... }, so the card can be looked at without a live session.
// demo: true          a v3 plan, running: every task status (pass, running, review, redo,
//                     fail, conflict, pending), musts, a branch, a delegate, linked agents.
// demo: "approval"    the same plan awaiting approval, the session idle (the Approve button).
// demo: "closing"     the same plan in its closing state, on crew "pair" ("one" and "team" skipped).
// demo: "derived"     the derived flow: stages done → running (with a done, a running and a
//                     failed agent) → pending.
// All of them: a running, a finished and a failed workflow, running and done subagents,
// nc delegate workers (running, done, failed) and one background shell.
// Names and numbers are made up.

export function demo(now, variant) {
  const ago = (s) => now - s * 1000;
  const agent = (id, label, phase, status, tokens, cost, tools, start, end, tool) => ({
    id, label, phase, status, model: "claude-opus-5-5", tokens, cost_usd: cost, tools,
    last_tool: tool ?? "StructuredOutput",
    started: ago(start), last_activity: ago(end ?? 2), ended: end == null ? 0 : ago(end),
  });
  const task = (id, title, role, status, more) => ({
    id, title, role, status, files: [], proof: null, after: [], musts: [], redos: 0, branch: null,
    delegate: null, review: null, answers: {}, evidence: null, agent: null, ...more,
  });
  const phases = [
    { name: "seam", lanes: [
      { id: "A", tasks: [task("A1", "Limiter interface and config", "implementer", "pass", {
        files: ["src/limit/index.ts", "src/config.ts"], proof: "npm test -- limit", musts: ["M1"], branch: "orch/a1-seam",
        review: "pass", answers: { M1: "kept" }, evidence: "12 tests pass",
        agent: { id: "s03", status: "done", tools: 21, cost_usd: 0.84, started: ago(520), ended: ago(400) } })] },
      { id: "B", tasks: [task("B1", "Docs outline", "implementer", "pass", { files: ["docs/rate-limits.md"], review: "pass" })] },
    ] },
    { name: "build", lanes: [
      { id: "A", tasks: [
        task("A2", "Redis adapter", "implementer", "running", { files: ["src/limit/redis.ts"], proof: "npm test -- redis",
          after: ["A1"], musts: ["M1", "M2"], delegate: "w-a2",
          agent: { id: "s04", status: "running", tools: 9, cost_usd: 0.31, started: ago(140), ended: 0 } }),
        task("A3", "Wire the middleware", "implementer", "pending", { files: ["src/server.ts"], after: ["A2", "B1"] }),
      ] },
      { id: "B", tasks: [
        task("B2", "Rate-limit docs page", "implementer", "review", { files: ["docs/rate-limits.md"], after: ["B1"], branch: "orch/b2-docs" }),
        task("B3", "Changelog entry", "implementer", "redo", { files: ["CHANGELOG.md"], redos: 1, review: "findings:2" }),
      ] },
      { id: "C", tasks: [
        task("C1", "Load test", "tester", "fail", { proof: "k6 run load.js", musts: ["M2"], answers: { M2: "broken" },
          evidence: "p99 410 ms over the 250 ms budget" }),
        task("C2", "Merge the adapter branch", "implementer", "conflict", { after: ["A2"], evidence: "conflict in src/config.ts" }),
      ] },
    ] },
  ];
  const all = phases.flatMap((p) => p.lanes.flatMap((l) => l.tasks));
  const count = (...s) => all.filter((x) => s.includes(x.status)).length;
  const plan = {
    musts: [{ id: "M1", text: "No new runtime dependencies" }, { id: "M2", text: "p99 latency stays under 250 ms" }],
    phases,
    counts: { total: all.length, pass: count("pass"), fail: count("fail", "conflict", "blocked"),
      running: count("running", "review", "redo"), pending: count("pending"), other: 0 },
  };
  const approval = variant === "approval";
  const closing = variant === "closing";
  const planFlow = {
    source: "plan", prompt: "Add rate limiting to the public API, then update the docs and the changelog",
    routes: ["one", "pair", "team"], route: closing ? "pair" : "team",
    reason: "three parts that stand alone once the seam is in",
    state: approval ? "awaiting_approval" : closing ? "closing" : "running",
    steps: [
      { title: "seam", status: "done", done: 2, total: 2 },
      { title: "build", status: "error", done: 0, total: 6 },
    ],
    outcome: { status: "working", usd: 6.85 }, plan,
  };
  const derivedFlow = {
    source: "derived", reason: null, state: null, plan: null,
    prompt: "Add rate limiting to the public API, then update the docs and the changelog",
    routes: ["one", "pair", "team"], route: "team",
    steps: [
      { title: "research", status: "done", done: 3, total: 3 },
      { title: "build", status: "running", done: 1, total: 3 },
      { title: "review", status: "pending", done: 0, total: 2 },
    ],
    outcome: { status: "working", usd: 6.85 },
  };
  return {
    v: 1, unchanged: false, sig: "demo", error: null,
    session: {
      id: "00000000-0000-4000-8000-000000000000", cwd: "~/demo", status: approval ? "idle" : "busy",
      model: "claude-opus-5-5", label: "Opus 5.5", started: ago(2580), elapsed_s: 2580,
      agents_running: 3, shells_running: 1, tokens: 48210000, usd: 31.42,
    },
    flow: variant === "derived" ? derivedFlow : planFlow,
    workflows: [
      {
        id: "wf_demo0001-a1b", name: "rate-limit", status: "running", started: ago(540), ended: 0,
        phases: [
          { title: "research", started: 3, running: 0, done: 3, error: 0, total: 3 },
          { title: "build", started: 3, running: 1, done: 1, error: 1, total: 3 },
          { title: "review", started: 0, running: 0, done: 0, error: 0, total: 2 },
        ],
        agents: [
          agent("a01", "research: limiter libraries", "research", "done", 1840000, 1.12, 24, 530, 400),
          agent("a02", "research: current middleware", "research", "done", 2210000, 1.31, 31, 530, 380),
          agent("a03", "research: docs structure", "research", "done", 960000, 0.58, 12, 528, 430),
          agent("a04", "build: limiter middleware", "build", "done", 3120000, 1.86, 44, 370, 120),
          agent("a05", "build: docs and changelog", "build", "running", 1750000, 1.08, 19, 115, null, "Edit"),
          agent("a06", "build: redis adapter", "build", "error", 640000, 0.39, 9, 360, 250),
        ],
        totals: { agents: 6, cost_usd: 6.34, tools: 139 },
      },
      {
        id: "wf_demo0002-c3d", name: "docs-review", status: "completed", started: ago(2100), ended: ago(1815),
        phases: [{ title: "review", started: 2, running: 0, done: 2, error: 0, total: 2 }],
        agents: [
          agent("a07", "review: api reference", "review", "done", 1210000, 0.74, 6, 2095, 1830),
          agent("a08", "review: getting started", "review", "done", 1060000, 0.64, 4, 2093, 1815),
        ],
        totals: { agents: 2, cost_usd: 1.38, tools: 10 },
      },
      {
        id: "wf_demo0003-e5f", name: "dependency-audit", status: "failed", started: ago(3000), ended: ago(2920),
        phases: [{ title: "audit", started: 1, running: 0, done: 0, error: 1, total: 1 }],
        agents: [], // the feed sends agents for the first 2 workflows only
        totals: { agents: 1, cost_usd: 0.21, tools: 3 },
      },
    ],
    subagents: [
      { id: "s01", type: "Explore", description: "Find where requests are authenticated", status: "running",
        model: "claude-sonnet-5-5", cost_usd: 0.18, tools: 7, started: ago(60), ended: 0 },
      { id: "s02", type: "code-reviewer", description: "Review the limiter middleware", status: "done",
        model: "claude-opus-5-5", cost_usd: 0.92, tools: 15, started: ago(900), ended: ago(610) },
      { id: "s04", type: "implementer", description: "A2 Redis adapter", status: "running",
        model: "claude-opus-5-5", cost_usd: 0.31, tools: 9, started: ago(140), ended: 0 },
      { id: "s03", type: "implementer", description: "A1 Limiter interface and config", status: "done",
        model: "claude-opus-5-5", cost_usd: 0.84, tools: 21, started: ago(520), ended: ago(400) },
    ],
    workers: [
      { id: "d0101-0900-a1b2", role: "tester", model: "openrouter/demo/coder-mini:free", status: "running", started: ago(95),
        ended: null, cost_usd: 0, tokens: 412000, tools: 23, last_tool: "grep", reason: null },
      { id: "d0101-0900-c3d4", role: "implementer", model: "openrouter/demo/coder-large", status: "done", started: ago(700),
        ended: ago(480), cost_usd: 0.07, tokens: 1310000, tools: 41, last_tool: "edit", reason: null },
      { id: "d0101-0900-e5f6", role: "tester", model: "openrouter/demo/coder-mini:free", status: "failed", started: ago(700),
        ended: ago(610), cost_usd: 0, tokens: 960000, tools: 45, last_tool: "write", reason: "RESULT.md missing or without a valid status line" },
    ],
    shells: [{ id: "toolu_demo1", description: "Wait for the workers and collect results", started: ago(90) }],
    scan_ms: 42,
  };
}
