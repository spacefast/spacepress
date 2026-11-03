import { useViewConfig } from '@zero-admin/views';
import { useMemo } from '@wordpress/element';
import { __, _n, sprintf } from '@wordpress/i18n';
import { trash } from '@wordpress/icons';
import { store as coreStore } from '@wordpress/core-data';
import { store as noticesStore } from '@wordpress/notices';
import { dispatch } from '@wordpress/data';
import type { Term } from '@wordpress/core-data';
import type { Action } from '@zero-admin/dataviews';
import {
	createConfirmModal,
	getNoticeFromSettledResults,
} from '@zero-admin/admin-toolkit';
import type { TermWithPermissions } from '../types';

const deleteTermEntities = async ( items: Term[] ) => {
	return Promise.allSettled(
		items.map( ( term ) =>
			dispatch( coreStore ).deleteEntityRecord(
				'taxonomy',
				term.taxonomy,
				term.id,
				{ force: true },
				{ throwOnError: true }
			)
		)
	);
};

const permanentlyDeleteTerms = async ( items: Term[] ) => {
	if ( items.length === 0 ) {
		return;
	}

	const promiseResult = await deleteTermEntities( items );
	const { createSuccessNotice, createErrorNotice } = dispatch( noticesStore );
	const notice = getNoticeFromSettledResults( {
		results: promiseResult,
		messages: {
			success: ( count ) =>
				sprintf(
					/* translators: %1$s: The terms' names. %2$d: The number of terms. */
					_n(
						'"%1$s" has been permanently deleted.',
						'%2$d terms have been permanently deleted.',
						count,
						'zero-admin'
					),
					items[ 0 ].name,
					count
				),
			error: ( count ) =>
				sprintf(
					/* translators: %d: The number of terms. */
					_n(
						'An error occurred while permanently deleting %d term.',
						'An error occurred while permanently deleting %d terms.',
						count,
						'zero-admin'
					),
					count
				),
		},
	} );

	if ( notice.kind === 'success' ) {
		void createSuccessNotice( notice.message, {
			type: 'snackbar',
			id: 'permanently-delete-term-action',
		} );
		return;
	}

	void createErrorNotice( notice.message, {
		type: 'snackbar',
		id: 'permanently-delete-term-error',
	} );
};

// Copied and adapted from Gutenberg
// packages/fields/src/actions/permanently-delete-post.tsx
export function useDeleteTermAction( taxonomy: string ): Action< Term > | null {
	const { actions } = useViewConfig( 'taxonomy', taxonomy );
	const isEnabled = actions.includes( 'delete' );

	const confirmModalConfig = createConfirmModal< Term >( {
		modalHeader: ( items ) =>
			_n( 'Delete term', 'Delete terms', items.length, 'zero-admin' ),
		intent: 'delete-permanently',
		onSubmit: async ( items, setIsLoading ) => {
			setIsLoading( true );
			await permanentlyDeleteTerms( items );
		},
		message: ( items ) =>
			items.length === 1
				? sprintf(
						// translators: %s: The taxonomy's name.
						__(
							'"%s" will be permanently deleted and can’t be restored. Items using this term won’t be affected.',
							'zero-admin'
						),
						items[ 0 ].name
				  )
				: sprintf(
						// translators: %d: The number of taxonomies (2 or more).
						__(
							'%d terms will be permanently deleted and can’t be restored. Items using this term won’t be affected.',
							'zero-admin'
						),
						items.length
				  ),
	} );

	return useMemo( () => {
		if ( ! isEnabled ) {
			return null;
		}

		return {
			id: 'delete-term',
			label: __( 'Delete', 'zero-admin' ),
			isPrimary: false,
			icon: trash,
			supportsBulk: true,
			isEligible( item: Term | TermWithPermissions ) {
				if ( 'permissions' in item ) {
					return item.permissions?.delete ?? false;
				}
				return false;
			},
			...confirmModalConfig,
		};
	}, [ isEnabled, confirmModalConfig ] );
}
