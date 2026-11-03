import { dispatch } from '@wordpress/data';
import { store as zeroAdminStore } from './store';
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
	void dispatch( zeroAdminStore ).updateMenuItem( id, changes );
}

export function unregisterSiteHubHelpMenuItem( id: string ): void {
	void dispatch( zeroAdminStore ).unregisterSiteHubHelpMenuItem( id );
}

export function setNudges( nudges: Nudge[] ): void {
	void dispatch( zeroAdminStore ).setNudges( nudges );
}

export function registerDashboardNotice( notice: DashboardNoticeConfig ): void {
	void dispatch( zeroAdminStore ).registerDashboardNotice( notice );
}

export function unregisterDashboardNotice( id: string ): void {
	void dispatch( zeroAdminStore ).unregisterDashboardNotice( id );
}

export function updateDashboardNotice(
	id: string,
	changes: Partial< DashboardNoticeConfig >
): void {
	void dispatch( zeroAdminStore ).updateDashboardNotice( id, changes );
}

export function registerModal( modal: RegisteredModal ): void {
	void dispatch( zeroAdminStore ).registerModal( modal );
}

export function unregisterModal( id: string ): void {
	void dispatch( zeroAdminStore ).unregisterModal( id );
}

export function setDashboardContext(
	context: Partial< DashboardContext >
): void {
	void dispatch( zeroAdminStore ).setDashboardContext( context );
}
