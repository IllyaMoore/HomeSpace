import { formatBytes, formatRelative, h, icon, iconForKind, mount } from "../dom.js";

/**
 * Two-pane content browser: directory listing on the left, preview on the
 * right. On narrow screens the preview replaces the list instead of squeezing
 * next to it.
 */
export function renderFiles(store, root, actions, state) {
  const roots = store.system?.roots ?? [];
  if (roots.length === 0) {
    mount(root, h("div.view", h("div.empty", "No content roots are configured on this NAS.")));
    return;
  }

  const activeRootId = state.rootId && roots.some((r) => r.id === state.rootId)
    ? state.rootId
    : roots[0].id;
  const activeRoot = roots.find((r) => r.id === activeRootId);

  const listPane = h("div.pane.list");
  const previewPane = h("div.pane.preview");
  const layout = h(`div.files-layout${state.selected ? "" : ".single"}${state.mobilePreview ? ".show-preview" : ""}`,
    listPane, state.selected ? previewPane : null);

  mount(root, h("div.view", { style: { display: "flex", flexDirection: "column" } },
    h("div.view-header",
      h("div",
        h("div.view-title", "Content"),
        h("div.view-sub", activeRoot ? activeRoot.path : "")),
      h("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap" } },
        rootSelect(roots, activeRootId, actions),
        searchBox(store, activeRootId, actions, state))),
    layout));

  renderListPane(listPane, store, activeRoot, actions, state);
  if (state.selected) renderPreviewPane(previewPane, store, activeRoot, actions, state);
}

function rootSelect(roots, activeRootId, actions) {
  const select = h("select", {
    style: { width: "auto" },
    onchange: (event) => actions.browse(event.target.value, ""),
  }, ...roots.map((r) => h("option", { value: r.id, selected: r.id === activeRootId || null },
    `${r.label}${r.available ? "" : " (unavailable)"}`)));
  return select;
}

function searchBox(store, rootId, actions, state) {
  const input = h("input", {
    "data-focus-key": "file-search",
    type: "search",
    placeholder: "Search filenames…",
    value: state.query ?? "",
    style: { width: "220px" },
    oninput: (event) => actions.searchInput(event.target.value),
    onkeydown: (event) => { if (event.key === "Escape") actions.searchInput(""); },
  });
  return h("div", { style: { display: "flex", alignItems: "center", gap: "6px" } }, input);
}

function renderListPane(pane, store, activeRoot, actions, state) {
  const head = h("div.pane-head");
  const body = h("div.pane-body");
  mount(pane, head, body);

  if (state.query) {
    mount(head,
      h("div.pane-title", `Search "${state.query}"`),
      h("button.btn.ghost.sm", { style: { marginLeft: "auto" }, onclick: () => actions.searchInput("") }, "Clear"));

    if (state.searching) {
      mount(body, h("div.empty", "Searching…"));
      return;
    }
    const hits = state.searchResults?.hits ?? [];
    if (hits.length === 0) {
      mount(body, h("div.empty", "No matching files."));
      return;
    }
    mount(body,
      ...hits.map((hit) => fileRow(hit, state, actions, hit.path)),
      state.searchResults?.truncated
        ? h("div.preview-note", `Showing the first ${hits.length} matches — narrow the query for more.`)
        : null);
    return;
  }

  const listing = state.listing;
  mount(head, breadcrumbs(activeRoot, state.path, actions),
    h("button.btn.ghost.sm", {
      style: { marginLeft: "auto" },
      title: "Reload this directory",
      onclick: () => actions.browse(state.rootId, state.path, { force: true }),
    }, icon("refresh")));

  if (state.loading) {
    mount(body, h("div.empty", "Loading…"));
    return;
  }
  if (state.error) {
    mount(body, h("div.empty", { style: { color: "var(--signal-error)" } }, state.error));
    return;
  }
  if (!listing) {
    mount(body, h("div.empty", "Nothing loaded."));
    return;
  }

  const rows = [];
  if (listing.parent !== null) {
    rows.push(h("button.file-row.dir", { onclick: () => actions.browse(state.rootId, listing.parent) },
      icon("back"), h("span.name", "..")));
  }
  for (const entry of listing.entries) rows.push(fileRow(entry, state, actions));

  mount(body,
    rows.length === 0 ? h("div.empty", "This directory is empty.") : rows,
    listing.truncated ? h("div.preview-note", "Listing truncated — this directory has more entries than the limit.") : null);
}

function fileRow(entry, state, actions, explicitPath) {
  const path = explicitPath ?? entry.path;
  const isDir = entry.kind === "directory";
  return h(
    `button.file-row${isDir ? ".dir" : ""}`,
    {
      "aria-selected": !isDir && state.selected?.path === path ? "true" : null,
      onclick: () => (isDir ? actions.browse(state.rootId, path) : actions.select(state.rootId, path)),
      title: path,
    },
    iconForKind(entry.kind),
    h("span.name", entry.name),
    h("span.meta", isDir ? "" : formatBytes(entry.sizeBytes)),
    entry.modifiedAt ? h("span.meta", formatRelative(entry.modifiedAt)) : null,
  );
}

function breadcrumbs(activeRoot, path, actions) {
  const parts = String(path || "").split("/").filter(Boolean);
  const crumbs = [
    h("button.crumb", { onclick: () => actions.browse(activeRoot.id, "") }, activeRoot.label),
  ];
  let accumulated = "";
  parts.forEach((part, index) => {
    accumulated = accumulated ? `${accumulated}/${part}` : part;
    const target = accumulated;
    crumbs.push(h("span.crumb-sep", "/"));
    crumbs.push(
      index === parts.length - 1
        ? h("span.crumb.current", part)
        : h("button.crumb", { onclick: () => actions.browse(activeRoot.id, target) }, part),
    );
  });
  return h("div.crumbs", ...crumbs);
}

function renderPreviewPane(pane, store, activeRoot, actions, state) {
  const detail = state.selected;
  const head = h("div.pane-head",
    h("button.btn.ghost.sm.only-mobile", { onclick: () => actions.closePreview() }, icon("back")),
    h("div.pane-title", { title: detail.path }, detail.name),
    h("div", { style: { marginLeft: "auto", display: "flex", gap: "6px" } },
      h("a.btn.sm", {
        href: store.api.rawUrl(activeRoot.id, detail.path, { download: true }),
        download: detail.name,
      }, icon("download"), "Download"),
      h("button.btn.ghost.sm", { onclick: () => actions.closePreview() }, "Close")));

  const body = h("div.pane-body");
  mount(pane, head, body);

  if (state.previewLoading) {
    mount(body, h("div.preview-note", "Loading preview…"));
    return;
  }
  if (state.previewError) {
    mount(body, h("div.preview-note", { style: { color: "var(--signal-error)" } }, state.previewError));
    return;
  }

  const rawUrl = store.api.rawUrl(activeRoot.id, detail.path);
  const meta = h("div.preview-note", { style: { padding: "10px 14px", textAlign: "left", borderBottom: "1px solid var(--surface-border)" } },
    `${detail.kind} · ${formatBytes(detail.sizeBytes)} · modified ${formatRelative(detail.modifiedAt)}`);

  if (detail.content !== null && detail.content !== undefined) {
    mount(body, meta, h("pre.preview-text.mono", detail.content),
      detail.contentTruncated ? h("div.preview-note", "Preview truncated.") : null);
    return;
  }

  if (detail.kind === "image") {
    mount(body, meta, h("img.preview-media", { src: rawUrl, alt: detail.name, loading: "lazy" }));
    return;
  }
  if (detail.kind === "video") {
    mount(body, meta, h("video.preview-media", { src: rawUrl, controls: true, preload: "metadata" }));
    return;
  }
  if (detail.kind === "audio") {
    mount(body, meta, h("audio.preview-media", { src: rawUrl, controls: true, preload: "metadata", style: { width: "90%" } }));
    return;
  }
  if (detail.kind === "pdf") {
    mount(body, meta, h("iframe", { src: rawUrl, style: { width: "100%", height: "70vh", border: "0" }, title: detail.name }));
    return;
  }

  mount(body, meta, h("div.preview-note", detail.reason ?? "No inline preview for this file type."));
}
