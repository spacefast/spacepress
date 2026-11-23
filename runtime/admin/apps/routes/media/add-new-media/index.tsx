import importAttachment from '@spacepress-admin/attachment-importer';
import { Button, FormFileUpload } from '@wordpress/components';
import { useRegistry } from '@wordpress/data';
import { __, _n, _x } from '@wordpress/i18n';

interface AddNewMediaUploadButtonProps {
	buttonText?: string;
	buttonVariant?: 'link' | 'primary' | 'secondary' | 'tertiary' | undefined;
}

export const AddNewMediaUploadButton = ( {
	buttonText = 'Upload New Media',
	buttonVariant = 'primary',
}: AddNewMediaUploadButtonProps ) => {
	const registry = useRegistry();
	return (
		<FormFileUpload
			accept="*"
			onChange={ ( event: React.ChangeEvent< HTMLInputElement > ) => {
				const files = event.target.files;
				if ( files ) {
					importAttachment( registry, Array.from( files ) );
				}
			} }
			multiple={ true }
			render={ ( { openFileDialog } ) => (
				<Button
					variant={ buttonVariant }
					onClick={ openFileDialog }
					size="compact"
				>
					{ buttonText }
				</Button>
			) }
		/>
	);
};
