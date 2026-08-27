/**
 * A ~60-line rendering layer, deliberately not a framework. The whole app is
 * five views; a build step and a dependency tree would cost more than they buy
 * on a box whose job is to serve files.
 */

/**
 * True only for a plain props bag. A DOM node, an array of children, a string
 * or a number in the second position is a child, not props — without this
 * check, `h("div", childA, childB)` would try to setAttribute("0", …) from the
 * array index and throw.
 */
function isProps(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !(value instanceof Node)
  );
}

/**
 * h("div.card", {onclick}, child, child) — the tag string may carry classes.
 * The props bag is optional: h("div.card", child) works too.
 */
export function h(spec, props, ...children) {
  const [tag, ...classes] = String(spec).split(".");
  const el = document.createElement(tag || "div");
  if (classes.length) el.className = classes.join(" ");

  if (!isProps(props)) {
    if (props !== undefined) children.unshift(props);
    props = null;
  }

  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === null || value === undefined || value === false) continue;

    if (key === "class" || key === "className") {
      el.className = [el.className, value].filter(Boolean).join(" ");
    } else if (key === "style" && typeof value === "object") {
      Object.assign(el.style, value);
    } else if (key === "dataset" && typeof value === "object") {
      Object.assign(el.dataset, value);
    } else if (key.startsWith("on") && typeof value === "function") {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === "html") {
      // Only ever called with strings this app itself built.
      el.innerHTML = value;
    } else if (value === true) {
      el.setAttribute(key, "");
    } else {
      el.setAttribute(key, String(value));
    }
  }

  append(el, children);
  return el;
}

function append(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false || child === true) continue;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function mount(node, ...children) {
  clear(node);
  append(node, children);
  return node;
}

/** Inline SVG icons, 24x24 stroke-based, sized by CSS. */
const PATHS = {
  home: "M3 10.2 12 3l9 7.2M5 9.5V21h14V9.5",
  files: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z",
  folder: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z",
  file: "M14 3v5h5M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z",
  image: "M4 5h16v14H4zM4 15l4-4 4 4 3-3 5 5M9 9.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z",
  video: "M4 6h11v12H4zM15 10l5-3v10l-5-3Z",
  audio: "M9 18V5l10-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM19 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  archive: "M4 5h16v4H4zM5 9v10h14V9M10 13h4",
  terminal: "M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1ZM8 9l3 3-3 3M13 15h4",
  agents: "M12 3v3M8 6h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2ZM4 12H2M22 12h-2M9.5 11v1M14.5 11v1M9 21l1.5-4M15 21l-1.5-4",
  play: "M7 4.5 19 12 7 19.5Z",
  stop: "M6 6h12v12H6z",
  pause: "M8 5h3v14H8zM13 5h3v14h-3z",
  refresh: "M20 11a8 8 0 1 0-.6 4M20 5v6h-6",
  plus: "M12 5v14M5 12h14",
  trash: "M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13h10l1-13",
  download: "M12 4v11m0 0 4-4m-4 4-4-4M4 19h16",
  search: "M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14ZM20 20l-4-4",
  settings: "M4 7h9M17 7h3M4 12h3M11 12h9M4 17h9M17 17h3M15 5v4M9 10v4M15 15v4",
  sun: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10ZM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4",
  moon: "M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z",
  logout: "M14 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 16l-4-4 4-4M6 12h9",
  menu: "M4 7h16M4 12h16M4 17h16",
  back: "M15 19l-7-7 7-7",
  send: "M4 12 20 4l-4 16-4-7Z",
};

export function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.7");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", PATHS[name] ?? PATHS.file);
  svg.append(path);
  return svg;
}

// ------------------------------------------------------------- formatting

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const power = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** power;
  return `${value >= 100 || power === 0 ? Math.round(value) : value.toFixed(1)} ${units[power]}`;
}

export function formatRelative(iso) {
  if (!iso) return "—";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "—";
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return "—";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function formatNumber(value) {
  return Number.isFinite(value) ? value.toLocaleString() : "—";
}

export function iconForKind(kind) {
  if (kind === "directory") return icon("folder");
  if (kind === "image") return icon("image");
  if (kind === "video") return icon("video");
  if (kind === "audio") return icon("audio");
  if (kind === "archive") return icon("archive");
  return icon("file");
}
