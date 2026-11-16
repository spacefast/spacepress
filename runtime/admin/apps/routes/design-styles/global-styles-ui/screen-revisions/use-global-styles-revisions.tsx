import type { GlobalStylesConfig } from '@typedpress-admin/global-styles-engine';
import { useSelect } from '@wordpress/data';
import {
	store as coreStore,
	type GlobalStylesRevision,
} from '@wordpress/core-data';
import { useContext, useMemo } from '@wordpress/element';
import { GlobalStylesContext } from '../context';

interface User {
	id: number;
	name: string;
	avatar_urls: Record< string, string >;
}

interface Revision extends GlobalStylesConfig {
	id: string | number;
	author?: number | User;
	modified?: string | Date;
	isLatest?: boolean;
	_links?: any;
}

interface Query {
	per_page?: number;
	page?: number;
}

interface UseGlobalStylesRevisionsParams {
	query?: Query;
}

interface UseGlobalStylesRevisionsReturn {
	revisions: Revision[];
	hasUnsavedChanges: boolean;
	isLoading: boolean;
	revisionsCount: number;
}

const SITE_EDITOR_AUTHORS_QUERY = {
	per_page: -1,
	_fields: 'id,name,avatar_urls',
	context: 'view',
	capabilities: [ 'edit_theme_options' ],
};
const DEFAULT_QUERY = { per_page: 100, page: 1 };
const EMPTY_ARRAY: Revision[] = [];

export default function useGlobalStylesRevisions( {
	query,
}: UseGlobalStylesRevisionsParams = {} ): UseGlobalStylesRevisionsReturn {
	const { user: userConfig } = useContext( GlobalStylesContext );
	const _query: Query = useMemo(
		() => ( { ...DEFAULT_QUERY, ...query } ),
		[ query ]
	);
	const {
		authors,
		currentUser,
		isDirty,
		revisions,
		isLoadingGlobalStylesRevisions,
		revisionsCount,
	} = useSelect(
		( select ) => {
			const {
				__experimentalGetDirtyEntityRecords,
				getCurrentUser,
				getUsers,
				getRevisions,
				__experimentalGetCurrentGlobalStylesId,
				getEntityRecord,
				isResolving,
			} = select( coreStore );
			const dirtyEntityRecords =
				__experimentalGetDirtyEntityRecords() || [];
			const _currentUser = getCurrentUser();
			const _isDirty = dirtyEntityRecords.length > 0;
			const globalStylesId = __experimentalGetCurrentGlobalStylesId();
			const globalStyles = globalStylesId
				? getEntityRecord< GlobalStylesRevision >(
						'root',
						'globalStyles',
						globalStylesId
				  )
				: undefined;
			const _revisionsCount: number =
				// @ts-expect-error - _links is not typed
				globalStyles?._links?.[ 'version-history' ]?.[ 0 ]?.count ?? 0;
			const globalStylesRevisions =
				getRevisions(
					'root',
					'globalStyles',
					globalStylesId,
					_query
				) || EMPTY_ARRAY;
			const _authors = getUsers( SITE_EDITOR_AUTHORS_QUERY ) || [];
			const _isResolving = isResolving( 'getRevisions', [
				'root',
				'globalStyles',
				globalStylesId,
				_query,
			] );
			return {
				authors: _authors,
				currentUser: _currentUser,
				isDirty: _isDirty,
				revisions: globalStylesRevisions as Revision[],
				isLoadingGlobalStylesRevisions: _isResolving,
				revisionsCount: _revisionsCount,
			};
		},
		[ _query ]
	);
	return useMemo( (): UseGlobalStylesRevisionsReturn => {
		if ( ! authors.length || isLoadingGlobalStylesRevisions ) {
			return {
				revisions: EMPTY_ARRAY,
				hasUnsavedChanges: isDirty,
				isLoading: true,
				revisionsCount,
			};
		}

		// Adds author details to each revision.
		// @ts-expect-error - author is not typed
		const _modifiedRevisions: Revision[] = revisions.map( ( revision ) => {
			return {
				...revision,
				author: authors.find(
					( author ) => author.id === revision.author
				),
			};
		} );

		const fetchedRevisionsCount = revisions.length;

		if ( fetchedRevisionsCount ) {
			// Flags the most current saved revision.
			if (
				_modifiedRevisions[ 0 ].id !== 'unsaved' &&
				_query.page === 1
			) {
				_modifiedRevisions[ 0 ].isLatest = true;
			}

			// Adds an item for unsaved changes.
			if (
				isDirty &&
				userConfig &&
				Object.keys( userConfig ).length > 0 &&
				currentUser &&
				_query.page === 1
			) {
				const unsavedRevision: Revision = {
					id: 'unsaved',
					styles: userConfig?.styles,
					settings: userConfig?.settings,
					_links: userConfig?._links,
					author: {
						id: currentUser?.id || 0,
						name: currentUser?.name || '',
						// @ts-expect-error - avatar_urls is not typed
						avatar_urls: currentUser?.avatar_urls || {},
					},
					modified: new Date(),
				};

				_modifiedRevisions.unshift( unsavedRevision );
			}

			if (
				_query.per_page &&
				_query.page === Math.ceil( revisionsCount / _query.per_page )
			) {
				// Adds an item for the default theme styles.
				_modifiedRevisions.push( {
					id: 'parent',
					styles: {},
					settings: {},
				} );
			}
		}

		return {
			revisions: _modifiedRevisions,
			hasUnsavedChanges: isDirty,
			isLoading: false,
			revisionsCount,
		};
	}, [
		isDirty,
		revisions,
		currentUser,
		authors,
		userConfig,
		isLoadingGlobalStylesRevisions,
		revisionsCount,
		_query.page,
		_query.per_page,
	] );
}
