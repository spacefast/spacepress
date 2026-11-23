import { useNavigate } from '@wordpress/route';
import { IconButton } from '@wordpress/ui';
import type { Form as FormType } from '@spacepress-admin/dataviews';
import { Page } from '@spacepress-admin/admin-toolkit';
import { seen } from '@wordpress/icons';
import { __ } from '@wordpress/i18n';
import { useSelect, useDispatch } from '@wordpress/data';
import { store as preferencesStore } from '@wordpress/preferences';
import Form from '../settings-reading/components/form';

const form: FormType = {
	layout: { type: 'regular', labelPosition: 'top' },
	fields: [ 'title', 'description', 'language' ],
};

function SettingsGeneral() {
	const navigate = useNavigate( { from: '/settings/general' } );
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
			title={ __( 'General settings', 'spacepress-admin' ) }
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
						navigate( { to: '/settings/general' } );
					} }
					size="compact"
				/>
			}
		>
			<Form form={ form } />
		</Page>
	);
}

export default SettingsGeneral;
