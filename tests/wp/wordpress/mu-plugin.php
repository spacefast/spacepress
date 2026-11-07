<?php
// Abilities lane only: a third-party plugin's ability, as WooCommerce or Jetpack would register one.
add_action('wp_abilities_api_categories_init', static fn () => wp_register_ability_category('acme', ['label' => 'Acme', 'description' => 'Acme lane tools']));
add_action('wp_abilities_api_init', static function (): void {
    wp_register_ability('acme/word-count', [
        'label' => 'Word count',
        'description' => 'Counts the words of a text for the signed-in user.',
        'category' => 'acme',
        'input_schema' => ['type' => 'object', 'properties' => ['text' => ['type' => 'string'], 'unit' => ['type' => 'string', 'enum' => ['words', 'letters']]], 'required' => ['text']],
        'output_schema' => ['type' => 'object', 'properties' => ['count' => ['type' => 'integer'], 'by' => ['type' => 'string']], 'required' => ['count', 'by']],
        'permission_callback' => static fn () => current_user_can('edit_posts'),
        'execute_callback' => static fn (array $in) => [
            'count' => ($in['unit'] ?? 'words') === 'letters' ? strlen(preg_replace('/\W/', '', $in['text'])) : str_word_count($in['text']),
            'by' => wp_get_current_user()->user_login,
        ],
        'meta' => ['show_in_rest' => true],
    ]);
});
