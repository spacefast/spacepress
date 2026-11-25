import {
	__experimentalHStack as HStack,
	__experimentalText as Text,
	__experimentalVStack as VStack,
	Button,
} from '@wordpress/components';
import { store as coreStore } from '@wordpress/core-data';
import type { Theme, UnstableBase } from '@wordpress/core-data';
import { useDispatch, useSelect } from '@wordpress/data';
import { useState } from '@wordpress/element';
import { decodeEntities } from '@wordpress/html-entities';
import { __, sprintf } from '@wordpress/i18n';
import { store as noticesStore } from '@wordpress/notices';
import type { Action, RenderModalProps } from '@spacepress-admin/dataviews';
import { setImmutably } from '../../design-styles/global-styles-ui/font-library-modal/utils/set-immutably';

const ActivateThemeModal = ( {
	items,
	closeModal,
}: RenderModalProps< Theme > ) => {
	const { saveEntityRecord } = useDispatch( coreStore );
	const { createSuccessNotice, createErrorNotice } =
		useDispatch( noticesStore );
	const { homeUrl } = useSelect( ( select ) => {
		const { getEntityRecord } = select( coreStore );
		const _base = getEntityRecord< UnstableBase >(
			'root',
			'__unstableBase'
		);

		return {
			homeUrl: _base?.home,
		};
	}, [] );
	const [ isBusy, setIsBusy ] = useState( false );

	const [ theme ] = items;
	const name = decodeEntities( theme.name?.rendered || theme?.name?.raw );

	const activateTheme = async () => {
		setIsBusy( true );

		try {
			await saveEntityRecord(
				'root',
				'theme',
				setImmutably( theme, 'status', 'active' ),
				{ throwOnError: true }
			);

			createSuccessNotice(
				sprintf(
					/* translators: %(name)s is the theme name */
					__( 'Theme %(name)s activated.', 'spacepress-admin' ),
					{ name }
				),
				{
					type: 'snackbar',
					id: 'activate-theme-success-notice',
					actions: [
						{
							label: __( 'Visit site', 'spacepress-admin' ),
							url: homeUrl,
							// @ts-expect-error variant is not a valid property for the actions object
							variant: 'link',
						},
					],
				}
			);
		} catch ( error: unknown ) {
			const errorMessage =
				error &&
				typeof error === 'object' &&
				'message' in error &&
				typeof error.message === 'string'
					? error.message
					: __( 'Unknown error occurred', 'spacepress-admin' );

			createErrorNotice(
				sprintf(
					/* translators: name: The theme name. errorMessage: The error message. */
					__(
						'Theme %(name)s activation failed: %(errorMessage)s',
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
					/* translators: %(name)s is the theme name */
					__(
						'Do you want to activate the %(name)s theme?',
						'spacepress-admin'
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
					{ __( 'Cancel', 'spacepress-admin' ) }
				</Button>
				<Button
					__next40pxDefaultSize
					variant="primary"
					onClick={ activateTheme }
					isBusy={ isBusy }
					disabled={ isBusy }
					accessibleWhenDisabled
				>
					{ __( 'Activate', 'spacepress-admin' ) }
				</Button>
			</HStack>
		</VStack>
	);
};

const activateTheme: Action< Theme > = {
	id: 'activate-theme',
	label: __( 'Activate', 'spacepress-admin' ),
	isPrimary: false, // TODO: should be true but that mandates icon yet and I haven't looked for one
	RenderModal: ActivateThemeModal,
	isEligible: ( item: Theme ) => {
		return item.status !== 'active' && item?.permissions?.update === true;
	},
};

export default activateTheme;
