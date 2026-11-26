import { store as coreStore } from '@wordpress/core-data';
import type { Theme } from '@wordpress/core-data';
import { useDispatch, useSelect } from '@wordpress/data';
import { decodeEntities } from '@wordpress/html-entities';
import { __, sprintf } from '@wordpress/i18n';
import { store as noticesStore } from '@wordpress/notices';
import { setImmutably } from '../../design-styles/global-styles-ui/font-library-modal/utils/set-immutably';
import type { WordPressError } from '../types';

export enum ThemeAction {
	AutoUpdatesEnabled,
	AutoUpdatesDisabled,
	Updated,
}

/**
 * Map the updated path/value to a constrained action string for notices.
 * Falls back to ThemeAction.Updated for unrecognized paths.
 *
 * @param path  The property path that was updated (e.g., ['status'] or ['auto_update']).
 * @param value The value being set at the given path.
 */
export function resolveThemeAction(
	path: string[],
	value: unknown
): ThemeAction {
	if ( path.toString() === [ 'auto_updates', 'enabled' ].toString() ) {
		return value === true
			? ThemeAction.AutoUpdatesEnabled
			: ThemeAction.AutoUpdatesDisabled;
	}

	return ThemeAction.Updated;
}

export const useThemeService = () => {
	const { saveEntityRecord } = useDispatch( coreStore );
	const { createSuccessNotice, createErrorNotice } =
		useDispatch( noticesStore );

	const editTheme = async ( theme: Theme, path: string[], value: any ) => {
		const action = resolveThemeAction( path, value );
		const name = decodeEntities(
			theme?.name?.rendered || theme?.name?.raw
		);

		try {
			saveEntityRecord(
				'root',
				'theme',
				setImmutably( theme, path, value ),
				{ throwOnError: true }
			);

			let successMessage: string;
			switch ( action ) {
				case ThemeAction.AutoUpdatesEnabled:
					successMessage = sprintf(
						// translators: %(name)s is the theme name.
						__( 'Auto-updates enabled on %(name)s.', 'spacepress-admin' ),
						{ name }
					);
					break;

				case ThemeAction.AutoUpdatesDisabled:
					successMessage = sprintf(
						// translators: %(name)s is the theme name.
						__(
							'Auto-updates disabled on %(name)s.',
							'spacepress-admin'
						),
						{ name }
					);
					break;

				default:
					successMessage = sprintf(
						// translators: %(name)s is the theme name.
						__( '%(name)s updated.', 'spacepress-admin' ),
						{ name }
					);
					break;
			}

			await createSuccessNotice( successMessage, {
				type: 'snackbar',
				id: 'theme-service-notice',
			} );
		} catch ( error: unknown ) {
			const wpError = error as WordPressError;
			const errorText =
				wpError.message || __( 'Unknown error occurred', 'spacepress-admin' );

			let errorMessage: string;
			switch ( action ) {
				case ThemeAction.AutoUpdatesEnabled:
					errorMessage = sprintf(
						// translators: %(name)s is the theme name. errorText: The error message.
						__(
							'Failed to enable auto-updates on %(name)s: %(errorText)s',
							'spacepress-admin'
						),
						{ name, errorText }
					);
					break;

				case ThemeAction.AutoUpdatesDisabled:
					errorMessage = sprintf(
						// translators: %(name)s is the theme name. errorText: The error message.
						__(
							'Failed to disable auto-updates on %(name)s: %(errorText)s',
							'spacepress-admin'
						),
						{ name, errorText }
					);
					break;

				default:
					errorMessage = sprintf(
						// translators: %(name)s is the theme name. errorText: The error message.
						__(
							'Failed to edit %(name)s: %(errorText)s',
							'spacepress-admin'
						),
						{ name, errorText }
					);
					break;
			}

			await createErrorNotice( errorMessage, {
				type: 'snackbar',
			} );
		}
	};

	const useIsSavingTheme = ( theme: Theme ) => {
		return useSelect(
			( select ) => {
				return select( coreStore ).isSavingEntityRecord(
					'root',
					'theme',
					theme.stylesheet
				);
			},
			[ theme.stylesheet ]
		);
	};

	return {
		editTheme,
		useIsSavingTheme,
	};
};
