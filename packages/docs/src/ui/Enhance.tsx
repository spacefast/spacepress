"use client";
// What the page gains with JavaScript: copy buttons on code blocks, "Copy page" through the
// page's Markdown twin, anchor links on headings, the table of contents following the reader,
// tab strips for <Tabs>, and the light/dark switch. Render it once, in the layout.
import { useEvent, useMount } from "spacepress/client";

export function DocsEnhancements({ copyLabel = "Copy", copiedLabel = "Copied" }: { copyLabel?: string; copiedLabel?: string }) {
  useMount(() => {
    const flash = (button: HTMLElement, text: string) => {
      const label = button.querySelector("span");
      const target = label ?? button;
      const before = target.textContent ?? "";
      target.textContent = text;
      setTimeout(() => {
        target.textContent = before;
      }, 1400);
    };
    for (const block of Array.from(document.querySelectorAll<HTMLElement>("[data-sd-article] figure.wp-block-code, [data-sd-article] pre:not(figure pre)"))) {
      if (block.querySelector(".sd-copy-code")) continue;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "sd-copy-code";
      button.setAttribute("aria-label", copyLabel);
      button.textContent = copyLabel;
      button.addEventListener("click", async () => {
        const code = block.querySelector("code") ?? block;
        await navigator.clipboard.writeText((code.textContent ?? "").replace(/\n$/, ""));
        flash(button, copiedLabel);
      });
      block.append(button);
    }
    for (const button of Array.from(document.querySelectorAll<HTMLElement>("[data-sd-copy-markdown]"))) {
      button.addEventListener("click", async () => {
        const url = button.getAttribute("data-sd-copy-markdown") ?? "";
        const res = await fetch(url, { headers: { accept: "text/markdown" } });
        await navigator.clipboard.writeText(await res.text());
        flash(button, copiedLabel);
      });
    }
    for (const heading of Array.from(document.querySelectorAll<HTMLElement>("[data-sd-article] h2[id], [data-sd-article] h3[id]"))) {
      if (heading.querySelector(".sd-anchor")) continue;
      const anchor = document.createElement("a");
      anchor.className = "sd-anchor";
      anchor.href = `#${heading.id}`;
      anchor.setAttribute("aria-label", "Link to this section");
      anchor.textContent = "#";
      heading.append(anchor);
    }
    for (const group of Array.from(document.querySelectorAll<HTMLElement>("[data-sd-tabs]"))) {
      if (group.querySelector(".sd-tab-list")) continue;
      const panels = Array.from(group.querySelectorAll<HTMLElement>(":scope > .sd-tab-panel"));
      if (panels.length === 0) continue;
      const param = group.getAttribute("data-sd-param") ?? "";
      const wanted = param !== "" ? new URL(window.location.href).searchParams.get(param) : null;
      let selected = 0;
      for (let i = 0; i < panels.length; i++) {
        if (wanted !== null && panels[i].getAttribute("data-sd-tab-title") === wanted) selected = i;
      }
      const list = document.createElement("div");
      list.className = "sd-tab-list";
      list.setAttribute("role", "tablist");
      const select = (index: number) => {
        for (let i = 0; i < panels.length; i++) {
          panels[i].hidden = i !== index;
          const tab = list.children[i] as HTMLElement;
          tab.setAttribute("aria-selected", i === index ? "true" : "false");
          tab.tabIndex = i === index ? 0 : -1;
        }
        if (param !== "") {
          const url = new URL(window.location.href);
          url.searchParams.set(param, panels[index].getAttribute("data-sd-tab-title") ?? "");
          window.history.replaceState(null, "", url.toString());
        }
      };
      for (let i = 0; i < panels.length; i++) {
        const tab = document.createElement("button");
        tab.type = "button";
        tab.className = "sd-tab";
        tab.setAttribute("role", "tab");
        tab.textContent = panels[i].getAttribute("data-sd-tab-title") ?? `Tab ${i + 1}`;
        tab.addEventListener("click", () => select(i));
        list.append(tab);
      }
      group.prepend(list);
      group.setAttribute("data-ready", "true");
      for (let i = 0; i < panels.length; i++) panels[i].hidden = i !== selected;
      for (let i = 0; i < panels.length; i++) (list.children[i] as HTMLElement).setAttribute("aria-selected", i === selected ? "true" : "false");
    }
    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>("[data-sd-toc] a"));
    if (links.length === 0) return;
    const observer = new IntersectionObserver(
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
      if (target) observer.observe(target);
    }
    return () => observer.disconnect();
  });
  useEvent(
    "click",
    (event) => {
      const target = event.target as HTMLElement | null;
      const toggle = target ? target.closest<HTMLElement>("[data-sd-theme-toggle]") : null;
      if (!toggle) return;
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
