import { __, sprintf } from '@wordpress/i18n';
import { Card, Text } from '@wordpress/ui';
// eslint-disable-next-line @zero-admin/design-system/use-new-components
import { Stack } from '@zero-admin/design-system';
import { Page, RouterLink } from '@zero-admin/admin-toolkit';
import { readableCollections } from '@zero-admin/schema';
import { useZeroContext } from '@zero-admin/zero-client';
import './style.scss';

/**
 * The overview: one tile per collection the viewer may read, from the schema the page handed in.
 * The permits come from the runtime's own access evaluation; a collection whose rule denies the
 * viewer outright has no tile.
 */
export default function CollectionsOverview() {
	const { schema, permits } = useZeroContext();
	if ( ! schema ) {
		return (
			<Page title={ __( 'Collections', 'zero-admin' ) }>
				<Text>{ __( 'No Zero app is active on this site.', 'zero-admin' ) }</Text>
			</Page>
		);
	}
	const names = readableCollections( schema, permits );
	return (
		<Page title={ __( 'Collections', 'zero-admin' ) } subTitle={ sprintf( /* translators: %s: the app name */ __( 'The %s app', 'zero-admin' ), schema.name ) }>
			{ names.length === 0 ? (
				<Text data-testid="zero-admin-no-collections">{ __( 'There is nothing here you can read.', 'zero-admin' ) }</Text>
			) : (
				<div className="zero-admin-collections-overview" data-testid="zero-admin-collections">
					{ names.map( ( name ) => {
						const collection = schema.collections[ name ];
						const columns = Object.keys( collection.columns ).length;
						return (
							<Card.Root key={ name } data-testid={ `zero-admin-collection-${ name }` }>
								<Card.Content>
									<Stack direction="column" gap={ 2 }>
										<RouterLink to={ `/collections/${ encodeURIComponent( name ) }` }>
											<Text variant="heading-md">{ collection.label }</Text>
										</RouterLink>
										<Text variant="body-sm">
											{ collection.wp
												? sprintf( /* translators: %d: number of columns */ __( '%d columns, stored as posts', 'zero-admin' ), columns )
												: sprintf( /* translators: %d: number of columns */ __( '%d columns, stored in a table', 'zero-admin' ), columns ) }
										</Text>
									</Stack>
								</Card.Content>
							</Card.Root>
						);
					} ) }
				</div>
			) }
		</Page>
	);
}
