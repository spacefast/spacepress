// The WordPress internals First relies on, read by reflection on the stack's own WordPress (the
// floor here, the nightly and the next beta in .github/workflows/wordpress-ahead.yml): the PHP
// suite tests/php/core_shape_test.php checks core's classes on the pinned core; this checks the
// plugin internals that only run here (Polylang) and core's classes as the web server loads them.
// What each one is for, and what to do when one fails: docs/wordpress-internals.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import { wp } from "./env.ts";

const shape = (php: string) => JSON.parse(wp("eval", php));

test("Polylang's model and REST context, as Wp/Polylang.php and Runtime's pll_context use them", () => {
  const seen = shape(`echo wp_json_encode([
    'pll' => function_exists('PLL'),
    'model' => function_exists('PLL') ? array_values(array_filter(['get_language', 'add_language', 'update_default_lang', 'clean_languages_cache'], fn ($m) => method_exists(PLL()->model, $m))) : [],
    'rest' => class_exists('PLL_REST_Request'),
    'context' => has_filter('pll_context') !== false,
  ]);`);
  assert.deepEqual(seen, { pll: true, model: ["get_language", "add_language", "update_default_lang", "clean_languages_cache"], rest: true, context: true });
});

test("core's REST classes First subclasses keep the protected members it uses", () => {
  const seen = shape(`
    $m = fn ($c, $n) => method_exists($c, $n) ? (new ReflectionMethod($c, $n))->isProtected() ? 'protected' : ((new ReflectionMethod($c, $n))->isPublic() ? 'public' : 'private') : 'gone';
    $p = fn ($c, $n) => property_exists($c, $n) ? ((new ReflectionProperty($c, $n))->isProtected() ? 'protected' : 'other') : 'gone';
    echo wp_json_encode([
      'posts.meta' => $p('WP_REST_Posts_Controller', 'meta'),
      'posts.get_post' => $m('WP_REST_Posts_Controller', 'get_post'),
      'controller.update_additional_fields_for_object' => $m('WP_REST_Controller', 'update_additional_fields_for_object'),
      'meta.get_registered_fields' => $m('WP_REST_Meta_Fields', 'get_registered_fields'),
      'search.type' => $p('WP_REST_Search_Handler', 'type'),
      'search.subtypes' => $p('WP_REST_Search_Handler', 'subtypes'),
    ]);`);
  assert.deepEqual(seen, {
    "posts.meta": "protected", "posts.get_post": "protected", "controller.update_additional_fields_for_object": "protected",
    "meta.get_registered_fields": "protected", "search.type": "protected", "search.subtypes": "protected",
  });
});
