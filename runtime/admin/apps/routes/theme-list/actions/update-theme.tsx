import {
	__experimentalHStack as HStack,
	__experimentalText as Text,
	__experimentalVStack as VStack,
	Button,
} from '@wordpress/components';
import { store as coreStore } from '@wordpress/core-data';
import type { Theme } from '@wordpress/core-data';
import { useDispatch } from '@wordpress/data';
import { useState } from '@wordpress/element';
import { decodeEntities } from '@wordpress/html-entities';
import { __, sprintf } from '@wordpress/i18n';
import { store as noticesStore } from '@wordpress/notices';
import type { Action, RenderModalProps } from '@spacepress-admin/dataviews';
import { setImmutably } from '../../design-styles/global-styles-ui/font-library-modal/utils/set-immutably';
import type { WordPressError } from '../types';

const UpdateThemeModal = ( {
	items,
	closeModal,
}: RenderModalProps< Theme > ) => {
	const { saveEntityRecord } = useDispatch( coreStore );
	const { createSuccessNotice, createErrorNotice } =
		useDispatch( noticesStore );
	const [ isBusy, setIsBusy ] = useState( false );

	const [ theme ] = items;
	const name = decodeEntities( theme?.name?.rendered || theme?.name?.raw );

	const updateInfo = theme.update_info;
	const currentVersion = updateInfo.current_version;
	const newVersion = updateInfo.new_version ?? '';

	const updateTheme = async () => {
		setIsBusy( true );

		try {
			await saveEntityRecord(
				'root',
				'theme',
				setImmutably( theme, 'version', newVersion ),
				{ throwOnError: true }
			);

			await createSuccessNotice(
				sprintf(
					/* translators: %(name)s is the theme name, %(version)d is the theme version */
					__(
						'Theme %(name)s updated to version %(version)s.',
						'spacepress-admin'
					),
					{ name, version: newVersion }
				),
				{
					type: 'snackbar',
					id: 'update-theme-success-notice',
				}
			);
		} catch ( error: unknown ) {
			const wpError = error as WordPressError;
			const errorMessage =
				wpError.message || __( 'Unknown error occurred', 'spacepress-admin' );

			await createErrorNotice(
				sprintf(
					/* translators: name: The theme name. errorMessage: The error message. */
					__(
						'Theme %(name)s update failed: %(errorMessage)s',
						'spacepress-admin'
					),
					{ name, errorMessage }
				),
				{ type: 'snackbar' }
			);
		} finally {
			setIsBusy( false );
			closeModal?.();
		}
	};

	return (
		<VStack>
			<Text>
				{ sprintf(
					/* translators: name is the theme name, currentVersion is the current theme version, newVersion is the new theme version */
					__(
						'Do you want to update the %(name)s theme from version %(currentVersion)s to version %(newVersion)s?',
						'spacepress-admin'
					),
					{ name, currentVersion, newVersion }
				) }
			</Text>
			<HStack justify="right">
				<Button
					__next40pxDefaultSize
					variant="tertiary"
					onClick={ closeModal }
					disabled={ isBusy }
					accessibleWhenDisabled
				>
					{ __( 'Cancel', 'spacepress-admin' ) }
				</Button>
				<Button
					__next40pxDefaultSize
					variant="primary"
					onClick={ updateTheme }
					isBusy={ isBusy }
					disabled={ isBusy }
					accessibleWhenDisabled
				>
					{ __( 'Update', 'spacepress-admin' ) }
				</Button>
			</HStack>
		</VStack>
	);
};

const updateTheme: Action< Theme > = {
	id: 'update-theme',
	label: __( 'Update', 'spacepress-admin' ),
	isPrimary: false,
	RenderModal: UpdateThemeModal,
	isEligible: ( item: Theme ) => {
		return item.update_info?.has_update === true;
	},
};

export default updateTheme;
