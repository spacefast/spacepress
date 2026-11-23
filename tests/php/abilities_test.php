<?php

declare(strict_types=1);

/*
 * abilities.call from "php/wordpress" (TypedPress\Wp\Abilities\Call) on an in-process WordPress: another
 * plugin's ability runs through core's execute() for the current user, with core's input and
 * permission checks, and its WP_Errors become HttpErrors; the app's own abilities are callable too.
 */

use TypedPress\HttpError;
use TypedPress\JsObject;
use TypedPress\Wp\Abilities\Call;

require __DIR__ . '/wp.php';
require __DIR__ . '/harness.php';

$schema = require dirname(__DIR__) . '/fixtures/blog/schema.php';
$wp = wpSite('abilities', [
    'schema' => $schema,
    'functions' => file_get_contents(dirname(__DIR__) . '/fixtures/blog/functions.php'),
    'muPlugins' => ['acme-abilities' => <<<'PHP'
        <?php
        add_action('wp_abilities_api_categories_init', static fn () => wp_register_ability_category('acme', ['label' => 'Acme', 'description' => 'Acme tools']));
        add_action('wp_abilities_api_init', static function (): void {
            wp_register_ability('acme/greet', [
                'label' => 'Greet', 'description' => 'Greets someone', 'category' => 'acme',
                'input_schema' => ['type' => 'object', 'properties' => ['name' => ['type' => 'string'], 'loud' => ['type' => 'boolean']], 'required' => ['name']],
                'output_schema' => ['type' => 'object', 'properties' => ['text' => ['type' => 'string'], 'by' => ['type' => 'integer']], 'required' => ['text', 'by']],
                'permission_callback' => static fn () => current_user_can('edit_posts'),
                'execute_callback' => static fn (array $in) => ['text' => ($in['loud'] ?? false) ? strtoupper("hi {$in['name']}") : "hi {$in['name']}", 'by' => get_current_user_id()],
                'meta' => ['show_in_rest' => true],
            ]);
            wp_register_ability('acme/teapot', [
                'label' => 'Teapot', 'description' => 'Always refuses', 'category' => 'acme',
                'input_schema' => [], 'output_schema' => [],
                'permission_callback' => '__return_true',
                'execute_callback' => static fn () => new WP_Error('acme_teapot', 'I am a teapot', ['status' => 418]),
            ]);
        });
        // A plugin's own hidden operation beside the app's.
        add_filter('tp_ability_operations', static function (array $ops, string $app): array {
            $ops[] = ['name' => "$app/plugin-hidden", 'op' => 'action', 'agents' => false, 'typedpress' => [], 'label' => 'Hidden', 'description' => 'A plugin operation',
                'input' => ['type' => 'object', 'default' => []], 'output' => [], 'annotations' => ['readonly' => true, 'idempotent' => true],
                'rule' => [['role' => 'anyone'], 'read', 'x'], 'run' => static fn (): int => 1];
            return $ops;
        }, 10, 2);
        // Another plugin exposing every post type to core's content abilities (WordPress 7.2).
        add_filter('register_post_type_args', static fn (array $args): array => ['show_in_abilities' => true] + $args, 99);
        PHP],
]);
$problem = static function (callable $fn): string {
    try {
        $fn();
        return 'no error';
    } catch (HttpError $e) {
        return "$e->status $e->errorCode";
    }
};

$wp->actAs('editor');
$out = Call::run('acme/greet', new JsObject(['name' => 'Ada', 'loud' => true]));
eq('another plugin\'s ability runs as the current user and returns a JS object',
    [$out instanceof JsObject, $out->p['text'] ?? null, $out->p['by'] ?? null], [true, 'HI ADA', $wp->userId('editor')]);
eq('core validates the input schema: 422 invalid_input', $problem(static fn () => Call::run('acme/greet', new JsObject(['loud' => true]))), '422 invalid_input');
eq('a WP_Error keeps its status and code', $problem(static fn () => Call::run('acme/teapot', null)), '418 acme_teapot');
eq('an ability the site lacks is 503 ability_unavailable', $problem(static fn () => Call::run('acme/missing', null)), '503 ability_unavailable');
$wp->actAs('subscriber');
eq('the ability\'s permission callback answers for a signed-in user: 403 forbidden', $problem(static fn () => Call::run('acme/greet', new JsObject(['name' => 'Ada']))), '403 forbidden');
$wp->actAs(null);
eq('and for a visitor: 401 unauthenticated', $problem(static fn () => Call::run('acme/greet', new JsObject(['name' => 'Ada']))), '401 unauthenticated');

$wp->actAs('editor');
$created = Call::run('blog/posts-create', new JsObject(['title' => 'Through an ability', 'body' => 'b', 'status' => 'draft']));
eq('the app\'s own ability runs TypedPress\'s pipeline', [$created->p['title'] ?? null, is_int($created->p['id'] ?? null)], ['Through an ability', true]);
$wp->actAs(null);
eq('and its own errors come back as TypedPress problems', $problem(static fn () => Call::run('blog/posts-create', new JsObject(['title' => 'x']))), '401 unauthenticated');

// Core's content abilities read posts without a kind's access rules or field permissions, so a kind
// is never exposed to them, whatever another plugin's register_post_type_args filter asks.
eq('a kind\'s post type is not shown in abilities, a filter\'s show_in_abilities notwithstanding',
    [get_post_type_object('tp_posts')->show_in_abilities ?? null, get_post_type_object('tp_authors')->show_in_abilities ?? null],
    [false, false]);
eq('the filter did run: a core post type it exposes keeps that', get_post_type_object('post')->show_in_abilities ?? null, true);
if (wp_has_ability('core/content-query')) {
    // WordPress 7.2+: the ability exists, lists only exposed types and refuses a kind.
    $enum = wp_get_ability('core/content-query')->get_input_schema()['properties']['where']['properties']['type']['enum'] ?? [];
    eq('core/content-query offers posts but no kind', [in_array('post', $enum, true), in_array('tp_posts', $enum, true), in_array('tp_authors', $enum, true)], [true, false, false]);
    $wp->actAs('admin');
    $posts = wp_get_ability('core/content-query')->execute(['where' => ['type' => 'post']]);
    $refused = wp_get_ability('core/content-query')->execute(['where' => ['type' => 'tp_posts']]);
    check('even for an administrator, core/content-query reads posts but refuses a kind',
        is_array($posts) && $refused instanceof WP_Error, [$posts, $refused]);
    $wp->actAs(null);
} else {
    echo "  (WordPress " . get_bloginfo('version') . " has no core/content-query; checked the post type args only)\n";
}

// Core's run route serves an `agents: false` operation of the app's own schema (its typed client
// runs it) only while that run is the request; a nested internal REST request keeps the outer one's
// state, and nothing outlives it.
$hidden = new ReflectionProperty(\TypedPress\Wp\Abilities\Register::class, 'runRoute');
$wp->actAs('editor');
$outerSeen = null;
$probe = static function (mixed $response, mixed $handler, mixed $request) use (&$outerSeen) {
    if ($request instanceof WP_REST_Request && str_contains((string) $request->get_route(), '/blog/published-count/run')) {
        // A plugin's own REST read inside the outer run's callbacks.
        rest_do_request(new WP_REST_Request('GET', '/wp/v2/types'));
        $outerSeen = \TypedPress\Wp\Abilities\Register::running();
    }
    return $response;
};
add_filter('rest_request_before_callbacks', $probe, 5, 3);
$run = new WP_REST_Request('GET', '/wp-abilities/v1/abilities/blog/published-count/run');
$run->set_query_params(['input' => '{}']);
$answer = rest_do_request($run);
remove_filter('rest_request_before_callbacks', $probe, 5);
eq('a nested REST request inside a run leaves the outer run its own state', $outerSeen, 'blog/published-count');
eq('the run answers', $answer->get_status(), 200);
eq('nothing of the run outlives it', $hidden->getValue(), null);
// An operation a plugin adds through tp_ability_operations is not the app's own: hidden from agents,
// it gets no run route (the mu-plugin above registers `blog/plugin-hidden`).
eq('a plugin\'s hidden operation is not served at the run route', rest_do_request(new WP_REST_Request('GET', '/wp-abilities/v1/abilities/blog/plugin-hidden/run'))->get_status(), 404);
eq('it is registered all the same', wp_has_ability('blog/plugin-hidden'), true);
// An Identity session cookie (where the host turns it on) signs in a run of the app's own operations,
// as on the app API; another plugin's run route, or a feature's hidden operation, stays out.
eq('identity cookie routes: the app API, an app operation\'s run route, nothing else', [
    apply_filters('tp_identity_rest_cookie_route', true, '/typedpress/v1/me'),
    apply_filters('tp_identity_rest_cookie_route', false, '/wp-abilities/v1/abilities/blog/published-count/run'),
    apply_filters('tp_identity_rest_cookie_route', false, '/wp-abilities/v1/abilities/blog/plugin-hidden/run'),
    apply_filters('tp_identity_rest_cookie_route', false, '/wp-abilities/v1/abilities/acme/greet/run'),
    apply_filters('tp_identity_rest_cookie_route', false, '/wp/v2/users/me'),
], [true, true, false, false, false]);
$wp->actAs(null);

finish('abilities');
