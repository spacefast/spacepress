import { dispatch } from '@wordpress/data';
import { store as spAdminStore } from './store';
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
	void dispatch( spAdminStore ).updateMenuItem( id, changes );
}

export function unregisterSiteHubHelpMenuItem( id: string ): void {
	void dispatch( spAdminStore ).unregisterSiteHubHelpMenuItem( id );
}

export function setNudges( nudges: Nudge[] ): void {
	void dispatch( spAdminStore ).setNudges( nudges );
}

export function registerDashboardNotice( notice: DashboardNoticeConfig ): void {
	void dispatch( spAdminStore ).registerDashboardNotice( notice );
}

export function unregisterDashboardNotice( id: string ): void {
	void dispatch( spAdminStore ).unregisterDashboardNotice( id );
}

export function updateDashboardNotice(
	id: string,
	changes: Partial< DashboardNoticeConfig >
): void {
	void dispatch( spAdminStore ).updateDashboardNotice( id, changes );
}

export function registerModal( modal: RegisteredModal ): void {
	void dispatch( spAdminStore ).registerModal( modal );
}

export function unregisterModal( id: string ): void {
	void dispatch( spAdminStore ).unregisterModal( id );
}

export function setDashboardContext(
	context: Partial< DashboardContext >
): void {
	void dispatch( spAdminStore ).setDashboardContext( context );
}
