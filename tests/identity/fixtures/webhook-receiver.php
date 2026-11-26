<?php
// A webhook endpoint for the webhooks suite (php -S router; test stack only). It verifies the
// `SpacePress-Signature: t=…,v1=hmac_sha256(t.body)` header, fails the first delivery of each event with
// 503 and accepts the retry with 204.
declare(strict_types=1);
$body = (string) file_get_contents('php://input');
$signature = (string) ($_SERVER['HTTP_SPACEPRESS_SIGNATURE'] ?? '');
$event = preg_replace('/[^0-9]/', '', (string) ($_SERVER['HTTP_SPACEPRESS_EVENT_ID'] ?? ''));
if (!preg_match('/^t=(\d+),v1=([0-9a-f]{64})$/D', $signature, $m) || abs(time() - (int) $m[1]) > 60
    || !hash_equals(hash_hmac('sha256', $m[1] . '.' . $body, 'disposable-webhook-contract-secret'), $m[2]) || $event === '') {
    http_response_code(401);
    exit;
}
$seen = sys_get_temp_dir() . "/webhook-$event";
if (!is_file($seen)) {
    touch($seen);
    http_response_code(503);
    exit;
}
http_response_code(204);
