// Basic HTML sanitizer to mitigate XSS when using dangerouslySetInnerHTML
// - Removes scriptable and embedded elements (script, iframe, object, embed)
// - Strips event handler attributes (on*)
// - Normalizes/blocks dangerous URL protocols in href/src/xlink:href
export function sanitizeHtml( html: string ): string {
	try {
		const parser = new DOMParser();
		const doc = parser.parseFromString( html, 'text/html' );

		// Remove dangerous elements entirely
		const blockedTags = [ 'script', 'iframe', 'object', 'embed' ];
		for ( const tag of blockedTags ) {
			const nodes = Array.from( doc.getElementsByTagName( tag ) );
			nodes.forEach( ( node ) => node.remove() );
		}

		// Walk all elements and sanitize attributes
		const walker = doc.createTreeWalker(
			doc.body,
			NodeFilter.SHOW_ELEMENT
		);
		const safeUrlProtocols = [
			'http:',
			'https:',
			'mailto:',
			'tel:',
			'ftp:',
		];
		const urlAttrs = new Set( [ 'href', 'src', 'xlink:href' ] );
		while ( walker.nextNode() ) {
			const el = walker.currentNode as HTMLElement;
			// Copy attribute names to avoid live list issues
			const attrNames = Array.from( el.attributes ).map(
				( a ) => a.name
			);
			for ( const name of attrNames ) {
				// Remove event handlers (on*)
				if ( /^on/i.test( name ) ) {
					el.removeAttribute( name );
					continue;
				}
				// Sanitize URL-bearing attributes
				if ( urlAttrs.has( name.toLowerCase() ) ) {
					const value = el.getAttribute( name ) || '';
					// Trim and lowercase protocol for checking
					const trimmed = value.trim();
					// Handle relative URLs (no protocol) as safe by default
					const hasProtocol = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(
						trimmed
					);
					if ( hasProtocol ) {
						try {
							const url = new URL( trimmed, document.baseURI );
							if ( ! safeUrlProtocols.includes( url.protocol ) ) {
								el.removeAttribute( name );
							}
						} catch {
							// Invalid URL — remove
							el.removeAttribute( name );
						}
					}
				}
			}
		}

		return doc.body.innerHTML;
	} catch {
		// On any failure, fall back to empty string to avoid unsafe rendering
		return '';
	}
}

// Create human-readable time difference like WordPress human_time_diff
// but using Intl.RelativeTimeFormat for pluralization/localization.
export function humanTimeDiff( from: string, to: Date = new Date() ): string {
	const dateRegex = /(\d{4})-(\d{2})-(\d{2}) (\d{1,2}):(\d{2})(am|pm) GMT/i;

	const match = from.match( dateRegex );
	if ( ! match ) {
		throw new Error( 'Invalid date string' );
	}

	const [ , year, month, day, hour, minute, ampm ] = match;

	let parsedHour = Number( hour );
	if ( ampm.toLowerCase() === 'pm' && parsedHour !== 12 ) {
		parsedHour += 12;
	} else if ( ampm.toLowerCase() === 'am' && parsedHour === 12 ) {
		parsedHour = 0;
	}

	const fromDate = new Date(
		Date.UTC(
			Number( year ),
			Number( month ) - 1,
			Number( day ),
			parsedHour,
			Number( minute )
		)
	);

	const diffInSeconds = Math.floor(
		( to.getTime() - fromDate.getTime() ) / 1000
	);

	// Pick the largest unit to display.
	const units: [ Intl.RelativeTimeFormatUnit, number ][] = [
		[ 'year', 60 * 60 * 24 * 365 ],
		[ 'month', 60 * 60 * 24 * 30 ],
		[ 'week', 60 * 60 * 24 * 7 ],
		[ 'day', 60 * 60 * 24 ],
		[ 'hour', 60 * 60 ],
		[ 'minute', 60 ],
		[ 'second', 1 ],
	];

	const timeFormatter = new Intl.RelativeTimeFormat( 'en', {
		numeric: 'auto',
	} );

	for ( const [ unit, secondsInUnit ] of units ) {
		const value = Math.floor( diffInSeconds / secondsInUnit );
		if ( Math.abs( value ) >= 1 ) {
			// We want "x units ago", so negative value.
			return timeFormatter.format( -value, unit );
		}
	}

	return timeFormatter.format( -1, 'second' );
}

export function formatActiveInstalls( n?: number ): string | undefined {
	if ( n === undefined || n === null ) {
		return undefined;
	}

	return `${ new Intl.NumberFormat().format( n ) }+`;
}
