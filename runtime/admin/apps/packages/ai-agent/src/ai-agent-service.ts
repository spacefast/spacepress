/**
 * AI Agent Service
 * Uses window.wpOrchestratorAgent exposed by big-sky-plugin's headless orchestrator.
 *
 * The headless orchestrator must be loaded for this to work.
 * It handles authentication, abilities, and tool execution automatically.
 */

/**
 * WpOrchestratorAgent interface (matches what big-sky-plugin exposes)
 */
interface WpOrchestratorAgent {
	ask: (
		prompt: string,
		onStream?: ( text: string ) => void
	) => Promise< string >;
}

declare global {
	interface Window {
		wpOrchestratorAgent?: WpOrchestratorAgent;
	}
}

/**
 * Simple one-shot function to ask the AI agent a question.
 * Uses window.wpOrchestratorAgent exposed by big-sky-plugin's headless orchestrator.
 *
 * @param prompt   - The user's prompt
 * @param onStream
 * @return The AI's text response
 * @throws Error if wpOrchestratorAgent is not available
 *
 * @example
 * ```ts
 * const response = await askAIAgent('What shipping zones should I create?');
 * console.log(response);
 * ```
 */
export async function askAIAgent(
	prompt: string,
	onStream?: ( text: string ) => void
): Promise< string > {
	if ( ! window.wpOrchestratorAgent ) {
		throw new Error(
			'wpOrchestratorAgent not available. Ensure the headless orchestrator is loaded.'
		);
	}

	return window.wpOrchestratorAgent.ask( prompt, onStream );
}
