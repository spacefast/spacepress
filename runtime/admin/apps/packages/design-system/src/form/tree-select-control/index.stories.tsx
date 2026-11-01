import { useEffect, useState } from '@wordpress/element';
import type { Meta, StoryFn } from '@storybook/react-vite';
import { TreeSelectControl } from './index';
import type { TreeSelectControlProps, Option } from './types';

const treeSelectControlOptions: Option[] = [
	{
		value: 'EU',
		label: 'Europe',
		children: [
			{ value: 'ES', label: 'Spain' },
			{ value: 'FR', label: 'France' },
			{ value: 'TR', label: 'Türkiye' },
			{ key: 'FR-Colonies', value: 'FR-C', label: 'France (Colonies)' },
		],
	},
	{
		value: 'AS',
		label: 'Asia',
		children: [
			{
				value: 'JP',
				label: 'Japan',
				children: [
					{
						value: 'TO',
						label: 'Tokyo',
						children: [
							{ value: 'SI', label: 'Shibuya' },
							{ value: 'GI', label: 'Ginza' },
						],
					},
					{ value: 'OK', label: 'Okinawa' },
				],
			},
			{ value: 'CH', label: 'China' },
			{
				value: 'MY',
				label: 'Malaysia',
				children: [ { value: 'KU', label: 'Kuala Lumpur' } ],
			},
		],
	},
	{
		value: 'NA',
		label: 'North America',
		children: [
			{
				value: 'US',
				label: 'United States',
				children: [
					{ value: 'NY', label: 'New York' },
					{ value: 'TX', label: 'Texas' },
					{ value: 'GE', label: 'Georgia' },
				],
			},
			{
				value: 'CA',
				label: 'Canada',
			},
		],
	},
];

const Template: StoryFn< TreeSelectControlProps > = ( args ) => {
	const [ selected, setSelected ] = useState< string[] >( [ 'ES' ] );

	useEffect( () => {
		if ( args.onValueChange ) {
			args.onValueChange( selected );
		}
	}, [ args, selected ] );

	return (
		<div style={ { minHeight: 500 } }>
			<TreeSelectControl
				{ ...args }
				value={ selected }
				onValueChange={ setSelected }
			/>
		</div>
	);
};

export const Base: StoryFn< TreeSelectControlProps > = Template.bind( {} );

Base.args = {
	id: 'my-id',
	label: 'Select Countries',
	placeholder: 'Search countries',
	description: 'Select one or more countries from the list',
	disabled: false,
	options: treeSelectControlOptions,
	maxVisibleTags: 3,
	selectAllLabel: 'All countries',
	includeParent: false,
	alwaysShowPlaceholder: false,
	individuallySelectParent: false,
	clearOnSelect: true,
};

Base.argTypes = {
	onInputChange: { action: 'onInputChange' },
	onValueChange: { action: 'onValueChange' },
};

const meta: Meta< typeof TreeSelectControl > = {
	title: 'Design System/Form/TreeSelectControl',
	component: TreeSelectControl,
};

export default meta;
