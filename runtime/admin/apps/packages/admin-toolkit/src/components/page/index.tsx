import clsx from 'clsx';
import { useEffect } from '@wordpress/element';
import { useRegistry } from '@wordpress/data';
import Header from './header';
import NavigableRegion from '../navigable-region';
import { SidebarToggleFill } from './sidebar-toggle-slot';
import './style.scss';
import Breadcrumbs from '../breadcrumbs';
import SaveButton, { type SaveButtonProps } from '../save-button';
import PageActions, { type PageActionConfig } from '../page-actions';
import {
	registerBeforeSaveHandler,
	type BeforeSaveHandler,
} from '../../utils/save-dirty-entities';

type EntityActions< Entity > = {
	entity: Entity | null | undefined;
	actions: PageActionConfig< Entity >[];
};

type PageProps< Entity > = {
	breadcrumbs?: React.ReactNode;
	badges?: React.ReactNode;
	title?: React.ReactNode;
	subTitle?: React.ReactNode;
	children: React.ReactNode;
	className?: string;
	actions?: React.ReactNode;
	entityActions?: EntityActions< Entity >;
	tabs?: React.ReactNode;
	hasPadding?: boolean;
	hasBorder?: boolean;
	contentWidth?: 'default' | 'full' | 'constrained';
	showSidebarToggle?: boolean;
	saveButton?: SaveButtonProps & {
		isVisible?: boolean;
		beforeSave?: BeforeSaveHandler;
	};
};

function Page< Entity = unknown >( {
	breadcrumbs,
	badges,
	title,
	subTitle,
	children,
	className,
	actions,
	entityActions,
	tabs,
	hasPadding = true,
	hasBorder = false,
	contentWidth = 'default',
	showSidebarToggle = true,
	saveButton,
}: PageProps< Entity > ) {
	const classes = clsx( 'zero-admin-page', className );
	const registry = useRegistry();

	useEffect( () => {
		if ( ! saveButton?.beforeSave ) {
			return;
		}

		return registerBeforeSaveHandler( registry, saveButton.beforeSave );
	}, [ registry, saveButton?.beforeSave ] );

	return (
		<NavigableRegion className={ classes } ariaLabel={ title }>
			{ ( title || breadcrumbs || badges ) && (
				<Header
					breadcrumbs={ breadcrumbs }
					badges={ badges }
					title={ title }
					subTitle={ subTitle }
					actions={
						<>
							{ saveButton?.isVisible && (
								<SaveButton
									isDisabled={ saveButton?.isDisabled }
									onSave={ saveButton?.onSave }
									onError={ saveButton?.onError }
									label={ saveButton?.label }
								/>
							) }
							{ actions }
							{ entityActions && (
								<PageActions
									item={ entityActions.entity }
									actions={ entityActions.actions }
								/>
							) }
						</>
					}
					tabs={ tabs }
					showSidebarToggle={ showSidebarToggle }
				/>
			) }
			<div
				className={ clsx( 'zero-admin-page__content', {
					'has-padding': hasPadding,
					'has-border': hasBorder,
					'is-constrained': contentWidth === 'constrained',
				} ) }
			>
				{ children }
			</div>
		</NavigableRegion>
	);
}

Page.SidebarToggleFill = SidebarToggleFill;
Page.Breadcrumbs = Breadcrumbs;

export default Page;
