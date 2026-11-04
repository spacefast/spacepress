import { __ } from '@wordpress/i18n';
import {
	Button,
	Notice,
	__experimentalSpacer as Spacer,
} from '@wordpress/components';
import type { User } from '@wordpress/core-data';
import type { Form, Field } from '@zero-admin/dataviews';
import { useFieldCollections } from '@zero-admin/core-data-next';
import { DataForm } from '@zero-admin/dataviews';
import { useUserForm } from '../user/hooks';

export default function UserForm( {
	userId,
	form,
}: {
	userId: number;
	form: Form;
} ) {
	const {
		data,
		isDirty,
		isSaving,
		errorMessage,
		saveButtonLabel,
		handleOnChange,
		handleSubmit,
	} = useUserForm( userId );

	const fields = useFieldCollections( 'root', 'user' );

	if ( ! fields ) {
		return null;
	}

	return (
		<form onSubmit={ handleSubmit }>
			<DataForm
				data={ data }
				fields={ fields as Field< User | undefined >[] }
				form={ form }
				onChange={ handleOnChange }
			/>

			<Spacer marginTop={ 4 } />

			{ errorMessage && (
				<>
					<Notice status="error" isDismissible={ false }>
						{ errorMessage }
					</Notice>
					<Spacer marginTop={ 4 } />
				</>
			) }

			<Button
				variant="primary"
				type="submit"
				disabled={ ! isDirty || isSaving }
			>
				{ saveButtonLabel }
			</Button>
		</form>
	);
}
