type MessageTemplate = string | ( ( count: number ) => string );

type SettledNoticeMessages = {
	success: MessageTemplate;
	error: MessageTemplate;
};

type GetSettledNoticeOptions = {
	results: PromiseSettledResult< unknown >[];
	messages: SettledNoticeMessages;
};

type SettledPromiseNotice = {
	kind: 'success' | 'error';
	message: string;
	successCount: number;
	errorCount: number;
};

function resolveCountMessage( message: MessageTemplate, count: number ) {
	if ( typeof message === 'function' ) {
		return message( count );
	}

	return message;
}

function extractBackendErrorMessage( reason: unknown ) {
	if ( ! reason || typeof reason !== 'object' ) {
		return undefined;
	}

	const typedReason = reason as {
		message?: string;
		data?: {
			message?: string;
		};
	};

	if ( typedReason.message ) {
		return typedReason.message;
	}

	return typedReason.data?.message;
}

function getBackendErrorMessage( results: PromiseSettledResult< unknown >[] ) {
	const messages = new Set< string >();

	for ( const result of results ) {
		if ( result.status !== 'rejected' ) {
			continue;
		}

		const backendMessage = extractBackendErrorMessage( result.reason );
		if ( backendMessage ) {
			messages.add( backendMessage );
		}
	}

	if ( messages.size === 0 ) {
		return undefined;
	}

	if ( messages.size === 1 ) {
		return [ ...messages ][ 0 ];
	}

	return [ ...messages ].join( ', ' );
}

export default function getNoticeFromSettledResults( {
	results,
	messages,
}: GetSettledNoticeOptions ): SettledPromiseNotice {
	const successCount = results.filter(
		( result ) => result.status === 'fulfilled'
	).length;
	const errorCount = results.length - successCount;

	const isSuccess = errorCount === 0;

	if ( isSuccess ) {
		return {
			kind: 'success',
			message: resolveCountMessage( messages.success, successCount ),
			successCount,
			errorCount,
		};
	}

	return {
		kind: 'error',
		message:
			getBackendErrorMessage( results ) ??
			resolveCountMessage( messages.error, errorCount ),
		successCount,
		errorCount,
	};
}

export type {
	GetSettledNoticeOptions,
	MessageTemplate,
	SettledPromiseNotice,
	SettledNoticeMessages,
};
