import { __, sprintf } from '@wordpress/i18n';
import { EmptyState } from '@typedpress-admin/design-system';

interface UserListEmptyStateProps {
	slug: string;
}

export function UserListEmptyState( { slug }: UserListEmptyStateProps ) {
	let title: string;
	let description: string;

	if ( slug === 'all' ) {
		title = __( 'No users', 'typedpress-admin' );
		description = __( 'Any users will appear here.', 'typedpress-admin' );
	} else {
		// Get translatable role name
		const getRoleName = ( role: string ) => {
			switch ( role ) {
				case 'administrator':
					return __( 'administrator', 'typedpress-admin' );
				case 'shop_manager':
					return __( 'store manager', 'typedpress-admin' );
				case 'customer':
					return __( 'customer', 'typedpress-admin' );
				case 'subscriber':
					return __( 'subscriber', 'typedpress-admin' );
				case 'contributor':
					return __( 'contributor', 'typedpress-admin' );
				case 'author':
					return __( 'author', 'typedpress-admin' );
				case 'editor':
					return __( 'editor', 'typedpress-admin' );
				default:
					// Fallback for custom roles
					return role.replace( /_/g, ' ' );
			}
		};

		const roleName = getRoleName( slug );
		title = sprintf(
			/* translators: %s: role name (e.g., administrator, shop manager) */
			__( 'No %s', 'typedpress-admin' ),
			roleName
		);
		description = sprintf(
			/* translators: %s: role name (e.g., administrator, shop manager) */
			__( 'Any users with the %s role will appear here.', 'typedpress-admin' ),
			roleName
		);
	}

	return (
		<EmptyState.Root className="user-list-empty-state">
			<EmptyState.Visual>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					width="48"
					height="49"
					viewBox="0 0 48 49"
					fill="none"
				>
					<g>
						<path
							d="M24.0267 4C11.8622 4 2 13.8622 2 26.0267C2 38.1911 11.8622 48.0533 24.0267 48.0533C36.1911 48.0533 46.0533 38.1911 46.0533 26.0267C46.0533 13.8622 36.1933 4 24.0267 4Z"
							fill="#F0F0F0"
						/>
						<path
							d="M28.6423 15.2778C25.6712 12.729 21.1978 13.069 18.6489 16.0401C16.1001 19.0112 16.4401 23.4845 19.4112 26.0334C22.3823 28.5823 26.8556 28.2423 29.4045 25.2712C31.9534 22.3001 31.6134 17.8267 28.6423 15.2778Z"
							fill="#E0E0E0"
						/>
						<path
							d="M24.0266 29.7734C29.0689 29.7734 35.9644 31.3157 35.9644 37.7668C35.9644 38.6957 35.9644 41.7423 35.9644 44.5401C32.5244 46.7623 28.4266 48.0534 24.0266 48.0534C19.6266 48.0534 15.5289 46.7623 12.0889 44.5401C12.0889 41.8201 12.0889 38.8357 12.0889 37.7668C12.0889 31.3179 18.9844 29.7734 24.0266 29.7734Z"
							fill="#E0E0E0"
						/>
					</g>
				</svg>
			</EmptyState.Visual>
			<EmptyState.Title>{ title }</EmptyState.Title>
			<EmptyState.Description>{ description }</EmptyState.Description>
		</EmptyState.Root>
	);
}
