import { unlock } from '@zero-admin/admin-toolkit';
import { Link } from '@wordpress/ui';
import { __ } from '@wordpress/i18n';
import type { Theme } from '@wordpress/core-data';
import { decodeEntities } from '@wordpress/html-entities';
import {
	privateApis as componentsPrivateApis,
	Modal,
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
	__experimentalText as Text,
	Button,
} from '@wordpress/components';
import { useThemeService } from './hooks/use-theme-service';

interface ThemeDetailModalProps {
	theme: Theme;
	onClose: () => void;
}

export default function ThemeDetailModal( {
	theme,
	onClose,
}: ThemeDetailModalProps ) {
	const { editTheme, useIsSavingTheme } = useThemeService();
	const isSaving = useIsSavingTheme( theme );

	const toggleAutoUpdates = () => {
		void editTheme(
			theme,
			[ 'auto_updates', 'enabled' ],
			! theme.auto_updates.enabled
		);
	};

	const themeScreenshot = theme.screenshot ? (
		<div className="theme-details-preview">
			<img
				src={ theme.screenshot }
				alt={ __( 'Theme screenshot', 'zero-admin' ) }
			/>
		</div>
	) : null;

	const renderAutoUpdates = () => {
		if ( theme.auto_updates.forced === false ) {
			return (
				<Text variant="muted">
					{ __( 'Auto-updates disabled', 'zero-admin' ) }
				</Text>
			);
		} else if ( theme.auto_updates.forced ) {
			return (
				<Text variant="muted">
					{ __( 'Auto-updates enabled', 'zero-admin' ) }
				</Text>
			);
		} else if ( theme.auto_updates.enabled ) {
			return (
				<Button
					__next40pxDefaultSize
					className="theme-toggle-auto-updates-button"
					disabled={ isSaving }
					onClick={ toggleAutoUpdates }
					variant="link"
				>
					{ __( 'Disable auto-updates', 'zero-admin' ) }
				</Button>
			);
		}

		return (
			<Button
				__next40pxDefaultSize
				className="theme-toggle-auto-updates-button"
				disabled={ isSaving }
				onClick={ toggleAutoUpdates }
				variant="link"
			>
				{ __( 'Enable auto-updates', 'zero-admin' ) }
			</Button>
		);
	};

	const renderTags = ( tags: { rendered?: string } | null | undefined ) => {
		if ( ! tags?.rendered ) {
			return null;
		}

		return (
			<Text variant="muted">
				<strong className="theme-details-tags-label">
					{ __( 'Tags:', 'zero-admin' ) }
				</strong>
				{ tags.rendered }
			</Text>
		);
	};

	const isActive = theme.status === 'active';
	// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- unlock() returns untyped private APIs
	const { Badge } = unlock( componentsPrivateApis );

	return (
		<Modal
			onRequestClose={ onClose }
			className="theme-detail-modal"
			size="large"
			title={ decodeEntities( theme.name.rendered ) }
		>
			<VStack spacing={ 4 }>
				<HStack spacing={ 6 } alignment="flex-start">
					<div className="theme-details-preview-container">
						{ themeScreenshot }
					</div>

					<VStack spacing={ 4 } className="theme-details-info">
						{ isActive && (
							<div>
								<Badge>{ __( 'Active', 'zero-admin' ) }</Badge>
							</div>
						) }

						{ theme.description && (
							<Text>
								{ decodeEntities( theme.description.rendered ) }
							</Text>
						) }

						<Text variant="muted">
							{ __( 'By', 'zero-admin' ) }{ ' ' }
							{ ( () => {
								const authorName =
									theme?.author?.raw &&
									theme.author.raw !== ''
										? decodeEntities( theme.author.raw )
										: __( 'Anonymous', 'zero-admin' );
								return theme?.author_uri?.raw ? (
									<Link
										href={ decodeEntities(
											theme.author_uri.raw
										) }
										openInNewTab
									>
										{ authorName }
									</Link>
								) : (
									authorName
								);
							} )() }
						</Text>
						{ theme.version && (
							<Text variant="muted">
								<span className="theme-details-version-label">
									{ __( 'Version:', 'zero-admin' ) }
								</span>
								{ theme.version }
							</Text>
						) }

						{ theme.auto_updates.supported && renderAutoUpdates() }

						{ theme.tags && renderTags( theme.tags ) }
					</VStack>
				</HStack>
			</VStack>
		</Modal>
	);
}
