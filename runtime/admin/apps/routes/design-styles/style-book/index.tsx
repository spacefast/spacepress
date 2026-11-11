import clsx from 'clsx';
import {
	getStyle,
	getPalettes,
	generateGlobalStyles,
} from '@first-admin/global-styles-engine';
import type {
	GlobalStylesConfig,
	GlobalStylesSettings,
} from '@first-admin/global-styles-engine';
import { Disabled, Composite } from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';
import {
	BlockList,
	BlockEditorProvider,
	__unstableEditorStyles as EditorStyles,
	__unstableIframe as Iframe,
	// @ts-expect-error block editor is not typed yet.
} from '@wordpress/block-editor';
import {
	useMemo,
	memo,
	useState,
	useRef,
	useLayoutEffect,
} from '@wordpress/element';
import {
	STYLE_BOOK_IFRAME_STYLES,
	STYLE_BOOK_COLOR_GROUPS,
	STYLE_BOOK_PREVIEW_CATEGORIES,
} from './constants';
import { getExamplesByCategory } from './categories';
import { getExamples } from './examples';
import './style.scss';
import type { Category, Example, CategoryExamples } from './types';
import {
	useGlobalStyles,
	useNonGlobalStylesEditorStylesAndSettings,
	useSection,
} from '../hooks';
import { getVariationClassName } from '../global-styles-ui/utils';

interface StyleBookProps {
	id: string;
	isSelected?: ( name: string ) => boolean;
	onSelect?: ( name: string, isVariation?: boolean ) => void;
}

interface StyleBookBodyProps {
	category?: Category;
	examples: CategoryExamples;
	isSelected?: ( name: string ) => boolean;
	onSelect?: ( name: string, isVariation?: boolean ) => void;
	globalStyles?: GlobalStylesConfig;
	title?: string;
	serverCSS: { isGlobalStyles?: boolean }[];
	serverSettings:
		| {
				__unstableResolvedAssets: Record< string, unknown >;
				settings: GlobalStylesSettings;
		  }
		| undefined;
	goTo?: { top: boolean } | null;
}

interface StyleBookSettings {
	__unstableResolvedAssets?: Record< string, unknown >;
	settings?: GlobalStylesSettings;
	__experimentalFeatures?: GlobalStylesSettings;
	styles?: Array< {
		css?: string;
		isGlobalStyles?: boolean;
		assets?: any;
		__unstableType?: string;
	} >;
	isPreviewMode?: boolean;
}

interface ExamplesProps {
	className: string;
	category?: Category;
	examples: CategoryExamples;
	label: string;
	isSelected?: ( name: string ) => boolean;
	onSelect?: ( name: string, isVariation?: boolean ) => void;
	settings?: StyleBookSettings;
}

interface ExampleProps {
	id: string;
	title: string;
	content?: JSX.Element;
	blocks: any;
	isSelected?: boolean;
	onClick?: () => void;
	settings?: StyleBookSettings;
}

interface SubcategoryProps {
	examples: CategoryExamples;
	isSelected?: ( name: string ) => boolean;
	onSelect?: ( name: string ) => void;
	settings?: StyleBookSettings;
}

/*
 * Parses a global styles navigation path to build a style book navigation path.
 * The object can be extended to include a category, representing a style book tab/section.
 */
const getStyleBookNavigationFromPath = (
	path: string | undefined
): { top: boolean } | null => {
	if ( path && typeof path === 'string' ) {
		// The paths in the condition are the ones that provide their own stylebook screens.
		// For other paths the screen won't change so scrolling isn't needed.
		if (
			path === '/' ||
			path.startsWith( '/typography' ) ||
			path.startsWith( '/colors' ) ||
			path.startsWith( '/blocks' )
		) {
			return {
				top: true,
			};
		}
	}
	return null;
};

/*
 * Applies a block variation to each example by updating its attributes.
 */
function applyBlockVariationsToExamples(
	examples: Example[],
	variation: string
): Example[] {
	if ( ! variation ) {
		return examples;
	}

	return examples.map( ( example ) => ( {
		...example,
		variation,
		blocks: {
			...example.blocks,
			attributes: {
				...example.blocks.attributes,
				style: undefined,
				className: getVariationClassName( variation ),
			},
		},
	} ) );
}

/*
 * Get deduped examples for single page stylebook.
 */
export function getExamplesForSinglePageUse( examples: Example[] ): Example[] {
	const examplesForSinglePageUse: Example[] = [];
	const overviewCategoryExamples = getExamplesByCategory(
		{ slug: 'overview', title: 'Overview' },
		examples
	);
	if ( overviewCategoryExamples?.examples ) {
		examplesForSinglePageUse.push( ...overviewCategoryExamples.examples );
	}
	const otherExamples = examples.filter( ( example: Example ) => {
		return (
			example.category !== 'overview' &&
			! overviewCategoryExamples?.examples?.find(
				( overviewExample: Example ) =>
					overviewExample.name === example.name
			)
		);
	} );
	examplesForSinglePageUse.push( ...otherExamples );

	return examplesForSinglePageUse;
}

const scrollToSection = (
	anchorId: string,
	iframe: HTMLIFrameElement | null
): void => {
	if ( ! anchorId || ! iframe || ! iframe?.contentDocument ) {
		return;
	}

	const element =
		anchorId === 'top'
			? iframe.contentDocument.body
			: iframe.contentDocument.getElementById( anchorId );
	if ( element ) {
		element.scrollIntoView( {
			behavior: 'smooth',
		} );
	}
};

const StyleBook = ( { id }: StyleBookProps ) => {
	const { merged: globalStyles } = useGlobalStyles( id );
	const [ serverCSS, serverSettings ] =
		useNonGlobalStylesEditorStylesAndSettings();

	const [ section, onChangeSection ] = useSection();

	const isSelected = ( blockName: string ): boolean => {
		// Match '/blocks/core%2Fbutton' and
		// '/blocks/core%2Fbutton/typography', but not
		// '/blocks/core%2Fbuttons'.
		return !! (
			section === `/blocks/${ encodeURIComponent( blockName ) }` ||
			section?.startsWith(
				`/blocks/${ encodeURIComponent( blockName ) }/`
			)
		);
	};

	const onSelect = ( blockName: string, isBlockVariation = false ): void => {
		if (
			STYLE_BOOK_COLOR_GROUPS.find(
				( group ) => group.slug === blockName
			)
		) {
			// Go to color palettes Global Styles.
			onChangeSection( '/colors/palette' );
			return;
		}
		if ( blockName === 'typography' ) {
			// Go to typography Global Styles.
			onChangeSection( '/typography' );
			return;
		}

		if ( isBlockVariation ) {
			return;
		}

		// Now go to the selected block.
		onChangeSection( `/blocks/${ encodeURIComponent( blockName ) }` );
	};

	const textColor = useMemo(
		() => getStyle( globalStyles, 'color.text' ),
		[ globalStyles ]
	);
	const backgroundColor = useMemo(
		() => getStyle( globalStyles, 'color.background' ),
		[ globalStyles ]
	);

	const colorStylesAndSettings = useMemo(
		() =>
			globalStyles || {
				settings: serverSettings?.settings,
			},
		[ globalStyles, serverSettings ]
	);

	const presets = useMemo(
		() => getPalettes( colorStylesAndSettings ),
		[ colorStylesAndSettings ]
	);

	const examples = useMemo(
		() => ( presets ? getExamples( presets ) : [] ),
		[ presets ]
	);

	let previewCategory = null;
	let blockVariation = null;
	if ( section?.includes( '/colors' ) ) {
		previewCategory = 'colors';
	} else if ( section?.includes( '/typography' ) ) {
		previewCategory = 'text';
	} else if ( section?.includes( '/blocks' ) ) {
		previewCategory = 'blocks';
		let blockName = decodeURIComponent( section ).split( '/blocks/' )[ 1 ];

		// The blockName can contain variations, if so, extract the variation.
		if ( blockName?.includes( '/variations' ) ) {
			[ blockName, blockVariation ] = blockName.split( '/variations/' );
		}

		if (
			blockName &&
			examples.find( ( example ) => example.name === blockName )
		) {
			previewCategory = blockName;
		}
	} else if ( !! id ) {
		// The id only exists if a block theme is active.
		previewCategory = 'overview';
	}

	const categoryDefinition = STYLE_BOOK_PREVIEW_CATEGORIES.find(
		( category ) => category.slug === previewCategory
	);

	const filteredExamples: CategoryExamples | undefined = useMemo( () => {
		// If there's no category definition there may be a single block.
		if ( ! categoryDefinition ) {
			const foundExample = examples.find(
				( example ) => example.name === previewCategory
			);
			return {
				slug: previewCategory || 'unknown',
				title: previewCategory || 'Unknown',
				examples: foundExample ? [ foundExample ] : [],
			};
		}

		return getExamplesByCategory( categoryDefinition, examples );
	}, [ categoryDefinition, examples, previewCategory ] );

	const displayedExamples: CategoryExamples = useMemo( () => {
		// If there's no preview category, show deduped examples.
		if ( ! previewCategory ) {
			return {
				slug: 'all',
				title: 'All Examples',
				examples: getExamplesForSinglePageUse( examples ),
			};
		}

		if ( blockVariation ) {
			const validExamples = ( filteredExamples?.examples || [] ).filter(
				( example ): example is Example => example !== undefined
			);
			return {
				slug: previewCategory,
				title: categoryDefinition?.title || previewCategory,
				examples: applyBlockVariationsToExamples(
					validExamples,
					blockVariation
				),
			};
		}

		return filteredExamples || { slug: '', title: '', examples: [] };
	}, [
		previewCategory,
		examples,
		blockVariation,
		filteredExamples,
		categoryDefinition,
	] );

	const goTo = useMemo(
		() => getStyleBookNavigationFromPath( section ),
		[ section ]
	);

	if ( ! colorStylesAndSettings || ! displayedExamples ) {
		return null;
	}

	return (
		<div
			className="first-admin-style-book"
			style={ {
				color: textColor,
				background: backgroundColor,
			} }
		>
			<StyleBookBody
				category={ categoryDefinition }
				examples={ displayedExamples }
				isSelected={ id ? isSelected : undefined }
				onSelect={ id ? onSelect : undefined }
				globalStyles={ globalStyles }
				serverCSS={ serverCSS }
				serverSettings={ serverSettings }
				goTo={ goTo }
			/>
		</div>
	);
};

export const StyleBookBody = ( {
	category,
	examples,
	isSelected,
	onSelect,
	globalStyles,
	title = '',
	serverCSS,
	serverSettings,
	goTo,
}: StyleBookBodyProps ) => {
	const [ globalStylesCSS, globalSettings ] =
		generateGlobalStyles( globalStyles );
	const styles = useMemo(
		() => [ ...( serverCSS ?? [] ), ...( globalStylesCSS ?? [] ) ],
		[ serverCSS, globalStylesCSS ]
	);

	const settings = useMemo( () => {
		return {
			...serverSettings,
			__experimentalFeatures: globalSettings,
			styles,
			isPreviewMode: true,
		};
	}, [ globalSettings, serverSettings, styles ] );

	const [ hasIframeLoaded, setHasIframeLoaded ] = useState( false );
	const iframeRef = useRef< HTMLIFrameElement >( null );

	const handleLoad = () => setHasIframeLoaded( true );
	useLayoutEffect( () => {
		if ( hasIframeLoaded && iframeRef?.current ) {
			if ( goTo?.top ) {
				scrollToSection( 'top', iframeRef?.current );
			}
		}
	}, [ goTo, hasIframeLoaded ] );

	return (
		<BlockEditorProvider settings={ settings }>
			<Iframe
				className="first-admin-style-book__iframe"
				name="style-book-canvas"
				tabIndex={ 0 }
				onLoad={ handleLoad }
				ref={ iframeRef }
			>
				<EditorStyles styles={ styles } />
				<style>{ STYLE_BOOK_IFRAME_STYLES }</style>
				<Examples
					className="first-admin-style-book__examples"
					category={ category }
					examples={ examples }
					label={
						title
							? sprintf(
									// translators: %s: Category of blocks, e.g. Text.
									__(
										'Examples of blocks in the %s category',
										'first-admin'
									),
									title
							  )
							: __( 'Examples of blocks', 'first-admin' )
					}
					isSelected={ isSelected }
					onSelect={ onSelect }
					key={ title }
					settings={ settings }
				/>
			</Iframe>
		</BlockEditorProvider>
	);
};

const Examples = memo(
	( {
		className,
		examples,
		label,
		isSelected,
		onSelect,
		settings,
	}: ExamplesProps ) => {
		return (
			<Composite
				orientation="vertical"
				className={ className }
				aria-label={ label }
				role="grid"
			>
				{ examples.examples?.length &&
					examples.examples.map( ( example ) => (
						<Example
							key={ example.name }
							id={ `example-${ example.name }` }
							title={ example.title }
							content={ example.content }
							blocks={ example.blocks }
							isSelected={ isSelected?.( example.name ) }
							onClick={
								!! onSelect
									? () =>
											onSelect(
												example.name,
												!! example.variation
											)
									: undefined
							}
							settings={ settings }
						/>
					) ) }
				{ examples.subcategories?.length &&
					examples.subcategories?.map( ( subcategory ) => {
						return (
							<Composite.Group
								className="first-admin-style-book__subcategory"
								key={ `subcategory-${ subcategory.slug }` }
							>
								<Composite.GroupLabel>
									<h2 className="first-admin-style-book__subcategory-title">
										{ subcategory.title }
									</h2>
								</Composite.GroupLabel>
								<Subcategory
									examples={ subcategory }
									isSelected={ isSelected }
									onSelect={ onSelect }
									settings={ settings }
								/>
							</Composite.Group>
						);
					} ) }
			</Composite>
		);
	}
);

const Subcategory = ( {
	examples,
	isSelected,
	onSelect,
	settings,
}: SubcategoryProps ) => {
	return (
		!! examples?.examples?.length &&
		examples.examples.map( ( example: Example ) => (
			<Example
				key={ example.name }
				id={ `example-${ example.name }` }
				title={ example.title }
				content={ example.content }
				blocks={ example.blocks }
				isSelected={ isSelected?.( example.name ) }
				onClick={
					!! onSelect ? () => onSelect( example.name ) : undefined
				}
				settings={ settings }
			/>
		) )
	);
};

const disabledExamples = [ 'example-duotones' ];

const Example = ( {
	id,
	title,
	blocks,
	isSelected,
	onClick,
	content,
	settings,
}: ExampleProps ) => {
	// Cache the list of blocks to avoid additional processing when the component is re-rendered.
	const renderedBlocks = useMemo(
		() => ( Array.isArray( blocks ) ? blocks : [ blocks ] ),
		[ blocks ]
	);
	const disabledProps =
		disabledExamples.includes( id ) || ! onClick
			? {
					disabled: true,
					accessibleWhenDisabled: !! onClick,
			  }
			: {};
	return (
		<div role="row">
			<div role="gridcell">
				<Composite.Item
					className={ clsx( 'first-admin-style-book__example', {
						'is-selected': isSelected,
						'is-disabled-example': !! disabledProps?.disabled,
					} ) }
					id={ id }
					aria-label={
						!! onClick
							? sprintf(
									// translators: %s: Title of a block, e.g. Heading.
									__(
										'Open %s styles in Styles panel',
										'first-admin'
									),
									title
							  )
							: undefined
					}
					render={ <div /> }
					role={ !! onClick ? 'button' : undefined }
					onClick={ onClick }
					{ ...disabledProps }
				>
					<span className="first-admin-style-book__example-title">
						{ title }
					</span>
					<div
						className="first-admin-style-book__example-preview"
						aria-hidden
					>
						<Disabled className="first-admin-style-book__example-preview__content">
							{ content ? (
								content
							) : (
								<BlockEditorProvider
									value={ renderedBlocks }
									settings={ settings }
								>
									<BlockList renderAppender={ false } />
								</BlockEditorProvider>
							) }
						</Disabled>
					</div>
				</Composite.Item>
			</div>
		</div>
	);
};

export default StyleBook;
