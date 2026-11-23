import { __, sprintf, _x } from '@wordpress/i18n';
import type { Field } from '@spacepress-admin/dataviews';
import type { MediaItem } from '../types';

const KB_IN_BYTES = 1024;
const MB_IN_BYTES = 1024 * KB_IN_BYTES;
const GB_IN_BYTES = 1024 * MB_IN_BYTES;
const TB_IN_BYTES = 1024 * GB_IN_BYTES;
const PB_IN_BYTES = 1024 * TB_IN_BYTES;
const EB_IN_BYTES = 1024 * PB_IN_BYTES;
const ZB_IN_BYTES = 1024 * EB_IN_BYTES;
const YB_IN_BYTES = 1024 * ZB_IN_BYTES;

function getBytesString(
	bytes: number,
	unitSymbol: string,
	decimals = 2
): string {
	return sprintf(
		// translators: 1: Actual bytes of a file. 2: The unit symbol (e.g. MB).
		_x( '%1$s %2$s', 'file size', 'spacepress-admin' ),
		bytes.toLocaleString( undefined, {
			minimumFractionDigits: 0,
			maximumFractionDigits: decimals,
		} ),
		unitSymbol
	);
}

/**
 * Converts bytes to a human-readable file size string with a specified number of decimal places.
 *
 * This logic is comparable to core's `size_format()` function.
 *
 * @param bytes    The size in bytes.
 * @param decimals The number of decimal places to include in the result.
 * @return         The human-readable file size string.
 */
function formatFileSize( bytes: number, decimals = 2 ): string {
	if ( bytes === 0 ) {
		return getBytesString(
			0,
			_x( 'B', 'unit symbol', 'spacepress-admin' ),
			decimals
		);
	}
	const quant = {
		/* translators: Unit symbol for yottabyte. */
		[ _x( 'YB', 'unit symbol', 'spacepress-admin' ) ]: YB_IN_BYTES,
		/* translators: Unit symbol for zettabyte. */
		[ _x( 'ZB', 'unit symbol', 'spacepress-admin' ) ]: ZB_IN_BYTES,
		/* translators: Unit symbol for exabyte. */
		[ _x( 'EB', 'unit symbol', 'spacepress-admin' ) ]: EB_IN_BYTES,
		/* translators: Unit symbol for petabyte. */
		[ _x( 'PB', 'unit symbol', 'spacepress-admin' ) ]: PB_IN_BYTES,
		/* translators: Unit symbol for terabyte. */
		[ _x( 'TB', 'unit symbol', 'spacepress-admin' ) ]: TB_IN_BYTES,
		/* translators: Unit symbol for gigabyte. */
		[ _x( 'GB', 'unit symbol', 'spacepress-admin' ) ]: GB_IN_BYTES,
		/* translators: Unit symbol for megabyte. */
		[ _x( 'MB', 'unit symbol', 'spacepress-admin' ) ]: MB_IN_BYTES,
		/* translators: Unit symbol for kilobyte. */
		[ _x( 'KB', 'unit symbol', 'spacepress-admin' ) ]: KB_IN_BYTES,
		/* translators: Unit symbol for byte. */
		[ _x( 'B', 'unit symbol', 'spacepress-admin' ) ]: 1,
	};

	for ( const [ unit, mag ] of Object.entries( quant ) ) {
		if ( bytes >= mag ) {
			return getBytesString( bytes / mag, unit, decimals );
		}
	}

	return ''; // Fallback in case no unit matches, though this should not happen.
}

export const fieldExtensions: Partial< Field< MediaItem > > = {
	getValue: ( { item }: { item: MediaItem } ) =>
		item?.media_details?.filesize
			? formatFileSize( item?.media_details?.filesize )
			: '',
	isVisible: ( item: MediaItem ) => {
		return !! item?.media_details?.filesize;
	},
};
