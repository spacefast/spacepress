import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, cp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { createServer as createHttpServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { command, wp, setup } from "./setup.mjs";

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
async function freePort() {
  const server = createServer();
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  return port;
}
const acfSections = (sections) =>
  sections.map(({ layout, ...fields }) => ({
    acf_fc_layout: layout,
    ...fields,
  }));
const layouts = (html) =>
  [...html.matchAll(/data-layout="([^"]+)"/g)].map((match) => match[1]);

// Submit the actual SCF options form, including its rendered nonces and repeater controls.
const decode = (value) =>
  value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
async function saveNativeSiteTitle(base, title) {
  const login = await fetch(base + "/wp-login.php", {
    method: "POST",
    redirect: "manual",
    body: new URLSearchParams({
      log: "admin",
      pwd: "first-test-admin",
      "wp-submit": "Log In",
      redirect_to: base + "/wp-admin/",
    }),
  });
  assert.equal(login.status, 302);
  const cookie = login.headers
    .getSetCookie()
    .map((item) => item.split(";")[0])
    .join("; ");
  const screen = "/wp-admin/admin.php?page=first-global-site";
  const response = await fetch(base + screen, { headers: { cookie } });
  assert.equal(response.status, 200);
  const html = await response.text();
  const form = html.match(/<form\b[^>]*id="post"[^>]*>([\s\S]*?)<\/form>/)?.[1];
  assert.ok(form, "SCF site options form renders");
  const attr = (tag, name) =>
    tag.match(new RegExp(`\\b${name}=["']([^"']*)["']`))?.[1];
  const controls = [];
  for (const [tag] of form.matchAll(/<input\b[^>]*>/gs)) {
    const name = attr(tag, "name");
    const type = attr(tag, "type") ?? "text";
    if (
      !name ||
      name.includes("acfcloneindex") ||
      /\bdisabled\b/.test(tag) ||
      ["submit", "button", "file"].includes(type)
    )
      continue;
    if (["checkbox", "radio"].includes(type) && !/\bchecked\b/.test(tag))
      continue;
    controls.push([decode(name), decode(attr(tag, "value") ?? "")]);
  }
  for (const [, attrs, body] of form.matchAll(
    /<textarea\b([^>]*)>(.*?)<\/textarea>/gs,
  )) {
    const name = attr(attrs, "name");
    if (name && !name.includes("acfcloneindex"))
      controls.push([decode(name), decode(body)]);
  }
  for (const [, attrs, body] of form.matchAll(
    /<select\b([^>]*)>(.*?)<\/select>/gs,
  )) {
    const name = attr(attrs, "name");
    if (!name || name.includes("acfcloneindex")) continue;
    const options = [...body.matchAll(/<option\b([^>]*)>(.*?)<\/option>/gs)];
    const selected = options.filter(([, attrs]) => /\bselected\b/.test(attrs));
    for (const [, attrs, label] of selected.length
      ? selected
      : options.slice(0, 1))
      controls.push([decode(name), decode(attr(attrs, "value") ?? label)]);
  }
  const body = new URLSearchParams(controls);
  const titleControl = [...body.keys()].find((name) =>
    name.endsWith("[field_first_global_site_identity_title]"),
  );
  assert.ok(titleControl, "SCF group title control exists");
  body.set(titleControl, title);
  const nonce = html.match(/acf\.data = .*?"nonce":"([^"]+)"/)?.[1];
  assert.ok(nonce, "SCF validation nonce exists");
  const validation = new URLSearchParams(body);
  validation.set("action", "acf/validate_save_post");
  validation.set("nonce", nonce);
  const validated = await (
    await fetch(base + "/wp-admin/admin-ajax.php", {
      method: "POST",
      headers: { cookie },
      body: validation,
    })
  ).json();
  assert.equal(validated.success, true, JSON.stringify(validated));
  assert.equal(validated.data.valid, 1, JSON.stringify(validated));
  const saved = await fetch(base + screen, {
    method: "POST",
    redirect: "manual",
    headers: { cookie },
    body,
  });
  assert.ok(
    [200, 302].includes(saved.status),
    `SCF options save: ${saved.status}`,
  );
  return { cookie, html };
}

test(
  "official marketing sections survive native SCF edits, render publicly, enforce access and persist across Studio rebuilds",
  { timeout: 900000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), "first-emdash-marketing-"));
    const project = join(root, "marketing");
    const site = join(project, ".first/dev/wordpress");
    await mkdir(project);
    for (const file of ["first.config.ts", "seed.json"])
      await cp(join(here, file), join(project, file));
    const evidence = join(root, "evidence");
    await mkdir(evidence);
    t.after(async () => {
      try {
        await cp(
          join(site, "wp-content/debug.log"),
          join(evidence, "wordpress-debug.log"),
        );
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      await command(["dev", "stop", project]);
      const status = JSON.parse(await command(["dev", "status", project]));
      assert.equal(status.isOnline, false);
      const deleted = await exec(
        "npx",
        ["--yes", "--package", "wp-studio@2.2.0", "--", "studio", "delete", "--path", site, "--no-files"],
        { timeout: 120000 },
      );
      await writeFile(
        join(evidence, "cleanup.json"),
        JSON.stringify(
          {
            stopped: !status.isOnline,
            exactSite: site,
            deleteOutput: deleted.stdout,
          },
          null,
          2,
        ),
      );
      await rm(project, { recursive: true, force: true });
      console.log(
        `Cleanup: stopped and deleted only ${site}; removed disposable project. Evidence: ${evidence}`,
      );
    });
    await command([
      "dev",
      project,
      "--port",
      String(await freePort()),
      "--no-watch",
    ]);
    await wp(project, "config", "set", "WP_DEBUG", "true", "--raw");
    await wp(project, "config", "set", "WP_DEBUG_LOG", "true", "--raw");
    await wp(project, "config", "set", "WP_DEBUG_DISPLAY", "false", "--raw");
    const rejectedDownload = createHttpServer((request, response) => {
      response.writeHead(503); response.end("Unavailable test image");
    });
    await new Promise((done) => rejectedDownload.listen(0, "127.0.0.1", done));
    try {
      const failedSeed = join(evidence, "failed-download-seed.json");
      const seed = JSON.parse(await readFile(join(here, "seed.json"), "utf8"));
      await writeFile(failedSeed, JSON.stringify(seed, (key, value) => key === "url" && typeof value === "string" && value.startsWith("https://images.unsplash.com/")
        ? `http://127.0.0.1:${rejectedDownload.address().port}/unavailable` : value));
      const passwords = async () => JSON.parse(await wp(project, "user", "application-password", "list", "admin", "--format=json")).map((item) => item.uuid).sort();
      const before = await passwords();
      await assert.rejects(setup(project, { seedFile: failedSeed }), /Download .*503/);
      assert.deepEqual(await passwords(), before, "failed setup revokes only its own temporary credential");
    } finally {
      await new Promise((done) => rejectedDownload.close(done));
    }
    const client = await setup(project);
    const { base, api, request } = client;
    console.log(`Native Studio marketing: ${base}; evidence ${evidence}`);
    const schema = await api("");
    assert.equal(schema.runtime.wp.database.kind, "sqlite");
    const home = client.pages.find((page) => page.slug === "home");
    const pricing = client.pages.find((page) => page.slug === "pricing");
    const contact = client.pages.find((page) => page.slug === "contact");
    const about = client.pages.find((page) => page.slug === "about");
    const publicHtml = async (path, expected = 200) => {
      const response = await fetch(base + path, {
        signal: AbortSignal.timeout(30000),
      });
      const html = await response.text();
      if (response.status !== expected)
        await writeFile(join(evidence, "public-error.html"), html);
      assert.equal(response.status, expected, html.slice(-7000));
      assert.doesNotMatch(html, /(?:Warning|Fatal error):/);
      return html;
    };
    // Each layout has different rendering logic; these checks hold the actual eleven public renderers.
    const allLayouts = new Set();
    for (const page of client.pages) {
      const html = await publicHtml(
        page.slug === "home" ? "/" : "/" + page.slug,
      );
      assert.deepEqual(
        layouts(html),
        page.sections.map((s) => s.layout),
      );
      for (const section of page.sections) allLayouts.add(section.layout);
      await writeFile(join(evidence, `${page.slug}-initial.html`), html);
    }
    assert.equal(allLayouts.size, 11);
    const originalHome = await publicHtml("/");
    const imageUrl = originalHome.match(
      /<figure class="photo"><img[^>]* src="([^"]+)"/,
    )?.[1];
    assert.ok(imageUrl, "Seed photo renders from native media library");
    const image = await fetch(decode(imageUrl));
    assert.equal(image.status, 200);
    assert.match(image.headers.get("content-type"), /^image\//);
    const mediaBefore = JSON.parse(
      await wp(
        project,
        "post",
        "list",
        "--post_type=attachment",
        "--format=json",
      ),
    );
    assert.ok(mediaBefore.length >= 4);
    const edited = structuredClone(home.sections);
    edited.find((s) => s.layout === "hero").headline =
      "Every building, edited in WordPress.";
    edited.find((s) => s.layout === "logos").logos[0].name =
      "Native Studio Partners";
    edited.find((s) => s.layout === "features").features[0].title =
      "Live native SCF feature";
    edited.find((s) => s.layout === "split").body =
      "Edited text and photo section.\n\nA second native paragraph.";
    edited.find((s) => s.layout === "stats").stats[0].value = "42%";
    edited.find((s) => s.layout === "testimonials").testimonials[0].quote =
      "Saved by the native WordPress editor.";
    edited.find((s) => s.layout === "faq").items[0].answer =
      "This answer came from an SCF repeater.";
    edited.find((s) => s.layout === "cta").primary_cta_label =
      "Book an edited demo";
    // Move logos before the hero. Stored order, including repeat layouts, drives the next public reload.
    const logosIndex = edited.findIndex((s) => s.layout === "logos");
    edited.unshift(...edited.splice(logosIndex, 1));
    await request(`/wp-json/wp/v2/first_pages/${home.id}`, {
      method: "POST",
      body: {
        acf: {
          first_sections: acfSections(edited),
          first_seo: {
            title: "Native marketing SEO",
            description: "Editable native description",
            noindex: false,
          },
        },
      },
    });
    const savedHome = await api(`/pages/${home.id}`);
    assert.deepEqual(savedHome.sections, edited);
    const changedHome = await publicHtml("/");
    assert.deepEqual(
      layouts(changedHome),
      edited.map((s) => s.layout),
    );
    for (const value of [
      "Every building, edited in WordPress.",
      "Native Studio Partners",
      "Live native SCF feature",
      "Edited text and photo section.",
      "42%",
      "Saved by the native WordPress editor.",
      "This answer came from an SCF repeater.",
      "Book an edited demo",
      "Native marketing SEO",
      "Editable native description",
    ])
      assert.ok(changedHome.includes(value), `Public reload shows ${value}`);
    const priceSections = structuredClone(pricing.sections);
    priceSections.find((s) => s.layout === "pricing").plans[1].price = "$179";
    priceSections.find((s) => s.layout === "pricing").plans[1].highlighted =
      false;
    await request(`/wp-json/wp/v2/first_pages/${pricing.id}`, {
      method: "POST",
      body: { acf: { first_sections: acfSections(priceSections) } },
    });
    assert.ok((await publicHtml("/pricing")).includes("$179"));
    assert.equal(
      (await api(`/pages/${pricing.id}`)).sections.find(
        (s) => s.layout === "pricing",
      ).plans[1].highlighted,
      false,
    );
    const contactSections = structuredClone(contact.sections);
    contactSections.find((s) => s.layout === "contact").options[0].link_url =
      "mailto:edited@halden.example";
    await request(`/wp-json/wp/v2/first_pages/${contact.id}`, {
      method: "POST",
      body: { acf: { first_sections: acfSections(contactSections) } },
    });
    assert.ok(
      (await publicHtml("/contact")).includes("mailto:edited@halden.example"),
    );
    await request(`/wp-json/wp/v2/first_pages/${about.id}`, {
      method: "POST",
      body: {
        acf: {
          first_sections: [
            {
              acf_fc_layout: "text",
              headline: "Our native story",
              body: "<p>A <strong>native rich text</strong> edit.</p>",
              anchor_id: "our-story",
            },
          ],
        },
      },
    });
    assert.ok(
      (await publicHtml("/about")).includes(
        "<strong>native rich text</strong>",
      ),
    );
    const native = await saveNativeSiteTitle(base, "Halden Native");
    assert.equal((await api("/site")).identity.title, "Halden Native");
    const globalHtml = await publicHtml("/");
    assert.match(globalHtml, /class="wordmark"[^>]*>Halden Native/);
    await writeFile(join(evidence, "native-scf-options.html"), native.html);
    const nav = await api("/site");
    assert.equal(
      nav.navigation.length,
      6,
      "SCF options save retains menu repeater",
    );
    assert.equal(
      nav.footer.length,
      3,
      "SCF options save retains nested footer repeaters",
    );
    nav.navigation[0].label = "Native navigation";
    await api("/site", {
      method: "PATCH",
      body: { navigation: nav.navigation },
    });
    assert.ok((await publicHtml("/")).includes("Native navigation"));
    // Representative invalid nested input is refused before changing persisted/public content.
    const invalid = structuredClone(edited);
    invalid.find((s) => s.layout === "features").features = [];
    await request(`/wp-json/wp/v2/first_pages/${home.id}`, {
      method: "POST",
      expected: 400,
      body: { acf: { first_sections: acfSections(invalid) } },
    });
    assert.deepEqual((await api(`/pages/${home.id}`)).sections, edited);
    await api(`/pages/${home.id}`, {
      method: "PATCH",
      expected: 422,
      body: {
        sections: [
          {
            layout: "hero",
            headline: "Unsafe link",
            primary_cta_url: "javascript:alert(1)",
          },
        ],
      },
    });
    await api("/pages", {
      method: "POST",
      expected: 401,
      auth: false,
      body: { title: "Anonymous cannot publish" },
    });
    await wp(
      project,
      "user",
      "create",
      "marketing-reader",
      "marketing-reader@example.test",
      "--role=subscriber",
      "--user_pass=local-marketing-reader",
    );
    const readerPassword = await wp(
      project,
      "user",
      "application-password",
      "create",
      "marketing-reader",
      "marketing-acceptance",
      "--porcelain",
    );
    await request(`/wp-json/wp/v2/first_pages/${home.id}`, {
      method: "POST",
      expected: 403,
      headers: {
        authorization: `Basic ${Buffer.from(`marketing-reader:${readerPassword}`).toString("base64")}`,
      },
      body: { title: "Reader cannot edit" },
    });
    const draft = await api("/pages", {
      method: "POST",
      body: {
        title: "Private draft",
        status: "draft",
        slug: "private-draft",
        sections: [{ layout: "hero", headline: "Private draft content" }],
      },
    });
    assert.equal(draft.status, "draft");
    const editorPreview = await fetch(base + `/?p=${draft.id}&preview=true`, {
      headers: { cookie: native.cookie },
    });
    assert.equal(editorPreview.status, 200);
    const previewHtml = await editorPreview.text();
    assert.ok(previewHtml.includes("Private draft content"));
    assert.ok(previewHtml.includes("Draft preview"));
    assert.ok(
      !(await publicHtml(`/?p=${draft.id}&preview=true`)).includes(
        "Private draft content",
      ),
    );
    const deniedDraft = await publicHtml("/private-draft", 404);
    assert.ok(!deniedDraft.includes("Private draft content"));
    assert.equal(
      (await api("/pages", { auth: false })).some((p) => p.id === draft.id),
      false,
    );
    const redirect = await fetch(base + "/home?campaign=native", {
      redirect: "manual",
    });
    assert.equal(redirect.status, 301);
    assert.equal(redirect.headers.get("location"), base + "/?campaign=native");
    await publicHtml("/missing-page", 404);
    const admin = await fetch(base + "/wp-admin/plugins.php", {
      headers: { cookie: native.cookie },
    });
    assert.equal(admin.status, 200);
    assert.match(await admin.text(), /Plugins/);
    const extra = join(site, "wp-content/plugins/marketing-acceptance-extra");
    await mkdir(extra);
    await writeFile(
      join(extra, "marketing-acceptance-extra.php"),
      "<?php /* Plugin Name: Marketing acceptance extra */",
    );
    await wp(project, "plugin", "activate", "marketing-acceptance-extra");
    const beforeRebuild = await api("/pages");
    const beforeGlobal = await api("/site");
    await command(["dev", "stop", project]);
    await command(["dev", project, "--no-watch"]);
    assert.deepEqual(await api("/pages"), beforeRebuild);
    assert.deepEqual(await api("/site"), beforeGlobal);
    assert.deepEqual(
      JSON.parse(
        await wp(
          project,
          "post",
          "list",
          "--post_type=attachment",
          "--format=json",
        ),
      ),
      mediaBefore,
    );
    const active = JSON.parse(
      await wp(project, "plugin", "list", "--status=active", "--format=json"),
    );
    assert.ok(active.some((p) => p.name === "marketing-acceptance-extra"));
    assert.ok(active.some((p) => p.name === "first-marketing-frontend"));
    assert.ok(
      (await publicHtml("/")).includes("Every building, edited in WordPress."),
    );
    await writeFile(join(evidence, "home-edited.html"), await publicHtml("/"));
    await writeFile(
      join(evidence, "results.json"),
      JSON.stringify(
        {
          result: "PASS",
          layouts: [...allLayouts],
          nativeRest: true,
          nativeScfOptions: true,
          publicReload: true,
          invalidInput: true,
          permissions: true,
          draftIsolation: true,
          rebuildPreservesDataMediaPluginsCredentials: true,
          port: new URL(base).port,
        },
        null,
        2,
      ),
    );
    await client.dispose();
    console.log(
      "PASS: all 11 layouts; native core REST/SCF option save → public reload; ordering, structured values, invalid input, anonymous/subscriber permissions, drafts, redirects, full admin, rebuild data/media/plugins/credentials preservation.",
    );
  },
);
