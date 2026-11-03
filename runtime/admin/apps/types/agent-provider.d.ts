export {};
declare global {
    interface Window {
        __agentsManagerActions?: {
            getChatState: () => Promise<{ isOpen: boolean } | undefined>;
            setChatOpen: (open: boolean) => void;
        };
    }
}
