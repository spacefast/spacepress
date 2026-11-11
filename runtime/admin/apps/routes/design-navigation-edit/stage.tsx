import { Page } from '@first-admin/admin-toolkit';
import { withEditor, withStylesId } from '@first-admin/lazy-editor';
import { Spinner } from '@wordpress/components';
import type { Post } from '@wordpress/core-data';
import { store as coreStore } from '@wordpress/core-data';
import { useSelect } from '@wordpress/data';
import { decodeEntities } from '@wordpress/html-entities';
import { __ } from '@wordpress/i18n';
import { useParams } from '@wordpress/route';
import { Stack } from '@wordpress/ui';
import NavigationMenuEditor from './editor';

const NAVIGATION_POST_TYPE = 'wp_navigation';

const WrappedNavigationMenuEditor = withStylesId(
	withEditor( NavigationMenuEditor )
);

function NavigationEditStage() {
	const { id }: { id: string } = useParams( {
		from: '/design/navigation/edit/$id',
	} );
	const navigationId = parseInt( id );

	const navigationMenu = useSelect(
		( select ) => {
			const { getEntityRecord } = select( coreStore );
			const record = getEntityRecord< Post >(
				'postType',
				NAVIGATION_POST_TYPE,
				navigationId
			);

			return record;
		},
		[ navigationId ]
	);

	if ( ! navigationMenu ) {
		return;
	}

	const menuTitle =
		navigationMenu.title?.rendered || navigationMenu.title?.raw || '';

	return (
		<Page
			breadcrumbs={
				<Page.Breadcrumbs
					items={ [
						{
							label: __( 'Navigation', 'first-admin' ),
							to: '/design/navigation/list',
						},
						{
							label: decodeEntities( menuTitle ),
						},
					] }
				/>
			}
		>
			<WrappedNavigationMenuEditor
				id={ navigationId }
				loadingFallback={
					<Stack
						align="center"
						justify="center"
						style={ { height: '100%' } }
					>
						<Spinner />
					</Stack>
				}
			/>
		</Page>
	);
}

export default NavigationEditStage;
