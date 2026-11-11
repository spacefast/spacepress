import { RadioGroupControl, SelectControl } from '@first-admin/design-system';
import type { Field } from '@first-admin/dataviews';
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
		label: __( 'Site title', 'first-admin' ),
		type: 'text',
	},
	{
		id: 'description',
		label: __( 'Site description', 'first-admin' ),
		type: 'text',
	},
	{
		id: 'language',
		label: __( 'Site Language', 'first-admin' ),
		type: 'text',
		Edit( { data, field, onChange } ) {
			return (
				<SelectControl
					label={ field.label }
					items={ [
						{
							label: __( 'English', 'first-admin' ),
							value: '',
						},
						{
							label: __( 'Deutsch', 'first-admin' ),
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
		label: __( 'Your homepage displays', 'first-admin' ),
		type: 'text',
		Edit( { data, field, onChange } ) {
			return (
				<RadioGroupControl
					label={ field.label }
					items={ [
						{
							label: __( 'Your latest posts', 'first-admin' ),
							value: 'posts',
						},
						{
							label: __(
								'A static page (select below)',
								'first-admin'
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
		label: __( 'Home page', 'first-admin' ),
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
							label: __( '— Select —', 'first-admin' ),
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
		label: __( 'Posts page', 'first-admin' ),
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
