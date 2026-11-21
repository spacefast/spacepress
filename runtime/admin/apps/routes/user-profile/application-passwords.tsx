import { useCallback, useEffect, useState } from 'react';
import apiFetch from '@wordpress/api-fetch';
import { Button, Notice, Spinner, TextControl } from '@wordpress/components';
import { __ } from '@wordpress/i18n';

interface ApplicationPassword {
	uuid: string;
	name: string;
	created?: string;
	last_used?: string | null;
	last_ip?: string | null;
}

interface CreatedApplicationPassword extends ApplicationPassword {
	password?: string;
}

function formatDate( value?: string | null ): string {
	if ( ! value ) {
		return __( 'Never', 'typedpress-admin' );
	}
	const parsed = new Date( value );
	if ( Number.isNaN( parsed.getTime() ) ) {
		return value;
	}
	return new Intl.DateTimeFormat( undefined, {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
	} ).format( parsed );
}

export function ApplicationPasswordsCard() {
	const [ items, setItems ] = useState< ApplicationPassword[] >( [] );
	const [ loading, setLoading ] = useState( true );
	const [ busy, setBusy ] = useState( false );
	const [ name, setName ] = useState( '' );
	const [ createdToken, setCreatedToken ] = useState< {
		name: string;
		password: string;
	} | null >( null );
	const [ error, setError ] = useState( '' );
	const [ unsupported, setUnsupported ] = useState( false );

	const load = useCallback( () => {
		setLoading( true );
		setError( '' );
		apiFetch< ApplicationPassword[] >( {
			path: '/wp/v2/users/me/application-passwords',
		} )
			.then( ( list ) => {
				setItems( Array.isArray( list ) ? list : [] );
				setLoading( false );
			} )
			.catch( ( err: unknown ) => {
				setLoading( false );
				const status =
					err && typeof err === 'object' && 'data' in err
						? Number(
								(
									err as {
										data?: { status?: number };
									}
								).data?.status
						  )
						: 0;
				if ( status === 404 || status === 501 ) {
					setUnsupported( true );
					return;
				}
				setError(
					err && typeof err === 'object' && 'message' in err
						? String( ( err as { message: unknown } ).message )
						: __(
								'Could not load application passwords.',
								'typedpress-admin'
						  )
				);
			} );
	}, [] );

	useEffect( () => {
		load();
	}, [ load ] );

	if ( unsupported ) {
		return null;
	}

	const createPassword = async ( e: React.FormEvent ) => {
		e.preventDefault();
		const trimmed = name.trim();
		if ( ! trimmed || busy ) {
			return;
		}
		setBusy( true );
		setError( '' );
		setCreatedToken( null );
		try {
			const created = await apiFetch< CreatedApplicationPassword >( {
				path: '/wp/v2/users/me/application-passwords',
				method: 'POST',
				data: { name: trimmed },
			} );
			setName( '' );
			if ( created.password ) {
				setCreatedToken( {
					name: created.name || trimmed,
					password: created.password,
				} );
			}
			load();
		} catch ( err: unknown ) {
			setError(
				err && typeof err === 'object' && 'message' in err
					? String( ( err as { message: unknown } ).message )
					: __(
							'Could not create application password.',
							'typedpress-admin'
					  )
			);
		} finally {
			setBusy( false );
		}
	};

	const revoke = async ( uuid: string ) => {
		setBusy( true );
		setError( '' );
		try {
			await apiFetch( {
				path: `/wp/v2/users/me/application-passwords/${ encodeURIComponent(
					uuid
				) }`,
				method: 'DELETE',
			} );
			load();
		} catch ( err: unknown ) {
			setError(
				err && typeof err === 'object' && 'message' in err
					? String( ( err as { message: unknown } ).message )
					: __(
							'Could not revoke application password.',
							'typedpress-admin'
					  )
			);
		} finally {
			setBusy( false );
		}
	};

	return (
		<section className="tp-app-passwords">
			<div className="tp-app-passwords__header">
				<h2>{ __( 'Application Passwords', 'typedpress-admin' ) }</h2>
				<p>
					{ __(
						'Create revocable credentials for CLI, MCP, and API clients without sharing your main password.',
						'typedpress-admin'
					) }
				</p>
			</div>

			{ error && (
				<Notice
					status="error"
					isDismissible
					onRemove={ () => setError( '' ) }
				>
					{ error }
				</Notice>
			) }

			{ createdToken && (
				<Notice
					status="warning"
					isDismissible
					onRemove={ () => setCreatedToken( null ) }
				>
					<strong>
						{ __(
							'New application password (shown once):',
							'typedpress-admin'
						) }
					</strong>{ ' ' }
					<code>{ createdToken.password }</code>
				</Notice>
			) }

			<form
				className="tp-app-passwords__form"
				onSubmit={ ( e ) => {
					void createPassword( e );
				} }
			>
				<TextControl
					label={ __( 'New password name', 'typedpress-admin' ) }
					value={ name }
					onChange={ setName }
					placeholder="SpacePress CLI or MCP agent"
					disabled={ busy }
				/>
				<Button
					type="submit"
					variant="secondary"
					disabled={ busy || ! name.trim() }
					isBusy={ busy }
				>
					{ __( 'Add Application Password', 'typedpress-admin' ) }
				</Button>
			</form>

			{ loading ? (
				<div className="tp-app-passwords__loading">
					<Spinner />
				</div>
			) : items.length === 0 ? (
				<p className="tp-app-passwords__empty">
					{ __(
						'No application passwords created yet.',
						'typedpress-admin'
					) }
				</p>
			) : (
				<ul className="tp-app-passwords__list">
					{ items.map( ( item ) => (
						<li key={ item.uuid } className="tp-app-passwords__row">
							<div>
								<strong>{ item.name }</strong>
								<div className="tp-app-passwords__meta">
									{ __( 'Created:', 'typedpress-admin' ) }{ ' ' }
									{ formatDate( item.created ) } ·{ ' ' }
									{ __( 'Last used:', 'typedpress-admin' ) }{ ' ' }
									{ formatDate( item.last_used ) }
								</div>
							</div>
							<Button
								variant="tertiary"
								isDestructive
								size="small"
								disabled={ busy }
								onClick={ () => {
									void revoke( item.uuid );
								} }
							>
								{ __( 'Revoke', 'typedpress-admin' ) }
							</Button>
						</li>
					) ) }
				</ul>
			) }
		</section>
	);
}
