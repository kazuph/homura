const root = document.querySelector("[data-kagero-root]");

let currentPage = null;
let currentScroll = { left: 0, top: 0 };

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

function applyPage(page, { replace = false, preserveScroll = false } = {}) {
  if (!root) return;
  const html = pageHtml(page);
  if (typeof html === "string") root.innerHTML = html;
  root.setAttribute("data-page", JSON.stringify(page));
  currentPage = page;

  const state = { kagero: true, page, scroll: preserveScroll ? currentScroll : { left: 0, top: 0 } };
  if (replace) history.replaceState(state, "", page.url);
  else history.pushState(state, "", page.url);

  if (!preserveScroll) window.scrollTo(0, 0);
}

async function visit(url, options = {}) {
  rememberScroll();
  const headers = new Headers(options.headers || {});
  headers.set("X-Inertia", "true");
  headers.set("X-Inertia-Version", currentPage ? currentPage.version : "");
  headers.set("X-Requested-With", "XMLHttpRequest");
  headers.set("Accept", "application/json, text/html;q=0.9");

  const response = await fetch(url, {
    method: options.method || "GET",
    body: options.body,
    headers,
    credentials: "same-origin",
    redirect: "follow"
  });

  if (response.status === 409 && response.headers.get("X-Inertia-Location")) {
    location.href = response.headers.get("X-Inertia-Location");
    return;
  }

  if (!response.ok) throw new Error(`Kagero visit failed: ${response.status}`);

  const page = await response.json();
  applyPage(page, {
    replace: options.replace === true,
    preserveScroll: options.preserveScroll === true
  });
}

function formBody(form) {
  const method = (form.getAttribute("method") || "GET").toUpperCase();
  if (method === "GET") return null;
  return new FormData(form);
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
  const link = event.target.closest("a[data-kagero]");
  if (link) {
    event.preventDefault();
    visit(link.href, {
      replace: link.dataset.kageroReplace === "true",
      preserveScroll: link.dataset.kageroPreserveScroll === "true"
    });
    return;
  }

  const reload = event.target.closest("[data-kagero-reload]");
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
  const form = event.target.closest("form[data-kagero]");
  if (!form) return;

  event.preventDefault();
  visit(formUrl(form), {
    method: (form.getAttribute("method") || "GET").toUpperCase(),
    body: formBody(form),
    preserveScroll: form.dataset.kageroPreserveScroll === "true"
  });
});

window.addEventListener("popstate", (event) => {
  if (event.state && event.state.kagero && event.state.page) {
    currentPage = event.state.page;
    const html = pageHtml(currentPage);
    if (typeof html === "string") root.innerHTML = html;
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
