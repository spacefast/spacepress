import { dispatch } from '@wordpress/data';
import { store as zeroAdminStore } from './store';
import type {
	FlatMenuItem,
	Nudge,
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
