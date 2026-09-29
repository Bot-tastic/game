// Account bar for the hub page: "Sign in with Google" when signed out, the
// nickname plus rename / sign out / delete when signed in. Renders nothing at
// all where there is no API (GitHub Pages), so the static hub stays as it was.
//
// Sign-in uses Google Identity Services: Google hands the page a signed ID
// token, the server verifies it and keeps only the account's opaque id.

import { api } from "./cloud.js";

const GIS_SRC = "https://accounts.google.com/gsi/client";

function loadGis() {
  if (window.google?.accounts?.id) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = GIS_SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Google sign-in could not be loaded"));
    document.head.append(s);
  });
}

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

export async function mountAccountBar(root) {
  const config = await api("GET", "/api/config");
  if (config.status !== 200) return; // static hosting: no accounts here
  root.hidden = false;

  const render = async () => {
    root.replaceChildren();
    const me = await api("GET", "/api/me");
    if (me.status === 200) renderSignedIn(me.body.user);
    else await renderSignedOut();
  };

  const note = (text, bad = false) => {
    const p = el("p", { className: `account-note${bad ? " account-note--bad" : ""}`, textContent: text });
    root.append(p);
  };

  async function renderSignedOut() {
    root.append(el("p", {
      className: "account-lead",
      textContent: "Sign in to keep your progress in the cloud and play on any device.",
    }));
    const slot = el("div", { className: "account-google" });
    root.append(slot);
    try {
      await loadGis();
    } catch (err) {
      note(err.message, true);
      return;
    }
    window.google.accounts.id.initialize({
      client_id: config.body.googleClientId,
      callback: async ({ credential }) => {
        const res = await api("POST", "/api/auth/google", { credential });
        if (res.status === 200) await render();
        else note("Sign-in failed. Please try again.", true);
      },
    });
    window.google.accounts.id.renderButton(slot, {
      theme: "filled_black", size: "large", shape: "pill", text: "signin_with",
    });
  }

  function renderSignedIn(user) {
    const name = el("strong", { className: "account-name", textContent: user.name });
    const rename = el("button", { className: "account-btn", type: "button", textContent: "Rename" });
    const logout = el("button", { className: "account-btn", type: "button", textContent: "Sign out" });
    const remove = el("button", { className: "account-btn account-btn--danger", type: "button", textContent: "Delete account" });
    root.append(
      el("div", { className: "account-row" },
        el("span", { className: "account-avatar", textContent: "👤" }),
        el("div", { className: "account-who" }, name, el("span", { className: "account-sub", textContent: "Progress is saved to the cloud" })),
      ),
      el("div", { className: "account-actions" }, rename, logout, remove),
    );

    rename.addEventListener("click", async () => {
      const next = window.prompt("New nickname (3–20 letters, numbers, space, _ . -)", user.name);
      if (next == null) return;
      const res = await api("PATCH", "/api/me", { name: next });
      if (res.status === 200) await render();
      else note("That nickname is not allowed.", true);
    });
    logout.addEventListener("click", async () => {
      await api("POST", "/api/auth/logout", {});
      window.google?.accounts?.id?.disableAutoSelect();
      await render();
    });
    remove.addEventListener("click", async () => {
      const ok = window.confirm(
        "Delete your account and all cloud saves? Progress stored on this device stays here.",
      );
      if (!ok) return;
      const res = await api("DELETE", "/api/me", {});
      if (res.status === 200) await render();
      else note("Could not delete the account. Please try again.", true);
    });
  }

  await render();
}
