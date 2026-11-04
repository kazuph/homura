const root = document.querySelector("[data-kagero-root]");

let currentPage = null;
let currentScroll = { left: 0, top: 0 };
let pendingVisits = 0;
let loadingBar = null;

function ensureLoadingBar() {
  if (loadingBar) return loadingBar;

  const style = document.createElement("style");
  style.textContent = `
    #kagero-loading-bar {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 2147483647;
      height: 3px;
      overflow: hidden;
      pointer-events: none;
      opacity: 0;
      background: rgba(147, 197, 253, 0.24);
      transition: opacity 120ms ease;
    }

    #kagero-loading-bar[data-active="true"] {
      opacity: 1;
    }

    #kagero-loading-bar::before {
      content: "";
      position: absolute;
      top: 0;
      bottom: 0;
      left: 0;
      width: 48%;
      background: linear-gradient(
        90deg,
        rgba(59, 130, 246, 0),
        rgba(96, 165, 250, 0.35),
        rgba(37, 99, 235, 0.9),
        rgba(96, 165, 250, 0.35),
        rgba(59, 130, 246, 0)
      );
      transform: translateX(-120%);
      animation: kagero-loading-wave 700ms linear infinite;
    }

    @keyframes kagero-loading-wave {
      from { transform: translateX(-120%); }
      to { transform: translateX(260%); }
    }
  `;
  document.head.appendChild(style);

  loadingBar = document.createElement("div");
  loadingBar.id = "kagero-loading-bar";
  loadingBar.setAttribute("aria-hidden", "true");
  document.body.appendChild(loadingBar);
  return loadingBar;
}

function startLoading() {
  pendingVisits += 1;
  ensureLoadingBar().dataset.active = "true";
}

function finishLoading() {
  pendingVisits = Math.max(0, pendingVisits - 1);
  if (pendingVisits === 0 && loadingBar) {
    loadingBar.dataset.active = "false";
  }
}

function readInitialPage() {
  if (!root) return null;
  const raw = root.getAttribute("data-page");
  if (!raw) return null;
  return JSON.parse(raw);
}

function pageHtml(page) {
  return page && page.props && page.props.kagero && page.props.kagero.html;
}

function rememberScroll() {
  currentScroll = { left: window.scrollX, top: window.scrollY };
  if (history.state && history.state.kagero) {
    history.replaceState({ ...history.state, scroll: currentScroll }, "", location.href);
  }
}

function renderPage(page) {
  if (!root) return;
  const html = pageHtml(page);
  if (typeof html === "string") root.innerHTML = html;
  root.setAttribute("data-page", JSON.stringify(page));
  currentPage = page;
  if (page.props.kagero && typeof page.props.kagero.title === "string") {
    document.title = page.props.kagero.title;
  }
}

function applyPage(page, { replace = false, preserveScroll = false } = {}) {
  renderPage(page);
  const state = { kagero: true, page, scroll: preserveScroll ? currentScroll : { left: 0, top: 0 } };
  if (replace) history.replaceState(state, "", page.url);
  else history.pushState(state, "", page.url);

  if (!preserveScroll) window.scrollTo(0, 0);
}

function showFailure() {
  let notice = document.getElementById("kagero-visit-error");
  if (!notice) {
    notice = document.createElement("div");
    notice.id = "kagero-visit-error";
    notice.setAttribute("role", "alert");
    document.body.prepend(notice);
  }
  notice.textContent = "操作に失敗しました。もう一度お試しください。";
}

async function visit(url, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  const targetUrl = new URL(url, location.href);
  if (targetUrl.origin !== location.origin) {
    if (method === "GET") location.href = targetUrl.href;
    else showFailure();
    return;
  }
  startLoading();
  const headers = new Headers(options.headers || {});
  headers.set("X-Inertia", "true");
  headers.set("X-Inertia-Version", currentPage ? currentPage.version : "");
  headers.set("X-Requested-With", "XMLHttpRequest");
  headers.set("Accept", "application/json, text/html;q=0.9");

  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    const cookie = document.cookie.split("; ").find((entry) => entry.startsWith("XSRF-TOKEN="));
    if (cookie) headers.set("X-XSRF-TOKEN", decodeURIComponent(cookie.slice("XSRF-TOKEN=".length)));
  }

  try {
    const response = await fetch(url, {
      method,
      body: options.body,
      headers,
      credentials: "same-origin",
      mode: "same-origin",
      redirect: "follow"
    });

    if (new URL(response.url).origin !== location.origin) throw new Error("Cross-origin response");

    if (response.status === 409 && response.headers.get("X-Inertia-Location")) {
      const destination = new URL(response.headers.get("X-Inertia-Location"), location.href);
      const current = new URL(location.href);
      destination.hash = "";
      current.hash = "";
      if (destination.href === current.href) location.reload();
      else location.href = response.headers.get("X-Inertia-Location");
      return;
    }

    if (!response.ok) throw new Error(`Kagero visit failed: ${response.status}`);

    let page = await response.json();
    if (!page || typeof page.component !== "string" || typeof page.url !== "string" ||
        typeof page.version !== "string" || !page.props || typeof page.props !== "object" ||
        Array.isArray(page.props) || !page.props.kagero ||
        typeof page.props.kagero.html !== "string" || typeof page.props.kagero.title !== "string") {
      throw new Error("Invalid page");
    }
    const pageUrl = new URL(page.url, location.href);
    if (!["http:", "https:"].includes(pageUrl.protocol) || pageUrl.origin !== location.origin) {
      throw new Error("Invalid page URL");
    }
    const partialComponent = headers.get("X-Inertia-Partial-Component");
    if (partialComponent) {
      if (!currentPage || partialComponent !== currentPage.component) return;
      if (partialComponent === page.component) {
        page = { ...page, props: { ...currentPage.props, ...page.props } };
      }
    }
    rememberScroll();
    document.getElementById("kagero-visit-error")?.remove();
    applyPage(page, {
      replace: options.replace === true,
      preserveScroll: options.preserveScroll === true
    });
  } catch (error) {
    showFailure();
  } finally {
    finishLoading();
  }
}

function formBody(form) {
  const method = (form.getAttribute("method") || "GET").toUpperCase();
  if (method === "GET") return null;

  const enctype = (form.getAttribute("enctype") || "").toLowerCase();
  const data = new FormData(form);
  const hasFile = Array.from(data.values()).some((value) => value instanceof File);
  if (enctype === "multipart/form-data" || hasFile) return data;

  const params = new URLSearchParams();
  for (const [key, value] of data.entries()) params.append(key, value);
  return params;
}

function formUrl(form) {
  const action = form.getAttribute("action") || location.href;
  const method = (form.getAttribute("method") || "GET").toUpperCase();
  if (method !== "GET") return action;

  const url = new URL(action, location.href);
  const data = new FormData(form);
  for (const [key, value] of data.entries()) url.searchParams.set(key, value);
  return url.toString();
}

document.addEventListener("click", (event) => {
  const target = event.target;
  if (!target || !target.closest) return;

  const link = target.closest("a[data-kagero]");
  if (link) {
    if (new URL(link.href, location.href).origin !== location.origin) return;
    event.preventDefault();
    visit(link.href, {
      replace: link.dataset.kageroReplace === "true",
      preserveScroll: link.dataset.kageroPreserveScroll === "true"
    });
    return;
  }

  const reload = target.closest("[data-kagero-reload]");
  if (reload) {
    event.preventDefault();
    const only = reload.dataset.kageroOnly || "";
    const headers = {};
    if (currentPage && only) {
      headers["X-Inertia-Partial-Component"] = currentPage.component;
      headers["X-Inertia-Partial-Data"] = only;
    }
    visit(location.href, { replace: true, preserveScroll: true, headers });
  }
});

document.addEventListener("submit", (event) => {
  const target = event.target;
  if (!target || !target.closest) return;
  const form = target.closest("form[data-kagero]");
  if (!form) return;
  if (new URL(form.action, location.href).origin !== location.origin) return;

  event.preventDefault();
  visit(formUrl(form), {
    method: (form.getAttribute("method") || "GET").toUpperCase(),
    body: formBody(form),
    preserveScroll: form.dataset.kageroPreserveScroll === "true"
  });
});

window.addEventListener("popstate", (event) => {
  if (event.state && event.state.kagero && event.state.page) {
    renderPage(event.state.page);
    const scroll = event.state.scroll || { left: 0, top: 0 };
    window.scrollTo(scroll.left, scroll.top);
  } else {
    location.reload();
  }
});

currentPage = readInitialPage();
if (currentPage) {
  history.replaceState({ kagero: true, page: currentPage, scroll: { left: 0, top: 0 } }, "", currentPage.url);
}

window.Kagero = { visit };
