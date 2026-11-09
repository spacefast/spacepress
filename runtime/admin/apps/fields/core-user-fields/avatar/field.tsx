import { __ } from '@wordpress/i18n';
import { BaseControl, Flex, Button } from '@wordpress/components';
import { useSelect } from '@wordpress/data';
import { store as coreStore, type User } from '@wordpress/core-data';
import { external } from '@wordpress/icons';
import type { Field } from '@first-admin/dataviews';

export const fieldExtensions: Partial< Field< User > > = {
	getValue: ( { item } ) => item.avatar_urls?.[ '48' ] || '',
	render: ( { item, field } ) => {
		// When field is readonly in a form, show larger avatar.
		// In list views, field.readOnly is typically false/undefined.
		const size = field.readOnly ? 56 : 32;

		if ( item.avatar_urls ) {
			return (
				<img
					className="core-user-avatar"
					src={
						item.avatar_urls?.[ '96' ] || item.avatar_urls?.[ '48' ]
					}
					alt={ item.name || item.username || item.slug }
					style={ {
						width: size,
						height: size,
						borderRadius: '50%',
					} }
				/>
			);
		}
		return null;
	},
	Edit: ( { data } ) => {
		const { currentUser } = useSelect( ( select ) => {
			const { getCurrentUser } = select( coreStore );
			return { currentUser: getCurrentUser() };
		}, [] );

		const isCurrentUser =
			currentUser?.id && data?.id && currentUser.id === data.id;

		return (
			<BaseControl
				id="avatar_url"
				help={
					isCurrentUser &&
					__(
						'Profile pictures are managed on Gravatar',
						'first-admin'
					)
				}
				__nextHasNoMarginBottom
			>
				<Flex align="center" justify="flex-start" gap={ 4 }>
					<img
						className="core-user-avatar"
						src={
							data.avatar_urls?.[ '96' ] ||
							data.avatar_urls?.[ '48' ]
						}
						alt={ data.name || data.username || data.slug }
						style={ {
							width: 56,
							height: 56,
							borderRadius: '50%',
						} }
					/>
					{ isCurrentUser && (
						<Button
							href="https://gravatar.com/"
							target="_blank"
							rel="noopener noreferrer"
							variant="secondary"
							size="compact"
							icon={ external }
							iconPosition="right"
						>
							{ __( 'Edit on Gravatar', 'first-admin' ) }
						</Button>
					) }
				</Flex>
			</BaseControl>
		);
	},
};
