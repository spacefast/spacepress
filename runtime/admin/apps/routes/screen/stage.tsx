import { useParams } from '@wordpress/route';
import { Page } from '@spacepress-admin/admin-toolkit';
import { ScreenBody } from '@spacepress-admin/screens';

/** SpacePress Admin's host for a declared screen (runtime/admin/lib/screens.php). */
export default function Stage() {
	const { id } = useParams( { from: '/screens/$id' } ) as { id: string };
	return (
		<ScreenBody
			id={ id }
			host="spacepress-admin"
			frame={ ( screen, body ) => (
				<Page title={ screen?.title ?? '' } subTitle={ screen?.description || undefined }>
					<div className="spacepress-admin-screen-page">{ body }</div>
				</Page>
			) }
		/>
	);
}
