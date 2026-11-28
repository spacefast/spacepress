<?php

declare(strict_types=1);

namespace SpacePress\Media;

use SpacePress\Access;
use SpacePress\Extensions;
use SpacePress\HttpError;
use SpacePress\Js;
use SpacePress\Response;
use SpacePress\Schema;
use SpacePress\Signer;
use SpacePress\Viewer;

use function SpacePress\db;

/**
 * Private file buckets (phase 2 §7.2): `files("decks", {...})` rows owned by their uploader, bytes
 * outside any public directory, read only through a signed 5-minute download URL that PHP streams.
 * FileStorage (WpFiles) owns the persistence.
 */
final class Files {

	public const TTL    = 300;
	private const RULES = array(
		'read'   => array( 'owner' => true ),
		'create' => array( 'role' => 'authenticated' ),
		'delete' => array( 'owner' => true ),
	);

	private static ?FileStorage $storage        = null;
	private static ?\SpacePress\Db $storage_for = null;

	public static function register(): void {
		Extensions::route( 'files', FileRoutes::dispatch( ... ) );
		\SpacePress\SystemTables::register(
			'__sp_files',
			array(
				'CREATE TABLE IF NOT EXISTS `{prefix}sp__files` (`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, `app` VARCHAR(191) NOT NULL DEFAULT \'\', `bucket` TEXT NOT NULL, `filename` TEXT NOT NULL, `mime` TEXT NOT NULL, `size` BIGINT NOT NULL, `path` TEXT NOT NULL, `ownerId` BIGINT UNSIGNED NULL, `createdAt` CHAR(24) NOT NULL, PRIMARY KEY (`id`), KEY `app` (`app`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
			)
		);
		// `file({ bucket })` columns: existence + bucket on write, populate with `with`, null on delete.
		// After before-hooks and persistence, still inside the transaction: hooks can't slip an unchecked id in.
		Extensions::onWritten( self::check_columns( ... ) );
		Extensions::beforeRead( self::take_with( ... ), constraintSafe: true );
		Extensions::onRead( self::populate( ... ), constraintSafe: true, reads: static fn ( string $collection ): array => self::$wanted[ $collection ] ?? array() );
		Extensions::schemaDescribe(
			static function ( array $description ): array {
				if ( ( $description['files'] ?? array() ) !== array() ) {
					try {
						$description['runtime']['privateFiles'] = self::storage()->describe();
					} catch ( \LogicException ) {
						// A schema described outside a booted app has no storage to report on.
					}
				}

				return $description;
			}
		);
	}

	/** The active app's private-file storage. */
	public static function storage(): FileStorage {
		if ( null === self::$storage || self::$storage_for !== db() ) { // phpcs:ignore WordPress.PHP.YodaConditions.NotYoda -- Preserve the existing comparison order.
			self::$storage     = new \SpacePress\Wp\WpFiles( \SpacePress\Wp\Runtime::plugin()?->connection() ?? throw new \LogicException( 'No SpacePress app is active' ), db()->schema()->name() );
			self::$storage_for = db();
		}

		return self::$storage;
	}

	/** @return array<string, array{accept: list<string>, maxBytes: int, access: array}> */
	public static function buckets(): array {
		return db()->schema()->files();
	}

	public static function bucket( string $name ): array {
		return self::buckets()[ $name ] ?? throw HttpError::notFound( "Unknown file bucket '$name'" );
	}

	/**
	 * One bucket rule for one row (or none, for create). "owner" compares ownerId to the viewer;
	 * a null viewer is trusted.
	 */
	public static function allowed( array $bucket, string $op, ?Viewer $viewer, ?array $row ): bool {
		if ( null === $viewer ) {
			return true;
		}
		$rule = $bucket['access'][ $op ] ?? self::RULES[ $op ];
		if ( ( $rule['owner'] ?? false ) === true ) {
			return null !== $viewer->user && null !== $row && $row['ownerId'] === (int) $viewer->user['id'];
		}
		$r = Access::evaluate( $rule, $viewer, $op, null );
		if ( is_array( $r ) ) {
			throw new \LogicException( "The $op rule of a file bucket returned a filter; it must return a boolean" );
		}

		return $r;
	}

	public static function require( array $bucket, string $name, string $op, ?Viewer $viewer, ?array $row ): void {
		if ( ! self::allowed( $bucket, $op, $viewer, $row ) ) {
			throw Access::deny( $viewer?->user, "$op files in $name" );
		}
	}

	// ================================================================ rows

	public static function upload( string $name, string $tmpPath, string $filename, ?Viewer $viewer ): array { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		$bucket = self::bucket( $name );
		self::require( $bucket, $name, 'create', $viewer, null );
		$storage = self::storage();
		if ( ( $why = $storage->unavailable() ) !== null ) { // phpcs:ignore Generic.CodeAnalysis.AssignmentInCondition.Found, Squiz.PHP.DisallowMultipleAssignments.FoundInControlStructure -- Keep the assignment and its test together.
			throw new HttpError( 503, 'files_unavailable', $why );
		}
		if ( ! is_file( $tmpPath ) ) { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
			throw HttpError::invalidInput( 'No file was uploaded', '/file' );
		}
		$size = (int) filesize( $tmpPath ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		if ( $size > (int) $bucket['maxBytes'] ) {
			throw new HttpError( 413, 'payload_too_large', "Files in $name are limited to {$bucket['maxBytes']} bytes" );
		}
		$mime = ( new \finfo( FILEINFO_MIME_TYPE ) )->file( $tmpPath ) ?: 'application/octet-stream'; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase, Universal.Operators.DisallowShortTernary.Found -- Preserve the existing PHP variable name. Keep the existing falsey fallback.
		if ( ! self::accepts( $bucket['accept'], $mime ) ) {
			throw HttpError::invalidInput( "$name accepts " . implode( ', ', $bucket['accept'] ) . "; this file is $mime", '/file' );
		}
		$rel = $name . '/' . wp_generate_uuid4();
		$storage->store( $tmpPath, $rel ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		$row = array(
			'bucket'    => $name,
			'filename'  => self::filename( $filename ),
			'mime'      => $mime,
			'size'      => $size,
			'path'      => $rel,
			'ownerId'   => isset( db()->actor()['id'] ) ? (int) db()->actor()['id'] : null,
			'createdAt' => Js::iso( Js::now() ),
		);
		$id  = $storage->insert( $row );

		return self::present( array( 'id' => $id ) + $row );
	}

	/** Readable row with a fresh signed url, or a 404 for a missing row / wrong bucket. */
	public static function get( string $name, int $id, ?Viewer $viewer ): array {
		$bucket = self::bucket( $name );
		$row    = self::find( $name, $id );
		self::require( $bucket, $name, 'read', $viewer, $row );

		return self::present( $row );
	}

	/** Maximum file size read into memory by trusted server handlers (`readText` / `readBase64`). */
	public const MAX_READ_BYTES = 16_777_216;

	/** Trusted server metadata read (+ signed url) as a JsObject, or null when missing / wrong bucket. */
	// phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the method name used by compiled PHP.
	public static function getOrNull( string $name, int $id ): ?\SpacePress\JsObject {
		self::bucket( $name );
		$row = self::storage()->getMany( array( $id ) )[ $id ] ?? null;
		if ( null === $row || $row['bucket'] !== $name ) {
			return null;
		}

		return new \SpacePress\JsObject( self::present( $row ) );
	}

	/** Trusted server read of raw file bytes from the configured local or S3 storage backend. */
	public static function readBytes( string $name, int $id, int $maxBytes = self::MAX_READ_BYTES ): string { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid, WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP method name. Preserve the existing PHP variable name.
		self::bucket( $name );
		$row = self::find( $name, $id );
		if ( $row['size'] > $maxBytes ) { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
			throw new HttpError( 413, 'file_too_large', "File $id exceeds the {$maxBytes}-byte read limit" ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.InterpolatedVariableNotSnakeCase -- Preserve the existing PHP variable name.
		}
		$stream = self::storage()->stream( $row['path'] );
		ob_start();
		try {
			$stream();
			$bytes = (string) ob_get_contents();
		} finally {
			ob_end_clean();
		}
		if ( strlen( $bytes ) > $maxBytes ) { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
			throw new HttpError( 413, 'file_too_large', "File $id exceeds the {$maxBytes}-byte read limit" ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.InterpolatedVariableNotSnakeCase -- Preserve the existing PHP variable name.
		}

		return $bytes;
	}

	/** Trusted server read of a private file as validated UTF-8 text. */
	// phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the method name used by compiled PHP.
	public static function readText( string $name, int $id ): string {
		$bytes = self::readBytes( $name, $id );
		if ( ! mb_check_encoding( $bytes, 'UTF-8' ) ) {
			throw new HttpError( 422, 'invalid_utf8', "File $id is not valid UTF-8 text" );
		}

		return $bytes;
	}

	/** Trusted server read of a private file as standard base64. */
	// phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the method name used by compiled PHP.
	public static function readBase64( string $name, int $id ): string {
		return base64_encode( self::readBytes( $name, $id ) );
	}

	/** Delete a file: null every `file` column holding it (hooks + revisions apply), then the row. */
	public static function delete( string $name, int $id, ?Viewer $viewer ): array {
		$bucket = self::bucket( $name );
		$row    = self::find( $name, $id );
		self::require( $bucket, $name, 'delete', $viewer, $row );
		$db = db();
		foreach ( $db->schema()->collections() as $c => $spec ) {
			foreach ( $spec['columns'] as $col => $def ) {
				if ( 'file' === $def['type'] && ( $def['bucket'] ?? null ) === $name ) {
					$db->update( (string) $c, array( $col => null ), array( $col => $id ) );
				}
			}
		}
		// Only once every column is nulled: a hook on a later update may have put an id back.
		foreach ( $db->schema()->collections() as $c => $spec ) {
			foreach ( $spec['columns'] as $col => $def ) {
				if ( 'file' === $def['type'] && ( $def['bucket'] ?? null ) === $name && $db->findFirst( (string) $c, array( 'where' => array( $col => $id ) ) ) !== null ) {
					throw new HttpError( 409, 'reference_violation', "Rows in $c still reference file $id", HttpError::seg( (string) $col ) );
				}
			}
		}
		self::refuse_nested( $name, $id );
		self::storage()->delete( $row );

		return self::present( $row );
	}

	private static function find( string $name, int $id ): array {
		$row = self::storage()->getMany( array( $id ) )[ $id ] ?? null;
		if ( null === $row || $row['bucket'] !== $name ) {
			throw HttpError::notFound( "No file $id in $name" );
		}

		return $row;
	}

	/** The public row: no storage path, a signed url valid for TTL seconds. */
	public static function present( array $row ): array {
		$exp   = intdiv( Js::now(), 1000 ) + self::TTL;
		$route = "/files/{$row['bucket']}/{$row['id']}/download";
		$query = http_build_query(
			array(
				'exp' => $exp,
				'sig' => self::signer()->sign( self::message( $row['bucket'], $row['id'], $exp ) ),
			)
		);

		return array(
			'id'        => $row['id'],
			'bucket'    => $row['bucket'],
			'filename'  => $row['filename'],
			'mime'      => $row['mime'],
			'size'      => $row['size'],
			'ownerId'   => $row['ownerId'],
			'createdAt' => $row['createdAt'],
			'url'       => self::storage()->apiUrl( $route ) . ( str_contains( self::storage()->apiUrl( $route ), '?' ) ? '&' : '?' ) . $query,
		);
	}

	/** Stream a file for a valid signature: no session, no access rule; the signature is the grant. */
	public static function download( string $name, int $id, array $query ): Response {
		self::bucket( $name );
		$exp   = $query['exp'] ?? null;
		$now   = intdiv( Js::now(), 1000 );
		$valid = is_string( $exp ) && preg_match( '/^\d{1,12}$/D', $exp ) === 1
			&& (int) $exp >= $now && (int) $exp <= $now + self::TTL
			&& self::signer()->verify( self::message( $name, $id, (int) $exp ), $query['sig'] ?? null );
		if ( ! $valid ) {
			throw new HttpError( 403, 'forbidden', 'This download link is invalid or has expired; request a fresh one' );
		}
		$row    = self::find( $name, $id );
		$stream = self::storage()->stream( $row['path'] );
		$ascii  = preg_replace( '/[^\x20-\x7E]|["\\\\]/', '_', $row['filename'] );

		return Response::raw(
			$stream,
			200,
			array(
				'Content-Type'            => $row['mime'],
				'Content-Length'          => (string) $row['size'],
				'Content-Disposition'     => 'attachment; filename="' . $ascii . '"; filename*=UTF-8\'\'' . rawurlencode( $row['filename'] ),
				'X-Content-Type-Options'  => 'nosniff',
				'Content-Security-Policy' => 'sandbox',
				'Cache-Control'           => 'private, no-store',
			)
		);
	}

	private static function signer(): Signer {
		return new Signer( self::storage()->secret() );
	}

	private static function message( string $bucket, int $id, int $exp ): string {
		return "$bucket/$id/$exp";
	}

	/** @param list<string> $accept `type/subtype` or `type/*` */
	private static function accepts( array $accept, string $mime ): bool {
		foreach ( $accept as $a ) {
			if ( $a === $mime || ( str_ends_with( $a, '/*' ) && str_starts_with( $mime, substr( $a, 0, -1 ) ) ) ) {
				return true;
			}
		}

		return false;
	}

	private static function filename( string $name ): string {
		$name = trim( basename( str_replace( '\\', '/', $name ) ) );
		$name = (string) preg_replace( '/[\x00-\x1F\x7F]/', '', $name );

		return '' === $name ? 'file' : mb_substr( $name, 0, 200, 'UTF-8' );
	}

	/** Rows as stored → typed. */
	public static function normalizeRow( array $r ): array { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		return array(
			'id'        => (int) $r['id'],
			'bucket'    => (string) $r['bucket'],
			'filename'  => (string) $r['filename'],
			'mime'      => (string) $r['mime'],
			'size'      => (int) $r['size'],
			'path'      => (string) $r['path'],
			'ownerId'   => null === $r['ownerId'] ? null : (int) $r['ownerId'],
			'createdAt' => (string) $r['createdAt'],
		);
	}

	// ================================================================ file({ bucket }) columns

	/** @return array<string, string> column => bucket */
	private static function file_columns( string $collection ): array {
		$out = array();
		foreach ( db()->schema()->collection( $collection )['columns'] as $col => $def ) {
			if ( 'file' === $def['type'] ) {
				$out[ (string) $col ] = (string) $def['bucket'];
			}
		}

		return $out;
	}

	/** Newly written ids must exist in the column's bucket (422 with the column pointer; the write rolls back). */
	private static function check_columns( string $op, string $collection, array $row, ?array $previous ): void {
		if ( 'delete' === $op ) {
			return;
		}
		$refs = array();
		foreach ( db()->schema()->collection( $collection )['columns'] as $col => $def ) {
			if ( ( $row[ $col ] ?? null ) !== ( $previous[ $col ] ?? null ) ) {
				array_push( $refs, ...self::refs( $def, $row[ $col ] ?? null, HttpError::seg( (string) $col ) ) );
			}
		}
		if ( array() === $refs ) {
			return;
		}
		$rows = self::storage()->getMany( array_map( static fn ( $r ) => $r[0], $refs ) );
		foreach ( $refs as [$id, $bucket, $ptr] ) {
			if ( ( $rows[ $id ]['bucket'] ?? null ) !== $bucket ) {
				throw HttpError::invalidInput( "No file $id in $bucket", $ptr );
			}
		}
	}

	/**
	 * Top-level file columns are nulled on delete; nested ones (group/repeater/blocks) are not, so
	 * a delete is refused while one still holds the id. (file() is rejected in globals at build time.)
	 */
	private static function refuse_nested( string $bucket, int $id ): void {
		$db    = db();
		$holds = static function ( array $defs, array $row ) use ( $bucket, $id ): bool {
			foreach ( $defs as $col => $def ) {
				foreach ( self::refs( $def, $row[ $col ] ?? null, '' ) as [$ref, $ref_bucket] ) {
					if ( $ref === $id && $ref_bucket === $bucket ) {
						return true;
					}
				}
			}

			return false;
		};
		foreach ( $db->schema()->collections() as $c => $spec ) {
			$nested = array_filter( $spec['columns'], static fn ( array $d ) => in_array( $d['type'], array( 'group', 'repeater', 'blocks' ), true ) );
			foreach ( array() === $nested ? array() : $db->findMany( (string) $c, array( 'columns' => array_fill_keys( array_keys( $nested ), true ) ) ) as $row ) {
				if ( $holds( $nested, $row ) ) {
					throw new HttpError( 409, 'reference_violation', "Rows in $c still reference file $id in a nested field; clear it first" );
				}
			}
		}
	}

	/**
	 * File ids in a decoded value, at any group/repeater/blocks depth.
	 *
	 * @return list<array{int, string, string}> [id, bucket, pointer]
	 */
	public static function refs( array $def, mixed $v, string $ptr ): array {
		if ( null === $v ) {
			return array();
		}
		$fields = static function ( array $fields, mixed $obj, string $base ): array {
			$out = array();
			foreach ( $fields as $name => $f ) {
				array_push( $out, ...self::refs( $f, is_array( $obj ) ? ( $obj[ $name ] ?? null ) : null, $base . HttpError::seg( (string) $name ) ) );
			}

			return $out;
		};

		return match ( $def['type'] ) {
			'file' => is_int( $v ) ? array( array( $v, (string) $def['bucket'], $ptr ) ) : array(),
			'group' => $fields( $def['fields'] ?? array(), $v, $ptr ),
			'repeater' => is_array( $v ) ? array_merge( array(), ...array_map( static fn ( $item, $i ) => $fields( $def['fields'] ?? array(), $item, "$ptr/$i" ), $v, array_keys( $v ) ) ) : array(),
			'blocks' => is_array( $v ) ? array_merge( array(), ...array_map( static fn ( $item, $i ) => $fields( $def['layouts'][ $item['layout'] ?? '' ] ?? array(), $item, "$ptr/$i" ), $v, array_keys( $v ) ) ) : array(),
			default => array(),
		};
	}

	/** Null when file $id is in $bucket, else the message editor validation shows. */
	public static function missing( int $id, string $bucket ): ?string {
		return ( self::storage()->getMany( array( $id ) )[ $id ]['bucket'] ?? null ) === $bucket ? null : "No file $id in $bucket";
	}

	/** @var array<string, list<string>> collection => file columns `with` asked to populate (this read) */
	private static array $wanted = array();

	/** Consume `with: { <fileColumn>: true }` before Db validates relations. */
	private static function take_with( string $collection, array &$opts, ?Viewer $viewer, string $pointer ): void {
		self::$wanted[ $collection ] = array();
		if ( ! isset( $opts['with'] ) || ! is_array( $opts['with'] ) ) {
			return;
		}
		foreach ( self::file_columns( $collection ) as $col => $_ ) {
			if ( ! array_key_exists( $col, $opts['with'] ) ) {
				continue;
			}
			$v = $opts['with'][ $col ];
			unset( $opts['with'][ $col ] );
			if ( true === $v ) {
				self::$wanted[ $collection ][] = $col;
				// `with` asked for the column, as it does for a relation or a media column: a
				// `columns` selection that leaves it out still returns it.
				if ( is_array( $opts['columns'] ?? null ) ) {
					if ( in_array( true, $opts['columns'], true ) ) {
						$opts['columns'][ $col ] = true;
					} else {
						unset( $opts['columns'][ $col ] );
					}
				}
			} elseif ( false !== $v && null !== $v ) {
				throw HttpError::invalidQuery( 'File columns take `true`', $pointer . '/with' . HttpError::seg( $col ) );
			}
		}
		if ( array() === $opts['with'] ) {
			unset( $opts['with'] );
		}
	}

	/** Replace requested file ids by rows with a fresh url, for viewers the bucket's read rule admits. */
	private static function populate( array $rows, string $collection, ?Viewer $viewer ): array {
		$cols                        = self::$wanted[ $collection ] ?? array();
		self::$wanted[ $collection ] = array();
		if ( array() === $cols || array() === $rows ) {
			return $rows;
		}
		$ids = array();
		foreach ( $rows as $row ) {
			foreach ( $cols as $col ) {
				if ( is_int( $row[ $col ] ?? null ) ) {
					$ids[] = $row[ $col ];
				}
			}
		}
		$files   = self::storage()->getMany( $ids );
		$columns = self::file_columns( $collection );
		foreach ( $rows as &$row ) {
			foreach ( $cols as $col ) {
				$file = is_int( $row[ $col ] ?? null ) ? ( $files[ $row[ $col ] ] ?? null ) : null;
				if ( null !== $file && $file['bucket'] === $columns[ $col ] && self::allowed( self::bucket( $columns[ $col ] ), 'read', $viewer, $file ) ) {
					$row[ $col ] = self::present( $file );
				}
			}
		}
		unset( $row );

		return $rows;
	}
}
