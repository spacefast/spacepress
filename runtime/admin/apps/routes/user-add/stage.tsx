import { Page } from '@zero-admin/admin-toolkit';
import { useViewConfig } from '@zero-admin/views';
import { useFieldCollections } from '@zero-admin/core-data-next';
import { Button } from '@wordpress/ui';
import { __ } from '@wordpress/i18n';
import { useSelect } from '@wordpress/data';
import { store as coreStore } from '@wordpress/core-data';
import {
	Notice,
	__experimentalGrid as Grid,
	__experimentalVStack as VStack,
} from '@wordpress/components';
import { useNavigate } from '@wordpress/route';
import { useEffect, useMemo } from '@wordpress/element';
import { DataForm, useFormValidity } from '@zero-admin/dataviews';
import type { Field, Form } from '@zero-admin/dataviews';
import type { User } from '@wordpress/core-data';
import { useTrack } from '@zero-admin/telemetry';
import { useAddUserForm } from '../user/hooks';
import { isInInviteMode } from '../user/utils';
import type { UserViewConfigData } from '../user/types';
import './style.scss';

const completeUserForm = {
	type: 'regular' as const,
	labelPosition: 'top' as const,
	fields: [
		'username',
		'email',
		'first_name',
		'last_name',
		'url',
		'password',
		'confirm_password',
		'roles',
	],
};

function Content() {
	const navigate = useNavigate();
	const fields = useFieldCollections( 'root', 'user' );
	const viewConfig = useViewConfig( 'root', 'user' );
	const { addForm } = viewConfig;

	// Check if we're in invite mode or regular user creation mode
	const isInviteModeEnabled = isInInviteMode(
		// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- PHP-added custom properties on ViewConfig
		viewConfig.viewConfig as UserViewConfigData
	);

	// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call -- useTrack is a WP Module that loses type resolution in strict mode
	const track = useTrack();
	const trackLabel = isInviteModeEnabled ? 'send_invite' : 'save';

	const callbacks = useMemo(
		() => ( {
			// eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- WP Module loses type info
			onError: ( error: unknown ) =>
				track.buttonError( trackLabel, error ),
		} ),
		[ track, trackLabel ]
	);

	const {
		data,
		isDirty,
		isSaving,
		errorMessage,
		saveButtonLabel,
		handleOnChange,
		handleSubmit,
		isSuccess,
	} = useAddUserForm( isInviteModeEnabled, callbacks );

	// Redirect after successful creation
	useEffect( () => {
		if ( isSuccess && ! isDirty ) {
			void navigate( { to: '/users/list/all' } );
		}
	}, [ isSuccess, isDirty, navigate ] );

	const formConfig = ( addForm || completeUserForm ) as Form;
	const typedFields = ( fields ?? [] ) as Field<
		Partial< User > | undefined
	>[];
	const { validity, isValid } = useFormValidity(
		data,
		typedFields,
		formConfig
	);

	const { canCreateUsers } = useSelect( ( select ) => {
		const { canUser } = select( coreStore );
		return {
			canCreateUsers: canUser( 'create', {
				kind: 'root',
				name: 'user',
			} ),
		};
	}, [] );

	if ( ! fields ) {
		return null;
	}

	return (
		<Page
			className="woocommerce-user-add-page"
			breadcrumbs={
				<Page.Breadcrumbs
					items={ [
						{
							label: __( 'Users', 'zero-admin' ),
							to: '/users/list/all',
						},
						{
							label: isInviteModeEnabled
								? __( 'Invite user', 'zero-admin' )
								: __( 'Add user', 'zero-admin' ),
						},
					] }
				/>
			}
			hasPadding={ true }
			hasBorder={ true }
			contentWidth={ 'constrained' }
			actions={
				<Button
					variant="solid"
					size="compact"
					onClick={ () => {
						// eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- WP Module loses type info
						track.buttonClick( trackLabel );
						void handleSubmit();
					} }
					disabled={ ! isDirty || isSaving || ! isValid }
				>
					{ saveButtonLabel }
				</Button>
			}
		>
			{ canCreateUsers ? (
				<Grid
					columns={ 3 }
					gap={ 8 }
					justify="center"
					templateColumns="600px"
				>
					<VStack spacing={ 8 }>
						<DataForm
							data={ data }
							fields={ typedFields }
							form={ formConfig }
							onChange={ handleOnChange }
							validity={ validity }
						/>

						{ errorMessage && (
							<Notice status="error" isDismissible={ false }>
								{ errorMessage }
							</Notice>
						) }
					</VStack>
				</Grid>
			) : (
				<div>
					{ __(
						'Sorry, you are not allowed to create users.',
						'zero-admin'
					) }
				</div>
			) }
		</Page>
	);
}

export default Content;
