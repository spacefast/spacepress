import { Page, useExperiments } from '@first-admin/admin-toolkit';
import {
	ToggleControl,
	Notice,
	__experimentalItemGroup as ItemGroup,
	__experimentalItem as Item,
} from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { experiments } from './experiments';

function SettingsExperiments() {
	const { enabledExperiments, setExperimentEnabled } = useExperiments();

	return (
		<Page title={ __( 'Experiments', 'first-admin' ) }>
			<div style={ { marginBottom: '24px' } }>
				<Notice status="warning" isDismissible={ false }>
					{ __(
						'Experimental features are early implementations that may change or be removed. Use with caution in production environments.',
						'first-admin'
					) }
				</Notice>
			</div>
			<ItemGroup>
				{ experiments.map( ( experiment ) => (
					<Item key={ experiment.slug }>
						<ToggleControl
							__nextHasNoMarginBottom
							label={ experiment.name }
							help={ experiment.description }
							checked={
								enabledExperiments[ experiment.slug ] || false
							}
							onChange={ ( checked ) =>
								setExperimentEnabled( experiment.slug, checked )
							}
						/>
					</Item>
				) ) }
			</ItemGroup>
		</Page>
	);
}

export default SettingsExperiments;
