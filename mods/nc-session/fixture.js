// Made-up usage-mode payload (usage.py contract, v1). Shown only with props { demo: true }.
export const DEMO = {
  v: 1, unchanged: false, sig: "demo", error: null,
  session: { id: "demo", cwd: "~/project", status: "busy" },
  prices_as_of: "2026-11-03",
  models: [
    { model: "claude-opus-5-5", label: "Opus 5.5", messages: 805, input: 1653, output: 871804,
      cache_read: 117658663, cache_write_5m: 2651498, cache_write_1h: 495760, usd: 58.2 },
    { model: "claude-haiku-4-5", label: "Haiku 4.5", messages: 41, input: 12040, output: 30211,
      cache_read: 1203345, cache_write_5m: 80211, cache_write_1h: 0, usd: 0.5 },
    { model: "claude-next-1", label: "Next 1", messages: 3, input: 900, output: 1200,
      cache_read: 0, cache_write_5m: 0, cache_write_1h: 0, usd: null },
  ],
  parts: { main: { messages: 109, usd: 15.72 }, sub: { messages: 740, usd: 42.98, files: 19 } },
  total: { messages: 849, tokens: 123006638, usd: 58.7, unpriced: ["claude-next-1"] },
  used: {
    tools: [["Bash", 120], ["Read", 80], ["Edit", 31], ["Grep", 22], ["Write", 9], ["Agent", 6], ["Glob", 4]],
    skills: [["artifact-design", 2], ["claude-api", 1]],
    connectors: [["Gmail", 3], ["Google Drive", 1]],
    edited: ["mods/nc-session/main.js", "mods/nc-session/RECIPE.md", "layouts/nc.json"],
    read: ["README.md", "CLAUDE.md", "~/.config/herdr-app/AGENTS.md", "local/upstream/herdr-app-0.1.16/mods/agents/main.js"],
  },
  scan_ms: 100,
};
