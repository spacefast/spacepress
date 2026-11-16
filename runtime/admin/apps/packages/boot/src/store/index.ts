import { createReduxStore, register } from '@wordpress/data';
import reducer from './reducer';
import * as actions from './actions';
import * as selectors from './selectors';

export const STORE_NAME: string = 'typedpress-admin';

export const storeConfig = {
	reducer,
	actions,
	selectors,
};

export const store = createReduxStore<
	unknown,
	typeof actions,
	typeof selectors
>( STORE_NAME, storeConfig );
register( store );
