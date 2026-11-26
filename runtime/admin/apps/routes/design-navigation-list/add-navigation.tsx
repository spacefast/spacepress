import { useNavigate } from '@wordpress/route';
import { useState } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import { store as coreStore } from '@wordpress/core-data';
import { store as noticesStore } from '@wordpress/notices';
import { useDispatch } from '@wordpress/data';
import { Button } from '@wordpress/ui';
// eslint-disable-next-line @spacepress-admin/design-system/use-new-components -- See: ARC-1359
import { Stack, InputControl } from '@spacepress-admin/design-system';
import { Modal } from '@wordpress/components';

const NAVIGATION_POST_TYPE = 'wp_navigation';

export const AddNavigationModal = ( {
	closeModal,
}: {
	closeModal?: () => void;
} ) => {
	const [ menuTitle, setMenuTitle ] = useState( '' );
	const [ isBusy, setIsBusy ] = useState( false );
	const navigate = useNavigate();

	const { saveEntityRecord } = useDispatch( coreStore );
	const { createSuccessNotice, createErrorNotice } =
		useDispatch( noticesStore );

	const handleConfirmAdd = async () => {
		if ( ! menuTitle || ! menuTitle.trim() ) {
			return;
		}

		const trimmedTitle = menuTitle.trim();
		setIsBusy( true );

		try {
			const savedRecord = await saveEntityRecord(
				'postType',
				NAVIGATION_POST_TYPE,
				{
					title: trimmedTitle,
					status: 'publish',
				},
				{
					throwOnError: true,
				}
			);

			if ( savedRecord ) {
				createSuccessNotice(
					__( 'Navigation menu created successfully.', 'spacepress-admin' ),
					{
						type: 'snackbar',
					}
				);

				// Navigate to the newly created navigation menu
				navigate( {
					to: `/types/${ NAVIGATION_POST_TYPE }/edit/${ encodeURIComponent(
						savedRecord.id
					) }`,
				} );
			}
		} catch ( error ) {
			const errorMessage =
				error instanceof Error ? error.message : 'Unknown error';
			createErrorNotice(
				sprintf(
					/* translators: %s: error message describing why the navigation menu could not be created. */
					__( 'Unable to create navigation menu: %s', 'spacepress-admin' ),
					errorMessage
				),
				{
					type: 'snackbar',
				}
			);
		}

		setIsBusy( false );
		closeModal?.();
	};

	return (
		<Modal
			title={ __( 'Add New Navigation Menu', 'spacepress-admin' ) }
			onRequestClose={ () => closeModal?.() }
			focusOnMount="firstContentElement"
			size="small"
		>
			<Stack direction="column" gap={ 4 }>
				<form
					onSubmit={ ( event ) => {
						event.preventDefault();
						handleConfirmAdd();
					} }
				>
					<Stack direction="column" gap={ 4 }>
						<InputControl
							autoComplete="off"
							value={ menuTitle }
							onValueChange={ setMenuTitle }
							label={ __( 'Name', 'spacepress-admin' ) }
							placeholder={ __(
								'Enter menu name',
								'spacepress-admin'
							) }
							disabled={ isBusy }
						/>
						<Stack direction="row" justify="right" gap={ 2 }>
							<Button
								variant="minimal"
								onClick={ closeModal }
								disabled={ isBusy }
								focusableWhenDisabled
							>
								{ __( 'Cancel', 'spacepress-admin' ) }
							</Button>
							<Button
								variant="solid"
								type="submit"
								aria-busy={ isBusy }
								disabled={ isBusy || ! menuTitle?.trim() }
								focusableWhenDisabled
							>
								{ __( 'Create Menu', 'spacepress-admin' ) }
							</Button>
						</Stack>
					</Stack>
				</form>
			</Stack>
		</Modal>
	);
};
