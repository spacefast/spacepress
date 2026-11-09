<?php
// Test-only: a request carrying `X-First-No-Query-String` arrives without $_SERVER['QUERY_STRING'],
// as some servers send it, so code that reads the query must fall back to REQUEST_URI.
if (isset($_SERVER['HTTP_X_FIRST_NO_QUERY_STRING'])) {
    unset($_SERVER['QUERY_STRING']);
}
