import { __ } from '@wordpress/i18n';
import { useSelect } from '@wordpress/data';
import { store as coreStore } from '@wordpress/core-data';
import { UserEditContent } from '../user-profile/stage';

function Profile() {
	const { currentUser } = useSelect( ( select ) => {
		const { getCurrentUser } = select( coreStore );
		return {
			currentUser: getCurrentUser(),
		};
	}, [] );

	if ( ! currentUser?.id ) {
		return null;
	}

	return (
		<UserEditContent
			userId={ currentUser.id }
			breadcrumbs={ [ { label: __( 'Profile', 'first-admin' ) } ] }
			showBadges={ false }
		/>
	);
}

export default Profile;
