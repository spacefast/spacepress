import { test } from "node:test";
import assert from "node:assert/strict";
import { assertAdditive, assertAdditiveSql, assertStructuredFields } from "./build-app.mjs";

test("Apply permits additions and rejects changes that endanger existing records", () => {
  const before = {
    tables: {
      items: { editor: false, columns: { name: { type: "text", notNull: true, default: null } } },
    },
  };
  const after = structuredClone(before);
  after.tables.items.columns.notes = { type: "text", notNull: false, default: null };
  after.tables.items.columns.opened = { type: "boolean", notNull: true, default: false };
  after.tables.locations = { editor: false, columns: { id: { type: "integer" } } };
  assert.doesNotThrow(() => assertAdditive(before, after));
  for (const mutate of [
    (value) => {
      delete value.tables.items;
    },
    (value) => {
      value.tables.items.editor = true;
    },
    (value) => {
      delete value.tables.items.columns.name;
    },
    (value) => {
      value.tables.items.columns.name.type = "integer";
    },
    (value) => {
      value.tables.items.columns.notes.notNull = true;
    },
  ]) {
    const unsafe = structuredClone(after);
    mutate(unsafe);
    assert.throws(() => assertAdditive(before, unsafe), /Apply|default/);
  }
});

test("Apply SQL permits only compiler-shaped additive statements", () => {
  assert.doesNotThrow(() =>
    assertAdditiveSql(
      "CREATE TABLE `new_table` (`id` BIGINT);\n--> statement-breakpoint\nALTER TABLE `sp_items` ADD COLUMN `notes` LONGTEXT;",
    ),
  );
  for (const sql of [
    "CREATE TABLE `bad` (`id` BIGINT); DELETE FROM `sp_items`;",
    "CREATE TABLE `bad` (`id` BIGINT) /*! SELECT 1 */;",
    "DROP TABLE `sp_items`;",
    "ALTER TABLE `sp_items` DROP COLUMN `name`;",
    "ALTER TABLE `sp_items` ADD COLUMN `notes` TEXT; DELETE FROM `sp_items`;",
    "UPDATE `sp_items` SET `name` = NULL;",
  ])
    assert.throws(() => assertAdditiveSql(sql), /new tables and added columns/);
});

test("Apply protects nested SCF fields, layouts, globals and native content bindings", () => {
  const before = {
    collections: {
      stories: {
        content: "body",
        columns: {
          body: { type: "richText" },
          details: { type: "group", fields: { subtitle: { type: "text" } } },
          blocks: { type: "blocks", layouts: { quote: { text: { type: "text" } } } },
        },
      },
    },
    globals: { settings: { wp: { postId: "settings" }, fields: { title: { type: "text" } } } },
  };
  const after = structuredClone(before);
  after.collections.stories.columns.details.fields.notes = { type: "text" };
  after.collections.stories.columns.blocks.layouts.callout = {
    heading: { type: "text", notNull: true },
  };
  after.globals.settings.fields.footer = { type: "text" };
  assert.doesNotThrow(() => assertStructuredFields(before, after));
  for (const mutate of [
    (value) => {
      delete value.collections.stories.columns.details.fields.subtitle;
    },
    (value) => {
      delete value.collections.stories.columns.blocks.layouts.quote;
    },
    (value) => {
      value.collections.stories.content = "other";
    },
    (value) => {
      delete value.globals.settings.fields.title;
    },
    (value) => {
      value.globals.settings.wp.postId = "elsewhere";
    },
  ]) {
    const unsafe = structuredClone(after);
    mutate(unsafe);
    assert.throws(() => assertStructuredFields(before, unsafe), /Apply cannot/);
  }
});
