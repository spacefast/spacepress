import { dispatch } from '@wordpress/data';
import { store as tpAdminStore } from './store';
import type {
	FlatMenuItem,
	Nudge,
	DashboardNoticeConfig,
	DashboardContext,
	RegisteredModal,
} from './store/types';

export function updateMenuItem(
	id: string,
	changes: Partial< FlatMenuItem >
): void {
	void dispatch( tpAdminStore ).updateMenuItem( id, changes );
}

export function unregisterSiteHubHelpMenuItem( id: string ): void {
	void dispatch( tpAdminStore ).unregisterSiteHubHelpMenuItem( id );
}

export function setNudges( nudges: Nudge[] ): void {
	void dispatch( tpAdminStore ).setNudges( nudges );
}

export function registerDashboardNotice( notice: DashboardNoticeConfig ): void {
	void dispatch( tpAdminStore ).registerDashboardNotice( notice );
}

export function unregisterDashboardNotice( id: string ): void {
	void dispatch( tpAdminStore ).unregisterDashboardNotice( id );
}

export function updateDashboardNotice(
	id: string,
	changes: Partial< DashboardNoticeConfig >
): void {
	void dispatch( tpAdminStore ).updateDashboardNotice( id, changes );
}

export function registerModal( modal: RegisteredModal ): void {
	void dispatch( tpAdminStore ).registerModal( modal );
}

export function unregisterModal( id: string ): void {
	void dispatch( tpAdminStore ).unregisterModal( id );
}

export function setDashboardContext(
	context: Partial< DashboardContext >
): void {
	void dispatch( tpAdminStore ).setDashboardContext( context );
}
