<?php

declare(strict_types=1);

/*
 * abilities.call from "php/wordpress" (First\Wp\Abilities\Call) on an in-process WordPress: another
 * plugin's ability runs through core's execute() for the current user, with core's input and
 * permission checks, and its WP_Errors become HttpErrors; the app's own abilities are callable too.
 */

use First\HttpError;
use First\JsObject;
use First\Wp\Abilities\Call;

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
eq('the app\'s own ability runs First\'s pipeline', [$created->p['title'] ?? null, is_int($created->p['id'] ?? null)], ['Through an ability', true]);
$wp->actAs(null);
eq('and its own errors come back as First problems', $problem(static fn () => Call::run('blog/posts-create', new JsObject(['title' => 'x']))), '401 unauthenticated');

finish('abilities');
