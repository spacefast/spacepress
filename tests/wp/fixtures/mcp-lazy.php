<?php
// Executed against the actual compiled artifact and pinned adapter, never shipped.
$check = static function (bool $ok, string $message): void {
    if (!$ok) { throw new RuntimeException($message); }
};
$adapter = \WP\MCP\Core\McpAdapter::instance();
$server = $adapter->get_server('zero-blog');
$check($server !== null, 'server registered on the ordinary lifecycle');
$tool = $server->get_mcp_tool('blog-posts-list');
$check($tool !== null, 'collection tool is registered');
$records = new ReflectionProperty($tool, 'protocol_records');
$check($records->getValue($tool) === [], 'registration must not project tools');
$routes = rest_get_server()->get_routes();
$check(isset($routes['/mcp/zero-blog']), 'route discovery includes MCP');
$check($records->getValue($tool) === [], 'route discovery must not project tools');
wp_set_current_user(get_user_by('login', 'admin')->ID);
$request = new WP_REST_Request('POST', '/mcp/zero-blog');
$request->set_header('Content-Type', 'application/json');
$request->set_header('Accept', 'application/json, text/event-stream');
$request->set_body(json_encode(['jsonrpc' => '2.0', 'id' => 1, 'method' => 'initialize', 'params' => [
    'protocolVersion' => '2025-11-25', 'capabilities' => new stdClass(),
    'clientInfo' => ['name' => 'internal-test', 'version' => '1'],
]]));
$response = rest_do_request($request);
$check($response->get_status() === 200, 'internal MCP initialize succeeds');

$registry = new \WP\MCP\Core\McpComponentRegistry($server,
    new \WP\MCP\Infrastructure\ErrorHandling\NullMcpErrorHandler(),
    new \WP\MCP\Infrastructure\Observability\NullMcpObservabilityHandler(), $server->get_schemas());
$valid = \WP\MCP\Domain\Tools\McpTool::fromArray(['name' => 'valid', 'handler' => static fn () => []]);
$invalid = \WP\MCP\Domain\Tools\McpTool::fromArray(['name' => 'invalid', 'inputSchema' => ['type' => 'string'], 'handler' => static fn () => []]);
$registry->register_tools([$valid, $invalid]);
$check($records->getValue($valid) === [], 'new tools stay neutral');
foreach (\WP\MCP\Core\McpVersionNegotiator::SUPPORTED_PROTOCOL_VERSIONS as $revision) {
    $tools = $registry->get_tools($server->get_schemas()->forVersion($revision));
    $check(isset($tools['valid']) && !isset($tools['invalid']), 'selected revision excludes invalid projections');
}
echo 'MCP lazy projection passed';
