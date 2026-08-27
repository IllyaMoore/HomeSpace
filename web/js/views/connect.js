import { probeServer } from "../api.js";
import { h, mount, icon } from "../dom.js";
import { forgetServer, loadServers, saveServer, serverId } from "../store.js";

/**
 * The gate. Nothing else in the app renders until a NAS has answered and the
 * token has been accepted, so this is also where "which NAS?" is decided when
 * the browser knows several.
 */
export function renderConnect(store, root) {
  const known = loadServers();
  const status = h("div.field-hint");
  const sameOrigin = window.location.origin;

  const addressInput = h("input", {
    type: "text",
    placeholder: `${sameOrigin} or http://nas.local:7333`,
    value: known[0]?.baseUrl ?? sameOrigin,
    spellcheck: "false",
    autocapitalize: "off",
  });
  const tokenInput = h("input", {
    type: "password",
    placeholder: "access token from `homespace token`",
    autocomplete: "current-password",
  });
  const submit = h("button.btn.primary", { type: "submit" }, "Connect");

  const attempt = async (baseUrl, token) => {
    submit.disabled = true;
    status.textContent = "contacting the server…";
    status.style.color = "";
    try {
      const normalized = normalizeUrl(baseUrl);
      const { health } = await probeServer(normalized, token);
      const server = {
        id: serverId(normalized),
        name: health.name || "HomeSpace",
        baseUrl: normalized,
        token,
      };
      saveServer(server);
      store.connect(server);
      await store.refresh();
      store.emit("connected");
    } catch (err) {
      status.style.color = "var(--signal-error)";
      status.textContent =
        err?.status === 401
          ? "the server is there, but that token was rejected"
          : (err?.message ?? "could not connect");
      submit.disabled = false;
    }
  };

  const form = h(
    "form",
    {
      onsubmit: (event) => {
        event.preventDefault();
        const address = addressInput.value.trim();
        const token = tokenInput.value.trim();
        if (!address) {
          status.style.color = "var(--signal-error)";
          status.textContent = "enter the address of your NAS";
          return;
        }
        if (!token) {
          status.style.color = "var(--signal-error)";
          status.textContent = "enter the access token";
          return;
        }
        void attempt(address, token);
      },
    },
    h("label.field", h("span", "NAS address"), addressInput,
      h("div.field-hint", "The host and port the HomeSpace daemon listens on.")),
    h("label.field", h("span", "Access token"), tokenInput,
      h("div.field-hint", "Run `homespace token` on the NAS to print it.")),
    submit,
    status,
  );

  const card = h(
    "div.connect-card",
    h("div.brand", { style: { marginBottom: "14px" } }, icon("home"), h("div.brand-name", "HomeSpace")),
    h("h1", "Connect to your NAS"),
    h("p.lede", "Browse content, open Claude Code sessions, and drive code agents on the box itself."),
    form,
    known.length > 0
      ? h(
          "div.connect-known",
          h("div.card-title", "Saved servers"),
          ...known.map((server) =>
            h(
              "div.known-server",
              {
                role: "button",
                tabindex: "0",
                onclick: () => void attempt(server.baseUrl, server.token),
                onkeydown: (event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    void attempt(server.baseUrl, server.token);
                  }
                },
              },
              icon("home"),
              h("div", h("div", server.name), h("div.url.mono", server.baseUrl)),
              h("button.btn.ghost.sm.forget", {
                title: "Forget this server",
                onclick: (event) => {
                  event.stopPropagation();
                  forgetServer(server.id);
                  renderConnect(store, root);
                },
              }, "Forget"),
            ),
          ),
        )
      : null,
  );

  mount(root, h("div.connect", card));
  (known.length > 0 ? tokenInput : addressInput).focus();
}

function normalizeUrl(value) {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `http://${trimmed}`;
}
