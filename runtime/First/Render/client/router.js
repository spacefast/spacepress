// Region navigation for First's <Link> (docs/spec/rendering.md §4.3). A click on a same-site link
// fetches the next page and swaps the router region in place with @wordpress/interactivity-router;
// a modified click, another target or a download stays a normal navigation. Without JavaScript the
// links are ordinary links.
//
// The JavaScript submit for `<form action={name}>` (docs/decisions/2026-11-14-forms-without-javascript.md):
// the same form-encoded post, sent with `fetch`. `fetch` follows the action's 303 to the page with
// `?_flash=<id>`, so that one page request reads the read-once flash, and the router gets that HTML
// handed to it (`html`, as client/live-region.js does): it diffs the region, so client components,
// focus and scroll stay, and nothing reloads. Without JavaScript the form posts as before.
import { store, withSyncEvent, getElement, getConfig } from "@wordpress/interactivity";

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

// The form's post URL when this submit is one the script sends: a post, in this tab, to this site,
// from a form inside the router region. Anything else stays the browser's.
const submitUrl = (form, submitter) => {
  if (!(form instanceof HTMLFormElement) || !form.closest("[data-wp-router-region]")) return null;
  const method = (attr(submitter, "formmethod") ?? attr(form, "method") ?? "get").toLowerCase();
  const target = attr(submitter, "formtarget") ?? attr(form, "target") ?? "";
  if (method !== "post" || (target !== "" && target !== "_self")) return null;
  let url;
  try {
    url = new URL(attr(submitter, "formaction") ?? attr(form, "action") ?? "", document.baseURI);
  } catch {
    return null;
  }
  return url.origin === window.location.origin ? url : null;
};

// The page URL without the flash marker: the history entry and the router's page cache use it, so
// the marker never reaches a URL someone copies, bookmarks or shares.
const withoutMarker = (href) => {
  const url = new URL(href);
  url.searchParams.delete("_flash");
  return url.href;
};

// Network failure: the browser's own submit, with the button that was pressed. The submit event it
// fires is let through once.
const native = new WeakSet();
const nativeSubmit = (form, submitter) => {
  native.add(form);
  try {
    form.requestSubmit(submitter?.isConnected && submitter.form === form ? submitter : null);
  } catch {
    native.delete(form);
    HTMLFormElement.prototype.submit.call(form);
  }
};

const pending = new WeakSet();

store("first/router", {
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
      // One submit at a time: a second press while the first is in flight does nothing.
      if (pending.has(form)) return;
      // The body the browser would send, collected before the buttons are disabled.
      const body = new URLSearchParams();
      for (const [name, value] of new FormData(form, submitter)) body.append(name, typeof value === "string" ? value : value.name);
      // Pending: `aria-busy` on the form (style it with `form[aria-busy="true"]`) and its submit
      // buttons disabled until the page is swapped. The focused element gets focus back after.
      const focused = document.activeElement;
      const buttons = [...form.querySelectorAll('button:not([type]), button[type="submit"], input[type="submit"], input[type="image"]')].filter((b) => !b.disabled);
      pending.add(form);
      form.setAttribute("aria-busy", "true");
      buttons.forEach((b) => { b.disabled = true; });
      const done = () => {
        pending.delete(form);
        form.removeAttribute("aria-busy");
        buttons.forEach((b) => { b.disabled = false; });
        if (focused instanceof HTMLElement && focused.isConnected && (document.activeElement === document.body || document.activeElement === null)) focused.focus({ preventScroll: true });
      };
      try {
        // The router first: if it can't load, the browser's own submit runs before anything is sent.
        let actions, response;
        try {
          ({ actions } = yield import("@wordpress/interactivity-router"));
          response = yield fetch(url.href, { method: "POST", body, credentials: "same-origin", redirect: "follow", headers: { Accept: "text/html" } });
        } catch {
          done();
          nativeSubmit(form, submitter);
          return;
        }
        const type = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
        const html = type === "text/html" && new URL(response.url).origin === window.location.origin ? yield response.text() : null;
        if (html === null || !html.includes("data-wp-router-region")) {
          if (!response.redirected) {
            // The action answered without coming back to a page (the site is unavailable, say): it
            // didn't run, and the browser's own submit shows what it shows without JavaScript.
            done();
            nativeSubmit(form, submitter);
          } else {
            // It came back to a page the router can't swap into: load that page.
            window.location.assign(withoutMarker(response.url));
          }
          return;
        }
        const href = withoutMarker(response.url);
        const here = new URL(window.location.href);
        const there = new URL(href);
        // `force` puts this render in the router's page cache under the page's URL, so going back
        // to it shows what the visitor last saw, and nothing fetches the page again. Coming back to
        // the page the form is on replaces its history entry instead of adding one.
        yield actions.navigate(href, {
          html,
          force: true,
          replace: here.pathname + here.search === there.pathname + there.search,
          screenReaderAnnouncement: false,
        });
      } finally {
        if (pending.has(form)) done();
      }
    }),
  },
});
