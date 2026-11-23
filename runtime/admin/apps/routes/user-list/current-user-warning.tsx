import { __, sprintf } from '@wordpress/i18n';
import { privateApis as componentsPrivateApis } from '@wordpress/components';
import { useSelect } from '@wordpress/data';
import { store as coreStore } from '@wordpress/core-data';
import { unlock } from '@spacepress-admin/admin-toolkit';
import { useSearch } from '@wordpress/route';

const { Badge } = unlock( componentsPrivateApis );

interface CurrentUserWarningProps {
	actionType: 'delete' | 'update-role';
}

export function CurrentUserWarning( { actionType }: CurrentUserWarningProps ) {
	const searchParams = useSearch( { from: '/users/list/$slug' } );
	const userIds = searchParams.userIds;

	const currentUser = useSelect(
		( select ) => select( coreStore ).getCurrentUser(),
		[]
	);

	const isCurrentUserSelected =
		currentUser?.id && userIds?.includes( currentUser.id );

	if ( ! isCurrentUserSelected ) {
		return null;
	}

	const getWarningMessage = () => {
		switch ( actionType ) {
			case 'delete':
				return sprintf(
					/* translators: %1$s is the user ID, %2$s is the username */
					__(
						"You can't delete your own account (%1$s).",
						'spacepress-admin'
					),
					currentUser.slug
				);
			case 'update-role':
				return sprintf(
					/* translators: %1$s is the user ID, %2$s is the username */
					__(
						"This action won't apply to your own account (%1$s).",
						'spacepress-admin'
					),
					currentUser.slug
				);
			default:
				return '';
		}
	};

	return <Badge intent="info">{ getWarningMessage() }</Badge>;
}
