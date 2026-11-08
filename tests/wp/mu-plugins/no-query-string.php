<?php
// Test-only: a request carrying `X-Zero-No-Query-String` arrives without $_SERVER['QUERY_STRING'],
// as some servers send it, so code that reads the query must fall back to REQUEST_URI.
if (isset($_SERVER['HTTP_X_ZERO_NO_QUERY_STRING'])) {
    unset($_SERVER['QUERY_STRING']);
}
