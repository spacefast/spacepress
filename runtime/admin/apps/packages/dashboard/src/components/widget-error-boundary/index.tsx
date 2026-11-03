import { Component, type ReactNode } from 'react';
import { WidgetError } from '../widget-error';
import type { WidgetErrorConfig } from '../../types';

interface Props {
	children: ReactNode;
	errorConfig?: WidgetErrorConfig | true | null;
	onError: () => void;
}

interface State {
	hasCaughtError: boolean;
}

/**
 * Error boundary component for dashboard widgets.
 * Handles both:
 * - Unexpected render errors (caught internally)
 * - External error state (passed via errorConfig prop)
 *
 * Renders WidgetError when either error condition is true.
 */
export class WidgetErrorBoundary extends Component< Props, State > {
	constructor( props: Props ) {
		super( props );
		this.state = { hasCaughtError: false };
	}

	static getDerivedStateFromError(): State {
		return { hasCaughtError: true };
	}

	componentDidCatch( error: Error, errorInfo: React.ErrorInfo ) {
		// eslint-disable-next-line no-console
		console.error( 'Widget render error:', error, errorInfo );

		try {
			this.props.onError();
		} catch ( callbackError ) {
			// eslint-disable-next-line no-console
			console.error( 'Error in onError callback:', callbackError );
		}
	}

	render() {
		const { errorConfig } = this.props;
		const hasError =
			this.state.hasCaughtError ||
			errorConfig === true ||
			( errorConfig !== null && errorConfig !== undefined );

		if ( hasError ) {
			// Use provided config, or empty object for default message when true
			const config =
				errorConfig === true || ! errorConfig ? {} : errorConfig;
			return <WidgetError { ...config } />;
		}
		return this.props.children;
	}
}
