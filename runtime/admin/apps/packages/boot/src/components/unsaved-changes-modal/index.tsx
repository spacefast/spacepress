/**
 * External dependencies
 */
import {
	type DirtyEntityRecord,
	getNoticeFromSettledResults,
	saveDirtyEntitiesSettled,
	unlock,
	useEntityValidity,
} from '@spacepress-admin/admin-toolkit';
import { Button, Icon } from '@wordpress/ui';
import { Dialog } from '@spacepress-admin/design-system';
import { store as coreStore } from '@wordpress/core-data';
import { useDispatch, useRegistry, useSelect } from '@wordpress/data';
import { doAction } from '@wordpress/hooks';
import { __ } from '@wordpress/i18n';
import { error as errorIcon } from '@wordpress/icons';
import { store as noticesStore } from '@wordpress/notices';
import { privateApis } from '@wordpress/route';
import { useEffect, useRef, useState } from 'react';

type RouteLocation = {
	pathname: string;
};

type RouteBlocker = {
	status: string;
	proceed: () => void;
	reset?: () => void;
};

type RouteSubscription = {
	subscribe: ( event: 'onResolved', callback: () => void ) => () => void;
};

type RoutePrivateApis = {
	useBlocker: ( options: {
		shouldBlockFn: ( args: {
			current: RouteLocation;
			next: RouteLocation;
		} ) => boolean;
		withResolver: boolean;
		enableBeforeUnload: boolean;
	} ) => RouteBlocker | void;
	useRouter: () => RouteSubscription;
};

type UnsavedChangesCoreSelect = {
	__experimentalGetDirtyEntityRecords: () => DirtyEntityRecord[];
	isSavingEntityRecord: (
		kind: string,
		name: string,
		key: number | string | undefined
	) => boolean;
};

function getRoutePrivateApis(): RoutePrivateApis {
	return unlock( privateApis ) as unknown as RoutePrivateApis;
}

const { useBlocker, useRouter } = getRoutePrivateApis();

function getErrorMessage( error: unknown ): string {
	if (
		typeof error === 'object' &&
		error !== null &&
		'message' in error &&
		typeof error.message === 'string'
	) {
		return error.message;
	}

	return __( 'Unable to save changes.', 'spacepress-admin' );
}

export default function UnsavedChangesModal() {
	const router = useRouter();
	const registry = useRegistry();
	const { isEntityValid: entityValid, documentChanges } = useEntityValidity();
	const isEntityValid = entityValid && (documentChanges?.valid ?? true);
	const { clearEntityRecordEdits } = useDispatch( coreStore );
	const { createErrorNotice } = useDispatch( noticesStore );
	const { entityRecords, isSaving } = useSelect< {
		entityRecords: DirtyEntityRecord[];
		isSaving: boolean;
	} >( ( select ) => {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- WordPress core-data does not expose typed selectors for dirty entity access.
		const coreSelect = select(
			coreStore
		) as unknown as UnsavedChangesCoreSelect;
		const dirtyEntityRecords =
			coreSelect.__experimentalGetDirtyEntityRecords();

		return {
			entityRecords: dirtyEntityRecords,
			isSaving: dirtyEntityRecords.some( ( record ) =>
				coreSelect.isSavingEntityRecord(
					record.kind,
					record.name,
					record.key
				)
			),
		};
	}, [] );
	const [ isPendingSave, setIsPendingSave ] = useState( false );
	const isPendingSaveRef = useRef( false );
	const shouldClearOnNavigationRef = useRef( false );
	const recordsToClearRef = useRef< DirtyEntityRecord[] >( entityRecords );
	const hasUnsavedChanges = entityRecords.length > 0 || Boolean(documentChanges?.dirty) || !isEntityValid;
	const changesRef = useRef(hasUnsavedChanges);
	changesRef.current = hasUnsavedChanges;
	const isSaveInFlight = isPendingSave || isSaving || Boolean(documentChanges?.saving);
	const blocker = useBlocker( {
		shouldBlockFn: ( { current, next } ) =>
			changesRef.current && current.pathname !== next.pathname,
		withResolver: true,
		enableBeforeUnload: hasUnsavedChanges,
	} ) ?? {
		status: 'idle',
		proceed: () => undefined,
	};

	useEffect( () => {
		const unsubscribe = router.subscribe( 'onResolved', () => {
			if ( ! shouldClearOnNavigationRef.current ) {
				return;
			}

			for ( const entityRecord of recordsToClearRef.current ) {
				if ( entityRecord.key === undefined ) {
					continue;
				}

				void clearEntityRecordEdits(
					entityRecord.kind,
					entityRecord.name,
					entityRecord.key
				);
			}

			shouldClearOnNavigationRef.current = false;
			recordsToClearRef.current = [];
		} );

		return () => {
			unsubscribe();
		};
	}, [ clearEntityRecordEdits, router ] );

	const modalTitle = isEntityValid
		? __( 'Save changes before leaving?', 'spacepress-admin' )
		: __( 'Fix errors before leaving?', 'spacepress-admin' );

	const modalDescription = isEntityValid
		? __(
				'You have unsaved changes. Choose whether to save or discard them before continuing.',
				'spacepress-admin'
		  )
		: __(
				'Some fields need attention before you can save your changes. Continue editing or discard changes.',
				'spacepress-admin'
		  );

	const discardLabel = __( 'Discard changes', 'spacepress-admin' );

	const primaryActionLabel = isEntityValid
		? __( 'Save changes', 'spacepress-admin' )
		: __( 'Continue editing', 'spacepress-admin' );

	const closeDialog = () => {
		shouldClearOnNavigationRef.current = false;
		recordsToClearRef.current = [];
		if ( typeof blocker.reset === 'function' ) {
			blocker.reset();
		}
	};

	return blocker.status === 'blocked' ? (
		<Dialog.Root
			open
			title={ modalTitle }
			onOpenChange={ ( open ) => {
				if ( ! open ) {
					closeDialog();
				}
			} }
		>
			<Dialog.Popup>
				<Dialog.Header>
					<Dialog.Heading />
					<Dialog.CloseIcon />
				</Dialog.Header>
				<p>{ modalDescription }</p>
				<Dialog.Footer>
					<Button
						variant="minimal"
						tone="neutral"
						disabled={ isSaveInFlight }
						onClick={ () => {
							shouldClearOnNavigationRef.current = true;
							recordsToClearRef.current = [ ...entityRecords ];
							// @fires spAdmin.unsavedChangesDiscarded
							doAction( 'spAdmin.unsavedChangesDiscarded' );
							void blocker.proceed();
						} }
					>
						{ discardLabel }
					</Button>
					<Button
						loading={ isEntityValid && isSaveInFlight }
						disabled={ isSaveInFlight }
						loadingAnnouncement={ __(
							'Saving changes',
							'spacepress-admin'
						) }
						onClick={ async () => {
							if ( ! isEntityValid ) {
								closeDialog();
								return;
							}

							if ( isPendingSaveRef.current ) {
								return;
							}

							isPendingSaveRef.current = true;
							setIsPendingSave( true );

							shouldClearOnNavigationRef.current = false;
							recordsToClearRef.current = [];
							try {
								const results = await saveDirtyEntitiesSettled(
									{
										registry,
										dirtyEntityRecords: entityRecords,
									}
								);
								if (documentChanges?.dirty) {
									results.push(...await Promise.allSettled([documentChanges.save()]));
								}

								if (
									results.every(
										( result ) =>
											result.status === 'fulfilled'
									)
								) {
									void blocker.proceed();
									return;
								}

								const notice = getNoticeFromSettledResults( {
									results,
									messages: {
										error: __(
											'Failed to save changes. Please try again.',
											'spacepress-admin'
										),
										success: () => '',
									},
								} );

								if ( notice.kind === 'error' ) {
									void createErrorNotice( notice.message, {
										icon: <Icon icon={ errorIcon } />,
										type: 'snackbar',
										id: 'spacepress-admin-unsaved-changes-save-error',
									} );
								}
							} catch ( error: unknown ) {
								void createErrorNotice(
									getErrorMessage( error ),
									{
										icon: <Icon icon={ errorIcon } />,
										type: 'snackbar',
										id: 'spacepress-admin-unsaved-changes-save-error',
									}
								);
							} finally {
								isPendingSaveRef.current = false;
								setIsPendingSave( false );
							}
						} }
					>
						{ primaryActionLabel }
					</Button>
				</Dialog.Footer>
			</Dialog.Popup>
		</Dialog.Root>
	) : null;
}
