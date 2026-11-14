<?php

declare(strict_types=1);

namespace First\Wp\Abilities;

use First\Wp\Facade;

/**
 * A First ability. Core's run route serves only abilities that are `show_in_rest`; an `agents: false`
 * one is hidden from REST discovery and MCP, but it is still the app's own operation, so for the
 * facade's own dispatches (`/__first/api/v1/actions/<name>`, spec §3a) it reports itself shown and
 * the run route serves it with core's checks: input, permission, execution, output.
 */
final class FirstAbility extends \WP_Ability
{
    public function get_meta_item(string $key, $default_value = null)
    {
        if ($key === 'show_in_rest' && Facade::running() === $this->get_name()) {
            return true; // the one named elevation: the app's own API runs its own ability
        }

        return parent::get_meta_item($key, $default_value);
    }

    /**
     * WordPress 7.2 sanitizes an ability's input by its schema inside execute(), after validating it.
     * First's pipeline is the one validator of its abilities (Register::validate) and reads the input
     * as it was sent, so nothing is cast here. Query-string input is still typed by core's run route
     * before it gets here.
     */
    protected function sanitize_input($input)
    {
        return $input;
    }
}
