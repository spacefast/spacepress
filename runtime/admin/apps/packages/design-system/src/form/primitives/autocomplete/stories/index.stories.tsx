import type { Meta, StoryObj } from '@storybook/react-vite';
import { useRef, useState } from 'react';
import { search } from '@wordpress/icons';
import { Icon } from '@wordpress/ui';
import { Autocomplete, Input, InputLayout, Textarea } from '../../../..';
import { COMMANDS, URLS, USERS, type FixtureItem } from './fixtures';

const meta: Meta< typeof Autocomplete.Root > = {
	title: 'Design System/Form/Primitives/Autocomplete',
	component: Autocomplete.Root,
	subcomponents: {
		Popup: Autocomplete.Popup,
		Input: Autocomplete.Input,
		List: Autocomplete.List,
		ListBody: Autocomplete.ListBody,
		Collection: Autocomplete.Collection,
		Item: Autocomplete.Item,
		Value: Autocomplete.Value,
		Empty: Autocomplete.Empty,
		Clear: Autocomplete.Clear,
	},
};
export default meta;

type Story = StoryObj< typeof Autocomplete.Root >;

/**
 * In this example, the user can type any URL freely.
 * Items are suggested as the user types, but the input accepts
 * arbitrary text — there is no selection state.
 */
export const Default: Story = {
	args: {
		items: URLS,
		children: (
			<>
				<Autocomplete.Input placeholder="Enter a URL" type="url" />
				<Autocomplete.Popup>
					<Autocomplete.Empty>No matching items.</Autocomplete.Empty>
					<Autocomplete.List>
						<Autocomplete.ListBody>
							<Autocomplete.Collection>
								{ ( item: FixtureItem ) => (
									<Autocomplete.Item
										key={ item.id }
										value={ item }
									>
										{ item.value }
									</Autocomplete.Item>
								) }
							</Autocomplete.Collection>
						</Autocomplete.ListBody>
					</Autocomplete.List>
				</Autocomplete.Popup>
			</>
		),
	},
};

/**
 * Same as the default example, but the popup only opens when there is at
 * least one matching item. The `open` and `onOpenChange` props are used
 * to control the popup visibility based on filtered results.
 */
export const OpenOnlyOnMatch: Story = {
	render: function Template( args ) {
		const [ open, setOpen ] = useState( false );
		const [ filteredItems, setFilteredItems ] = useState( URLS );

		return (
			<Autocomplete.Root
				{ ...args }
				items={ URLS }
				open={ open }
				onOpenChange={ ( nextOpen ) => {
					// Only allow opening when there are matches.
					setOpen( nextOpen && filteredItems.length > 0 );
				} }
				onValueChange={ ( value ) => {
					const matches = URLS.filter( ( bookmark ) =>
						bookmark.value
							.toLowerCase()
							.includes( value.toLowerCase() )
					);
					setFilteredItems( matches );
					setOpen( value.length > 0 && matches.length > 0 );
				} }
				filteredItems={ filteredItems }
			>
				<Autocomplete.Input placeholder="Enter a URL" type="url" />
				<Autocomplete.Popup>
					<Autocomplete.List>
						<Autocomplete.ListBody>
							<Autocomplete.Collection>
								{ ( item: FixtureItem ) => (
									<Autocomplete.Item
										key={ item.id }
										value={ item }
									>
										{ item.value }
									</Autocomplete.Item>
								) }
							</Autocomplete.Collection>
						</Autocomplete.ListBody>
					</Autocomplete.List>
				</Autocomplete.Popup>
			</Autocomplete.Root>
		);
	},
};

export const AsyncItems: Story = {
	render: function Template( args ) {
		const [ query, setQuery ] = useState( '' );
		const [ loading, setLoading ] = useState( false );
		const [ results, setResults ] = useState< typeof URLS >( [] );

		return (
			<Autocomplete.Root
				{ ...args }
				items={ results }
				value={ query }
				onValueChange={ ( newValue ) => {
					setQuery( newValue );
					setLoading( true );
					// Simulate an async search.
					setTimeout( () => {
						setResults(
							URLS.filter( ( item ) =>
								item.value
									.toLowerCase()
									.includes( newValue.toLowerCase() )
							)
						);
						setLoading( false );
					}, 500 );
				} }
			>
				<Autocomplete.Input placeholder="Enter a URL" type="url" />
				<Autocomplete.Popup>
					<Autocomplete.Empty>
						{ loading ? 'Loading…' : 'No matching items.' }
					</Autocomplete.Empty>
					<Autocomplete.List>
						<Autocomplete.ListBody>
							<Autocomplete.Collection>
								{ ( item: FixtureItem ) => (
									<Autocomplete.Item
										key={ item.id }
										value={ item }
									>
										{ item.value }
									</Autocomplete.Item>
								) }
							</Autocomplete.Collection>
						</Autocomplete.ListBody>
					</Autocomplete.List>
				</Autocomplete.Popup>
			</Autocomplete.Root>
		);
	},
};

/**
 * A command palette where items perform an action when clicked.
 * The input is cleared after running a command.
 */
export const CommandPalette: Story = {
	args: {
		items: COMMANDS,
	},
	render: function Template( args ) {
		const [ value, setValue ] = useState( '' );

		return (
			<Autocomplete.Root
				{ ...args }
				value={ value }
				onValueChange={ setValue }
			>
				<Autocomplete.Input placeholder="Type a command" />
				<Autocomplete.Popup>
					<Autocomplete.Empty>No commands found.</Autocomplete.Empty>
					<Autocomplete.List>
						<Autocomplete.ListBody>
							<Autocomplete.Collection>
								{ ( command: FixtureItem ) => (
									<Autocomplete.Item
										key={ command.id }
										value={ command }
										onClick={ () => {
											// eslint-disable-next-line no-alert
											alert(
												`Running: ${ command.value }`
											);
											setValue( '' );
										} }
									>
										{ command.value }
									</Autocomplete.Item>
								) }
							</Autocomplete.Collection>
						</Autocomplete.ListBody>
					</Autocomplete.List>
				</Autocomplete.Popup>
			</Autocomplete.Root>
		);
	},
};

/**
 * The suggestion list can be rendered inline (without a popup) by enabling the
 * `inline` and `open` props on the `Root`. This is useful when embedding the autocomplete
 * directly in a modal, such as a command palette.
 */
export const Inline: Story = {
	args: {
		...CommandPalette.args,
		inline: true,
		open: true,
	},
	render: function Template( args ) {
		const [ value, setValue ] = useState( '' );

		return (
			<Autocomplete.Root
				{ ...args }
				value={ value }
				onValueChange={ setValue }
			>
				<Autocomplete.Input placeholder="Type a command" />
				<div
					style={ {
						minHeight: '200px',
						maxHeight: '200px',
						marginTop: 8,
						overflow: 'auto',
					} }
				>
					<Autocomplete.Empty>No commands found.</Autocomplete.Empty>
					<Autocomplete.List>
						<Autocomplete.Collection>
							{ ( command: FixtureItem ) => (
								<Autocomplete.Item
									key={ command.id }
									value={ command }
									onClick={ () => {
										// eslint-disable-next-line no-alert
										alert( `Running: ${ command.value }` );
										setValue( '' );
									} }
								>
									{ command.value }
								</Autocomplete.Item>
							) }
						</Autocomplete.Collection>
					</Autocomplete.List>
				</div>
			</Autocomplete.Root>
		);
	},
};

export const WithSearchIconAndClearButton: Story = {
	args: {
		items: URLS,
		children: (
			<>
				<Autocomplete.Input
					placeholder="Search URLs"
					type="url"
					render={
						<Input
							prefix={
								<InputLayout.Slot padding="minimal">
									<Icon icon={ search } />
								</InputLayout.Slot>
							}
							suffix={
								<InputLayout.Slot padding="minimal">
									<Autocomplete.Clear />
								</InputLayout.Slot>
							}
						/>
					}
				/>
				<Autocomplete.Popup>
					<Autocomplete.Empty>No matching items.</Autocomplete.Empty>
					<Autocomplete.List>
						<Autocomplete.ListBody>
							<Autocomplete.Collection>
								{ ( item: FixtureItem ) => (
									<Autocomplete.Item
										key={ item.id }
										value={ item }
									>
										{ item.value }
									</Autocomplete.Item>
								) }
							</Autocomplete.Collection>
						</Autocomplete.ListBody>
					</Autocomplete.List>
				</Autocomplete.Popup>
			</>
		),
	},
};

/**
 * Experimental: Textarea with inline autocomplete triggered by `@`.
 *
 * Ping the Design System team if you have a use case for this feature.
 */
export const TextareaInlineAutocomplete: Story = {
	render: function Template() {
		const textareaRef = useRef< HTMLTextAreaElement >( null );
		const [ value, setValue ] = useState( '' );
		const [ open, setOpen ] = useState( false );
		const [ filteredItems, setFilteredItems ] = useState< FixtureItem[] >(
			[]
		);
		const triggerInfo = useRef< {
			offset: number;
			query: string;
		} | null >( null );

		/**
		 * Given a text string and caret position, find the active
		 * trigger ("@") and extract the search query after it.
		 */
		function findTrigger( text: string, caretPos: number ) {
			const textBeforeCaret = text.slice( 0, caretPos );
			const triggerIndex = textBeforeCaret.lastIndexOf( '@' );
			if ( triggerIndex < 0 ) {
				return null;
			}

			const query = textBeforeCaret.slice( triggerIndex + 1 );
			// Not an active trigger if there's whitespace in the query.
			if ( /\s/.test( query ) ) {
				return null;
			}
			// The trigger must be at the start or preceded by whitespace.
			if ( triggerIndex > 0 && ! /\s/.test( text[ triggerIndex - 1 ] ) ) {
				return null;
			}

			return { offset: triggerIndex, query };
		}

		function handleValueChange(
			newValue: string,
			details: { reason: string }
		) {
			const trigger = triggerInfo.current;

			if ( details.reason === 'item-press' && trigger ) {
				// An item was selected. `newValue` is the item's string
				// value. Replace only the @query portion in the full text.
				const before = value.slice( 0, trigger.offset );
				const afterEndPos = trigger.offset + 1 + trigger.query.length;
				const after = value.slice( afterEndPos );
				const needsSpace = after.length > 0 && after[ 0 ] !== ' ';
				const inserted = `@${ newValue }${ needsSpace ? ' ' : '' }`;
				const fullValue = before + inserted + after;

				setValue( fullValue );
				triggerInfo.current = null;
				setOpen( false );

				// Move caret to after the inserted mention.
				const caretPos = before.length + inserted.length;
				requestAnimationFrame( () => {
					textareaRef.current?.setSelectionRange(
						caretPos,
						caretPos
					);
					textareaRef.current?.focus();
				} );
				return;
			}

			// User is typing normally.
			setValue( newValue );

			const textarea = textareaRef.current;
			if ( ! textarea ) {
				return;
			}

			const caretPos = textarea.selectionStart ?? 0;
			const detected = findTrigger( newValue, caretPos );

			if ( detected ) {
				triggerInfo.current = detected;
				const matches = USERS.filter( ( u ) =>
					u.value
						.toLowerCase()
						.startsWith( detected.query.toLowerCase() )
				);
				setFilteredItems( matches );
				setOpen( matches.length > 0 );
			} else {
				triggerInfo.current = null;
				setOpen( false );
			}
		}

		return (
			<Autocomplete.Root
				items={ USERS }
				value={ value }
				onValueChange={ handleValueChange }
				filteredItems={ filteredItems }
				open={ open }
				onOpenChange={ ( nextOpen ) => {
					// Only respond to close requests. Opening is
					// controlled by trigger detection in handleValueChange.
					if ( ! nextOpen ) {
						setOpen( false );
						triggerInfo.current = null;
					}
				} }
				mode="none"
				openOnInputClick={ false }
				autoHighlight
			>
				<Autocomplete.Input
					render={
						<Textarea
							ref={ textareaRef }
							placeholder="Type @ to mention someone"
						/>
					}
				/>
				<Autocomplete.Popup>
					<Autocomplete.List>
						<Autocomplete.ListBody>
							<Autocomplete.Collection>
								{ ( item: FixtureItem ) => (
									<Autocomplete.Item
										key={ item.id }
										value={ item }
									>
										{ item.value }
									</Autocomplete.Item>
								) }
							</Autocomplete.Collection>
						</Autocomplete.ListBody>
					</Autocomplete.List>
				</Autocomplete.Popup>
			</Autocomplete.Root>
		);
	},
};

/**
 * The `--wp-ui-autocomplete-z-index` CSS variable, available on the
 * `Autocomplete.Popup` component, can be used to override the z-index
 * on a case-by-case basis.
 */
export const WithCustomZIndex: Story = {
	name: 'With Custom z-index',
	args: {
		items: URLS,
		children: (
			<>
				<Autocomplete.Input placeholder="Enter a URL" type="url" />
				<Autocomplete.Popup
					style={ { '--wp-ui-autocomplete-z-index': '1000001' } }
				>
					<Autocomplete.List>
						<Autocomplete.ListBody>
							<Autocomplete.Collection>
								{ ( item: FixtureItem ) => (
									<Autocomplete.Item
										key={ item.id }
										value={ item }
									>
										{ item.value }
									</Autocomplete.Item>
								) }
							</Autocomplete.Collection>
						</Autocomplete.ListBody>
					</Autocomplete.List>
				</Autocomplete.Popup>
			</>
		),
	},
};
