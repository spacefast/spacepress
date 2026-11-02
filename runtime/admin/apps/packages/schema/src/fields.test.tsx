import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Fields } from './fields';
import { columns, type Row } from './model';

test('new repeater items retain all editable fields while returned items retain masking after removal', async () => {
	window.zeroAdmin = { native: {}, readable: [], role: 'admin' };
	const fields = columns({
		entries: { type: 'repeater', fields: {
			open: { type: 'text' }, sealed: { type: 'text' },
		} },
	});
	function Form() {
		const [values, setValues] = useState<Row>({ entries: [{ open: 'Returned' }, {}] });
		return <>
			<Fields fields={fields} values={values}
				onChange={(key, value) => setValues({ ...values, [key]: value })} />
			<output>{JSON.stringify(values)}</output>
		</>;
	}
	const user = userEvent.setup();
	render(<Form />);
	expect(screen.getAllByRole('textbox')).toHaveLength(1);
	expect(screen.queryByRole('textbox', { name: 'Sealed' })).not.toBeInTheDocument();
	await user.click(screen.getByRole('button', { name: 'Add Entries' }));
	await user.type(screen.getAllByRole('textbox', { name: 'Open' })[1], 'New');
	await user.type(screen.getByRole('textbox', { name: 'Sealed' }), 'Complete');
	await user.click(screen.getByRole('button', { name: 'Remove 1' }));
	expect(screen.getByRole('textbox', { name: 'Sealed' })).toHaveValue('Complete');
	await user.clear(screen.getByRole('textbox', { name: 'Open' }));
	await user.type(screen.getByRole('textbox', { name: 'Open' }), 'Edited');
	expect(JSON.parse(screen.getByRole('status').textContent ?? '')).toEqual({
		entries: [{}, { open: 'Edited', sealed: 'Complete' }],
	});
});

test('changing a returned block layout creates editable nested groups without exposing masked siblings', async () => {
	window.zeroAdmin = { native: {}, readable: [], role: 'admin' };
	const fields = columns({
		sections: { type: 'blocks', layouts: {
			old: { hidden: { type: 'text' } },
			new: { details: { type: 'group', fields: {
				first: { type: 'text' }, second: { type: 'text' },
			} } },
		} },
	});
	function Form() {
		const [values, setValues] = useState<Row>({ sections: [{ layout: 'old' }] });
		return <Fields fields={fields} values={values}
			onChange={(key, value) => setValues({ ...values, [key]: value })} />;
	}
	const user = userEvent.setup();
	render(<Form />);
	expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
	await user.selectOptions(screen.getByRole('combobox', { name: 'Layout' }), 'new');
	const group = screen.getByRole('group', { name: 'Details' });
	await user.type(within(group).getByRole('textbox', { name: 'First' }), 'One');
	await user.type(within(group).getByRole('textbox', { name: 'Second' }), 'Two');
	expect(within(group).getByRole('textbox', { name: 'First' })).toHaveValue('One');
});

test('create permissions differ from update permissions even for new items inside an existing record', async () => {
	window.zeroAdmin = { native: {}, readable: [], role: 'editor' };
	const fields = columns({
		createOnly: { type: 'text', access: { read: false, create: 'anyone', update: false } },
		updateOnly: { type: 'text', access: { create: false, update: 'editor' } },
		entries: { type: 'repeater', fields: {
			value: { type: 'text', access: { create: false, update: 'editor' } },
		} },
	});
	function Form() {
		const [editing, setEditing] = useState(false);
		const [values, setValues] = useState<Row>({ entries: [] });
		return <>
			<Fields fields={fields} values={values} editing={editing}
				onChange={(key, value) => setValues({ ...values, [key]: value })} />
			<button onClick={() => {
				setEditing(true);
				setValues({ updateOnly: 'Returned', entries: [] });
			}}>Load saved record</button>
		</>;
	}
	const user = userEvent.setup();
	render(<Form />);
	expect(screen.getByRole('textbox', { name: 'Create Only' })).toBeEnabled();
	expect(screen.queryByRole('textbox', { name: 'Update Only' })).not.toBeInTheDocument();
	await user.click(screen.getByRole('button', { name: 'Load saved record' }));
	expect(screen.queryByRole('textbox', { name: 'Create Only' })).not.toBeInTheDocument();
	expect(screen.getByRole('textbox', { name: 'Update Only' })).toBeEnabled();
	await user.click(screen.getByRole('button', { name: 'Add Entries' }));
	expect(screen.getByRole('textbox', { name: 'Value' })).toBeEnabled();
});
