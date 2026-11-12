import { createClient } from "./client/index.js";

const first = createClient({ url: "/__first/api/v1" });
const element = (id) => document.getElementById(id);
const node = (tag, className = "", text) => {
  const result = document.createElement(tag);
  result.className = className;
  if (text !== undefined) result.textContent = text;
  return result;
};

function safeUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value, window.location.href);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function editorLink(collection, id, label) {
  const link = node("a", "", label);
  link.href = `/first-admin/collections/${collection}/${encodeURIComponent(id)}`;
  link.target = "_blank";
  link.setAttribute("aria-label", `${label} (opens in a new tab)`);
  link.rel = "noopener noreferrer";
  return link;
}

// Rebuild reading elements only: no authored attributes, scripts or embeds survive.
function storyBody(html) {
  const parsed = new DOMParser().parseFromString(html ?? "", "text/html");
  const allowed = new Set([
    "P",
    "BR",
    "HR",
    "STRONG",
    "EM",
    "B",
    "I",
    "S",
    "DEL",
    "UL",
    "OL",
    "LI",
    "BLOCKQUOTE",
    "PRE",
    "CODE",
    "FIGURE",
    "FIGCAPTION",
    "A",
    "IMG",
  ]);
  const blocked = new Set([
    "SCRIPT",
    "STYLE",
    "IFRAME",
    "OBJECT",
    "EMBED",
    "SVG",
    "MATH",
    "FORM",
    "INPUT",
    "BUTTON",
    "TEXTAREA",
    "SELECT",
    "TEMPLATE",
    "NOSCRIPT",
  ]);
  function copy(source, parent) {
    for (const child of source.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        parent.append(document.createTextNode(child.textContent));
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE || blocked.has(child.tagName))
        continue;
      const heading = /^H[1-6]$/.test(child.tagName);
      if (!allowed.has(child.tagName) && !heading) {
        copy(child, parent);
        continue;
      }
      const clean = node(heading ? "h5" : child.tagName.toLowerCase());
      if (child.tagName === "A") {
        const href = safeUrl(child.getAttribute("href"));
        if (!href) {
          copy(child, parent);
          continue;
        }
        clean.href = href;
        clean.rel = "noreferrer";
      }
      if (child.tagName === "IMG") {
        const src = safeUrl(child.getAttribute("src"));
        if (!src) continue;
        clean.src = src;
        clean.alt = child.getAttribute("alt") ?? "";
        clean.loading = "lazy";
      }
      copy(child, clean);
      parent.append(clean);
    }
  }
  const body = node("div", "story-body");
  copy(parsed.body, body);
  if (!body.textContent.trim() && !body.querySelector("img")) {
    body.append(
      node("p", "empty", "No body yet. Add a paragraph in the native editor."),
    );
  }
  return body;
}

function fieldSection(title, content) {
  const section = node("section", "story-field");
  section.append(node("h4", "", title), content);
  return section;
}

function taskRow(task, story) {
  const row = node("li", "task");
  const mark = node("span", "task-mark", task.done ? "✓" : "○");
  mark.setAttribute("aria-hidden", "true");
  const text = node("div");
  text.append(editorLink("tasks", task.id, task.title));
  text.append(
    node(
      "small",
      "",
      `${task.done ? "Done" : "To do"} · ${story ?? "No linked story"} · Edit ↗`,
    ),
  );
  row.append(mark, text);
  return row;
}

function storyCard(story, openStories) {
  const card = node("article", "story");
  const art = node("div", "story-art");
  const coverUrl = safeUrl(story.cover?.sizes?.card?.url ?? story.cover?.url);
  if (coverUrl) {
    const image = node("img");
    image.src = coverUrl;
    image.alt = story.cover.alt ?? "";
    art.append(image);
  }
  const content = node("div", "story-content");
  const label = node(
    "span",
    "label",
    `${story.details?.featured ? "Featured" : "Not featured"} · ${story.tasks.length} linked tasks`,
  );
  const title = node("h3", "", story.title);
  title.id = `story-title-${story.id}`;
  card.setAttribute("aria-labelledby", title.id);
  const subtitle = node("p", "", story.details?.subtitle || "No subtitle yet.");
  const details = node("details", "story-details");
  details.id = `story-${story.id}`;
  details.open = openStories.has(details.id);
  details.append(node("summary", "", "Read story & fields"));

  const actions = node("div", "story-edit");
  const refreshButton = node("button", "", "Refresh from First ↻");
  refreshButton.type = "button";
  refreshButton.id = `story-refresh-${story.id}`;
  refreshButton.dataset.refresh = "";
  refreshButton.addEventListener("click", refresh);
  actions.append(
    editorLink("stories", story.id, "Edit this story ↗"),
    refreshButton,
  );
  details.append(
    actions,
    node(
      "p",
      "hint",
      "Editor opens in a new tab. Save your changes, return here, then refresh.",
    ),
  );
  details.append(fieldSection("Story body", storyBody(story.body)));

  const links = node("ul", "story-links");
  for (const entry of story.links ?? []) {
    const item = node("li");
    const href = safeUrl(entry.href);
    const link = node(
      href ? "a" : "span",
      "",
      entry.label || entry.href || "Untitled link",
    );
    if (href) {
      link.href = href;
      link.rel = "noreferrer";
    }
    item.append(link);
    if (!href)
      item.append(
        node("small", "empty", " (link unavailable: use http or https)"),
      );
    links.append(item);
  }
  details.append(
    fieldSection(
      "Links · repeater",
      links.children.length ? links : node("p", "empty", "No links yet."),
    ),
  );

  const sections = node("div", "story-blocks");
  for (const block of story.sections ?? []) {
    if (block.layout === "quote") {
      const quote = node("blockquote");
      quote.append(node("p", "", block.text));
      if (block.cite) quote.append(node("cite", "", block.cite));
      sections.append(quote);
    } else if (block.layout === "callout") {
      const callout = node("div", "story-callout");
      callout.append(node("h5", "", block.heading), node("p", "", block.body));
      sections.append(callout);
    }
  }
  details.append(
    fieldSection(
      "Sections · layout blocks",
      sections.children.length
        ? sections
        : node("p", "empty", "No sections yet."),
    ),
  );
  details.append(
    fieldSection(
      "Metadata · JSON",
      node(
        "pre",
        "story-json",
        JSON.stringify(story.metadata ?? null, null, 2),
      ),
    ),
  );
  const tasks = node("ul", "task-list");
  tasks.append(...story.tasks.map((task) => taskRow(task, story.title)));
  details.append(
    fieldSection(
      "Related tasks",
      tasks.children.length
        ? tasks
        : node(
            "p",
            "empty",
            "No linked tasks. Choose this story on a task in the admin.",
          ),
    ),
  );
  content.append(label, title, subtitle, details);
  card.append(art, content);
  return card;
}

async function listAll(collection, options = {}) {
  const rows = [];
  for (let offset = 0; ; offset += 100) {
    const page = await collection.list({
      ...options,
      orderBy: { id: "asc" },
      limit: 100,
      offset,
    });
    rows.push(...page);
    if (page.length < 100) return rows;
  }
}

async function refresh() {
  const focusedRefresh = document.activeElement?.matches("[data-refresh]")
    ? document.activeElement
    : null;
  document.querySelectorAll("[data-refresh]").forEach((button) => {
    button.disabled = true;
  });
  element("stories").setAttribute("aria-busy", "true");
  element("load-status").className = "";
  element("load-status").textContent = "Reading from the API…";
  try {
    const [settings, stories, tasks] = await Promise.all([
      first.globals.settings.get(),
      listAll(first.stories, {
        with: { tasks: true, cover: true },
      }),
      listAll(first.tasks, { with: { storyId: true } }),
    ]);
    element("site-title").textContent = settings.title;
    element("description").textContent = settings.description;
    const openStories = new Set(
      [...document.querySelectorAll(".story-details[open]")].map(
        (details) => details.id,
      ),
    );
    element("stories").replaceChildren(
      ...stories.map((story) => storyCard(story, openStories)),
    );
    element("tasks").replaceChildren(
      ...tasks.map((task) => taskRow(task, task.storyId?.title)),
    );
    if (!tasks.length)
      element("tasks").append(
        node("li", "empty", "No tasks yet. Create one in the admin."),
      );
    element("load-status").textContent = stories.length
      ? `${stories.length} stories · ${tasks.length} tasks · Refreshed at ${new Date().toLocaleTimeString()}`
      : "No stories yet. Create one in the admin, then refresh.";
  } catch (error) {
    const previous = element("stories").children.length
      ? " Previously loaded content is still shown."
      : "";
    element("load-status").textContent =
      `Could not refresh.${previous} ${error.message} Try Refresh from First again.`;
    element("load-status").className = "error";
  } finally {
    element("stories").setAttribute("aria-busy", "false");
    document.querySelectorAll("[data-refresh]").forEach((button) => {
      button.disabled = false;
    });
    if (
      focusedRefresh &&
      (document.activeElement === document.body ||
        document.activeElement === focusedRefresh)
    ) {
      element(focusedRefresh.id)?.focus({ preventScroll: true });
    }
  }
}

element("headline-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button");
  button.disabled = true;
  try {
    const result = await first.actions.previewHeadline({
      title: element("headline").value,
    });
    element("result").textContent = JSON.stringify(result, null, 2);
  } catch (error) {
    element("result").textContent = error.message;
  } finally {
    button.disabled = false;
  }
});
element("refresh").addEventListener("click", refresh);
element("copy-check").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText("node examples/showcase/run.mjs check");
    element("copy-check").textContent = "Copied";
  } catch {
    element("copy-check").textContent = "Select command to copy";
  }
});
await refresh();
