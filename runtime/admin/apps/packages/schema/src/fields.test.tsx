import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Fields, useFieldDrafts } from './fields';
import { EditingObjects, columns, type Row } from './model';
import { fromNative, toNative } from './api';

test('native repeater edits retain provenance, JSON row identity and returned-field masking after removal', async () => {
	window.zeroAdmin = { native: { posts: { path: '/wp/v2/zero_posts', postType: 'zero_posts', metaPrefix: 'zero_' } }, readable: [], role: 'admin' };
	const fields = columns({
		payload: { type: 'json' },
		entries: { type: 'repeater', fields: {
			open: { type: 'text' }, sealed: { type: 'text' }, metadata: { type: 'json' },
		} },
	});
	const collection = { name: 'posts', label: 'Posts', columns: fields, primaryKey: 'id', access: {} };
	function Form() {
		const [objects] = useState(() => new EditingObjects());
		const [shown, setShown] = useState(true);
		const [record, setRecord] = useState<Row>(() => toNative(collection, {
			payload: { saved: true },
			entries: [{ open: 'Returned', metadata: { owner: 'first' } }, { metadata: { owner: 'second' } }, {}],
		}));
		const values = fromNative(collection, record, objects);
		const drafts = useFieldDrafts({ fields, values, objects });
		return <>
			{shown && <Fields fields={fields} values={values} objects={objects}
				jsonDrafts={drafts}
				onChange={(key, value) => setRecord(toNative(collection, { ...values, [key]: value }, objects))} />}
			<button disabled={!drafts.valid}>Save</button>
			<button onClick={() => setShown(!shown)}>Toggle fields</button>
			<button onClick={() => setRecord(toNative(collection, { ...values, entries: [] }, objects))}>External remove rows</button>
			<button onClick={() => setRecord(toNative(collection, { ...values, payload: { restored: true } }, objects))}>External restore payload</button>
			<output>{JSON.stringify(values)}</output>
		</>;
	}
	const user = userEvent.setup();
	render(<Form />);
	expect(screen.getAllByRole('textbox', { name: 'Open' })).toHaveLength(1);
	expect(screen.queryByRole('textbox', { name: 'Sealed' })).not.toBeInTheDocument();
	await user.click(screen.getByRole('button', { name: 'Add Entries' }));
	await user.type(screen.getAllByRole('textbox', { name: 'Open' })[1], 'New');
	await user.type(screen.getByRole('textbox', { name: 'Sealed' }), 'Complete');
	await user.click(screen.getByRole('button', { name: 'Remove 1' }));
	expect(screen.getAllByRole('textbox', { name: /Metadata/ })[0])
		.toHaveValue(JSON.stringify({ owner: 'second' }, null, 2));
	const json = screen.getAllByRole('textbox', { name: /Metadata/ })[1];
	await user.clear(json);
	await user.type(json, 'unfinished');
	expect(screen.getByRole('textbox', { name: 'Sealed' })).toHaveValue('Complete');
	await user.clear(screen.getByRole('textbox', { name: 'Open' }));
	await user.type(screen.getByRole('textbox', { name: 'Open' }), 'Edited');
	expect(JSON.parse(screen.getByRole('status').textContent ?? '')).toEqual({
		payload: { saved: true },
		entries: [{ metadata: { owner: 'second' } }, {}, { open: 'Edited', sealed: 'Complete' }],
	});
	expect(json).toHaveValue('unfinished');
	expect(screen.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
	await user.click(screen.getByRole('button', { name: 'Toggle fields' }));
	expect(screen.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
	await user.click(screen.getByRole('button', { name: 'Toggle fields' }));
	expect(screen.getAllByRole('textbox', { name: /Metadata/ })[1]).toHaveValue('unfinished');
	await user.click(screen.getByRole('button', { name: 'Remove 3' }));
	expect(screen.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
	await user.clear(screen.getByRole('textbox', { name: /Metadata/ }));
	await user.type(screen.getByRole('textbox', { name: /Metadata/ }), 'orphaned draft');
	await user.click(screen.getByRole('button', { name: 'Toggle fields' }));
	await user.click(screen.getByRole('button', { name: 'External remove rows' }));
	expect(screen.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
	await user.click(screen.getByRole('button', { name: 'Toggle fields' }));
	expect(screen.queryByRole('textbox', { name: /Metadata/ })).not.toBeInTheDocument();
	await user.clear(screen.getByRole('textbox', { name: /Payload/ }));
	await user.type(screen.getByRole('textbox', { name: /Payload/ }), '123');
	await user.click(screen.getByRole('button', { name: 'External restore payload' }));
	expect(JSON.parse(screen.getByRole('status').textContent ?? '').payload).toEqual({ restored: true });
	expect(screen.getByRole('textbox', { name: /Payload/ })).toHaveValue(JSON.stringify({ restored: true }, null, 2));

});

test('changing a returned block layout creates editable nested groups without exposing masked siblings', async () => {
	window.zeroAdmin = { native: {}, readable: [], role: 'admin' };
	const fields = columns({
		sections: { type: 'blocks', layouts: {
			old: { hidden: { type: 'text' }, payload: { type: 'json' } },
			new: { payload: { type: 'json' }, details: { type: 'group', fields: {
				first: { type: 'text' }, second: { type: 'text' },
			} } },
		} },
	});
	function Form() {
		const [values, setValues] = useState<Row>({ sections: [{ layout: 'old', payload: { old: true } }] });
		return <Fields fields={fields} values={values}
			onChange={(key, value) => setValues({ ...values, [key]: value })} />;
	}
	const user = userEvent.setup();
	render(<Form />);
	expect(screen.queryByRole('textbox', { name: 'Hidden' })).not.toBeInTheDocument();
	expect(screen.getByRole('textbox', { name: /Payload/ })).toHaveValue(JSON.stringify({ old: true }, null, 2));
	await user.clear(screen.getByRole('textbox', { name: /Payload/ }));
	await user.type(screen.getByRole('textbox', { name: /Payload/ }), 'layout unfinished');
	expect(screen.getByRole('textbox', { name: /Payload/ })).toHaveAttribute('aria-invalid', 'true');
	await user.selectOptions(screen.getByRole('combobox', { name: 'Layout' }), 'new');
	expect(screen.getByRole('textbox', { name: /Payload/ })).toHaveValue('null');
	expect(screen.getByRole('textbox', { name: /Payload/ })).toHaveAttribute('aria-invalid', 'false');
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
