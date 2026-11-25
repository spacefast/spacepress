import { useCallback, useEffect, useState } from 'react';
import apiFetch from '@wordpress/api-fetch';
import {
	Button,
	Notice,
	Spinner,
	TextControl,
} from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { Page } from '@spacepress-admin/admin-toolkit';
import './style.scss';

type TabKey =
	| 'people'
	| 'organizations'
	| 'applications'
	| 'sessions'
	| 'authentication'
	| 'security-events';

type Row = Record< string, unknown >;

const TABS: Array< { key: TabKey; label: string } > = [
	{ key: 'people', label: __( 'People', 'spacepress-admin' ) },
	{ key: 'organizations', label: __( 'Organizations', 'spacepress-admin' ) },
	{ key: 'applications', label: __( 'Applications', 'spacepress-admin' ) },
	{ key: 'sessions', label: __( 'Sessions', 'spacepress-admin' ) },
	{ key: 'authentication', label: __( 'Authentication', 'spacepress-admin' ) },
	{
		key: 'security-events',
		label: __( 'Security Events', 'spacepress-admin' ),
	},
];

function errorMessage( err: unknown ): string {
	if ( err && typeof err === 'object' ) {
		const record = err as Record< string, unknown >;
		if (
			record.error &&
			typeof record.error === 'object' &&
			'message' in record.error
		) {
			return String( ( record.error as { message: unknown } ).message );
		}
		if ( 'message' in record ) {
			return String( record.message );
		}
	}
	return __( 'Unable to complete request.', 'spacepress-admin' );
}

function formatTs( value: unknown ): string {
	if ( value === null || value === undefined || value === '' ) {
		return '—';
	}
	const num = typeof value === 'number' ? value : Number( value );
	const date =
		! Number.isNaN( num ) && num > 1_000_000_000
			? new Date( num > 1e12 ? num : num * 1000 )
			: new Date( String( value ) );
	if ( Number.isNaN( date.getTime() ) ) {
		return String( value );
	}
	return new Intl.DateTimeFormat( undefined, {
		dateStyle: 'medium',
		timeStyle: 'short',
	} ).format( date );
}

async function identityRequest< T = unknown >(
	op: string,
	method: 'GET' | 'POST' = 'GET',
	data?: Record< string, unknown >
): Promise< T > {
	const res = await apiFetch< { data?: T } >( {
		path: `/spacepress-identity/v1/admin/${ op }`,
		method,
		data,
	} );
	return ( res && typeof res === 'object' && 'data' in res
		? res.data
		: res ) as T;
}

function randomIdempotencyKey(): string {
	const chars =
		'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
	let out = '';
	for ( let i = 0; i < 24; i++ ) {
		out += chars[ Math.floor( Math.random() * chars.length ) ];
	}
	return out;
}

export default function IdentityStage() {
	const [ tab, setTab ] = useState< TabKey >( 'people' );
	const [ loaded, setLoaded ] = useState< { tab: TabKey; value: unknown } | null >(
		null
	);
	const [ loading, setLoading ] = useState( true );
	const [ busy, setBusy ] = useState( false );
	const [ error, setError ] = useState( '' );
	const [ notice, setNotice ] = useState( '' );
	const [ revision, setRevision ] = useState( 0 );

	// New OAuth Application form state
	const [ appName, setAppName ] = useState( '' );
	const [ appRedirect, setAppRedirect ] = useState( '' );
	const [ appOrigin, setAppOrigin ] = useState( '' );
	const [ createdSecret, setCreatedSecret ] = useState< string | null >( null );

	const reload = useCallback( () => setRevision( ( r ) => r + 1 ), [] );

	useEffect( () => {
		let active = true;
		setLoading( true );
		setError( '' );
		setLoaded( ( prev ) => ( prev?.tab === tab ? prev : null ) );
		identityRequest( tab )
			.then( ( res ) => {
				if ( active ) {
					setLoaded( { tab, value: res } );
					setLoading( false );
				}
			} )
			.catch( ( err: unknown ) => {
				if ( active ) {
					setLoaded( null );
					setError( errorMessage( err ) );
					setLoading( false );
				}
			} );
		return () => {
			active = false;
		};
	}, [ tab, revision ] );

	const runMutation = async (
		fn: () => Promise< unknown >,
		successMessage: string
	) => {
		setBusy( true );
		setError( '' );
		setNotice( '' );
		try {
			await fn();
			setNotice( successMessage );
			reload();
		} catch ( err: unknown ) {
			setError( errorMessage( err ) );
		} finally {
			setBusy( false );
		}
	};

	const renderBody = () => {
		if ( loading ) {
			return (
				<div className="sp-identity-loading">
					<Spinner />
					<span>{ __( 'Loading…', 'spacepress-admin' ) }</span>
				</div>
			);
		}
		if ( ! loaded || loaded.tab !== tab ) {
			return null;
		}
		const data = loaded.value;

		if ( tab === 'people' ) {
			const rows = Array.isArray( data ) ? ( data as Row[] ) : [];
			return (
				<div className="sp-identity-table-wrap">
					<table className="sp-identity-table">
						<thead>
							<tr>
								<th>{ __( 'Person', 'spacepress-admin' ) }</th>
								<th>{ __( 'Email', 'spacepress-admin' ) }</th>
								<th>{ __( 'Status', 'spacepress-admin' ) }</th>
								<th>{ __( 'MFA', 'spacepress-admin' ) }</th>
								<th>{ __( 'Actions', 'spacepress-admin' ) }</th>
							</tr>
						</thead>
						<tbody>
							{ rows.length === 0 ? (
								<tr>
									<td colSpan={ 5 } className="sp-identity-muted">
										{ __( 'No accounts found.', 'spacepress-admin' ) }
									</td>
								</tr>
							) : (
								rows.map( ( person ) => {
									const id = String( person.id ?? person.wp_user_id ?? '' );
									const suspended =
										person.status === 'suspended' ||
										person.suspended === true;
									return (
										<tr key={ id }>
											<td>
												<strong>
													{ String(
														person.display_name ??
															person.name ??
															`#${ id }`
													) }
												</strong>
											</td>
											<td>{ String( person.email ?? '—' ) }</td>
											<td>
												<span
													className={ `sp-identity-badge ${
														suspended ? 'is-error' : 'is-success'
													}` }
												>
													{ String(
														person.status ??
															( suspended ? 'suspended' : 'active' )
													) }
												</span>
											</td>
											<td>
												<span
													className={ `sp-identity-badge ${
														person.mfa_enabled ? 'is-success' : ''
													}` }
												>
													{ person.mfa_enabled
														? __( 'Enabled', 'spacepress-admin' )
														: __( 'Off', 'spacepress-admin' ) }
												</span>
											</td>
											<td>
												<Button
													variant="secondary"
													size="small"
													disabled={ busy }
													onClick={ () =>
														void runMutation(
															() =>
																identityRequest(
																	'people/suspend',
																	'POST',
																	{ id, suspended: ! suspended }
																),
															suspended
																? __( 'Account reactivated.', 'spacepress-admin' )
																: __( 'Account suspended.', 'spacepress-admin' )
														)
													}
												>
													{ suspended
														? __( 'Reactivate', 'spacepress-admin' )
														: __( 'Suspend', 'spacepress-admin' ) }
												</Button>
											</td>
										</tr>
									);
								} )
							) }
						</tbody>
					</table>
				</div>
			);
		}

		if ( tab === 'organizations' ) {
			const rows = Array.isArray( data ) ? ( data as Row[] ) : [];
			return (
				<div className="sp-identity-table-wrap">
					<table className="sp-identity-table">
						<thead>
							<tr>
								<th>{ __( 'Name', 'spacepress-admin' ) }</th>
								<th>{ __( 'Slug', 'spacepress-admin' ) }</th>
								<th>{ __( 'Created', 'spacepress-admin' ) }</th>
							</tr>
						</thead>
						<tbody>
							{ rows.length === 0 ? (
								<tr>
									<td colSpan={ 3 } className="sp-identity-muted">
										{ __( 'No organizations yet.', 'spacepress-admin' ) }
									</td>
								</tr>
							) : (
								rows.map( ( org, idx ) => (
									<tr key={ String( org.id ?? idx ) }>
										<td>
											<strong>{ String( org.name ?? '—' ) }</strong>
										</td>
										<td className="sp-identity-code">
											{ String( org.slug ?? org.id ?? '—' ) }
										</td>
										<td>{ formatTs( org.created_at ) }</td>
									</tr>
								) )
							) }
						</tbody>
					</table>
				</div>
			);
		}

		if ( tab === 'applications' ) {
			const rows = Array.isArray( data ) ? ( data as Row[] ) : [];
			return (
				<>
					<form
						className="sp-identity-card"
						onSubmit={ ( e ) => {
							e.preventDefault();
							if ( ! appName.trim() || ! appRedirect.trim() || ! appOrigin.trim() ) {
								return;
							}
							void runMutation( async () => {
								const created = await identityRequest< Row >(
									'applications',
									'POST',
									{
										name: appName.trim(),
										redirect_uri: appRedirect.trim(),
										origin: appOrigin.trim(),
										idempotency_key: randomIdempotencyKey(),
									}
								);
								if ( created && typeof created.client_secret === 'string' ) {
									setCreatedSecret( created.client_secret );
								}
								setAppName( '' );
								setAppRedirect( '' );
								setAppOrigin( '' );
							}, __( 'OAuth application registered.', 'spacepress-admin' ) );
						} }
					>
						<h3>{ __( 'Register OAuth Application', 'spacepress-admin' ) }</h3>
						<div className="sp-identity-form-grid">
							<TextControl
								label={ __( 'Name', 'spacepress-admin' ) }
								value={ appName }
								onChange={ setAppName }
								placeholder="My Client App"
							/>
							<TextControl
								label={ __( 'Redirect URI', 'spacepress-admin' ) }
								value={ appRedirect }
								onChange={ setAppRedirect }
								placeholder="https://app.example.com/callback"
							/>
							<TextControl
								label={ __( 'Allowed Origin', 'spacepress-admin' ) }
								value={ appOrigin }
								onChange={ setAppOrigin }
								placeholder="https://app.example.com"
							/>
							<Button
								type="submit"
								variant="primary"
								disabled={
									busy ||
									! appName.trim() ||
									! appRedirect.trim() ||
									! appOrigin.trim()
								}
							>
								{ __( 'Add Application', 'spacepress-admin' ) }
							</Button>
						</div>
						{ createdSecret && (
							<Notice
								status="warning"
								isDismissible
								onRemove={ () => setCreatedSecret( null ) }
							>
								<strong>{ __( 'Client secret (shown once):', 'spacepress-admin' ) }</strong>{ ' ' }
								<code className="sp-identity-code">{ createdSecret }</code>
							</Notice>
						) }
					</form>

					<div className="sp-identity-table-wrap">
						<table className="sp-identity-table">
							<thead>
								<tr>
									<th>{ __( 'Name', 'spacepress-admin' ) }</th>
									<th>{ __( 'Client ID', 'spacepress-admin' ) }</th>
									<th>{ __( 'Origin', 'spacepress-admin' ) }</th>
									<th>{ __( 'Status', 'spacepress-admin' ) }</th>
									<th>{ __( 'Actions', 'spacepress-admin' ) }</th>
								</tr>
							</thead>
							<tbody>
								{ rows.length === 0 ? (
									<tr>
										<td colSpan={ 5 } className="sp-identity-muted">
											{ __( 'No OAuth applications registered.', 'spacepress-admin' ) }
										</td>
									</tr>
								) : (
									rows.map( ( app ) => {
										const id = String( app.id ?? '' );
										const enabled =
											app.enabled === true ||
											app.enabled === 1 ||
											app.enabled === '1';
										return (
											<tr key={ id }>
												<td>
													<strong>{ String( app.name ?? '—' ) }</strong>
												</td>
												<td className="sp-identity-code">{ id }</td>
												<td className="sp-identity-code">
													{ String( app.origin ?? '—' ) }
												</td>
												<td>
													<span
														className={ `sp-identity-badge ${
															enabled ? 'is-success' : 'is-warning'
														}` }
													>
														{ enabled
															? __( 'Enabled', 'spacepress-admin' )
															: __( 'Disabled', 'spacepress-admin' ) }
													</span>
												</td>
												<td>
													<Button
														variant="secondary"
														size="small"
														disabled={ busy }
														onClick={ () =>
															void runMutation(
																() =>
																	identityRequest(
																		'applications/status',
																		'POST',
																		{ id, enabled: ! enabled }
																	),
																enabled
																	? __( 'Application disabled.', 'spacepress-admin' )
																	: __( 'Application enabled.', 'spacepress-admin' )
															)
														}
													>
														{ enabled
															? __( 'Disable', 'spacepress-admin' )
															: __( 'Enable', 'spacepress-admin' ) }
													</Button>
												</td>
											</tr>
										);
									} )
								) }
							</tbody>
						</table>
					</div>
				</>
			);
		}

		if ( tab === 'sessions' ) {
			const rows = Array.isArray( data ) ? ( data as Row[] ) : [];
			return (
				<div className="sp-identity-table-wrap">
					<table className="sp-identity-table">
						<thead>
							<tr>
								<th>{ __( 'Session', 'spacepress-admin' ) }</th>
								<th>{ __( 'User ID', 'spacepress-admin' ) }</th>
								<th>{ __( 'Created', 'spacepress-admin' ) }</th>
								<th>{ __( 'Expires', 'spacepress-admin' ) }</th>
								<th>{ __( 'Status', 'spacepress-admin' ) }</th>
								<th>{ __( 'Actions', 'spacepress-admin' ) }</th>
							</tr>
						</thead>
						<tbody>
							{ rows.length === 0 ? (
								<tr>
									<td colSpan={ 6 } className="sp-identity-muted">
										{ __( 'No sessions recorded.', 'spacepress-admin' ) }
									</td>
								</tr>
							) : (
								rows.map( ( s ) => {
									const id = String( s.id ?? '' );
									const userId = String( s.wp_user_id ?? '' );
									const revoked = Boolean( s.revoked_at );
									return (
										<tr key={ id }>
											<td>
												<strong>{ String( s.label || id.slice( 0, 12 ) ) }</strong>
											</td>
											<td>#{ userId }</td>
											<td>{ formatTs( s.created_at ) }</td>
											<td>{ formatTs( s.expires_at ) }</td>
											<td>
												<span
													className={ `sp-identity-badge ${
														revoked ? 'is-error' : 'is-success'
													}` }
												>
													{ revoked
														? __( 'Revoked', 'spacepress-admin' )
														: __( 'Active', 'spacepress-admin' ) }
												</span>
											</td>
											<td>
												{ ! revoked && (
													<Button
														variant="secondary"
														size="small"
														isDestructive
														disabled={ busy }
														onClick={ () =>
															void runMutation(
																() =>
																	identityRequest(
																		'sessions/revoke',
																		'POST',
																		{ user_id: userId, id }
																	),
																__( 'Session revoked.', 'spacepress-admin' )
															)
														}
													>
														{ __( 'Revoke', 'spacepress-admin' ) }
													</Button>
												) }
											</td>
										</tr>
									);
								} )
							) }
						</tbody>
					</table>
				</div>
			);
		}

		if ( tab === 'authentication' ) {
			const auth =
				data && typeof data === 'object' ? ( data as Row ) : {};
			const providers = Array.isArray( auth.providers )
				? auth.providers.map( String )
				: [];
			const keysObj =
				auth.keys && typeof auth.keys === 'object'
					? ( auth.keys as { keys?: Row[] } )
					: {};
			const jwks = Array.isArray( keysObj.keys ) ? keysObj.keys : [];
			return (
				<>
					<div className="sp-identity-card">
						<h3>{ __( 'Sign-in Providers', 'spacepress-admin' ) }</h3>
						{ providers.length === 0 ? (
							<p className="sp-identity-muted">
								{ __( 'Email & password sign-in active. No external OAuth providers configured.', 'spacepress-admin' ) }
							</p>
						) : (
							<div>
								{ providers.map( ( p ) => (
									<span
										key={ p }
										className="sp-identity-badge is-success"
										style={ { marginInlineEnd: 6 } }
									>
										{ p }
									</span>
								) ) }
							</div>
						) }
					</div>
					<div className="sp-identity-card">
						<div className="sp-identity-toolbar">
							<h3>{ __( 'Signing Keys (JWKS)', 'spacepress-admin' ) }</h3>
							<Button
								variant="secondary"
								disabled={ busy }
								onClick={ () =>
									void runMutation(
										() => identityRequest( 'keys/rotate', 'POST' ),
										__( 'Signing keys rotated.', 'spacepress-admin' )
									)
								}
							>
								{ __( 'Rotate Keys', 'spacepress-admin' ) }
							</Button>
						</div>
						<p className="sp-identity-muted">
							{ jwks.length } { __( 'active signing key(s).', 'spacepress-admin' ) }
						</p>
						{ jwks.map( ( k, idx ) => (
							<div key={ String( k.kid ?? idx ) } className="sp-identity-code">
								kid: { String( k.kid ?? '—' ) } ({ String( k.alg ?? k.kty ?? '' ) })
							</div>
						) ) }
					</div>
				</>
			);
		}

		// security-events
		const events = Array.isArray( data ) ? ( data as Row[] ) : [];
		return (
			<div className="sp-identity-table-wrap">
				<table className="sp-identity-table">
					<thead>
						<tr>
							<th>{ __( 'Event', 'spacepress-admin' ) }</th>
							<th>{ __( 'User ID', 'spacepress-admin' ) }</th>
							<th>{ __( 'Time', 'spacepress-admin' ) }</th>
						</tr>
					</thead>
					<tbody>
						{ events.length === 0 ? (
							<tr>
								<td colSpan={ 3 } className="sp-identity-muted">
									{ __( 'No security events recorded.', 'spacepress-admin' ) }
								</td>
							</tr>
						) : (
							events.map( ( ev, idx ) => (
								<tr key={ String( ev.id ?? idx ) }>
									<td className="sp-identity-code">
										{ String( ev.kind ?? ev.event ?? ev.type ?? '—' ) }
									</td>
									<td>{ ev.wp_user_id ? `#${ String( ev.wp_user_id ) }` : '—' }</td>
									<td>{ formatTs( ev.created_at ?? ev.occurred_at ) }</td>
								</tr>
							) )
						) }
					</tbody>
				</table>
			</div>
		);
	};

	const tabBar = (
		<div className="sp-identity-tabs" role="tablist">
			{ TABS.map( ( item ) => (
				<button
					key={ item.key }
					type="button"
					role="tab"
					aria-selected={ tab === item.key }
					className={ `sp-identity-tab${ tab === item.key ? ' is-active' : '' }` }
					onClick={ () => setTab( item.key ) }
				>
					{ item.label }
				</button>
			) ) }
		</div>
	);

	return (
		<Page
			title={ __( 'Identity & Auth', 'spacepress-admin' ) }
			subTitle={ __(
				'Accounts, organizations, OAuth applications, sessions, and security logs.',
				'spacepress-admin'
			) }
			tabs={ tabBar }
			actions={
				<Button variant="secondary" size="compact" onClick={ reload }>
					{ __( 'Refresh', 'spacepress-admin' ) }
				</Button>
			}
		>
			<div className="sp-identity-body">
				{ error && (
					<Notice status="error" isDismissible onRemove={ () => setError( '' ) }>
						{ error }
					</Notice>
				) }
				{ notice && (
					<Notice status="success" isDismissible onRemove={ () => setNotice( '' ) }>
						{ notice }
					</Notice>
				) }
				{ renderBody() }
			</div>
		</Page>
	);
}
