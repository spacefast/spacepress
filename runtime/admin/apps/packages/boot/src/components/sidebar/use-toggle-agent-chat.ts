export function useToggleAgentChat() {
	const toggleAgentChat = async () => {
		if ( ! window.__agentsManagerActions ) {
			return;
		}
		const state = await window.__agentsManagerActions?.getChatState();
		if ( ! state ) {
			return;
		}
		window.__agentsManagerActions?.setChatOpen( ! state.isOpen );
	};

	return { toggleAgentChat };
}
