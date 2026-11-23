import { useNavigate } from '@wordpress/route';
import { Page } from '@spacepress-admin/admin-toolkit';
import { IconButton } from '@wordpress/ui';
import type { Form as FormType } from '@spacepress-admin/dataviews';
import { seen } from '@wordpress/icons';
import { __ } from '@wordpress/i18n';
import { useSelect, useDispatch } from '@wordpress/data';
import { store as preferencesStore } from '@wordpress/preferences';
import Form from './components/form';

const form: FormType = {
	layout: {
		type: 'regular',
		labelPosition: 'top',
	},
	fields: [ 'show_on_front', 'page_on_front', 'page_for_posts' ],
};

function SettingsReading() {
	const navigate = useNavigate( { from: '/settings/reading' } );
	const { set } = useDispatch( preferencesStore );
	const showCanvas =
		useSelect(
			( select ) =>
				select( preferencesStore ).get(
					'core/settings-route',
					'showCanvas'
				),
			[]
		) ?? true;

	return (
		<Page
			title={ __( 'Reading settings', 'spacepress-admin' ) }
			actions={
				<IconButton
					aria-pressed={ showCanvas }
					tone="neutral"
					variant="minimal"
					icon={ seen }
					label={ __( 'Preview', 'spacepress-admin' ) }
					onClick={ async () => {
						await set(
							'core/settings-route',
							'showCanvas',
							! showCanvas
						);
						// Refresh to trigger the canvas function.
						navigate( { to: '/settings/reading' } );
					} }
					size="compact"
				/>
			}
		>
			<Form form={ form } />
		</Page>
	);
}

export default SettingsReading;
