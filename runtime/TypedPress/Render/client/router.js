// Region navigation for TypedPress's <Link> (docs/spec/rendering.md §4.3). A click on a same-site link
// fetches the next page and swaps the router region in place with @wordpress/interactivity-router;
// a modified click, another target or a download stays a normal navigation. Without JavaScript the
// links are ordinary links.
//
// The JavaScript submit for `<form action={name}>` (docs/decisions/2026-11-14-forms-without-javascript.md):
// the same form-encoded post, sent with `fetch`. `fetch` follows the action's 303 to the page with
// `?_flash=<id>`, so that one page request reads the read-once flash, and the router gets that HTML
// handed to it (`html`, as client/live-region.js does): it diffs the region, so client components
// and scroll stay, and nothing reloads. Without JavaScript the form posts as before.
//
// Once a post may have reached the server, it is never sent again: a failure after that shows a
// message in the form. Only when the router module can't load (nothing was sent) does the browser
// post the form itself.
import { store, withSyncEvent, getElement, getConfig } from "@wordpress/interactivity";

const MARKER = "_flash";
const PENDING = "data-tp-pending";
const SUBMITS = 'button:not([type]), button[type="submit"], input[type="submit"], input[type="image"]';

// What submits and `<Live>` swaps share on this page (client/live-region.js reads it):
// - `pending`, `idle`: how many submits are in flight, and a promise for when none is;
// - `ticket`, `last`: each submit's number, and the number of the last one rendered, so an answer
//   older than one already on the page is dropped;
// - `renders`: how many submit answers were rendered, so a `<Live>` answer held during one knows;
// - `living`, `live`: whether a `<Live>` swap is in progress, and a promise for its end, which a
//   submit waits for before rendering.
const forms = (globalThis[Symbol.for("tp/forms")] ??= { pending: 0, idle: Promise.resolve(), ticket: 0, last: 0, renders: 0, living: false, live: Promise.resolve() });
let idleNow = () => {};
const begin = () => {
  if (forms.pending++ === 0) forms.idle = new Promise((resolve) => { idleNow = resolve; });
  return ++forms.ticket;
};
const end = () => {
  if (--forms.pending === 0) idleNow();
};

const sameSite = (event, ref) =>
  ref instanceof HTMLAnchorElement &&
  event.button === 0 &&
  !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey &&
  (ref.target === "" || ref.target === "_self") &&
  !ref.hasAttribute("download") &&
  ref.origin === window.location.origin;

// Attributes are read with getAttribute: a field named `action`, `method` or `target` shadows the
// form's own properties.
const attr = (el, name) => (el && el.hasAttribute(name) ? el.getAttribute(name) : null);

// The form's post URL when this submit is one the script sends: a form-encoded post, in this tab,
// to this site, from a form inside the router region. Anything else stays the browser's.
const submitUrl = (form, submitter) => {
  if (!(form instanceof HTMLFormElement) || !form.closest("[data-wp-router-region]")) return null;
  const method = (attr(submitter, "formmethod") ?? attr(form, "method") ?? "get").toLowerCase();
  const target = attr(submitter, "formtarget") ?? attr(form, "target") ?? "";
  const encoding = (attr(submitter, "formenctype") ?? attr(form, "enctype") ?? "application/x-www-form-urlencoded").toLowerCase();
  if (method !== "post" || (target !== "" && target !== "_self") || encoding !== "application/x-www-form-urlencoded") return null;
  let url;
  try {
    url = new URL(attr(submitter, "formaction") ?? attr(form, "action") ?? "", document.baseURI);
  } catch {
    return null;
  }
  if (url.origin !== window.location.origin) return null;
  // Only TypedPress's own form endpoints: an action (`<form action={name}>`) or `<Comments>`. Their
  // answer is a 303 to a page of this site. A `formaction` to anywhere else posts as the browser does.
  const base = new URL(getConfig("tp/router")?.forms || "/__tp/api/v1/", document.baseURI);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) return null;
  const rest = url.pathname.slice(base.pathname.length);
  return /^actions\/[^/]+$/.test(rest) || rest === "comments" ? url : null;
};

// A URL without the flash marker: the history entry and the router's page cache use it, so the
// marker never reaches a URL someone copies, bookmarks or shares.
const withoutMarker = (href) => {
  const url = new URL(href, window.location.href);
  url.searchParams.delete(MARKER);
  return url.href;
};
const pagePath = (href) => {
  const url = new URL(withoutMarker(href));
  return url.pathname + url.search;
};

// A page the browser loaded with the marker (a form posted without this script, or the fallback
// below): the address bar shows it without. The flash was read with this document already.
if (new URL(window.location.href).searchParams.has(MARKER)) {
  window.history.replaceState(window.history.state, "", withoutMarker(window.location.href));
}

// The browser's own submit, when the router can't load: nothing has been sent. The pressed button
// is enabled for the moment the browser reads it; the submit event this fires is let through.
// Returns whether the browser is now posting it: false when the form's own validation, or a
// handler of the submit event, stopped it, so the caller lets go of the pending state.
const native = new WeakSet();
const nativeSubmit = (form, submitter) => {
  native.add(form);
  const pressed = submitter?.isConnected && submitter.form === form ? submitter : null;
  const wasDisabled = pressed?.disabled;
  if (pressed) pressed.disabled = false;
  let sent = false;
  const sending = (event) => { sent = event.target === form && !event.defaultPrevented; };
  try {
    // Registered last on window, so it runs after every other handler of this submit event.
    window.addEventListener("submit", sending);
    form.requestSubmit(pressed);
  } catch {
    native.delete(form);
    HTMLFormElement.prototype.submit.call(form);
    sent = true;
  } finally {
    window.removeEventListener("submit", sending);
    if (pressed) pressed.disabled = wasDisabled;
  }
  // An invalid form fires no submit event, so the marker is still there.
  native.delete(form);
  return sent;
};

// A failure after the post may have reached the server: said in the form, in a live region, and
// not sent again.
const showError = (form) => {
  let box = form.querySelector(":scope > [data-tp-form-error]");
  if (!box) {
    box = document.createElement("p");
    box.className = "tp-form-error";
    box.setAttribute("data-tp-form-error", "");
    box.setAttribute("role", "alert");
    box.setAttribute("aria-live", "assertive");
    form.append(box);
  }
  box.textContent = getConfig("tp/router")?.failed || "Something went wrong sending this form. Reload the page to see whether it went through.";
};

store("tp/router", {
  actions: {
    navigate: withSyncEvent(function* (event) {
      const { ref } = getElement();
      if (!sameSite(event, ref)) return;
      event.preventDefault();
      const { actions } = yield import("@wordpress/interactivity-router");
      yield actions.navigate(ref.href);
    }),
    *prefetch() {
      const { ref } = getElement();
      if (!(ref instanceof HTMLAnchorElement) || ref.origin !== window.location.origin) return;
      const { actions } = yield import("@wordpress/interactivity-router");
      yield actions.prefetch(ref.href);
    },
    submit: withSyncEvent(function* (event) {
      const { ref: form } = getElement();
      const submitter = event.submitter ?? null;
      if (native.delete(form) || event.defaultPrevented) return;
      // A page core marks as not client-navigable would be loaded again by the router, and the
      // flash is read once: the browser posts it, as without JavaScript.
      if (getConfig("core/router")?.clientNavigationDisabled) return;
      const url = submitUrl(form, submitter);
      if (!url) return;
      event.preventDefault();
      // One submit at a time per form: another while one is in flight does nothing.
      if (form.hasAttribute(PENDING)) return;
      // The body the browser would send, with the pressed button, collected before anything is disabled.
      const body = new URLSearchParams();
      for (const [name, value] of new FormData(form, submitter)) body.append(name, typeof value === "string" ? value : value.name);
      // Pending: `aria-busy` on the form (style `form[aria-busy="true"]`) and its enabled submit
      // buttons (inside it, or outside with `form="id"`) disabled, each marked so only those are
      // enabled again. The focused element gets focus back if the swap drops it.
      const focused = document.activeElement;
      const buttons = [...document.querySelectorAll(SUBMITS)].filter((b) => b.form === form && !b.disabled);
      form.querySelector(":scope > [data-tp-form-error]")?.remove();
      form.setAttribute(PENDING, "");
      form.setAttribute("aria-busy", "true");
      for (const b of buttons) {
        b.setAttribute(PENDING, "");
        b.disabled = true;
      }
      const done = () => {
        form.removeAttribute(PENDING);
        form.removeAttribute("aria-busy");
        for (const b of buttons) {
          if (!b.hasAttribute(PENDING)) continue;
          b.removeAttribute(PENDING);
          b.disabled = false;
        }
        if (focused instanceof HTMLElement && focused.isConnected && (document.activeElement === document.body || document.activeElement === null)) focused.focus({ preventScroll: true });
      };
      // Where the visitor is now: a navigation while the post is in flight wins over its answer.
      const from = pagePath(window.location.href);
      const ticket = begin();
      let keepPending = false;
      try {
        let actions;
        try {
          ({ actions } = yield import("@wordpress/interactivity-router"));
        } catch {
          // Nothing was sent: the browser posts the form, which stays pending while the page loads,
          // unless the form's validation stopped the post.
          keepPending = nativeSubmit(form, submitter);
          return;
        }
        // The answer is still this page's to show: the visitor is where they submitted from, the
        // form is on the page, and no later submit's answer is on the page already.
        const current = () => pagePath(window.location.href) === from && form.isConnected && ticket >= forms.last;
        let html = null;
        let response = null;
        try {
          // Only TypedPress's form endpoints get here (submitUrl), and they answer with a 303 to a
          // page of this site (Forms::redirect), so following it never leaves the site.
          response = yield fetch(url.href, { method: "POST", body, credentials: "same-origin", redirect: "follow", headers: { Accept: "text/html" } });
          const type = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
          if (response.ok && type === "text/html" && new URL(response.url).origin === window.location.origin) html = yield response.text();
        } catch {
          // No answer, or one cut off: the post may have run. Not sent again.
          html = null;
        }
        if (html === null) {
          if (form.isConnected) showError(form);
          return;
        }
        if (!html.includes("data-wp-router-region")) {
          // It came back to a page the router can't swap into: that page loads in full, unless the
          // visitor has gone somewhere else meanwhile.
          if (response.redirected && current()) {
            keepPending = true;
            window.location.assign(withoutMarker(response.url));
          } else if (form.isConnected) {
            showError(form);
          }
          return;
        }
        // A `<Live>` swap in progress finishes first; then this answer renders only if it is still current.
        yield forms.live;
        if (!current()) return;
        forms.last = ticket;
        forms.renders++;
        const href = withoutMarker(response.url);
        // `force` puts this render in the router's page cache under the page's URL, so going back
        // to it shows what the visitor last saw, and nothing fetches the page again. Coming back to
        // the page the form is on replaces its history entry instead of adding one.
        yield actions.navigate(href, {
          html,
          force: true,
          replace: pagePath(href) === from,
          screenReaderAnnouncement: false,
        });
      } finally {
        if (!keepPending) done();
        end();
      }
    }),
  },
});
