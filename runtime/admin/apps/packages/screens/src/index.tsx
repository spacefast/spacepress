import { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import apiFetch from '@wordpress/api-fetch';
import { Button, Modal, Notice, Spinner } from '@wordpress/components';
import {
	DataForm,
	type Action,
	type Field,
	type View,
} from '@spacepress-admin/dataviews';
import { DataViews, useView } from '@spacepress-admin/views';
import {
	actionInput,
	display,
	fieldType,
	items,
	at,
	readPath,
	sorted,
	type Item,
	type Screen,
	type ScreenAction,
	type ScreenField,
} from './model';
import './style.scss';

export * from './model';

/** Which admin hosts the screen: SpacePress Admin's route, or a classic wp-admin page. */
export type Host = 'spacepress-admin' | 'classic';

type Load< T > =
	| { kind: 'loading' }
	| { kind: 'error'; message: string }
	| { kind: 'ready'; value: T };

function message( e: unknown ): string {
	if ( e && typeof e === 'object' && 'message' in e ) {
		return String( ( e as { message: unknown } ).message );
	}
	return String( e );
}

/** The declaration, from the server, for the signed-in user. */
export function fetchScreen( id: string ): Promise< Screen > {
	return apiFetch< Screen >( {
		path: `/spacepress-admin/v1/screens/${ encodeURIComponent( id ) }`,
	} );
}

/** Runs an action's Ability over core's run route, with the method the server gave it. */
export function runAction(
	action: ScreenAction & { method?: string },
	item: Item | null
): Promise< unknown > {
	const input = actionInput( action, item );
	const method = action.method ?? 'POST';
	const path = `/wp-abilities/v1/abilities/${ action.ability }/run`;
	return method === 'POST'
		? apiFetch( { path, method, data: { input } } )
		: apiFetch( {
				path: readPath( { ability: action.ability, input, fields: [] } ),
				method,
		  } );
}

function fields( declared: ScreenField[] ): Field< Item >[] {
	return declared.map( ( f ) => ( {
		id: f.id,
		label: f.label ?? f.id,
		description: f.description,
		type: fieldType( f.type ) as Field< Item >[ 'type' ],
		elements: f.elements,
		enableGlobalSearch: f.type === undefined || f.type === 'text',
		// Search runs over the rows the ability returned; filters would need the ability's `where`.
		filterBy: false,
		getValue: ( { item } ) => item[ f.id ],
		render: ( { item } ) => (
			<span className="spacepress-admin-screen__value">
				{ display( item[ f.id ] ) }
			</span>
		),
	} ) );
}

function Loading( { state }: { state: Load< unknown > } ) {
	return state.kind === 'error' ? (
		<div role="alert">
			<Notice status="error" isDismissible={ false }>
				{ state.message }
			</Notice>
		</div>
	) : (
		<div role="status">
			<Spinner /> Loading…
		</div>
	);
}

function ScreenList( {
	screen,
	reload,
	setNotice,
}: {
	screen: Screen;
	reload: number;
	setNotice: ( n: { status: 'success' | 'error'; text: string } | null ) => void;
} ) {
	const declared = screen.view!;
	const [ state, setState ] = useState< Load< Item[] > >( { kind: 'loading' } );
	const [ round, setRound ] = useState( 0 );
	const [ confirming, setConfirming ] = useState< {
		action: ScreenAction;
		item: Item;
	} | null >( null );
	useEffect( () => {
		let live = true;
		apiFetch( { path: readPath( declared ) } )
			.then( ( out ) => live && setState( { kind: 'ready', value: items( declared, out ) } ) )
			.catch( ( e ) => live && setState( { kind: 'error', message: message( e ) } ) );
		return () => {
			live = false;
		};
	}, [ declared, reload, round ] );
	const viewFields = useMemo( () => fields( declared.fields ), [ declared ] );
	const defaultView = useMemo< View >( () => ( {
		type: 'table',
		perPage: 20,
		fields: declared.fields.map( ( f ) => f.id ),
		...declared.layout,
	} ), [ declared ] );
	const [ queryParams, setQueryParams ] = useState( { page: 1, search: '' } );
	const { view, updateView, isModified, resetToDefault } = useView( {
		kind: 'firstScreen',
		name: screen.id,
		slug: 'all',
		defaultView,
		queryParams,
		onChangeQueryParams: ( { page = 1, search = '' } ) => {
			setQueryParams( ( previous ) => ( {
				page: search !== previous.search ? 1 : page,
				search,
			} ) );
		},
	} );
	const run = useCallback(
		async ( action: ScreenAction, item: Item ) => {
			try {
				await runAction( action, item );
				setNotice( { status: 'success', text: `${ action.label }: done.` } );
				setRound( ( r ) => r + 1 );
			} catch ( e ) {
				setNotice( { status: 'error', text: message( e ) } );
			}
		},
		[ setNotice ]
	);
	const actions: Action< Item >[] = screen.actions.map( ( action ) => ( {
		id: action.id,
		label: action.label,
		isDestructive: action.destructive,
		callback: ( selected: Item[] ) => {
			const item = selected[ 0 ];
			if ( action.confirm ) {
				setConfirming( { action, item } );
			} else {
				void run( action, item );
			}
		},
	} ) );
	if ( state.kind !== 'ready' ) {
		return <Loading state={ state } />;
	}
	// Client-side paging and search over what the ability returned: the list abilities a screen
	// declares return bounded lists (versions, credentials, staged changes).
	const search = ( view.search ?? '' ).toLowerCase();
	const filtered = sorted( search
		? state.value.filter( ( item ) =>
				declared.fields
					.filter( ( f ) => f.type === undefined || f.type === 'text' )
					.some( ( f ) => display( item[ f.id ] ).toLowerCase().includes( search ) )
		  )
		: state.value, view.sort as { field: string; direction: 'asc' | 'desc' } | undefined );
	const perPage = view.perPage ?? 20;
	const page = view.page ?? 1;
	const key = declared.id ?? 'id';
	return (
		<>
			<DataViews< Item >
				data={ filtered.slice( ( page - 1 ) * perPage, page * perPage ) }
				fields={ viewFields }
				view={ view }
				onChangeView={ updateView }
				onReset={ isModified ? () => {
					resetToDefault();
					setQueryParams( previous => ( { ...previous, page: 1 } ) );
				} : false }
				actions={ actions }
				getItemId={ ( item ) => String( at( item, key ) ) }
				defaultLayouts={ { table: {} } }
				paginationInfo={ {
					totalItems: filtered.length,
					totalPages: Math.max( 1, Math.ceil( filtered.length / perPage ) ),
				} }
			/>
			{ confirming && (
				<Modal
					title={ confirming.action.label }
					onRequestClose={ () => setConfirming( null ) }
					size="small"
				>
					<p>{ confirming.action.confirm }</p>
					<div className="spacepress-admin-screen__confirm">
						<Button variant="tertiary" onClick={ () => setConfirming( null ) }>
							Cancel
						</Button>
						<Button
							variant="primary"
							isDestructive={ confirming.action.destructive }
							onClick={ () => {
								const { action, item } = confirming;
								setConfirming( null );
								void run( action, item );
							} }
						>
							{ confirming.action.label }
						</Button>
					</div>
				</Modal>
			) }
		</>
	);
}

function ScreenForm( {
	screen,
	setNotice,
}: {
	screen: Screen;
	setNotice: ( n: { status: 'success' | 'error'; text: string } | null ) => void;
} ) {
	const declared = screen.form!;
	const [ state, setState ] = useState< Load< Item > >( { kind: 'loading' } );
	const [ values, setValues ] = useState< Item >( {} );
	const [ busy, setBusy ] = useState( false );
	useEffect( () => {
		let live = true;
		apiFetch( { path: readPath( declared ) } )
			.then( ( out ) => {
				const value = ( at( out, declared.item ) ?? {} ) as Item;
				if ( live ) {
					setValues( value );
					setState( { kind: 'ready', value } );
				}
			} )
			.catch( ( e ) => live && setState( { kind: 'error', message: message( e ) } ) );
		return () => {
			live = false;
		};
	}, [ declared ] );
	const formFields = useMemo( () => fields( declared.fields ).map( ( f ) => ( { ...f, render: undefined } ) ), [ declared ] );
	if ( state.kind !== 'ready' ) {
		return <Loading state={ state } />;
	}
	const submit = declared.submit;
	return (
		<form
			className="spacepress-admin-screen__form"
			onSubmit={ ( e ) => {
				e.preventDefault();
				if ( ! submit || busy ) {
					return;
				}
				setBusy( true );
				runAction( submit, values )
					.then( () => setNotice( { status: 'success', text: 'Saved.' } ) )
					.catch( ( err ) => setNotice( { status: 'error', text: message( err ) } ) )
					.finally( () => setBusy( false ) );
			} }
		>
			<DataForm< Item >
				data={ values }
				fields={ formFields }
				form={ ( declared.layout ?? { fields: declared.fields.map( ( f ) => f.id ) } ) as never }
				onChange={ ( edits ) => setValues( { ...values, ...edits } ) }
			/>
			{ submit && (
				<Button variant="primary" type="submit" isBusy={ busy } disabled={ busy }>
					{ submit.label }
				</Button>
			) }
		</form>
	);
}

/**
 * One declared screen. The same component runs on SpacePress Admin's `/screens/<id>` route and on the
 * classic wp-admin page; only the surrounding chrome (title, layout) differs.
 */
export function ScreenBody( {
	id,
	host,
	frame = ( _screen, body ) => body,
}: {
	id: string;
	host: Host;
	/** The host's chrome around the body: SpacePress Admin's Page with the declared title. */
	frame?: ( screen: Screen | null, body: JSX.Element ) => JSX.Element;
} ) {
	const [ state, setState ] = useState< Load< Screen > >( { kind: 'loading' } );
	const [ notice, setNotice ] = useState< { status: 'success' | 'error'; text: string } | null >( null );
	useEffect( () => {
		let live = true;
		setState( { kind: 'loading' } );
		fetchScreen( id )
			.then( ( value ) => live && setState( { kind: 'ready', value } ) )
			.catch( ( e ) => live && setState( { kind: 'error', message: message( e ) } ) );
		return () => {
			live = false;
		};
	}, [ id ] );
	if ( state.kind !== 'ready' ) {
		return frame( null, <Loading state={ state } /> );
	}
	const screen = state.value;
	const summary = Array.isArray( screen.data ) ? screen.data : screen.data == null ? [] : [ screen.data ];
	return frame(
		screen,
		<div className={ `spacepress-admin-screen spacepress-admin-screen--${ host }` } data-screen={ screen.id }>
			{ notice && (
				<Notice status={ notice.status } onRemove={ () => setNotice( null ) }>
					{ notice.text }
				</Notice>
			) }
			{ summary.map( ( line, i ) => (
				<p key={ i } className="spacepress-admin-screen__summary">
					{ display( line ) }
				</p>
			) ) }
			{ screen.view && <ScreenList key={ screen.id } screen={ screen } reload={ 0 } setNotice={ setNotice } /> }
			{ screen.form && <ScreenForm screen={ screen } setNotice={ setNotice } /> }
		</div>
	);
}

/** Classic wp-admin: mount the screen into the page's element (lib/screens.php prints it). */
export function mountClassic( element: HTMLElement | null, { id }: { id: string } ) {
	if ( ! element ) {
		return;
	}
	createRoot( element ).render( <ScreenBody id={ id } host="classic" /> );
}
