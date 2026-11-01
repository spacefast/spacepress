import { useSelect } from '@wordpress/data';
import { store as coreStore } from '@wordpress/core-data';
import { useCallback } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import { Button } from '@wordpress/ui';
// @ts-expect-error - the block editor's media upload is typed loosely upstream
import { MediaUpload } from '@wordpress/block-editor';
import type { DataFormControlProps } from '@zero-admin/dataviews';
import type { Row } from '@zero-admin/schema';

type Picked = { id: number; title?: string; url?: string };

/**
 * One attachment id, chosen through the media library the admin already opens for attachments
 * (`editor.MediaUpload` is the boot media modal). Writes the id; the API decides what the row may
 * hold. `accept` narrows the library to images when the column asked for them.
 */
export function MediaControl( { data, field, onChange, hideLabelFromVision }: DataFormControlProps< Row > ) {
	const value = field.getValue( { item: data } ) as number | null | undefined;
	const accept = ( field as { accept?: string } ).accept;
	const media = useSelect(
		( select ) => ( typeof value === 'number' && value > 0 ? ( select( coreStore ).getEntityRecord( 'postType', 'attachment', value ) as { title?: { rendered?: string }; source_url?: string } | undefined ) : undefined ),
		[ value ]
	);
	const set = useCallback( ( id: number | null ) => onChange( { [ field.id ]: id } as Partial< Row > ), [ field.id, onChange ] );
	return (
		<fieldset className="zero-admin-media-control" data-testid={ `zero-admin-media-${ field.id }` }>
			{ ! hideLabelFromVision && <legend>{ field.label }</legend> }
			<MediaUpload
				onSelect={ ( picked: Picked ) => set( picked.id ) }
				allowedTypes={ accept === 'image' ? [ 'image' ] : undefined }
				value={ value ?? undefined }
				render={ ( { open }: { open: () => void } ) => (
					<span className="zero-admin-media-control__row">
						{ typeof value === 'number' && value > 0 ? (
							<span className="zero-admin-media-control__current">
								{ media?.title?.rendered ?? sprintf( /* translators: %d: attachment id */ __( 'Media #%d', 'zero-admin' ), value ) }
							</span>
						) : (
							<span className="zero-admin-media-control__current">{ __( 'None', 'zero-admin' ) }</span>
						) }
						<Button variant="outline" size="compact" onClick={ open }>
							{ typeof value === 'number' && value > 0 ? __( 'Replace', 'zero-admin' ) : __( 'Choose', 'zero-admin' ) }
						</Button>
						{ typeof value === 'number' && value > 0 && (
							<Button variant="minimal" size="compact" onClick={ () => set( null ) }>
								{ __( 'Remove', 'zero-admin' ) }
							</Button>
						) }
					</span>
				) }
			/>
		</fieldset>
	);
}

/** Several attachment ids, in order; the library's multi-select, plus remove per item. */
export function MediaListControl( { data, field, onChange, hideLabelFromVision }: DataFormControlProps< Row > ) {
	const raw = field.getValue( { item: data } );
	const ids = Array.isArray( raw ) ? raw.map( Number ).filter( ( n ) => Number.isInteger( n ) && n > 0 ) : [];
	const set = useCallback( ( next: number[] ) => onChange( { [ field.id ]: next } as Partial< Row > ), [ field.id, onChange ] );
	return (
		<fieldset className="zero-admin-media-control" data-testid={ `zero-admin-media-${ field.id }` }>
			{ ! hideLabelFromVision && <legend>{ field.label }</legend> }
			<ul className="zero-admin-media-control__list">
				{ ids.map( ( id ) => (
					<li key={ id }>
						{ sprintf( /* translators: %d: attachment id */ __( 'Media #%d', 'zero-admin' ), id ) }
						<Button variant="minimal" size="small" onClick={ () => set( ids.filter( ( other ) => other !== id ) ) }>
							{ __( 'Remove', 'zero-admin' ) }
						</Button>
					</li>
				) ) }
			</ul>
			<MediaUpload
				multiple
				gallery
				value={ ids }
				onSelect={ ( picked: Picked | Picked[] ) => set( ( Array.isArray( picked ) ? picked : [ picked ] ).map( ( p ) => p.id ) ) }
				render={ ( { open }: { open: () => void } ) => (
					<Button variant="outline" size="compact" onClick={ open }>
						{ ids.length > 0 ? __( 'Change selection', 'zero-admin' ) : __( 'Choose', 'zero-admin' ) }
					</Button>
				) }
			/>
		</fieldset>
	);
}
