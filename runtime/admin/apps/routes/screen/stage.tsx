import { useParams } from '@wordpress/route';
import { Page } from '@typedpress-admin/admin-toolkit';
import { ScreenBody } from '@typedpress-admin/screens';

/** TypedPress Admin's host for a declared screen (runtime/admin/lib/screens.php). */
export default function Stage() {
	const { id } = useParams( { from: '/screens/$id' } ) as { id: string };
	return (
		<ScreenBody
			id={ id }
			host="typedpress-admin"
			frame={ ( screen, body ) => (
				<Page title={ screen?.title ?? '' } subTitle={ screen?.description || undefined }>
					<div className="typedpress-admin-screen-page">{ body }</div>
				</Page>
			) }
		/>
	);
}
