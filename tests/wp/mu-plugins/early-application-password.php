<?php
/**
 * Test hook: with `X-Test-Early-Application-Password: 1`, application passwords are checked whenever
 * the user is resolved, as a plugin that widens `application_password_is_api_request` makes them. On
 * this site Polylang resolves the user while plugins load, before the app has booted.
 */
if (!empty($_SERVER['HTTP_X_TEST_EARLY_APPLICATION_PASSWORD'])) {
    add_filter('application_password_is_api_request', '__return_true');
}
