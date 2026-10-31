<?php

declare(strict_types=1);

/*
 * Standalone only (WordPress defines all of these before any plugin loads): the WordPress functions the
 * bundled php-toolkit calls while converting Markdown and blocks. Block parsing and serialization are
 * WordPress's own algorithms (Zero\Sync\Blocks); escaping matches the toolkit's polyfill.
 */

function parse_blocks($input)
{
    return \Zero\Sync\Blocks::parse((string) $input);
}

function serialize_block($block)
{
    return \Zero\Sync\Blocks::serializeBlock($block);
}

function serialize_blocks($blocks)
{
    return \Zero\Sync\Blocks::serialize($blocks);
}

function esc_attr($text)
{
    return htmlspecialchars((string) $text, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function esc_html($text)
{
    return htmlspecialchars((string) $text, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function esc_url($url)
{
    return htmlspecialchars((string) $url, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function wp_kses_uri_attributes()
{
    return ['action', 'cite', 'formaction', 'href', 'poster', 'src', 'srcset', 'xmlns'];
}

function __($text, $domain = 'default')
{
    return $text;
}

function _doing_it_wrong($function_name, $message, $version)
{
}

function wp_trigger_error($function_name, $message, $error_level = E_USER_NOTICE)
{
    trigger_error(($function_name === '' ? '' : "$function_name(): ") . $message, $error_level === E_USER_ERROR ? E_USER_WARNING : $error_level);
}
