import 'react';

declare module 'react' {
	interface HTMLAttributes< T > {
		/** Standard global attribute (supported in browsers, missing in React types) */
		inert?: 'true';
	}
}
