import { createContext, useCallback, useContext, useLayoutEffect, useState } from 'react';
import apiFetch from '@wordpress/api-fetch';
import {
	Button,
	ComboboxControl,
	FormFileUpload,
	Notice,
	SelectControl,
	TextControl,
	TextareaControl,
	ToggleControl,
} from '@wordpress/components';
import {
	EditingObjects,
	allowed,
	defaults,
	object,
	text,
	visible,
	type Column,
	type Columns,
	type Row,
} from './model';
import {
	api,
	bootstrap,
	collectionSpec,
	list,
	message,
	unwrap,
	useLoad,
} from './api';

function scalar(v: unknown): string {
	return typeof v === 'string' || typeof v === 'number' ? String(v) : '';
}
type FieldState = {
	objects: EditingObjects;
	operation: 'create' | 'update';
	validation: FieldDrafts;
};
type FieldDrafts = {
	drafts: ReadonlyMap<string, string>;
	change: (path: string, source?: string) => void;
	valid: boolean;
};
type FieldTree = {
	fields: Columns;
	values: Row;
	objects: EditingObjects;
	editing?: boolean;
	omit?: string[];
	path?: string;
};
function shownFields(fields: Columns, values: Row, editing: boolean, operation: FieldState['operation'], omit: string[] = []) {
	return Object.entries(fields).filter(([key, c]) =>
		!omit.includes(key) && !c.generated &&
		(editing ? key in values : allowed(operation === 'create' ? c.create : c.read, bootstrap().role)) &&
		visible(c.showIf, values)
	);
}
function rowPath(path: string, row: Row, column: Column, objects: EditingObjects): string {
	return `${path}/${objects.key(row)}/${column.type === 'blocks' ? encodeURIComponent(text(row.layout) ?? Object.keys(column.layouts)[0]) + '/' : ''}`;
}
function jsonPaths(tree: FieldTree, paths = new Set<string>(), operation: FieldState['operation'] = tree.editing === false ? 'create' : 'update'): Set<string> {
	const { fields, values, objects, editing = true, omit, path = '' } = tree;
	for (const [key, c] of shownFields(fields, values, editing, operation, omit)) {
		const field = `${path}${key}`, value = values[key];
		if (c.type === 'json') paths.add(field);
		else if (c.type === 'group') {
			const row = value != null && typeof value === 'object' && !Array.isArray(value) ? object(value) : {};
			jsonPaths({ fields: c.fields, values: row, objects, editing: editing && value != null && !objects.isNew(row), path: `${field}/` }, paths, operation);
		} else if ((c.type === 'repeater' || c.type === 'blocks') && Array.isArray(value)) {
			for (const item of value) {
				const row = object(item), layout = text(row.layout) ?? Object.keys(c.layouts)[0];
				jsonPaths({ fields: c.type === 'blocks' ? c.layouts[layout] ?? {} : c.fields, values: row, objects,
					editing: editing && !objects.isNew(row), path: rowPath(field, row, c, objects) }, paths, operation);
			}
		}
	}
	return paths;
}
/** The document owns drafts, including while its field panel is collapsed. */
export function useFieldDrafts(tree?: FieldTree): FieldDrafts {
	const [drafts, setDrafts] = useState(() => new Map<string, string>());
	const paths = tree ? jsonPaths(tree) : undefined;
	const current = paths ? new Map([...drafts].filter(([path]) => paths.has(path))) : drafts;
	useLayoutEffect(() => {
		if (current.size !== drafts.size) setDrafts(current);
	}, [current, drafts]);
	const change = useCallback((path: string, source?: string) => {
		setDrafts((previous) => {
			const next = new Map(previous);
			if (source === undefined) next.delete(path);
			else next.set(path, source);
			return next;
		});
	}, []);
	return { drafts: current, change, valid: current.size === 0 };
}
const EditingState = createContext<FieldState | null>(null);
function Reference({
	column,
	value,
	onChange,
	disabled,
}: {
	column: Column;
	value: unknown;
	onChange: (v: unknown) => void;
	disabled: boolean;
}) {
	const [search, setSearch] = useState('');
	const options = useLoad(async () => {
		if (column.reference) {
			const reference = column.reference;
			const target = await collectionSpec(reference.collection);
			// The target endpoint supplies its own row filtering and field masking.
			const result = await list(target, { page: 1, perPage: 30, search });
			return result.rows.flatMap((r) => {
				const key = r[reference.column];
				if (typeof key !== 'string' && typeof key !== 'number') return [];
				return [{
					value: String(key),
					label:
						target.title && r[target.title] != null
							? scalar(r[target.title])
							: `#${scalar(r[target.primaryKey])}`,
				}];
			});
		}
		const response: unknown = await apiFetch({
			path: `/wp/v2/media?per_page=30&search=${encodeURIComponent(search)}`,
		});
		if (!Array.isArray(response)) throw new Error('Expected media results.');
		return response.map((v: unknown) => {
			const r = object(v),
				title = r.title ? object(r.title) : {};
			return {
				value: String(r.id),
				label: text(title.rendered) || `#${String(r.id)}`,
			};
		});
	}, [column.reference?.collection, column.reference?.column, search]);
	const selected = scalar(value);
	const choices = options.kind === 'ready' ? options.value : [];
	// Retain the identity without inventing a label for an inaccessible target.
	const all =
		value != null && !choices.some((o) => o.value === selected)
			? [{ value: selected, label: `#${selected} (current)` }, ...choices]
			: choices;
	return (
		<fieldset disabled={disabled}>
			<ComboboxControl
				label={column.label}
				help={
					column.help ||
					'Search readable records. Clear to remove the reference.'
				}
				value={value == null ? null : selected}
				options={all}
				onFilterValueChange={setSearch}
				onChange={(v) =>
					onChange(
						v !== null
							? column.type === 'integer' ||
								column.type === 'media' ||
								column.type === 'mediaList'
								? Number(v)
								: v
							: null
					)
				}
			/>
			{options.kind === 'error' && (
				<Notice status="warning" isDismissible={false}>
					{options.message}
				</Notice>
			)}
		</fieldset>
	);
}
function FileField({
	column,
	value,
	onChange,
	disabled,
}: {
	column: Column;
	value: unknown;
	onChange: (v: unknown) => void;
	disabled: boolean;
}) {
	const [busy, setBusy] = useState(false),
		[error, setError] = useState('');
	const path = `/files/${encodeURIComponent(column.bucket ?? '')}`;
	const state = useLoad(
		async () =>
			value == null
				? null
				: object(
						unwrap(
							await apiFetch(api(`${path}/${encodeURIComponent(String(value))}`))
						)
					),
		[path, value]
	);
	return (
		<fieldset disabled={disabled || busy}>
			<legend>{column.label}</legend>
			<p>{column.help}</p>
			{state.kind === 'ready' && state.value && (
				<p>
					<a href={text(state.value.url)}>
						{text(state.value.filename) ?? `File #${String(value)}`}
					</a>
				</p>
			)}
			{state.kind === 'error' && (
				<Notice status="warning" isDismissible={false}>
					{state.message}
				</Notice>
			)}
			{error && (
				<Notice status="error" isDismissible={false}>
					{error}
				</Notice>
			)}
			<FormFileUpload
				onChange={(event) => {
					const file = event.target.files?.[0];
					if (!file) return;
					const body = new FormData();
					body.append('file', file);
					setBusy(true);
					setError('');
					apiFetch({ ...api(path), method: 'POST', body })
						.then((v: unknown) => {
							const row = object(unwrap(v));
							if (typeof row.id !== 'number')
								throw new Error('The upload returned no file identity.');
							onChange(row.id);
						})
						.catch((e: unknown) => setError(message(e)))
						.finally(() => setBusy(false));
				}}
				render={({ openFileDialog }) => (
					<Button
						variant="secondary"
						disabled={disabled || busy}
						isBusy={busy}
						onClick={openFileDialog}
					>
						{value == null ? 'Upload file' : 'Replace file'}
					</Button>
				)}
			/>
			{value != null && (
				<Button
					variant="tertiary"
					disabled={disabled || busy}
					onClick={() => onChange(null)}
				>
					Clear reference
				</Button>
			)}
		</fieldset>
	);
}
function JsonField({
	column,
	value,
	onChange,
	disabled,
	path,
}: {
	column: Column;
	value: unknown;
	onChange: (v: unknown) => void;
	disabled: boolean;
	path: string;
}) {
	const validation = useContext(EditingState)?.validation;
	const serialized = JSON.stringify(value ?? null);
	const [accepted, setAccepted] = useState(() => ({ value: serialized, source: JSON.stringify(value ?? null, null, 2) }));
	if (accepted.value !== serialized) {
		setAccepted({ value: serialized, source: JSON.stringify(value ?? null, null, 2) });
	}
	const source = validation?.drafts.get(path) ??
		(accepted.value === serialized ? accepted.source : JSON.stringify(value ?? null, null, 2));
	const invalid = validation?.drafts.has(path) ?? false;
	return (
		<label className="typedpress-schema-json">
			{column.label}
			<textarea
				value={source}
				disabled={disabled}
				aria-invalid={invalid}
				ref={(element) => element?.setCustomValidity(invalid ? 'Enter valid JSON before saving.' : '')}
				rows={8}
				onChange={(e) => {
					const v = e.target.value;
					try {
						const parsed: unknown = JSON.parse(v);
						setAccepted({ value: JSON.stringify(parsed), source: v });
						onChange(parsed);
						validation?.change(path);
						e.target.setCustomValidity('');
					} catch {
						validation?.change(path, v);
						e.target.setCustomValidity('Enter valid JSON before saving.');
					}
				}}
			/>
			{invalid && <span role="alert">Enter valid JSON before saving.</span>}
			<span>{column.help || 'JSON value'}</span>
		</label>
	);
}
function Field({
	column: c,
	value,
	onChange,
	disabled,
	editing,
	objects,
	operation,
	path,
}: {
	column: Column;
	value: unknown;
	onChange: (v: unknown) => void;
	disabled: boolean;
	editing: boolean;
	objects: EditingObjects;
	operation: FieldState['operation'];
	path: string;
}) {
	const writable = (column: Column) =>
		allowed(operation === 'create' ? column.create : column.write, bootstrap().role);
	if (c.reference || c.type === 'media')
		return (
			<Reference
				column={c}
				value={value}
				onChange={onChange}
				disabled={disabled}
			/>
		);
	if (c.type === 'group') {
		const row =
			value && typeof value === 'object' && !Array.isArray(value)
				? object(value)
				: {};
		const persisted =
			editing && value != null &&
			!(typeof value === 'object' && objects.isNew(value));
		return (
			<fieldset>
				<legend>{c.label}</legend>
				<p>{c.help}</p>
				<Fields
					path={`${path}/`}
					fields={c.fields}
					values={row}
					onChange={(key, v) => {
						const next = { ...row, [key]: v };
						objects.replace(row, next);
						if (!persisted) objects.mark(next);
						onChange(next);
					}}
					editing={persisted}
					disabled={disabled}
				/>
			</fieldset>
		);
	}
	if (c.type === 'repeater' || c.type === 'blocks' || c.type === 'mediaList') {
		const rows: unknown[] = Array.isArray(value) ? value : [];
		const layouts = Object.keys(c.layouts);
		return (
			<fieldset>
				<legend>{c.label}</legend>
				<p>{c.help}</p>
				{rows.map((item, index) => {
					const row = c.type === 'mediaList' ? {} : object(item);
					const layout = text(row.layout) ?? layouts[0];
					const fields =
						c.type === 'blocks' ? (c.layouts[layout] ?? {}) : c.fields;
					const persisted =
						editing &&
						!(item !== null && typeof item === 'object' && objects.isNew(item));
					const update = (v: unknown, fresh = false) => {
						if (v !== null && typeof v === 'object') {
							if (item !== null && typeof item === 'object') objects.replace(item, v);
							if (!persisted || fresh) objects.mark(v);
						}
						onChange(rows.map((r, i) => (i === index ? v : r)));
					};
					return (
						<div className="typedpress-schema-repeat" key={
							item !== null && typeof item === 'object'
								? `${objects.key(item)}:${c.type === 'blocks' ? layout : ''}`
								: index
						}>
							{c.type === 'mediaList' ? (
								<Reference
									column={{
										...c,
										type: 'media',
										label: `${c.label} ${index + 1}`,
									}}
									value={item}
									onChange={update}
									disabled={disabled}
								/>
							) : (
								<>
									{c.type === 'blocks' && (
										<SelectControl
											label="Layout"
											value={layout}
											options={layouts.map((l) => ({ value: l, label: l }))}
											disabled={disabled}
											onChange={(v) =>
												update({ layout: v, ...defaults(c.layouts[v], writable) }, true)
											}
										/>
									)}
									<Fields
										path={rowPath(path, row, c, objects)}
										fields={fields}
										values={row}
										onChange={(key, v) => update({ ...row, [key]: v })}
										editing={persisted}
										disabled={disabled}
									/>
								</>
							)}
							<Button
								variant="tertiary"
								isDestructive
								disabled={disabled}
								onClick={() => onChange(rows.filter((_, i) => i !== index))}
							>
								Remove {index + 1}
							</Button>
						</div>
					);
				})}
				<Button
					variant="secondary"
					disabled={disabled}
					onClick={() => {
						const item = c.type === 'mediaList'
							? null
							: c.type === 'blocks'
								? { layout: layouts[0], ...defaults(c.layouts[layouts[0]], writable) }
								: defaults(c.fields, writable);
						if (item) objects.mark(item);
						onChange([...rows, item]);
					}}
				>
					Add {c.label}
				</Button>
			</fieldset>
		);
	}
	if (c.options.length) {
		const options = [
			...(!c.multiple ? [{ label: '—', value: '' }] : []),
			...c.options.map((v) => ({ label: v, value: v })),
		];
		return c.multiple ? (
			<SelectControl
				label={c.label}
				help={c.help}
				multiple
				value={Array.isArray(value) ? value.map(scalar) : []}
				options={options}
				disabled={disabled}
				onChange={onChange}
			/>
		) : (
			<SelectControl
				label={c.label}
				help={c.help}
				required={c.required}
				value={scalar(value)}
				options={options}
				disabled={disabled}
				onChange={onChange}
			/>
		);
	}
	if (c.type === 'boolean')
		return (
			<ToggleControl
				label={c.label}
				help={c.help}
				checked={value === true || value === 1}
				disabled={disabled}
				onChange={onChange}
			/>
		);
	if (c.type === 'file')
		return (
			<FileField
				column={c}
				value={value}
				onChange={onChange}
				disabled={disabled}
			/>
		);
	if (c.type === 'json')
		return (
			<JsonField
				path={path}
				column={c}
				value={value}
				onChange={onChange}
				disabled={disabled}
			/>
		);
	if (c.multiline || c.type === 'richText')
		return (
			<TextareaControl
				label={c.label}
				help={c.help}
				value={scalar(value)}
				disabled={disabled}
				required={c.required}
				onChange={onChange}
			/>
		);
	const type =
		c.type === 'integer' || c.type === 'real'
			? 'number'
			: c.type === 'email'
				? 'email'
				: c.type === 'url'
					? 'url'
					: c.type === 'date'
						? 'date'
						: c.type === 'timestamp'
							? 'datetime-local'
							: 'text';
	const displayed =
		type === 'datetime-local'
			? scalar(value).replace(/Z$/, '').slice(0, 19)
			: scalar(value);
	return (
		<TextControl
			label={c.label}
			help={c.help}
			type={type}
			value={displayed}
			step={c.type === 'real' ? 'any' : c.type === 'integer' ? '1' : undefined}
			required={c.required}
			disabled={disabled}
			onChange={(v) =>
				onChange(
					type === 'number'
						? v === ''
							? null
							: Number(v)
						: type === 'datetime-local'
							? v
								? `${v}Z`
								: null
							: v
				)
			}
		/>
	);
}
export function Fields({
	fields,
	values,
	onChange,
	editing = true,
	disabled = false,
	omit = [],
	objects,
	jsonDrafts,
	path = '',
}: {
	fields: Columns;
	values: Row;
	onChange: (key: string, value: unknown) => void;
	editing?: boolean;
	disabled?: boolean;
	omit?: string[];
	objects?: EditingObjects;
	jsonDrafts?: FieldDrafts;
	path?: string;
}) {
	const inherited = useContext(EditingState);
	const [local] = useState(() => new EditingObjects());
	const editingObjects = objects ?? local;
	const localDrafts = useFieldDrafts(inherited || jsonDrafts ? undefined : { fields, values, objects: editingObjects, editing, omit, path });
	const validation = jsonDrafts ?? localDrafts;
	const state: FieldState = inherited ?? {
		objects: editingObjects,
		operation: editing ? 'update' : 'create',
		validation,
	};
	return (
		<EditingState.Provider value={state}>
			<div className="typedpress-schema-fields">
				{shownFields(fields, values, editing, state.operation, omit)
					.map(([key, c]) => (
						<Field
							key={key}
							path={`${path}${key}`}
							column={c}
							value={values[key]}
							onChange={(v) => onChange(key, v)}
							disabled={disabled || !allowed(state.operation === 'create' ? c.create : c.write, bootstrap().role)}
							editing={editing}
							objects={state.objects}
							operation={state.operation}
						/>
					))}
			</div>
		</EditingState.Provider>
	);
}
