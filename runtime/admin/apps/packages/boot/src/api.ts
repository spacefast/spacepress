import { dispatch } from '@wordpress/data';
import { store as firstAdminStore } from './store';
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
	void dispatch( firstAdminStore ).updateMenuItem( id, changes );
}

export function unregisterSiteHubHelpMenuItem( id: string ): void {
	void dispatch( firstAdminStore ).unregisterSiteHubHelpMenuItem( id );
}

export function setNudges( nudges: Nudge[] ): void {
	void dispatch( firstAdminStore ).setNudges( nudges );
}

export function registerDashboardNotice( notice: DashboardNoticeConfig ): void {
	void dispatch( firstAdminStore ).registerDashboardNotice( notice );
}

export function unregisterDashboardNotice( id: string ): void {
	void dispatch( firstAdminStore ).unregisterDashboardNotice( id );
}

export function updateDashboardNotice(
	id: string,
	changes: Partial< DashboardNoticeConfig >
): void {
	void dispatch( firstAdminStore ).updateDashboardNotice( id, changes );
}

export function registerModal( modal: RegisteredModal ): void {
	void dispatch( firstAdminStore ).registerModal( modal );
}

export function unregisterModal( id: string ): void {
	void dispatch( firstAdminStore ).unregisterModal( id );
}

export function setDashboardContext(
	context: Partial< DashboardContext >
): void {
	void dispatch( firstAdminStore ).setDashboardContext( context );
}
