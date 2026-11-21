import { useCallback, useEffect, useState } from 'react';
import apiFetch from '@wordpress/api-fetch';
import {
	Button,
	Notice,
	Spinner,
	TextControl,
} from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { Page } from '@typedpress-admin/admin-toolkit';
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
	{ key: 'people', label: __( 'People', 'typedpress-admin' ) },
	{ key: 'organizations', label: __( 'Organizations', 'typedpress-admin' ) },
	{ key: 'applications', label: __( 'Applications', 'typedpress-admin' ) },
	{ key: 'sessions', label: __( 'Sessions', 'typedpress-admin' ) },
	{ key: 'authentication', label: __( 'Authentication', 'typedpress-admin' ) },
	{
		key: 'security-events',
		label: __( 'Security Events', 'typedpress-admin' ),
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
	return __( 'Unable to complete request.', 'typedpress-admin' );
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
		path: `/typedpress-identity/v1/admin/${ op }`,
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
				<div className="tp-identity-loading">
					<Spinner />
					<span>{ __( 'Loading…', 'typedpress-admin' ) }</span>
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
				<div className="tp-identity-table-wrap">
					<table className="tp-identity-table">
						<thead>
							<tr>
								<th>{ __( 'Person', 'typedpress-admin' ) }</th>
								<th>{ __( 'Email', 'typedpress-admin' ) }</th>
								<th>{ __( 'Status', 'typedpress-admin' ) }</th>
								<th>{ __( 'MFA', 'typedpress-admin' ) }</th>
								<th>{ __( 'Actions', 'typedpress-admin' ) }</th>
							</tr>
						</thead>
						<tbody>
							{ rows.length === 0 ? (
								<tr>
									<td colSpan={ 5 } className="tp-identity-muted">
										{ __( 'No accounts found.', 'typedpress-admin' ) }
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
													className={ `tp-identity-badge ${
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
													className={ `tp-identity-badge ${
														person.mfa_enabled ? 'is-success' : ''
													}` }
												>
													{ person.mfa_enabled
														? __( 'Enabled', 'typedpress-admin' )
														: __( 'Off', 'typedpress-admin' ) }
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
																? __( 'Account reactivated.', 'typedpress-admin' )
																: __( 'Account suspended.', 'typedpress-admin' )
														)
													}
												>
													{ suspended
														? __( 'Reactivate', 'typedpress-admin' )
														: __( 'Suspend', 'typedpress-admin' ) }
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
				<div className="tp-identity-table-wrap">
					<table className="tp-identity-table">
						<thead>
							<tr>
								<th>{ __( 'Name', 'typedpress-admin' ) }</th>
								<th>{ __( 'Slug', 'typedpress-admin' ) }</th>
								<th>{ __( 'Created', 'typedpress-admin' ) }</th>
							</tr>
						</thead>
						<tbody>
							{ rows.length === 0 ? (
								<tr>
									<td colSpan={ 3 } className="tp-identity-muted">
										{ __( 'No organizations yet.', 'typedpress-admin' ) }
									</td>
								</tr>
							) : (
								rows.map( ( org, idx ) => (
									<tr key={ String( org.id ?? idx ) }>
										<td>
											<strong>{ String( org.name ?? '—' ) }</strong>
										</td>
										<td className="tp-identity-code">
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
						className="tp-identity-card"
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
							}, __( 'OAuth application registered.', 'typedpress-admin' ) );
						} }
					>
						<h3>{ __( 'Register OAuth Application', 'typedpress-admin' ) }</h3>
						<div className="tp-identity-form-grid">
							<TextControl
								label={ __( 'Name', 'typedpress-admin' ) }
								value={ appName }
								onChange={ setAppName }
								placeholder="My Client App"
							/>
							<TextControl
								label={ __( 'Redirect URI', 'typedpress-admin' ) }
								value={ appRedirect }
								onChange={ setAppRedirect }
								placeholder="https://app.example.com/callback"
							/>
							<TextControl
								label={ __( 'Allowed Origin', 'typedpress-admin' ) }
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
								{ __( 'Add Application', 'typedpress-admin' ) }
							</Button>
						</div>
						{ createdSecret && (
							<Notice
								status="warning"
								isDismissible
								onRemove={ () => setCreatedSecret( null ) }
							>
								<strong>{ __( 'Client secret (shown once):', 'typedpress-admin' ) }</strong>{ ' ' }
								<code className="tp-identity-code">{ createdSecret }</code>
							</Notice>
						) }
					</form>

					<div className="tp-identity-table-wrap">
						<table className="tp-identity-table">
							<thead>
								<tr>
									<th>{ __( 'Name', 'typedpress-admin' ) }</th>
									<th>{ __( 'Client ID', 'typedpress-admin' ) }</th>
									<th>{ __( 'Origin', 'typedpress-admin' ) }</th>
									<th>{ __( 'Status', 'typedpress-admin' ) }</th>
									<th>{ __( 'Actions', 'typedpress-admin' ) }</th>
								</tr>
							</thead>
							<tbody>
								{ rows.length === 0 ? (
									<tr>
										<td colSpan={ 5 } className="tp-identity-muted">
											{ __( 'No OAuth applications registered.', 'typedpress-admin' ) }
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
												<td className="tp-identity-code">{ id }</td>
												<td className="tp-identity-code">
													{ String( app.origin ?? '—' ) }
												</td>
												<td>
													<span
														className={ `tp-identity-badge ${
															enabled ? 'is-success' : 'is-warning'
														}` }
													>
														{ enabled
															? __( 'Enabled', 'typedpress-admin' )
															: __( 'Disabled', 'typedpress-admin' ) }
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
																	? __( 'Application disabled.', 'typedpress-admin' )
																	: __( 'Application enabled.', 'typedpress-admin' )
															)
														}
													>
														{ enabled
															? __( 'Disable', 'typedpress-admin' )
															: __( 'Enable', 'typedpress-admin' ) }
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
				<div className="tp-identity-table-wrap">
					<table className="tp-identity-table">
						<thead>
							<tr>
								<th>{ __( 'Session', 'typedpress-admin' ) }</th>
								<th>{ __( 'User ID', 'typedpress-admin' ) }</th>
								<th>{ __( 'Created', 'typedpress-admin' ) }</th>
								<th>{ __( 'Expires', 'typedpress-admin' ) }</th>
								<th>{ __( 'Status', 'typedpress-admin' ) }</th>
								<th>{ __( 'Actions', 'typedpress-admin' ) }</th>
							</tr>
						</thead>
						<tbody>
							{ rows.length === 0 ? (
								<tr>
									<td colSpan={ 6 } className="tp-identity-muted">
										{ __( 'No sessions recorded.', 'typedpress-admin' ) }
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
													className={ `tp-identity-badge ${
														revoked ? 'is-error' : 'is-success'
													}` }
												>
													{ revoked
														? __( 'Revoked', 'typedpress-admin' )
														: __( 'Active', 'typedpress-admin' ) }
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
																__( 'Session revoked.', 'typedpress-admin' )
															)
														}
													>
														{ __( 'Revoke', 'typedpress-admin' ) }
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
					<div className="tp-identity-card">
						<h3>{ __( 'Sign-in Providers', 'typedpress-admin' ) }</h3>
						{ providers.length === 0 ? (
							<p className="tp-identity-muted">
								{ __( 'Email & password sign-in active. No external OAuth providers configured.', 'typedpress-admin' ) }
							</p>
						) : (
							<div>
								{ providers.map( ( p ) => (
									<span
										key={ p }
										className="tp-identity-badge is-success"
										style={ { marginInlineEnd: 6 } }
									>
										{ p }
									</span>
								) ) }
							</div>
						) }
					</div>
					<div className="tp-identity-card">
						<div className="tp-identity-toolbar">
							<h3>{ __( 'Signing Keys (JWKS)', 'typedpress-admin' ) }</h3>
							<Button
								variant="secondary"
								disabled={ busy }
								onClick={ () =>
									void runMutation(
										() => identityRequest( 'keys/rotate', 'POST' ),
										__( 'Signing keys rotated.', 'typedpress-admin' )
									)
								}
							>
								{ __( 'Rotate Keys', 'typedpress-admin' ) }
							</Button>
						</div>
						<p className="tp-identity-muted">
							{ jwks.length } { __( 'active signing key(s).', 'typedpress-admin' ) }
						</p>
						{ jwks.map( ( k, idx ) => (
							<div key={ String( k.kid ?? idx ) } className="tp-identity-code">
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
			<div className="tp-identity-table-wrap">
				<table className="tp-identity-table">
					<thead>
						<tr>
							<th>{ __( 'Event', 'typedpress-admin' ) }</th>
							<th>{ __( 'User ID', 'typedpress-admin' ) }</th>
							<th>{ __( 'Time', 'typedpress-admin' ) }</th>
						</tr>
					</thead>
					<tbody>
						{ events.length === 0 ? (
							<tr>
								<td colSpan={ 3 } className="tp-identity-muted">
									{ __( 'No security events recorded.', 'typedpress-admin' ) }
								</td>
							</tr>
						) : (
							events.map( ( ev, idx ) => (
								<tr key={ String( ev.id ?? idx ) }>
									<td className="tp-identity-code">
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
		<div className="tp-identity-tabs" role="tablist">
			{ TABS.map( ( item ) => (
				<button
					key={ item.key }
					type="button"
					role="tab"
					aria-selected={ tab === item.key }
					className={ `tp-identity-tab${ tab === item.key ? ' is-active' : '' }` }
					onClick={ () => setTab( item.key ) }
				>
					{ item.label }
				</button>
			) ) }
		</div>
	);

	return (
		<Page
			title={ __( 'Identity & Auth', 'typedpress-admin' ) }
			subTitle={ __(
				'Accounts, organizations, OAuth applications, sessions, and security logs.',
				'typedpress-admin'
			) }
			tabs={ tabBar }
			actions={
				<Button variant="secondary" size="compact" onClick={ reload }>
					{ __( 'Refresh', 'typedpress-admin' ) }
				</Button>
			}
		>
			<div className="tp-identity-body">
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
