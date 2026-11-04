import { createReduxStore, register } from '@wordpress/data';
import reducer from './reducer';
import * as actions from './actions';
import * as selectors from './selectors';

/**
 * Store name for the AI agent context store.
 *
 * WARNING: This store name is used by external plugins (e.g., big-sky-plugin).
 * Changing this value will break the integration. If you must change it,
 * coordinate with all consuming plugins.
 *
 * @see https://github.com/Automattic/big-sky-plugin/blob/trunk/src/ai/wp-orchestrator/client-context.ts
 */
export const STORE_NAME: string = 'ai-agent-context';

export const storeConfig = {
	reducer,
	actions,
	selectors,
};

export const store: ReturnType<
	typeof createReduxStore< unknown, typeof actions, typeof selectors >
> = createReduxStore( STORE_NAME, storeConfig );

// Register store with guard against duplicate registration
// This can happen in development with hot module reloading
try {
	register( store );
} catch ( error ) {
	// Store already registered, ignore
	if (
		! (
			error instanceof Error &&
			error.message.includes( 'already registered' )
		)
	) {
		// Re-throw if it's a different error
		throw error;
	}
}

export * from './types';
