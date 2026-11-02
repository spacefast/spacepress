import { createContext, useContext, useState } from 'react';
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
type FieldState = { created: WeakSet<object>; operation: 'create' | 'update' };
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
	const path = `/zero/v1/files/${encodeURIComponent(column.bucket ?? '')}`;
	const state = useLoad(
		async () =>
			value == null
				? null
				: object(
						unwrap(
							await apiFetch({
								path: `${path}/${encodeURIComponent(String(value))}`,
							})
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
					apiFetch({ path, method: 'POST', body })
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
}: {
	column: Column;
	value: unknown;
	onChange: (v: unknown) => void;
	disabled: boolean;
}) {
	const [source, setSource] = useState(JSON.stringify(value ?? null, null, 2));
	return (
		<label className="zero-schema-json">
			{column.label}
			<textarea
				value={source}
				disabled={disabled}
				rows={8}
				onChange={(e) => {
					const v = e.target.value;
					setSource(v);
					try {
						const parsed: unknown = JSON.parse(v);
						onChange(parsed);
						e.target.setCustomValidity('');
					} catch {
						e.target.setCustomValidity('Enter valid JSON before saving.');
					}
				}}
			/>
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
	created,
	operation,
}: {
	column: Column;
	value: unknown;
	onChange: (v: unknown) => void;
	disabled: boolean;
	editing: boolean;
	created: WeakSet<object>;
	operation: FieldState['operation'];
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
			!(typeof value === 'object' && created.has(value));
		return (
			<fieldset>
				<legend>{c.label}</legend>
				<p>{c.help}</p>
				<Fields
					fields={c.fields}
					values={row}
					onChange={(key, v) => {
						const next = { ...row, [key]: v };
						if (!persisted) created.add(next);
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
						!(item !== null && typeof item === 'object' && created.has(item));
					const update = (v: unknown, fresh = false) => {
						if ((!persisted || fresh) && v !== null && typeof v === 'object')
							created.add(v);
						onChange(rows.map((r, i) => (i === index ? v : r)));
					};
					return (
						<div className="zero-schema-repeat" key={index}>
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
						if (item) created.add(item);
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
}: {
	fields: Columns;
	values: Row;
	onChange: (key: string, value: unknown) => void;
	editing?: boolean;
	disabled?: boolean;
	omit?: string[];
}) {
	const { role } = bootstrap();
	const inherited = useContext(EditingState);
	const [local] = useState(() => new WeakSet<object>());
	const state: FieldState = inherited ?? {
		created: local,
		operation: editing ? 'update' : 'create',
	};
	return (
		<EditingState.Provider value={state}>
			<div className="zero-schema-fields">
				{Object.entries(fields)
					.filter(
						([key, c]) =>
							!omit.includes(key) &&
							!c.generated &&
							(editing ? key in values :
								allowed(state.operation === 'create' ? c.create : c.read, role)) &&
							visible(c.showIf, values)
					)
					.map(([key, c]) => (
						<Field
							key={key}
							column={c}
							value={values[key]}
							onChange={(v) => onChange(key, v)}
							disabled={disabled || !allowed(state.operation === 'create' ? c.create : c.write, role)}
							editing={editing}
							created={state.created}
							operation={state.operation}
						/>
					))}
			</div>
		</EditingState.Provider>
	);
}
