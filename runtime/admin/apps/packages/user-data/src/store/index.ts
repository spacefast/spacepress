import { createReduxStore, register } from '@wordpress/data';
import reducer from './reducer';
import * as actions from './actions';
import * as privateActions from './private-actions';
import * as selectors from './selectors';
import type { State } from './types';
import { unlock } from '../lock-unlock';

export const STORE_NAME: string = 'user-data';

export const storeConfig = {
	reducer,
	actions,
	selectors,
};

export const store = createReduxStore<
	State,
	typeof actions,
	typeof selectors
>( STORE_NAME, storeConfig );

// Register private actions for internal use by thunks.
// eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- unlock() returns any by design
unlock( store ).registerPrivateActions( privateActions );

// Register store with guard against duplicate registration.
// This can happen in development with hot module reloading.
try {
	register( store );
} catch ( error ) {
	// Store already registered, ignore.
	if (
		! (
			error instanceof Error &&
			error.message.includes( 'already registered' )
		)
	) {
		// Re-throw if it's a different error.
		throw error;
	}
}
