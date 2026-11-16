import { _x } from '@wordpress/i18n';

export const ALLOWED_FILE_EXTENSIONS = [ 'otf', 'ttf', 'woff', 'woff2' ];

export const FONT_WEIGHTS: Record< string, string > = {
	100: _x( 'Thin', 'font weight', 'typedpress-admin' ),
	200: _x( 'Extra-light', 'font weight', 'typedpress-admin' ),
	300: _x( 'Light', 'font weight', 'typedpress-admin' ),
	400: _x( 'Normal', 'font weight', 'typedpress-admin' ),
	500: _x( 'Medium', 'font weight', 'typedpress-admin' ),
	600: _x( 'Semi-bold', 'font weight', 'typedpress-admin' ),
	700: _x( 'Bold', 'font weight', 'typedpress-admin' ),
	800: _x( 'Extra-bold', 'font weight', 'typedpress-admin' ),
	900: _x( 'Black', 'font weight', 'typedpress-admin' ),
};

export const FONT_STYLES: Record< string, string > = {
	normal: _x( 'Normal', 'font style', 'typedpress-admin' ),
	italic: _x( 'Italic', 'font style', 'typedpress-admin' ),
};
