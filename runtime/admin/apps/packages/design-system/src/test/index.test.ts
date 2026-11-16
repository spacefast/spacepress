import { glob, readFile } from 'node:fs/promises';
import { basename, join, dirname, resolve } from 'node:path';

const FILE_IGNORE_PATTERN = /\.stories\.tsx$/;

/**
 * Iterates through a given set of file paths, returning the an array of the
 * file name and its contents for the first file that exists.
 *
 * @param files Paths to read.
 * @return Array of the file name and its contents for the first file that exists.
 */
async function getFirstFile(
	...files: string[]
): Promise< [ string, string ] | [] > {
	for ( const file of files ) {
		try {
			const content = await readFile( file, 'utf-8' );
			return [ file, content ];
		} catch {}
	}

	return [];
}

describe( '@zero-admin/design-system', () => {
	it( 'consistently forwards refs in each component', async () => {
		const files = glob( '../../src/**/*.tsx', { cwd: __dirname } );

		const promises: Promise< void >[] = [];

		for await ( const file of files ) {
			if ( FILE_IGNORE_PATTERN.test( file ) ) {
				continue;
			}

			const dir = dirname( file );
			if ( basename( dir ) === 'test' ) {
				continue;
			}

			// Check for either component-specific or index test files, where
			// index test files are expected to include rendering of compound
			// components. Prefer the index test file if it exists.
			const baseName = basename( file, '.tsx' );
			const indexTestPath = join( dir, `test/index.test.tsx` );
			const componentTestPath = join(
				dir,
				`test/${ baseName }.test.tsx`
			);

			promises.push(
				( async () => {
					const [ firstFile, content ] = await getFirstFile(
						resolve( __dirname, indexTestPath ),
						resolve( __dirname, componentTestPath )
					);

					if ( ! firstFile || ! content ) {
						throw new Error(
							`Test file not found for component ${ file } (looked for ${ indexTestPath } or ${ componentTestPath })`
						);
					}

					if ( content.includes( "it( 'forwards ref'," ) ) {
						return;
					}

					throw new Error(
						`Test file ${ firstFile } does not include test for forwarding ref.

Expected to find content "it( 'forwards ref',"`
					);
				} )()
			);
		}

		await Promise.all( promises );
	} );
} );
