"use client";

import { useEvent, useMount } from "spacepress/react";

export function DocsEnhancements({
  copyCode = true,
  copyLabel = "Copy",
  copiedLabel = "Copied",
  copyFailedLabel = "Copy failed",
}: {
  copyCode?: boolean;
  copyLabel?: string;
  copiedLabel?: string;
  copyFailedLabel?: string;
}) {
  useMount(() => {
    let pageListeners = new AbortController();
    let scrollSpy: IntersectionObserver | null = null;
    let nextTabGroup = 0;
    const copyTimers = new WeakMap<HTMLElement, number>();
    const flash = (button: HTMLElement, target: HTMLElement, original: string, text: string) => {
      clearTimeout(copyTimers.get(button));
      const label = button.getAttribute("aria-label");
      target.textContent = text;
      if (label !== null) button.setAttribute("aria-label", text);
      copyTimers.set(button, window.setTimeout(() => {
        target.textContent = original;
        if (label !== null) button.setAttribute("aria-label", original);
        copyTimers.delete(button);
      }, 1400));
    };
    const enhancePage = () => {
      pageListeners.abort();
      pageListeners = new AbortController();
      scrollSpy?.disconnect();
      const signal = pageListeners.signal;
      if (copyCode) {
        for (const block of Array.from(document.querySelectorAll<HTMLElement>("[data-sd-article] figure.wp-block-code, [data-sd-article] pre:not(figure pre)"))) {
          block.querySelector(".sd-copy-code")?.remove();
          const button = document.createElement("button");
          button.type = "button";
          button.className = "sd-copy-code";
          button.textContent = copyLabel;
          const code = block.querySelector("code") ?? block;
          const text = (code.textContent ?? "").replace(/\n$/, "");
          button.addEventListener("click", async () => {
            try {
              await navigator.clipboard.writeText(text);
              flash(button, button, copyLabel, copiedLabel);
            } catch {
              flash(button, button, copyLabel, copyFailedLabel);
            }
          }, { signal });
          block.append(button);
        }
      }
      for (const button of Array.from(document.querySelectorAll<HTMLElement>("[data-sd-copy-markdown]"))) {
        const label = button.querySelector<HTMLElement>("span:not([aria-hidden])") ?? button;
        const original = label.textContent ?? copyLabel;
        label.setAttribute("aria-live", "polite");
        button.addEventListener("click", async () => {
          const url = button.getAttribute("data-sd-copy-markdown");
          if (url === null) return;
          try {
            const res = await fetch(url, { headers: { accept: "text/markdown" }, signal });
            if (!res.ok || !res.headers.get("content-type")?.startsWith("text/markdown")) throw new Error("Markdown unavailable");
            await navigator.clipboard.writeText(await res.text());
            flash(button, label, original, copiedLabel);
          } catch {
            flash(button, label, original, copyFailedLabel);
          }
        }, { signal });
      }
      for (const heading of Array.from(document.querySelectorAll<HTMLElement>("[data-sd-article] h2[id], [data-sd-article] h3[id]"))) {
        heading.querySelector(".sd-anchor")?.remove();
        const anchor = document.createElement("a");
        anchor.className = "sd-anchor";
        anchor.href = `#${heading.id}`;
        anchor.setAttribute("aria-label", `Copy link to ${heading.textContent?.trim() ?? "this section"}`);
        anchor.textContent = "#";
        anchor.addEventListener("click", async (event) => {
          if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
          try {
            await navigator.clipboard.writeText(anchor.href);
            anchor.classList.add("is-copied");
            setTimeout(() => anchor.classList.remove("is-copied"), 1400);
          } catch {
            // The link still navigates to the heading when clipboard access is blocked.
          }
        }, { signal });
        heading.append(anchor);
      }
      for (const group of Array.from(document.querySelectorAll<HTMLElement>("[data-sd-tabs]"))) {
        group.querySelector(":scope > .sd-tab-list")?.remove();
        const panels = Array.from(group.querySelectorAll<HTMLElement>(":scope > .sd-tab-panel"));
        if (panels.length === 0) continue;
        const param = group.getAttribute("data-sd-param") ?? "";
        const wanted = param !== "" ? new URL(window.location.href).searchParams.get(param) : null;
        const selected = Math.max(0, panels.findIndex((panel) => panel.getAttribute("data-sd-tab-title") === wanted));
        const groupId = `sd-tabs-${++nextTabGroup}`;
        const list = document.createElement("div");
        list.className = "sd-tab-list";
        list.setAttribute("role", "tablist");
        list.setAttribute("aria-label", param || "Documentation tabs");
        const tabs = panels.map((panel, index) => {
          const tab = document.createElement("button");
          tab.type = "button";
          tab.className = "sd-tab";
          tab.id = `${groupId}-tab-${index}`;
          panel.id = panel.id || `${groupId}-panel-${index}`;
          tab.setAttribute("role", "tab");
          tab.setAttribute("aria-controls", panel.id);
          tab.textContent = panel.getAttribute("data-sd-tab-title") ?? `Tab ${index + 1}`;
          panel.setAttribute("role", "tabpanel");
          panel.setAttribute("aria-labelledby", tab.id);
          panel.tabIndex = 0;
          list.append(tab);
          return tab;
        });
        const select = (index: number, updateUrl: boolean) => {
          for (let i = 0; i < panels.length; i++) {
            const active = i === index;
            panels[i].hidden = !active;
            tabs[i].setAttribute("aria-selected", active ? "true" : "false");
            tabs[i].tabIndex = active ? 0 : -1;
          }
          if (updateUrl && param !== "") {
            const url = new URL(window.location.href);
            url.searchParams.set(param, panels[index].getAttribute("data-sd-tab-title") ?? "");
            window.history.replaceState(window.history.state, "", url.toString());
          }
        };
        tabs.forEach((tab, index) => {
          tab.addEventListener("click", () => select(index, true), { signal });
          tab.addEventListener("keydown", (event) => {
            let next = index;
            if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
            else if (event.key === "ArrowLeft") next = (index + tabs.length - 1) % tabs.length;
            else if (event.key === "Home") next = 0;
            else if (event.key === "End") next = tabs.length - 1;
            else return;
            event.preventDefault();
            select(next, true);
            tabs[next]?.focus();
          }, { signal });
        });
        select(selected, false);
        group.prepend(list);
        group.setAttribute("data-ready", "true");
      }
      const links = Array.from(document.querySelectorAll<HTMLAnchorElement>("[data-sd-toc] a"));
      if (links.length === 0) return;
      scrollSpy = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            for (const link of links) link.classList.toggle("is-active", link.getAttribute("href") === `#${entry.target.id}`);
          }
        },
        { rootMargin: "0px 0px -75% 0px" },
      );
      for (const link of links) {
        const target = document.getElementById((link.getAttribute("href") ?? "").slice(1));
        if (target) scrollSpy.observe(target);
      }
    };
    enhancePage();
    let pathname = window.location.pathname;
    let frame = 0;
    const navigation = new MutationObserver(() => {
      if (frame !== 0) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (pathname === window.location.pathname) return;
        pathname = window.location.pathname;
        enhancePage();
      });
    });
    const region = document.querySelector("[data-wp-router-region='sp/main']");
    if (region) navigation.observe(region, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(frame);
      navigation.disconnect();
      pageListeners.abort();
      scrollSpy?.disconnect();
    };
  });
  useEvent(
    "click",
    (event) => {
      if (!(event.target instanceof Element) || !event.target.closest("[data-sd-theme-toggle]")) return;
      const root = document.documentElement;
      const dark = root.getAttribute("data-theme") === "dark" || (root.getAttribute("data-theme") === null && window.matchMedia("(prefers-color-scheme: dark)").matches);
      const next = dark ? "light" : "dark";
      root.setAttribute("data-theme", next);
      try {
        localStorage.setItem("sd-theme", next);
      } catch {
        // Storage can be blocked; the choice then lasts for this page.
      }
    },
    "document",
  );
  return <span className="sd-enhance" hidden />;
}
