import clsx from 'clsx';
import {
	__experimentalHStack as HStack,
	__experimentalText as Text,
	Button,
} from '@wordpress/components';
import { __, _x, _n, sprintf, isRTL } from '@wordpress/i18n';
import { previous, chevronLeft, chevronRight, next } from '@wordpress/icons';
import './style.scss';

interface PaginationProps {
	currentPage: number;
	numPages: number;
	changePage: ( page: number ) => void;
	totalItems: number;
	className?: string;
	disabled?: boolean;
	buttonVariant?: 'primary' | 'secondary' | 'tertiary';
	label?: string;
}

export default function Pagination( {
	currentPage,
	numPages,
	changePage,
	totalItems,
	className,
	disabled = false,
	buttonVariant = 'tertiary',
	label = __( 'Pagination', 'zero-admin' ),
}: PaginationProps ) {
	return (
		<HStack
			expanded={ false }
			as="nav"
			aria-label={ label }
			spacing={ 3 }
			justify="flex-start"
			className={ clsx( 'zero-admin-pagination', className ) }
		>
			<Text variant="muted" className="zero-admin-pagination__total">
				{ sprintf(
					// translators: %d: Total number of patterns.
					_n( '%d item', '%d items', totalItems, 'zero-admin' ),
					totalItems
				) }
			</Text>
			<HStack expanded={ false } spacing={ 1 }>
				<Button
					variant={ buttonVariant }
					onClick={ () => changePage( 1 ) }
					accessibleWhenDisabled
					disabled={ disabled || currentPage === 1 }
					label={ __( 'First page', 'zero-admin' ) }
					icon={ isRTL() ? next : previous }
					size="compact"
				/>
				<Button
					variant={ buttonVariant }
					onClick={ () => changePage( currentPage - 1 ) }
					accessibleWhenDisabled
					disabled={ disabled || currentPage === 1 }
					label={ __( 'Previous page', 'zero-admin' ) }
					icon={ isRTL() ? chevronRight : chevronLeft }
					size="compact"
				/>
			</HStack>
			<Text variant="muted">
				{ sprintf(
					// translators: 1: Current page number. 2: Total number of pages.
					_x( '%1$d of %2$d', 'paging', 'zero-admin' ),
					currentPage,
					numPages
				) }
			</Text>
			<HStack expanded={ false } spacing={ 1 }>
				<Button
					variant={ buttonVariant }
					onClick={ () => changePage( currentPage + 1 ) }
					accessibleWhenDisabled
					disabled={ disabled || currentPage === numPages }
					label={ __( 'Next page', 'zero-admin' ) }
					icon={ isRTL() ? chevronLeft : chevronRight }
					size="compact"
				/>
				<Button
					variant={ buttonVariant }
					onClick={ () => changePage( numPages ) }
					accessibleWhenDisabled
					disabled={ disabled || currentPage === numPages }
					label={ __( 'Last page', 'zero-admin' ) }
					icon={ isRTL() ? previous : next }
					size="compact"
				/>
			</HStack>
		</HStack>
	);
}
