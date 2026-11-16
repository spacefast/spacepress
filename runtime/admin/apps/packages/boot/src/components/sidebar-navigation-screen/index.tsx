import type { ReactNode } from 'react';
import { IconButton } from '@wordpress/ui';
// eslint-disable-next-line @typedpress-admin/design-system/use-new-components
import { Stack } from '@typedpress-admin/design-system';
import {
	__experimentalHeading as Heading,
	__unstableMotion as motion,
	__unstableAnimatePresence as AnimatePresence,
} from '@wordpress/components';
import { isRTL, __ } from '@wordpress/i18n';
import { chevronRight, chevronLeft } from '@wordpress/icons';
import { useReducedMotion } from '@wordpress/compose';
import './style.scss';
import { useNavigate } from '@wordpress/route';
import type { MenuItem } from '../../store/types';

const ANIMATION_DURATION = 0.3;
const slideVariants = {
	initial: ( direction: 'forward' | 'backward' ) => ( {
		x: direction === 'forward' ? 100 : -100,
		opacity: 0,
	} ),
	animate: {
		x: 0,
		opacity: 1,
	},
	exit: ( direction: 'forward' | 'backward' ) => ( {
		x: direction === 'forward' ? 100 : -100,
		opacity: 0,
	} ),
};

export default function SidebarNavigationScreen( {
	isRoot,
	title,
	actions,
	content,
	description,
	animationDirection,
	backMenuItem,
	navigationKey,
	onNavigate,
}: {
	isRoot?: boolean;
	title: string;
	actions?: ReactNode;
	content: ReactNode;
	description?: ReactNode;
	backMenuItem?: MenuItem;
	animationDirection?: 'forward' | 'backward';
	navigationKey?: string;
	onNavigate: ( {
		id,
		direction,
	}: {
		id?: string;
		direction: 'forward' | 'backward';
	} ) => void;
} ) {
	const icon = isRTL() ? chevronRight : chevronLeft;
	const disableMotion = useReducedMotion();
	const navigate = useNavigate();

	const handleBackClick = async ( e: React.MouseEvent ) => {
		e.preventDefault();
		await navigate( { to: backMenuItem?.to ?? '' } );
		onNavigate( { id: backMenuItem?.id, direction: 'backward' } );
	};

	return (
		<div
			className="typedpress-admin-sidebar-navigation-screen"
			style={ {
				overflow: 'hidden',
				position: 'relative',
				display: 'grid',
				gridTemplateColumns: '1fr',
				gridTemplateRows: '1fr',
			} }
		>
			<AnimatePresence initial={ false }>
				<motion.div
					key={ navigationKey }
					custom={ animationDirection }
					variants={ slideVariants }
					initial="initial"
					animate="animate"
					exit="exit"
					transition={ {
						type: 'tween',
						duration: disableMotion ? 0 : ANIMATION_DURATION,
						ease: [ 0.33, 0, 0, 1 ],
					} }
					style={ {
						width: '100%',
						gridColumn: '1',
						gridRow: '1',
					} }
				>
					<Stack
						direction="row"
						gap={ 2 }
						align="center"
						className="typedpress-admin-sidebar-navigation-screen__title-icon"
					>
						{ ! isRoot && (
							<IconButton
								icon={ icon }
								onClick={ handleBackClick }
								label={ __( 'Back', 'typedpress-admin' ) }
								size="small"
								variant="minimal"
								tone="neutral"
							/>
						) }
						<Heading
							className="typedpress-admin-sidebar-navigation-screen__title"
							level={ 1 }
							size="15px"
						>
							{ title }
						</Heading>
						{ actions && (
							<div className="typedpress-admin-sidebar-navigation-screen__actions">
								{ actions }
							</div>
						) }
					</Stack>

					{ description && (
						<div className="typedpress-admin-sidebar-navigation-screen__description">
							{ description }
						</div>
					) }

					{ content }
				</motion.div>
			</AnimatePresence>
		</div>
	);
}
