import { _x } from '@wordpress/i18n';

export const ALLOWED_FILE_EXTENSIONS = [ 'otf', 'ttf', 'woff', 'woff2' ];

export const FONT_WEIGHTS: Record< string, string > = {
	100: _x( 'Thin', 'font weight', 'zero-admin' ),
	200: _x( 'Extra-light', 'font weight', 'zero-admin' ),
	300: _x( 'Light', 'font weight', 'zero-admin' ),
	400: _x( 'Normal', 'font weight', 'zero-admin' ),
	500: _x( 'Medium', 'font weight', 'zero-admin' ),
	600: _x( 'Semi-bold', 'font weight', 'zero-admin' ),
	700: _x( 'Bold', 'font weight', 'zero-admin' ),
	800: _x( 'Extra-bold', 'font weight', 'zero-admin' ),
	900: _x( 'Black', 'font weight', 'zero-admin' ),
};

export const FONT_STYLES: Record< string, string > = {
	normal: _x( 'Normal', 'font style', 'zero-admin' ),
	italic: _x( 'Italic', 'font style', 'zero-admin' ),
};
