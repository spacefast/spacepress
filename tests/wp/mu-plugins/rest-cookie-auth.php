<?php
// Test stack only: a host that serves its own frontend turns on identity cookies for /zero/v1.
// auth.test.ts flips the option to exercise both modes on one stack.
add_filter('zero_identity_rest_cookie_auth', static fn (): bool => get_option('zero_test_rest_cookie_auth') === '1');
