<?php
// Test stack only: a host that serves its own frontend turns on identity cookies for /wp-json/typedpress/v1.
// auth.test.ts flips the option to exercise both modes on one stack.
add_filter('tp_identity_rest_cookie_auth', static fn (): bool => get_option('tp_test_rest_cookie_auth') === '1');
