import { createClient } from "./client/index.js";

const zero = createClient({ url: "/wp-json/zero/v1" });
const element = (id) => document.getElementById(id);

async function refresh() {
  element("refresh").disabled = true;
  try {
    const [settings, stories, tasks] = await Promise.all([
      zero.globals.settings.get(),
      zero.stories.list({
        orderBy: { id: "asc" },
        with: { tasks: true, cover: true },
      }),
      zero.tasks.list({ orderBy: { id: "asc" }, with: { story: true } }),
    ]);
    element("site-title").textContent = settings.title;
    element("description").textContent = settings.description;
    const cards = stories.map((story) => {
      const card = document.createElement("article");
      card.className = "story";
      const art = document.createElement("div");
      art.className = "story-art";
      if (story.cover) {
        const image = document.createElement("img");
        image.src = story.cover.sizes.card?.url ?? story.cover.url;
        image.alt = story.cover.alt ?? "";
        art.replaceChildren(image);
      }
      const content = document.createElement("div");
      content.className = "story-content";
      const label = document.createElement("span");
      label.className = "label";
      label.textContent = `${story.details?.featured ? "Featured · " : ""}${story.tasks.length} linked tasks`;
      const title = document.createElement("h3");
      title.textContent = story.title;
      const body = document.createElement("p");
      body.textContent =
        story.details?.subtitle ??
        "Open this story in the native editor to make it yours.";
      content.append(label, title, body);
      card.append(art, content);
      return card;
    });
    element("stories").replaceChildren(...cards);
    element("tasks").replaceChildren(
      ...tasks.map((task) => {
        const row = document.createElement("div");
        row.className = "task";
        const mark = document.createElement("span");
        mark.className = "task-mark";
        mark.textContent = task.done ? "✓" : "○";
        const text = document.createElement("div");
        text.textContent = task.title;
        const story = document.createElement("small");
        story.textContent = task.story?.title ?? "No linked story";
        text.append(story);
        row.append(mark, text);
        return row;
      }),
    );
    element("load-status").textContent = cards.length
      ? ""
      : "No stories yet. Create one in the admin.";
  } catch (error) {
    element("load-status").textContent = error.message;
    element("load-status").className = "error";
  } finally {
    element("refresh").disabled = false;
  }
}

element("headline-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button");
  button.disabled = true;
  try {
    const result = await zero.actions.previewHeadline({
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
for (const [id, file] of [
  ["source-ts", "source.ts.txt"],
  ["source-php", "compiled.php.txt"],
]) {
  fetch(`./${file}`)
    .then((response) => {
      if (!response.ok) throw new Error("Source unavailable");
      return response.text();
    })
    .then((source) => {
      element(id).textContent = source;
    })
    .catch((error) => {
      element(id).textContent = error.message;
    });
}
await refresh();
