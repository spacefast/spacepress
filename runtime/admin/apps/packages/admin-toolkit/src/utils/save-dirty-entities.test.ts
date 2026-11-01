import {
	registerBeforeSaveHandler,
	saveDirtyEntities,
	saveDirtyEntitiesSettled,
	type DirtyEntityRecord,
} from './save-dirty-entities';

type FakeRecordKey = number | string | undefined;
type FakeRecord = Record< string, unknown >;
type FakeSaveValue = unknown | Error;

type FakeRegistry = {
	registry: {
		select: jest.Mock;
		dispatch: jest.Mock;
	};
	editEntityRecord: jest.Mock;
	saveEditedEntityRecord: jest.Mock;
	getDirtyEntityRecords: () => DirtyEntityRecord[];
};

function getRecordId( kind: string, name: string, key: FakeRecordKey ): string {
	return `${ kind }::${ name }::${
		typeof key === 'undefined' ? '__undefined__' : String( key )
	}`;
}

function isSameDirtyEntityRecord(
	record: DirtyEntityRecord,
	kind: string,
	name: string,
	key: FakeRecordKey
): boolean {
	return record.kind === kind && record.name === name && record.key === key;
}

function createRegistry( {
	dirtyEntityRecords,
	records,
	savedValues,
}: {
	dirtyEntityRecords: DirtyEntityRecord[];
	records: Record< string, FakeRecord >;
	savedValues?: Record< string, FakeSaveValue >;
} ): FakeRegistry {
	let currentDirtyEntityRecords = [ ...dirtyEntityRecords ];
	const recordStore = { ...records };
	const editEntityRecord = jest.fn(
		(
			kind: string,
			name: string,
			key: FakeRecordKey,
			edits: Record< string, unknown >
		) => {
			const recordId = getRecordId( kind, name, key );
			recordStore[ recordId ] = {
				...( recordStore[ recordId ] ?? {} ),
				...edits,
			};
		}
	);
	const saveEditedEntityRecord = jest.fn(
		async (
			kind: string,
			name: string,
			key: FakeRecordKey
		): Promise< unknown > => {
			currentDirtyEntityRecords = currentDirtyEntityRecords.filter(
				( record ) =>
					! isSameDirtyEntityRecord( record, kind, name, key )
			);

			const savedValue = savedValues?.[ getRecordId( kind, name, key ) ];
			if ( savedValue instanceof Error ) {
				throw savedValue;
			}

			return savedValue ?? recordStore[ getRecordId( kind, name, key ) ];
		}
	);

	return {
		registry: {
			select: jest.fn( () => ( {
				__experimentalGetDirtyEntityRecords: () =>
					currentDirtyEntityRecords,
				getEditedEntityRecord: (
					kind: string,
					name: string,
					key: FakeRecordKey
				) => recordStore[ getRecordId( kind, name, key ) ],
			} ) ),
			dispatch: jest.fn( () => ( {
				editEntityRecord,
				saveEditedEntityRecord,
			} ) ),
		},
		editEntityRecord,
		saveEditedEntityRecord,
		getDirtyEntityRecords: () => currentDirtyEntityRecords,
	};
}

describe( 'saveDirtyEntities', () => {
	const unregisterCallbacks: Array< () => void > = [];

	afterEach( () => {
		while ( unregisterCallbacks.length > 0 ) {
			unregisterCallbacks.pop()?.();
		}

		jest.clearAllMocks();
	} );

	it( 'saves independent dirty entities in parallel', async () => {
		const dirtyEntityRecords: DirtyEntityRecord[] = [
			{ kind: 'root', name: 'booking', key: -1 },
			{ kind: 'woocommerce', name: 'customer', key: -1 },
		];
		const { registry, saveEditedEntityRecord } = createRegistry( {
			dirtyEntityRecords,
			records: {
				[ getRecordId( 'root', 'booking', -1 ) ]: { id: -1 },
				[ getRecordId( 'woocommerce', 'customer', -1 ) ]: { id: -1 },
			},
		} );

		let resolveBooking: ( value: unknown ) => void = () => undefined;
		let resolveCustomer: ( value: unknown ) => void = () => undefined;
		let notifyCallsStarted: () => void = () => undefined;
		const callsStarted = new Promise< void >( ( resolve ) => {
			notifyCallsStarted = resolve;
		} );
		let saveCallCount = 0;

		saveEditedEntityRecord.mockImplementation(
			( kind: string, name: string ): Promise< unknown > =>
				new Promise( ( resolve ) => {
					saveCallCount += 1;
					if ( saveCallCount === 2 ) {
						notifyCallsStarted();
					}

					if ( kind === 'root' && name === 'booking' ) {
						resolveBooking = resolve;
						return;
					}

					resolveCustomer = resolve;
				} )
		);

		const savePromise = saveDirtyEntities( {
			registry,
			dirtyEntityRecords,
		} );

		await callsStarted;

		expect( saveEditedEntityRecord ).toHaveBeenCalledTimes( 2 );

		resolveBooking( { id: 301 } );
		resolveCustomer( { id: 91 } );

		await expect( savePromise ).resolves.toEqual( [
			{ id: 301 },
			{ id: 91 },
		] );
	} );

	it( 're-reads dirty entities after beforeSave and saves the remainder', async () => {
		const dirtyEntityRecords: DirtyEntityRecord[] = [
			{ kind: 'root', name: 'booking', key: -1 },
			{ kind: 'woocommerce', name: 'customer', key: -1 },
		];
		const {
			registry,
			editEntityRecord,
			saveEditedEntityRecord,
			getDirtyEntityRecords,
		} = createRegistry( {
			dirtyEntityRecords,
			records: {
				[ getRecordId( 'root', 'booking', -1 ) ]: {
					id: -1,
					customerId: 'pending-new-customer',
				},
				[ getRecordId( 'woocommerce', 'customer', -1 ) ]: {
					id: -1,
					email: 'bookings@example.com',
				},
			},
			savedValues: {
				[ getRecordId( 'root', 'booking', -1 ) ]: { id: 401 },
				[ getRecordId( 'woocommerce', 'customer', -1 ) ]: { id: 94 },
			},
		} );

		unregisterCallbacks.push(
			registerBeforeSaveHandler(
				registry,
				async ( { registry: beforeSaveRegistry } ) => {
					const coreDispatch = beforeSaveRegistry.dispatch(
						'core'
					) as {
						editEntityRecord: typeof editEntityRecord;
						saveEditedEntityRecord: typeof saveEditedEntityRecord;
					};

					const createdCustomer =
						await coreDispatch.saveEditedEntityRecord(
							'woocommerce',
							'customer',
							-1,
							{ throwOnError: true }
						);

					coreDispatch.editEntityRecord( 'root', 'booking', -1, {
						customer_id: 94,
						customerId: String(
							( createdCustomer as { id: number } ).id
						),
					} );
				}
			)
		);

		const values = await saveDirtyEntities( {
			registry,
			dirtyEntityRecords,
		} );

		expect( saveEditedEntityRecord ).toHaveBeenNthCalledWith(
			1,
			'woocommerce',
			'customer',
			-1,
			expect.objectContaining( { throwOnError: true } )
		);
		expect( editEntityRecord ).toHaveBeenCalledWith(
			'root',
			'booking',
			-1,
			{
				customer_id: 94,
				customerId: '94',
			}
		);
		expect( saveEditedEntityRecord ).toHaveBeenNthCalledWith(
			2,
			'root',
			'booking',
			-1,
			expect.objectContaining( { throwOnError: true } )
		);
		expect( getDirtyEntityRecords() ).toEqual( [] );
		expect( values ).toEqual( [ { id: 401 } ] );
	} );

	it( 'shares the same in-flight save when saveDirtyEntities is called twice', async () => {
		const dirtyEntityRecords: DirtyEntityRecord[] = [
			{ kind: 'root', name: 'booking', key: -1 },
		];
		const { registry, saveEditedEntityRecord } = createRegistry( {
			dirtyEntityRecords,
			records: {
				[ getRecordId( 'root', 'booking', -1 ) ]: { id: -1 },
			},
			savedValues: {
				[ getRecordId( 'root', 'booking', -1 ) ]: { id: 401 },
			},
		} );
		let resolveBeforeSave: () => void = () => undefined;
		const beforeSavePromise = new Promise< void >( ( resolve ) => {
			resolveBeforeSave = resolve;
		} );
		const beforeSave = jest.fn( () => beforeSavePromise );

		unregisterCallbacks.push(
			registerBeforeSaveHandler( registry, beforeSave )
		);

		const firstSave = saveDirtyEntities( {
			registry,
			dirtyEntityRecords,
		} );
		const secondSave = saveDirtyEntities( {
			registry,
			dirtyEntityRecords,
		} );

		await Promise.resolve();

		expect( beforeSave ).toHaveBeenCalledTimes( 1 );

		resolveBeforeSave();

		await expect(
			Promise.all( [ firstSave, secondSave ] )
		).resolves.toEqual( [ [ { id: 401 } ], [ { id: 401 } ] ] );
		expect( saveEditedEntityRecord ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'shares the same in-flight save between saveDirtyEntities and saveDirtyEntitiesSettled', async () => {
		const dirtyEntityRecords: DirtyEntityRecord[] = [
			{ kind: 'root', name: 'booking', key: -1 },
		];
		const { registry, saveEditedEntityRecord } = createRegistry( {
			dirtyEntityRecords,
			records: {
				[ getRecordId( 'root', 'booking', -1 ) ]: { id: -1 },
			},
			savedValues: {
				[ getRecordId( 'root', 'booking', -1 ) ]: { id: 401 },
			},
		} );
		let resolveBeforeSave: () => void = () => undefined;
		const beforeSavePromise = new Promise< void >( ( resolve ) => {
			resolveBeforeSave = resolve;
		} );
		const beforeSave = jest.fn( () => beforeSavePromise );

		unregisterCallbacks.push(
			registerBeforeSaveHandler( registry, beforeSave )
		);

		const firstSave = saveDirtyEntities( { registry, dirtyEntityRecords } );
		const secondSave = saveDirtyEntitiesSettled( {
			registry,
			dirtyEntityRecords,
		} );

		await Promise.resolve();

		expect( beforeSave ).toHaveBeenCalledTimes( 1 );

		resolveBeforeSave();

		await expect( firstSave ).resolves.toEqual( [ { id: 401 } ] );
		await expect( secondSave ).resolves.toEqual( [
			{
				status: 'fulfilled',
				value: { id: 401 },
			},
		] );
		expect( saveEditedEntityRecord ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'runs beforeSave handlers only for the current registry', async () => {
		const dirtyEntityRecords: DirtyEntityRecord[] = [
			{ kind: 'root', name: 'booking', key: -1 },
		];
		const firstRegistryState = createRegistry( {
			dirtyEntityRecords,
			records: {
				[ getRecordId( 'root', 'booking', -1 ) ]: { id: -1 },
			},
			savedValues: {
				[ getRecordId( 'root', 'booking', -1 ) ]: { id: 401 },
			},
		} );
		const secondRegistryState = createRegistry( {
			dirtyEntityRecords,
			records: {
				[ getRecordId( 'root', 'booking', -1 ) ]: { id: -2 },
			},
			savedValues: {
				[ getRecordId( 'root', 'booking', -1 ) ]: { id: 402 },
			},
		} );
		const firstBeforeSave = jest.fn();
		const secondBeforeSave = jest.fn();

		unregisterCallbacks.push(
			registerBeforeSaveHandler(
				firstRegistryState.registry,
				firstBeforeSave
			)
		);
		unregisterCallbacks.push(
			registerBeforeSaveHandler(
				secondRegistryState.registry,
				secondBeforeSave
			)
		);

		await expect(
			saveDirtyEntities( {
				registry: firstRegistryState.registry,
				dirtyEntityRecords,
			} )
		).resolves.toEqual( [ { id: 401 } ] );

		expect( firstBeforeSave ).toHaveBeenCalledTimes( 1 );
		expect( secondBeforeSave ).not.toHaveBeenCalled();
		expect(
			firstRegistryState.saveEditedEntityRecord
		).toHaveBeenCalledTimes( 1 );
		expect(
			secondRegistryState.saveEditedEntityRecord
		).not.toHaveBeenCalled();
	} );

	it( 'returns settled results when some saves fail', async () => {
		const dirtyEntityRecords: DirtyEntityRecord[] = [
			{ kind: 'root', name: 'booking', key: -1 },
			{ kind: 'woocommerce', name: 'customer', key: -1 },
		];
		const bookingError = new Error( 'Unable to save booking.' );
		const { registry, saveEditedEntityRecord } = createRegistry( {
			dirtyEntityRecords,
			records: {
				[ getRecordId( 'root', 'booking', -1 ) ]: { id: -1 },
				[ getRecordId( 'woocommerce', 'customer', -1 ) ]: { id: -1 },
			},
			savedValues: {
				[ getRecordId( 'root', 'booking', -1 ) ]: bookingError,
				[ getRecordId( 'woocommerce', 'customer', -1 ) ]: { id: 91 },
			},
		} );

		const results = await saveDirtyEntitiesSettled( {
			registry,
			dirtyEntityRecords,
		} );

		expect( saveEditedEntityRecord ).toHaveBeenCalledTimes( 2 );
		expect( results ).toEqual( [
			{
				status: 'rejected',
				reason: bookingError,
			},
			{
				status: 'fulfilled',
				value: { id: 91 },
			},
		] );
	} );

	it( 'stops saving remaining dirty entities when beforeSave throws', async () => {
		const dirtyEntityRecords: DirtyEntityRecord[] = [
			{ kind: 'root', name: 'booking', key: -1 },
		];
		const { registry, saveEditedEntityRecord } = createRegistry( {
			dirtyEntityRecords,
			records: {
				[ getRecordId( 'root', 'booking', -1 ) ]: { id: -1 },
			},
		} );
		const beforeSaveError = new Error( 'Pending customer draft missing.' );

		unregisterCallbacks.push(
			registerBeforeSaveHandler( registry, () => {
				throw beforeSaveError;
			} )
		);

		await expect(
			saveDirtyEntities( {
				registry,
				dirtyEntityRecords,
			} )
		).rejects.toThrow( beforeSaveError.message );
		expect( saveEditedEntityRecord ).not.toHaveBeenCalled();
	} );
} );
