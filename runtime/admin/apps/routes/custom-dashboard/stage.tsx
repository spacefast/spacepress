import { useCallback, useMemo, useState } from 'react';
import { Button, Notice } from '@wordpress/components';
import { useDispatch, useSelect } from '@wordpress/data';
import { __ } from '@wordpress/i18n';
import { store as preferencesStore } from '@wordpress/preferences';
import { useParams } from '@wordpress/route';
import { Page, RouterLink } from '@spacepress-admin/admin-toolkit';
import {
	store as spAdminStore,
	type StoreSelectors,
} from '@spacepress-admin/boot';
import {
	Dashboard,
	type DashboardWidget,
} from '@spacepress-admin/dashboard';
import { useSpacePressWidgetTypes } from '@spacepress-admin/widgets';

export default function CustomDashboardStage() {
	const { id } = useParams( { from: '/dashboards/$id' } ) as { id: string };
	const [ resetKey, setResetKey ] = useState( 0 );

	const { registeredWidgetTypes, dashboardContext } = useSelect(
		( select ) => {
			const selectors = select( spAdminStore ) as StoreSelectors;
			return {
				registeredWidgetTypes: selectors.getDashboardWidgetTypes(),
				dashboardContext: selectors.getDashboardContext(),
			};
		},
		[]
	);

	const dashboard = useMemo(
		() => dashboardContext?.dashboards?.find( ( d ) => d.id === id ),
		[ dashboardContext, id ]
	);

	const prefKey = `spDashboardLayout:${ id }`;
	const storedLayout = useSelect(
		( select ) =>
			select( preferencesStore ).get( 'core/admin', prefKey ) as
				| DashboardWidget< unknown >[]
				| undefined,
		[ prefKey ]
	);
	const { set } = useDispatch( preferencesStore );

	const widgetTypes = useSpacePressWidgetTypes(
		registeredWidgetTypes,
		dashboardContext?.declarative_widgets ?? [],
		dashboardContext
	);

	const defaultLayout = useMemo< DashboardWidget< unknown >[] >(
		() => dashboard?.widgets ?? [],
		[ dashboard ]
	);

	const layout = storedLayout ?? defaultLayout;

	const onChange = useCallback(
		( next: DashboardWidget< unknown >[] ) => {
			void set( 'core/admin', prefKey, next );
		},
		[ set, prefKey ]
	);

	const onReset = useCallback( () => {
		void set( 'core/admin', prefKey, defaultLayout );
		setResetKey( ( k ) => k + 1 );
	}, [ set, prefKey, defaultLayout ] );

	if ( ! dashboard ) {
		return (
			<Page title={ __( 'Dashboard not found', 'spacepress-admin' ) }>
				<Notice status="warning" isDismissible={ false }>
					{ __(
						'This dashboard is unavailable or you do not have permission to view it.',
						'spacepress-admin'
					) }
				</Notice>
				<p>
					<RouterLink to="/">
						{ __( 'Back to Home', 'spacepress-admin' ) }
					</RouterLink>
				</p>
			</Page>
		);
	}

	return (
		<Dashboard
			key={ `${ id }-${ resetKey }` }
			layout={ layout }
			onChange={ onChange }
			widgetTypes={ widgetTypes }
		>
			<Page
				title={ dashboard.title }
				subTitle={ dashboard.description || undefined }
				hasBorder={ true }
				actions={
					<>
						<Dashboard.Actions />
						<Button variant="tertiary" size="compact" onClick={ onReset }>
							{ __( 'Restore defaults', 'spacepress-admin' ) }
						</Button>
					</>
				}
			>
				<Dashboard.Widgets />
			</Page>
		</Dashboard>
	);
}
