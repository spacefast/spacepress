# AI agent integration

This package preserves the upstream agent context store, abilities lifecycle,
cache invalidation and provider slot. It does not include an AI service.

A WordPress plugin can enable the slot with the `tp_admin_boot_context`
filter (`ai_agent_enabled => true`). The provider implements
`window.wpOrchestratorAgent.ask(prompt, onStream)` and renders into the slot
announced by `typedpress-admin-ai-agent-ready`. Authentication and tool authorization
belong to that provider and WordPress. An absent provider causes `askAIAgent`
to reject explicitly; no simulated chat response is supplied.

The optional `window.__agentsManagerActions` contract controls a provider's
chat visibility. The exported `ai-agent-context` store retains its upstream
name because providers consume it. Register minimal metadata and remove
component-owned context entries on unmount.

Hosted AI transport, credentials and hosted account invitations are outside
TypedPress's native WordPress installation. They have not been verified by the
local WordPress acceptance suite.
