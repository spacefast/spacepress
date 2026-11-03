import { store as coreStore } from '@wordpress/core-data';
import type { Theme } from '@wordpress/core-data';
import { __, sprintf } from '@wordpress/i18n';
import { useState } from '@wordpress/element';
import {
	__experimentalHStack as HStack,
	__experimentalText as Text,
	__experimentalVStack as VStack,
	Button,
} from '@wordpress/components';
import { useDispatch } from '@wordpress/data';
import { store as noticesStore } from '@wordpress/notices';
import { decodeEntities } from '@wordpress/html-entities';
import type { Action, RenderModalProps } from '@zero-admin/dataviews';
import type { WordPressError } from '../types';

const DeleteThemeModal = ( {
	items,
	closeModal,
}: RenderModalProps< Theme > ) => {
	const { deleteEntityRecord } = useDispatch( coreStore );
	const { createSuccessNotice, createErrorNotice } =
		useDispatch( noticesStore );
	const [ isBusy, setIsBusy ] = useState( false );

	const [ theme ] = items;
	const name = decodeEntities( theme?.name?.rendered || theme?.name?.raw );

	const deleteTheme = async () => {
		setIsBusy( true );

		try {
			await deleteEntityRecord(
				'root',
				'theme',
				theme.stylesheet,
				{},
				{ throwOnError: true }
			);

			await createSuccessNotice(
				sprintf(
					/* translators: %(name)s is the theme name */
					__( 'Theme %(name)s deleted.', 'zero-admin' ),
					{ name }
				),
				{
					type: 'snackbar',
					id: 'delete-theme-success-notice',
				}
			);
		} catch ( error: unknown ) {
			const wpError = error as WordPressError;
			const errorMessage =
				wpError.message || __( 'Unknown error occurred', 'zero-admin' );

			await createErrorNotice(
				sprintf(
					/* translators: name: The theme name. errorMessage: The error message. */
					__(
						'Theme %(name)s deletion failed: %(errorMessage)s',
						'zero-admin'
					),
					{
						name,
						errorMessage,
					}
				),
				{
					type: 'snackbar',
				}
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
					/* translators: %(name)s is the theme name */
					__(
						'Are you sure you want to delete the %(name)s theme?',
						'zero-admin'
					),
					{ name }
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
					{ __( 'Cancel', 'zero-admin' ) }
				</Button>
				<Button
					__next40pxDefaultSize
					variant="primary"
					onClick={ deleteTheme }
					isBusy={ isBusy }
					disabled={ isBusy }
					accessibleWhenDisabled
				>
					{ __( 'Delete', 'zero-admin' ) }
				</Button>
			</HStack>
		</VStack>
	);
};

const deleteTheme: Action< Theme > = {
	id: 'delete-theme',
	label: __( 'Delete', 'zero-admin' ),
	isPrimary: false,
	RenderModal: DeleteThemeModal,
	isEligible: ( item: Theme ) => {
		// @ts-expect-error useEntityRecordsWithPermissions return type does not include the permissions property yet
		return item.status !== 'active' && item.permissions.delete;
	},
};

export default deleteTheme;
