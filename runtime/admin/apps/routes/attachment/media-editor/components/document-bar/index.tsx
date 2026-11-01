import { __ } from '@wordpress/i18n';
import { useDispatch } from '@wordpress/data';
import {
	Button,
	__experimentalText as Text,
	__unstableMotion as motion,
} from '@wordpress/components';
import { displayShortcut } from '@wordpress/keycodes';
// @ts-expect-error Commands package is not typed yet.
import { store as commandsStore } from '@wordpress/commands';
import { useRef, useEffect } from '@wordpress/element';
import { useReducedMotion } from '@wordpress/compose';
import { __unstableStripHTML as stripHTML } from '@wordpress/dom';
import { Icon } from '@wordpress/ui';
import './style.scss';

export default function DocumentBar( {
	icon,
	title,
}: {
	icon: React.ReactElement< React.ComponentProps< 'svg' > >;
	title: string;
} ) {
	const { open: openCommandCenter } = useDispatch( commandsStore );
	const isReducedMotion = useReducedMotion();

	const mountedRef = useRef( false );
	useEffect( () => {
		mountedRef.current = true;
	}, [] );

	return (
		<div className="zero-admin-media-editor-document-bar">
			{ icon && (
				<span className="zero-admin-media-editor-document-bar__icon-layout">
					<Icon icon={ icon } />
				</span>
			) }
			<Button
				className="zero-admin-media-editor-document-bar__command"
				onClick={ () => openCommandCenter() }
				size="compact"
			>
				<motion.div
					className="zero-admin-media-editor-document-bar__title"
					// Force entry animation when the back button is added or removed.
					initial={
						mountedRef.current
							? {
									opacity: 0,
									transform: 'translateX(-15%)',
							  }
							: false // Don't show entry animation when DocumentBar mounts.
					}
					animate={ {
						opacity: 1,
						transform: 'translateX(0%)',
					} }
					transition={ isReducedMotion ? { duration: 0 } : undefined }
				>
					<Text size="body" as="h1">
						<span className="zero-admin-media-editor-document-bar__post-title">
							{ title
								? stripHTML( title )
								: __( 'No title', 'zero-admin' ) }
						</span>
					</Text>
				</motion.div>
				<span className="zero-admin-media-editor-document-bar__shortcut">
					{ displayShortcut.primary( 'k' ) }
				</span>
			</Button>
		</div>
	);
}
