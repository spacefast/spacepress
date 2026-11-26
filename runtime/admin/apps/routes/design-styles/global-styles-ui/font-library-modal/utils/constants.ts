import { _x } from '@wordpress/i18n';

export const ALLOWED_FILE_EXTENSIONS = [ 'otf', 'ttf', 'woff', 'woff2' ];

export const FONT_WEIGHTS: Record< string, string > = {
	100: _x( 'Thin', 'font weight', 'spacepress-admin' ),
	200: _x( 'Extra-light', 'font weight', 'spacepress-admin' ),
	300: _x( 'Light', 'font weight', 'spacepress-admin' ),
	400: _x( 'Normal', 'font weight', 'spacepress-admin' ),
	500: _x( 'Medium', 'font weight', 'spacepress-admin' ),
	600: _x( 'Semi-bold', 'font weight', 'spacepress-admin' ),
	700: _x( 'Bold', 'font weight', 'spacepress-admin' ),
	800: _x( 'Extra-bold', 'font weight', 'spacepress-admin' ),
	900: _x( 'Black', 'font weight', 'spacepress-admin' ),
};

export const FONT_STYLES: Record< string, string > = {
	normal: _x( 'Normal', 'font style', 'spacepress-admin' ),
	italic: _x( 'Italic', 'font style', 'spacepress-admin' ),
};
