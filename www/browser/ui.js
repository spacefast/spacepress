// Progressive enhancements: copy-to-clipboard, Copy as Markdown + Bloom page menu,
// Cmd+K quick search modal, heading anchor copy links, mobile drawers, active nav, and sticky TOC.
// Uses event delegation + MutationObserver so everything survives SPA router navigations.

const mdCache = new Map();

function closeAllPageMenus(restoreFocus = false) {
  let closedToggle = null;
  for (const wrap of document.querySelectorAll("[data-page-actions]")) {
    const menu = wrap.querySelector(".sp-pa-menu");
    const toggle = wrap.querySelector("[data-page-menu-toggle]");
    if (menu && !menu.hidden) {
      menu.hidden = true;
      toggle?.setAttribute("aria-expanded", "false");
      closedToggle = toggle;
    }
  }
  if (restoreFocus && closedToggle instanceof HTMLElement) {
    closedToggle.focus();
  }
  return Boolean(closedToggle);
}

function closeNavDrawer() {
  const navDrawer = document.querySelector("[data-nav-drawer]");
  const toggle = document.querySelector("[data-nav-toggle]");
  if (!navDrawer?.classList.contains("is-open")) return false;
  navDrawer.classList.remove("is-open");
  toggle?.setAttribute("aria-expanded", "false");
  return true;
}

function flashCopied(btn, copiedLabel = "Copied", ms = 1400) {
  btn.dataset.origLabel ??= btn.textContent;
  clearTimeout(btn._copyTimer);
  btn.textContent = copiedLabel;
  btn.classList.add("is-copied");
  btn._copyTimer = setTimeout(() => {
    btn.textContent = btn.dataset.origLabel;
    btn.classList.remove("is-copied");
  }, ms);
}

async function copyMarkdownFrom(btn) {
  const mdPath = btn.getAttribute("data-copy-md");
  if (!mdPath) return;
  const wrap = btn.closest("[data-page-actions]");
  const mainBtn = wrap?.querySelector(".sp-pa-main") ?? btn;
  try {
    let text = mdCache.get(mdPath);
    if (!text) {
      const res = await fetch(mdPath);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      text = await res.text();
      mdCache.set(mdPath, text);
    }
    await navigator.clipboard.writeText(text);
    closeAllPageMenus();
    flashCopied(mainBtn, "Copied Markdown", 1600);
  } catch {
    flashCopied(mainBtn, "Copy failed", 1600);
  }
}

// --- Cmd+K / Ctrl+K / `/` Quick Search Modal ---
let searchIndexPromise = null;
let searchModal = null;
let searchItems = [];
let filteredItems = [];
let activeIdx = 0;
let lastFocusedEl = null;

function loadSearchIndex() {
  searchIndexPromise ??= fetch("/search-index.json")
    .then((r) => (r.ok ? r.json() : []))
    .catch(() => []);
  return searchIndexPromise;
}

function ensureSearchModal() {
  if (searchModal?.isConnected) return searchModal;
  const backdrop = document.createElement("div");
  backdrop.className = "sp-search-backdrop";
  backdrop.hidden = true;
  backdrop.innerHTML = `
    <div class="sp-search-modal" role="dialog" aria-modal="true" aria-label="Search SpacePress">
      <div class="sp-search-input-row">
        <input type="search" class="sp-search-input" placeholder="Search Reference, Handbook, Examples, Blog…" autocomplete="off" spellcheck="false" />
        <button type="button" class="sp-search-esc" aria-label="Close search">Esc</button>
      </div>
      <ul class="sp-search-results" role="listbox"></ul>
      <div class="sp-search-foot">
        <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
        <span><kbd>↵</kbd> open</span>
        <span><kbd>Esc</kbd> close</span>
      </div>
    </div>
  `;
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) closeSearch();
  });
  backdrop.querySelector(".sp-search-esc").addEventListener("click", () => closeSearch());
  const input = backdrop.querySelector(".sp-search-input");
  const list = backdrop.querySelector(".sp-search-results");
  input.addEventListener("input", () => renderSearchResults(input.value));
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (filteredItems.length) {
        activeIdx = (activeIdx + 1) % filteredItems.length;
        highlightSearchRow();
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (filteredItems.length) {
        activeIdx = (activeIdx - 1 + filteredItems.length) % filteredItems.length;
        highlightSearchRow();
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      const chosen = filteredItems[activeIdx];
      if (chosen) navigateTo(chosen.href);
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeSearch();
    }
  });
  list.addEventListener("click", (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    const link = e.target instanceof Element ? e.target.closest("a[href]") : null;
    if (link) {
      e.preventDefault();
      navigateTo(link.getAttribute("href"));
    }
  });
  document.body.append(backdrop);
  searchModal = backdrop;
  return backdrop;
}

function navigateTo(href) {
  closeSearch(false);
  window.location.assign(href);
}

function renderSearchResults(rawQuery) {
  const modal = ensureSearchModal();
  const list = modal.querySelector(".sp-search-results");
  const q = rawQuery.trim().toLowerCase();
  const terms = q ? q.split(/\s+/) : [];
  filteredItems = (terms.length === 0
    ? searchItems.slice(0, 10)
    : searchItems
        .map((item) => {
          const hayTitle = item.title.toLowerCase();
          const hayDesc = (item.description || "").toLowerCase();
          const hayGroup = (item.group || "").toLowerCase();
          const hayHref = (item.href || "").toLowerCase();
          const all = `${hayTitle} ${hayDesc} ${hayGroup} ${hayHref}`;
          if (!terms.every((t) => all.includes(t))) return null;
          let score = 0;
          for (const t of terms) {
            if (hayTitle.startsWith(t)) score += 10;
            else if (hayTitle.includes(t)) score += 6;
            else if (hayGroup.includes(t)) score += 3;
            else score += 1;
          }
          return { item, score };
        })
        .filter(Boolean)
        .sort((a, b) => b.score - a.score)
        .slice(0, 12)
        .map((r) => r.item));

  activeIdx = 0;
  list.replaceChildren();
  if (filteredItems.length === 0) {
    const empty = document.createElement("li");
    empty.className = "sp-search-empty";
    empty.textContent = `No matches for “${rawQuery}”.`;
    list.append(empty);
    return;
  }
  for (let i = 0; i < filteredItems.length; i++) {
    const item = filteredItems[i];
    const li = document.createElement("li");
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", String(i === 0));
    li.className = i === 0 ? "is-active" : "";
    const a = document.createElement("a");
    a.href = item.href;
    const top = document.createElement("div");
    top.className = "sp-search-row-top";
    const title = document.createElement("strong");
    title.textContent = item.title;
    const group = document.createElement("span");
    group.className = "sp-search-group";
    group.textContent = item.group;
    top.append(title, group);
    a.append(top);
    if (item.description) {
      const desc = document.createElement("p");
      desc.textContent = item.description;
      a.append(desc);
    }
    li.onmouseenter = () => {
      activeIdx = i;
      highlightSearchRow(false);
    };
    li.append(a);
    list.append(li);
  }
}

function highlightSearchRow(scroll = true) {
  if (!searchModal) return;
  const rows = [...searchModal.querySelectorAll(".sp-search-results > li[role='option']")];
  rows.forEach((li, i) => {
    const on = i === activeIdx;
    li.classList.toggle("is-active", on);
    li.setAttribute("aria-selected", String(on));
  });
  if (scroll) rows[activeIdx]?.scrollIntoView({ block: "nearest" });
}

async function openSearch() {
  lastFocusedEl = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  closeAllPageMenus();
  closeNavDrawer();
  const modal = ensureSearchModal();
  modal.hidden = false;
  document.body.classList.add("sp-no-scroll");
  const input = modal.querySelector(".sp-search-input");
  input.value = "";
  requestAnimationFrame(() => input.focus());
  if (searchItems.length === 0) {
    searchItems = await loadSearchIndex();
  }
  renderSearchResults(input.value);
}

function closeSearch(restoreFocus = true) {
  if (!searchModal || searchModal.hidden) return false;
  searchModal.hidden = true;
  if (!document.querySelector("sp-play.is-fullscreen")) {
    document.body.classList.remove("sp-no-scroll");
  }
  if (restoreFocus && lastFocusedEl?.isConnected) {
    lastFocusedEl.focus();
  }
  lastFocusedEl = null;
  return true;
}

function isTypingTarget(el) {
  if (!(el instanceof Element)) return false;
  if (el.closest("input, textarea, select, [contenteditable='true'], sp-sandbox, sp-play")) return true;
  return false;
}

document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    if (searchModal && !searchModal.hidden) closeSearch();
    else openSearch();
    return;
  }
  if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey && !isTypingTarget(document.activeElement)) {
    e.preventDefault();
    openSearch();
    return;
  }
  if (e.key === "Escape") {
    if (closeSearch()) {
      e.preventDefault();
      return;
    }
    if (closeAllPageMenus(true)) {
      e.preventDefault();
      return;
    }
    if (closeNavDrawer()) {
      e.preventDefault();
    }
  }
});

document.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;

  if (target.closest("[data-search-open]")) {
    openSearch();
    return;
  }

  const copyMdBtn = target.closest("[data-copy-md]");
  if (copyMdBtn) {
    copyMarkdownFrom(copyMdBtn);
    return;
  }

  const menuToggle = target.closest("[data-page-menu-toggle]");
  if (menuToggle) {
    const wrap = menuToggle.closest("[data-page-actions]");
    const menu = wrap?.querySelector(".sp-pa-menu");
    if (menu) {
      const opening = menu.hidden;
      closeAllPageMenus();
      menu.hidden = !opening;
      menuToggle.setAttribute("aria-expanded", String(opening));
    }
    return;
  }

  if (!target.closest("[data-page-actions]")) {
    closeAllPageMenus();
  }

  if (!target.closest("[data-nav-drawer]") && !target.closest("[data-nav-toggle]")) {
    closeNavDrawer();
  }

  const anchorBtn = target.closest(".sp-heading-anchor");
  if (anchorBtn) {
    event.preventDefault();
    const hash = anchorBtn.getAttribute("href");
    if (hash) {
      history.replaceState(null, "", hash);
      const fullUrl = new URL(hash, location.href).href;
      navigator.clipboard?.writeText(fullUrl).then(() => {
        clearTimeout(anchorBtn._copyTimer);
        anchorBtn.classList.add("is-copied");
        anchorBtn._copyTimer = setTimeout(() => {
          anchorBtn.classList.remove("is-copied");
        }, 1200);
      }, () => {});
    }
    return;
  }

  // Copy buttons for CLI commands and agent prompts
  const copyBtn = target.closest("[data-copy]");
  if (copyBtn) {
    const text = copyBtn.getAttribute("data-copy");
    if (!text) return;
    navigator.clipboard?.writeText(text).then(() => {
      flashCopied(copyBtn, "Copied", 1400);
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
    closeNavDrawer();
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

// Sticky Table of Contents scroll spy on /handbook (rebinds after SPA navigation)
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

function attachHeadingAnchors() {
  for (const heading of document.querySelectorAll(".sp-guide-section[id] > h2, .sp-guide-article h3[id]")) {
    if (heading.querySelector(".sp-heading-anchor")) continue;
    const id = heading.id || heading.closest("section[id]")?.id;
    if (!id) continue;
    const a = document.createElement("a");
    a.className = "sp-heading-anchor";
    a.href = `#${id}`;
    a.textContent = "#";
    a.setAttribute("aria-label", `Copy link to ${heading.textContent.trim()}`);
    heading.append(a);
  }
}

function syncSearchShortcutLabel() {
  const isApple = /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || "");
  if (isApple) return;
  for (const kbd of document.querySelectorAll("[data-search-open] kbd")) {
    kbd.textContent = "Ctrl K";
  }
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

const GH_STARS_TTL_MS = 30 * 60 * 1000;

function formatStarCount(n) {
  if (n >= 1000) {
    const k = n / 1000;
    return `${k >= 10 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, "")}k`;
  }
  return String(n);
}

function hydrateGitHubStars() {
  for (const link of document.querySelectorAll("[data-gh-stars]")) {
    if (link.dataset.ghStarsBound) continue;
    link.dataset.ghStarsBound = "1";
    const repo = link.getAttribute("data-gh-stars");
    const badge = link.querySelector(".sp-gh-stars");
    if (!repo || !badge) continue;

    const show = (count) => {
      if (typeof count !== "number" || count <= 0) return;
      badge.textContent = `★ ${formatStarCount(count)}`;
      badge.setAttribute("aria-label", `${count} GitHub stars`);
      badge.hidden = false;
    };

    const cacheKey = `sp:gh-stars:${repo}`;
    try {
      const cached = JSON.parse(sessionStorage.getItem(cacheKey) || "null");
      if (cached && typeof cached.ts === "number" && Date.now() - cached.ts < GH_STARS_TTL_MS) {
        show(cached.stars);
        continue;
      }
    } catch {
      // Ignore storage access errors in private browsing.
    }

    fetch("/gh-stars.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((meta) => {
        if (!meta) return;
        if (typeof meta.stars === "number" && meta.stars > 0) {
          show(meta.stars);
        }
        if (!meta.public) {
          try {
            sessionStorage.setItem(cacheKey, JSON.stringify({ stars: meta.stars ?? 0, ts: Date.now() }));
          } catch {}
          return;
        }
        return fetch(`https://api.github.com/repos/${repo}`, { headers: { Accept: "application/vnd.github+json" } })
          .then((r) => (r.ok ? r.json() : null))
          .then((data) => {
            const stars = data && typeof data.stargazers_count === "number" ? data.stargazers_count : (meta.stars ?? 0);
            try {
              sessionStorage.setItem(cacheKey, JSON.stringify({ stars, ts: Date.now() }));
            } catch {}
            show(stars);
          });
      })
      .catch(() => {});
  }
}

function syncUi() {
  syncActiveNav();
  syncSearchShortcutLabel();
  hydrateGitHubStars();
  bindToc();
  attachHeadingAnchors();
}

syncUi();
window.addEventListener("popstate", syncUi);
if (typeof MutationObserver !== "undefined" && document.body) {
  let uiTimer = null;
  const mo = new MutationObserver(() => {
    if (uiTimer) return;
    uiTimer = setTimeout(() => {
      uiTimer = null;
      syncUi();
    }, 60);
  });
  mo.observe(document.body, { childList: true, subtree: true });
}
