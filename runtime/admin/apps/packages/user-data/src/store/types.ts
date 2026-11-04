export interface State {
	// Create invite state
	isCreatingInvite: boolean;
	createInviteError: string | null;

	// Delete invite state
	isDeletingInvites: boolean;
	deleteInvitesError: string | null;
	deletingInviteKeys: string[];
}
