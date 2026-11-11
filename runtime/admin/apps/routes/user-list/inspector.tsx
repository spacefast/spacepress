import { Link, useSearch } from '@wordpress/route';
import { store as coreDataNextStore } from '@first-admin/core-data-next';
import { Page } from '@first-admin/admin-toolkit';
import { __ } from '@wordpress/i18n';
import { IconButton } from '@wordpress/ui';
import { close } from '@wordpress/icons';
import { useSelect } from '@wordpress/data';
import { useMemo } from '@wordpress/element';
import Form from './form';

export default function Inspector() {
	const searchParams = useSearch( { from: '/users/list/$slug' } );

	const viewConfig = useSelect( ( select ) => {
		const { getEntityViewConfig } = select( coreDataNextStore );
		return getEntityViewConfig( 'root', 'user' );
	}, [] );

	const userForm = useMemo( () => {
		return viewConfig?.quick_edit_form;
	}, [ viewConfig?.quick_edit_form ] );

	if ( ! searchParams.userIds || searchParams.userIds.length !== 1 ) {
		return null;
	}

	// If quick_edit_form is null, don't show the inspector
	if ( ! userForm ) {
		return null;
	}

	const removeEdit = ( search: Record< string, unknown > ) => ( {
		...search,
		edit: undefined,
	} );

	return (
		<Page
			title={ __( 'Quick Edit', 'first-admin' ) }
			actions={
				<IconButton
					variant="minimal"
					tone="neutral"
					label={ __( 'Close inspector', 'first-admin' ) }
					icon={ close }
					size="compact"
					render={
						<Link to="/users/list/$slug" search={ removeEdit } />
					}
				/>
			}
			showSidebarToggle={ false }
		>
			<Form userId={ searchParams.userIds[ 0 ] } form={ userForm } />
		</Page>
	);
}
