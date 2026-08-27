import { formatBytes, formatDuration, formatNumber, formatRelative, h, icon, mount } from "../dom.js";

/** The landing view: is the NAS healthy, is Claude Code present, what is running. */
export function renderOverview(store, root, actions) {
  const system = store.system;
  if (!system) {
    mount(root, h("div.view", h("div.empty", "Waiting for the first system snapshot…")));
    return;
  }

  const memoryPct = system.memory.usedPct;
  const running = store.sessions.filter((s) => s.status === "working" || s.status === "idle" || s.status === "starting");
  const workingCount = store.sessions.filter((s) => s.status === "working").length;
  const totalCost = store.sessions.reduce((sum, s) => sum + (s.costUsd ?? 0), 0);

  mount(
    root,
    h(
      "div.view",
      h(
        "div.view-header",
        h("div",
          h("div.view-title", system.name),
          h("div.view-sub", `${system.hostname} · ${system.platform}/${system.arch} · up ${formatDuration(system.uptimeSeconds)}`)),
        h("button.btn.sm", { onclick: () => void actions.refresh() }, icon("refresh"), "Refresh"),
      ),

      !system.claude.available
        ? h("div.error-banner",
            h("div",
              h("strong", "Claude Code is not reachable on this NAS."),
              h("div", `The daemon tried to run "${system.claude.bin}". Install Claude Code on the NAS, or set claude.bin in the config to its full path — until then, sessions and agents cannot start.`)))
        : null,

      h(
        "div.grid",
        statCard("Memory", `${memoryPct}%`,
          `${formatBytes(system.memory.totalBytes - system.memory.freeBytes)} of ${formatBytes(system.memory.totalBytes)} used`,
          memoryPct, memoryPct > 90 ? "" : memoryPct > 75 ? "warn" : "ok"),
        statCard("Load", system.loadAverage[0].toFixed(2),
          `${system.cpu.cores} cores · ${system.loadAverage.map((n) => n.toFixed(2)).join(" / ")}`,
          Math.min((system.loadAverage[0] / Math.max(system.cpu.cores, 1)) * 100, 100),
          system.loadAverage[0] > system.cpu.cores ? "" : "ok"),
        statCard("Sessions", `${running.length}`,
          `${workingCount} working · limit ${system.claude.maxConcurrentSessions}`,
          (running.length / Math.max(system.claude.maxConcurrentSessions, 1)) * 100,
          running.length >= system.claude.maxConcurrentSessions ? "warn" : "ok"),
        h("div.card",
          h("div.card-title", "Spend this run"),
          h("div.stat-value", totalCost > 0 ? `$${totalCost.toFixed(3)}` : "—"),
          h("div.stat-note", `${formatNumber(store.sessions.reduce((n, s) => n + (s.usage?.outputTokens ?? 0), 0))} output tokens`)),
      ),

      h("div", { style: { marginTop: "18px" } },
        h("div.card-title", "Content roots"),
        system.roots.length === 0
          ? h("div.empty", "No roots configured. Add them to the server config and restart the daemon.")
          : h("div.grid", ...system.roots.map((rootEntry) => rootCard(rootEntry, actions)))),

      h("div", { style: { marginTop: "18px" } },
        h("div.card-title", "Active sessions"),
        running.length === 0
          ? h("div.empty", "Nothing running. Open the Sessions tab to start one, or launch an agent.")
          : h("div.grid", ...running.map((session) => sessionCard(session, store, actions)))),

      h("div", { style: { marginTop: "18px" } },
        h("div.card-title", "Claude Code"),
        h("div.card",
          kv("Binary", system.claude.bin),
          kv("Version", system.claude.version ?? "unavailable"),
          kv("Default model", system.claude.defaultModel ?? "CLI default"),
          kv("Default permission mode", system.claude.defaultPermissionMode),
          kv("Server time", new Date(system.serverTime).toLocaleString()))),
    ),
  );
}

function statCard(title, value, note, percent, tone) {
  return h("div.card",
    h("div.card-title", title),
    h("div.stat-value", value),
    h("div.stat-note", note),
    h(`div.meter${tone ? `.${tone}` : ""}`, h("i", { style: { width: `${Math.max(0, Math.min(100, percent))}%` } })));
}

function rootCard(root, actions) {
  const usedPct = root.disk && root.disk.totalBytes
    ? Math.round(((root.disk.totalBytes - root.disk.freeBytes) / root.disk.totalBytes) * 100)
    : null;

  return h("div.card",
    h("div", { style: { display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" } },
      icon("folder"),
      h("div", { style: { fontWeight: "600" } }, root.label),
      h(`span.badge${root.available ? "" : ".error"}`, h("span.dot"), root.available ? "mounted" : "unavailable")),
    h("div.stat-note.mono", { style: { fontSize: "11px", wordBreak: "break-all" } }, root.path),
    root.error ? h("div.stat-note", { style: { color: "var(--signal-error)" } }, root.error) : null,
    h("div", { style: { display: "flex", gap: "6px", marginTop: "8px", flexWrap: "wrap" } },
      h("span.badge", root.workspace ? "workspace" : "content"),
      h("span.badge", root.readOnly ? "read-only" : "writable")),
    usedPct !== null
      ? h("div",
          h("div.stat-note", { style: { marginTop: "8px" } },
            `${formatBytes(root.disk.freeBytes)} free of ${formatBytes(root.disk.totalBytes)}`),
          h(`div.meter${usedPct > 90 ? "" : usedPct > 75 ? ".warn" : ".ok"}`, h("i", { style: { width: `${usedPct}%` } })))
      : null,
    root.available
      ? h("button.btn.sm", { style: { marginTop: "10px" }, onclick: () => actions.browse(root.id, "") }, icon("files"), "Browse")
      : null);
}

function sessionCard(session, store, actions) {
  const agent = store.agents.find((a) => a.id === session.agentId);
  return h("div.card",
    h("div", { style: { display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" } },
      icon("terminal"),
      h("div", { style: { fontWeight: "600", flex: "1", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, session.title),
      h(`span.badge.${session.status}`, h("span.dot"), session.status)),
    agent ? h("div.stat-note", `agent · ${agent.name}`) : null,
    h("div.stat-note", `${session.turns} turns · ${formatRelative(session.lastActivityAt)}`),
    h("button.btn.sm", { style: { marginTop: "10px" }, onclick: () => actions.openSession(session.id) }, "Open"));
}

function kv(label, value) {
  return h("div", { style: { display: "flex", justifyContent: "space-between", gap: "12px", padding: "4px 0", fontSize: "13px" } },
    h("span", { style: { color: "var(--text-secondary)" } }, label),
    h("span.mono", { style: { fontSize: "12px", textAlign: "right", wordBreak: "break-all" } }, String(value)));
}
