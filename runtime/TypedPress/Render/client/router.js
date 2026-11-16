// Region navigation for TypedPress's <Link> (docs/spec/rendering.md §4.3). A click on a same-site link
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

// The block template a page renders in (`<body data-tp-template>`) and the one a link's target
// renders in (`data-tp-template` on the link): the router region swaps only between pages of one
// template, so a link to a page with other chrome (the theme's header, or none) loads the page.
// A link with no template (an address no app page serves) loads the page: what answers there has
// no router region to swap.
const sameTemplate = (ref) => {
  const target = ref.dataset.tpTemplate;
  return target !== undefined && target === document.body.dataset.tpTemplate;
};

store("tp/router", {
  actions: {
    navigate: withSyncEvent(function* (event) {
      const { ref } = getElement();
      if (!sameSite(event, ref) || !sameTemplate(ref)) return;
      event.preventDefault();
      const { actions } = yield import("@wordpress/interactivity-router");
      yield actions.navigate(ref.href);
    }),
    *prefetch() {
      const { ref } = getElement();
      if (!(ref instanceof HTMLAnchorElement) || ref.origin !== window.location.origin || !sameTemplate(ref)) return;
      const { actions } = yield import("@wordpress/interactivity-router");
      yield actions.prefetch(ref.href);
    },
  },
});
