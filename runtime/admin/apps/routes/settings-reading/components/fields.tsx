import { RadioGroupControl, SelectControl } from '@typedpress-admin/design-system';
import type { Field } from '@typedpress-admin/dataviews';
import { __ } from '@wordpress/i18n';
import {
	type Settings,
	store as coreStore,
	type Page,
} from '@wordpress/core-data';
import { useSelect } from '@wordpress/data';

export const fields: Field< Settings >[] = [
	{
		id: 'title',
		label: __( 'Site title', 'typedpress-admin' ),
		type: 'text',
	},
	{
		id: 'description',
		label: __( 'Site description', 'typedpress-admin' ),
		type: 'text',
	},
	{
		id: 'language',
		label: __( 'Site Language', 'typedpress-admin' ),
		type: 'text',
		Edit( { data, field, onChange } ) {
			return (
				<SelectControl
					label={ field.label }
					items={ [
						{
							label: __( 'English', 'typedpress-admin' ),
							value: '',
						},
						{
							label: __( 'Deutsch', 'typedpress-admin' ),
							value: 'de_DE',
						},
					] }
					value={ data.language }
					onValueChange={ ( value ) => {
						onChange( { [ field.id ]: value } );
					} }
				/>
			);
		},
	},
	{
		id: 'show_on_front',
		label: __( 'Your homepage displays', 'typedpress-admin' ),
		type: 'text',
		Edit( { data, field, onChange } ) {
			return (
				<RadioGroupControl
					label={ field.label }
					items={ [
						{
							label: __( 'Your latest posts', 'typedpress-admin' ),
							value: 'posts',
						},
						{
							label: __(
								'A static page (select below)',
								'typedpress-admin'
							),
							value: 'page',
						},
					] }
					value={ data.show_on_front }
					onValueChange={ ( value ) => {
						onChange( { [ field.id ]: value } );
					} }
				/>
			);
		},
	},
	{
		id: 'page_on_front',
		label: __( 'Home page', 'typedpress-admin' ),
		type: 'text',
		Edit( { data, field, onChange } ) {
			const pages = useSelect( ( select ) => {
				return select( coreStore ).getEntityRecords< Page >(
					'postType',
					'page',
					{ per_page: -1 }
				);
			}, [] );
			return (
				<SelectControl
					label={ field.label }
					disabled={ data.show_on_front !== 'page' || ! pages }
					items={ [
						{
							label: __( '— Select —', 'typedpress-admin' ),
							value: '0',
						},
						...( pages || [] ).map( ( page: Page ) => ( {
							label: page.title.rendered,
							value: page.id.toString(),
						} ) ),
					] }
					value={ String( data.page_on_front ) }
					onValueChange={ ( value ) => {
						onChange( { [ field.id ]: value } );
					} }
				/>
			);
		},
	},
	{
		id: 'page_for_posts',
		label: __( 'Posts page', 'typedpress-admin' ),
		type: 'text',
		Edit( { data, field, onChange } ) {
			const pages = useSelect( ( select ) => {
				return select( coreStore ).getEntityRecords< Page >(
					'postType',
					'page',
					{ per_page: -1 }
				);
			}, [] );
			return (
				<SelectControl
					label={ field.label }
					disabled={ data.show_on_front !== 'page' || ! pages }
					items={ [
						{
							label: '— Select —',
							value: '0',
						},
						...( pages || [] ).map( ( page: Page ) => ( {
							label: page.title.rendered,
							value: page.id.toString(),
						} ) ),
					] }
					value={ String( data.page_for_posts ) }
					onValueChange={ ( value ) => {
						onChange( { [ field.id ]: value } );
					} }
				/>
			);
		},
	},
];
