/**
 * A Zero problem document (RFC 9457 as the runtime emits it) or a core REST error, as one shape the
 * screens can show inline: the status, Zero's `code`, the message, and the field a `pointer` names.
 */
export interface Problem {
	status: number;
	code: string;
	message: string;
	/** `/salary` → `salary`; nested pointers keep their path. */
	field: string | null;
}

export function problemOf( error: unknown ): Problem {
	const e = ( error ?? {} ) as Record< string, unknown >;
	const data = ( e.data ?? {} ) as Record< string, unknown >;
	const status = numberOf( e.status ) ?? numberOf( data.status ) ?? 0;
	const pointer = stringOf( e.pointer ) ?? stringOf( data.pointer );
	return {
		status,
		code: stringOf( e.code ) ?? 'error',
		message: stringOf( e.detail ) ?? stringOf( e.message ) ?? stringOf( e.title ) ?? 'The request failed',
		field: pointer ? pointer.replace( /^\//, '' ) : null,
	};
}

function numberOf( value: unknown ): number | null {
	return typeof value === 'number' && Number.isFinite( value ) ? value : null;
}
function stringOf( value: unknown ): string | null {
	return typeof value === 'string' && value !== '' ? value : null;
}
