import { formatRelative, h, icon, mount } from "../dom.js";
import { modalShell } from "./sessions.js";

const PERMISSION_MODES = ["manual", "acceptEdits", "auto", "plan", "dontAsk", "bypassPermissions"];

const MODE_HELP = {
  manual: "Claude asks before every tool use. Safest.",
  acceptEdits: "File edits are auto-approved; other tools still ask.",
  auto: "Claude decides when to ask.",
  plan: "Read-only: Claude produces a plan and changes nothing.",
  dontAsk: "No prompts; the agent proceeds on its own judgement.",
  bypassPermissions: "Every permission check is skipped. Only for a workspace you can afford to lose.",
};

/** Saved workers: a workspace plus a policy, startable with one click. */
export function renderAgents(store, root, actions) {
  const agents = store.agents;

  mount(root, h("div.view",
    h("div.view-header",
      h("div",
        h("div.view-title", "Code agents"),
        h("div.view-sub", "Saved Claude Code workers bound to a workspace on this NAS")),
      h("div", { style: { display: "flex", gap: "8px" } },
        h("button.btn.sm", { onclick: () => void actions.refresh() }, icon("refresh"), "Refresh"),
        h("button.btn.primary.sm", { onclick: () => actions.openAgentForm(null) }, icon("plus"), "New agent"))),

    agents.length === 0
      ? h("div.empty",
          h("div", "No agents yet."),
          h("div", { style: { marginTop: "8px" } },
            "An agent remembers a workspace, a model and a permission mode, so you can put it to work without setting it up each time."))
      : h("div.grid", ...agents.map((agent) => agentCard(agent, store, actions)))));
}

function agentCard(agent, store, actions) {
  const busy = agent.status === "working";
  const live = agent.status === "running" || busy;

  return h("div.card.agent-card",
    h("div.head",
      icon("agents"),
      h("div", { style: { flex: 1, minWidth: 0 } },
        h("div.name", agent.name),
        agent.description ? h("div.desc", agent.description) : null),
      h(`span.badge.${agent.status}`, h("span.dot"), agent.status)),

    h("div.path.mono", agent.workspaceError ?? agent.workspacePath ?? ""),
    h("div", { style: { display: "flex", gap: "6px", flexWrap: "wrap" } },
      h("span.badge", agent.model ?? "default model"),
      h("span.badge", { title: MODE_HELP[agent.permissionMode] }, agent.permissionMode),
      agent.allowedTools.length
        ? h("span.badge", { title: "Tools this agent may use without asking" }, `${agent.allowedTools.length} auto-approved`)
        : null,
      agent.disallowedTools.length
        ? h("span.badge", { title: "Tools this agent may never use" }, `${agent.disallowedTools.length} denied`)
        : null),

    agent.sessions.length > 0
      ? h("div", { style: { fontSize: "11px", color: "var(--text-muted)" } },
          `${agent.sessions.length} session(s) · last active ${formatRelative(agent.sessions[0].lastActivityAt)}`)
      : null,

    h("div.actions",
      live
        ? h("button.btn.primary.sm", { onclick: () => actions.openTaskForm(agent) }, icon("send"), "Assign task")
        : h("button.btn.primary.sm", {
            disabled: Boolean(agent.workspaceError) || null,
            onclick: () => actions.openTaskForm(agent),
          }, icon("play"), "Start"),
      agent.activeSessionId
        ? h("button.btn.sm", { onclick: () => actions.openSession(agent.activeSessionId) }, icon("terminal"), "Open")
        : null,
      live ? h("button.btn.sm.danger", { onclick: () => void actions.stopAgent(agent.id) }, icon("stop"), "Stop") : null,
      h("button.btn.ghost.sm", { onclick: () => actions.openAgentForm(agent) }, icon("settings")),
      h("button.btn.ghost.sm.danger", {
        title: "Delete this agent",
        onclick: () => void actions.deleteAgent(agent),
      }, icon("trash"))));
}

/** Create/edit form. `agent` is null when creating. */
export function agentFormModal(store, actions, agent) {
  const workspaces = (store.system?.roots ?? []).filter((r) => r.workspace);

  if (workspaces.length === 0) {
    return modalShell("New agent",
      h("div.empty", "No workspace root is configured. Mark one root with \"workspace\": true in the server config and restart the daemon."),
      [h("button.btn", { onclick: actions.closeModal }, "Close")]);
  }

  const nameInput = h("input", { type: "text", value: agent?.name ?? "", placeholder: "e.g. media librarian" });
  const descInput = h("input", { type: "text", value: agent?.description ?? "", placeholder: "what this agent is for" });
  const rootSelect = h("select", ...workspaces.map((r) =>
    h("option", { value: r.id, selected: r.id === agent?.rootId || null }, `${r.label} — ${r.path}`)));
  const pathInput = h("input", { type: "text", value: agent?.path ?? "", placeholder: "subdirectory (optional)", spellcheck: "false" });
  const modelInput = h("input", {
    type: "text",
    value: agent?.model ?? "",
    placeholder: store.system?.claude.defaultModel ?? "CLI default",
  });

  const modeHint = h("div.field-hint");
  const modeSelect = h("select", {
    onchange: (event) => { modeHint.textContent = MODE_HELP[event.target.value] ?? ""; },
  }, ...PERMISSION_MODES.map((mode) =>
    h("option", { value: mode, selected: mode === (agent?.permissionMode ?? store.system?.claude.defaultPermissionMode) || null }, mode)));
  modeHint.textContent = MODE_HELP[modeSelect.value] ?? "";

  const instructionsInput = h("textarea", {
    value: agent?.instructions ?? "",
    placeholder: "Appended to Claude Code's system prompt for this agent.",
  });
  const allowedInput = h("input", {
    type: "text",
    value: (agent?.allowedTools ?? []).join(", "),
    placeholder: "Read, Grep, Bash(git *)",
  });
  const deniedInput = h("input", {
    type: "text",
    value: (agent?.disallowedTools ?? []).join(", "),
    placeholder: "WebFetch, Bash(rm *)",
  });
  const error = h("div.field-hint", { style: { color: "var(--signal-error)" } });

  const save = async () => {
    const payload = {
      name: nameInput.value.trim(),
      description: descInput.value.trim(),
      rootId: rootSelect.value,
      path: pathInput.value.trim(),
      model: modelInput.value.trim() || null,
      permissionMode: modeSelect.value,
      instructions: instructionsInput.value.trim(),
      allowedTools: splitList(allowedInput.value),
      disallowedTools: splitList(deniedInput.value),
    };
    if (!payload.name) {
      error.textContent = "give the agent a name";
      return;
    }
    try {
      if (agent) await store.api.updateAgent(agent.id, payload);
      else await store.api.createAgent(payload);
      actions.closeModal();
      await actions.refresh();
      store.toast(agent ? "Agent updated" : "Agent created", "success");
    } catch (err) {
      error.textContent = err?.message ?? "could not save the agent";
    }
  };

  return modalShell(agent ? `Edit ${agent.name}` : "New agent",
    h("div",
      h("label.field", h("span", "Name"), nameInput),
      h("label.field", h("span", "Description"), descInput),
      h("div.field-row",
        h("label.field", h("span", "Workspace root"), rootSelect),
        h("label.field", h("span", "Subdirectory"), pathInput)),
      h("div.field-row",
        h("label.field", h("span", "Model"), modelInput),
        h("label.field", h("span", "Permission mode"), modeSelect, modeHint)),
      h("label.field", h("span", "Instructions"), instructionsInput),
      h("label.field", h("span", "Auto-approved tools"), allowedInput,
        h("div.field-hint",
          "Comma-separated. These run without a permission prompt. This is an auto-approve list, not a restriction — it does not stop the agent using other tools.")),
      h("label.field", h("span", "Denied tools"), deniedInput,
        h("div.field-hint", "Tools the agent may never use. This is the field that actually restricts it.")),
      error),
    [
      h("button.btn", { onclick: actions.closeModal }, "Cancel"),
      h("button.btn.primary", { onclick: () => void save() }, agent ? "Save" : "Create"),
    ]);
}

/** Start-or-assign form: the same box whether the agent is already up. */
export function taskModal(store, actions, agent) {
  const running = agent.status === "running" || agent.status === "working";
  const taskInput = h("textarea", {
    placeholder: "What should this agent do?",
    style: { minHeight: "120px" },
  });
  const error = h("div.field-hint", { style: { color: "var(--signal-error)" } });

  const submit = async () => {
    const task = taskInput.value.trim();
    if (!task && running) {
      error.textContent = "enter a task";
      return;
    }
    try {
      const result = running
        ? await store.api.assignTask(agent.id, task)
        : await store.api.startAgent(agent.id, task);
      actions.closeModal();
      await actions.refresh();
      if (result?.session?.id) actions.openSession(result.session.id);
    } catch (err) {
      error.textContent = err?.message ?? "could not send the task";
    }
  };

  return modalShell(running ? `Assign a task to ${agent.name}` : `Start ${agent.name}`,
    h("div",
      h("div.field-hint", { style: { marginBottom: "10px" } },
        running
          ? "Goes to the agent's running session."
          : `Starts a Claude Code session in ${agent.workspacePath ?? "its workspace"}${agent.permissionMode === "bypassPermissions" ? " with every permission check skipped." : "."}`),
      h("label.field", h("span", "Task"), taskInput,
        !running ? h("div.field-hint", "Optional — you can start the agent and prompt it afterwards.") : null),
      error),
    [
      h("button.btn", { onclick: actions.closeModal }, "Cancel"),
      h("button.btn.primary", { onclick: () => void submit() }, running ? "Send" : "Start"),
    ]);
}

function splitList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
