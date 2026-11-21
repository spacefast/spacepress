// Lightweight progressive enhancements: copy-to-clipboard, mobile menu, tabs, and sticky TOC scroll spy.
// Uses event delegation + MutationObserver so everything keeps working after SPA navigations.

document.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;

  // Copy buttons for CLI commands and snippets
  const copyBtn = target.closest("[data-copy]");
  if (copyBtn) {
    const text = copyBtn.getAttribute("data-copy");
    if (!text) return;
    navigator.clipboard?.writeText(text).then(() => {
      const prev = copyBtn.textContent;
      copyBtn.textContent = "Copied";
      copyBtn.classList.add("is-copied");
      setTimeout(() => { copyBtn.textContent = prev; copyBtn.classList.remove("is-copied"); }, 1400);
    }, () => {});
    return;
  }

  // Mobile navigation menu toggle
  const navToggle = target.closest("[data-nav-toggle]");
  if (navToggle) {
    const navDrawer = document.querySelector("[data-nav-drawer]");
    if (navDrawer) {
      const open = navDrawer.classList.toggle("is-open");
      navToggle.setAttribute("aria-expanded", String(open));
    }
    return;
  }

  // Close mobile drawer when clicking a navigation link
  if (target.closest("[data-nav-drawer] a")) {
    const navDrawer = document.querySelector("[data-nav-drawer]");
    const toggle = document.querySelector("[data-nav-toggle]");
    navDrawer?.classList.remove("is-open");
    toggle?.setAttribute("aria-expanded", "false");
    return;
  }

  // Generic tab panels ([data-tab-group])
  const tabBtn = target.closest("[data-tab-btn]");
  if (tabBtn) {
    const group = tabBtn.closest("[data-tab-group]");
    if (!group) return;
    const id = tabBtn.getAttribute("data-tab-btn");
    for (const b of group.querySelectorAll("[data-tab-btn]")) {
      const on = b.getAttribute("data-tab-btn") === id;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-selected", String(on));
    }
    for (const p of group.querySelectorAll("[data-tab-panel]")) {
      p.hidden = p.getAttribute("data-tab-panel") !== id;
    }
  }
});

// Sticky Table of Contents scroll spy on /handbook and /docs (rebinds after SPA navigation)
let tocObserver = null;
let lastTocEl = null;

function bindToc() {
  const toc = document.querySelector("[data-toc]");
  if (toc === lastTocEl) return;
  tocObserver?.disconnect();
  tocObserver = null;
  lastTocEl = toc;
  if (!toc || !("IntersectionObserver" in window)) return;

  const tocLinks = [...toc.querySelectorAll("a[href^='#']")];
  const sections = tocLinks
    .map((a) => ({ link: a, el: document.getElementById(a.getAttribute("href").slice(1)) }))
    .filter((s) => s.el);
  if (sections.length === 0) return;

  let current = sections[0]?.link;
  const setActive = (link) => {
    if (!link || link === current) return;
    current?.classList.remove("is-active");
    current = link;
    current.classList.add("is-active");
  };
  current?.classList.add("is-active");

  tocObserver = new IntersectionObserver((entries) => {
    const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
    if (visible.length > 0) {
      const match = sections.find((s) => s.el === visible[0].target);
      if (match) setActive(match.link);
    }
  }, { rootMargin: "-84px 0px -68% 0px", threshold: 0 });

  for (const s of sections) tocObserver.observe(s.el);
}

function syncActiveNav() {
  const path = location.pathname.replace(/\/+$/, "") || "/";
  for (const link of document.querySelectorAll(".sp-nav a, .sp-mobile-drawer a")) {
    const href = link.getAttribute("href");
    if (!href) continue;
    let url;
    try {
      url = new URL(href, location.origin);
    } catch {
      continue;
    }
    if (url.origin !== location.origin) continue;
    const targetPath = url.pathname.replace(/\/+$/, "") || "/";
    const active = targetPath === "/" ? path === "/" : path === targetPath || path.startsWith(`${targetPath}/`);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
}

syncActiveNav();
bindToc();
window.addEventListener("popstate", syncActiveNav);
if (typeof MutationObserver !== "undefined" && document.body) {
  let tocTimer = null;
  const mo = new MutationObserver(() => {
    if (tocTimer) return;
    tocTimer = setTimeout(() => {
      tocTimer = null;
      syncActiveNav();
      bindToc();
    }, 60);
  });
  mo.observe(document.body, { childList: true, subtree: true });
}
