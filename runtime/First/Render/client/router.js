// Region navigation for First's <Link> (docs/spec/rendering.md §4.3). A click on a same-site link
// fetches the next page and swaps the router region in place with @wordpress/interactivity-router;
// a modified click, another target or a download stays a normal navigation. Without JavaScript the
// links are ordinary links.
import { store, withSyncEvent, getElement } from "@wordpress/interactivity";

const sameSite = (event, ref) =>
  ref instanceof HTMLAnchorElement &&
  event.button === 0 &&
  !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey &&
  (ref.target === "" || ref.target === "_self") &&
  !ref.hasAttribute("download") &&
  ref.origin === window.location.origin;

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
  },
});
