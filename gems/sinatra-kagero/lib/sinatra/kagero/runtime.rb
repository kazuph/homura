# frozen_string_literal: true

module Sinatra
  module Kagero
    module Runtime
      SOURCE = <<~JS
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
          startLoading();
          const headers = new Headers(options.headers || {});
          headers.set("X-Inertia", "true");
          headers.set("X-Inertia-Version", currentPage ? currentPage.version : "");
          headers.set("X-Requested-With", "XMLHttpRequest");
          headers.set("Accept", "application/json, text/html;q=0.9");

          try {
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
      JS
    end
  end
end
