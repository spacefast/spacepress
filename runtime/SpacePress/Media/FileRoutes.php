<?php

declare(strict_types=1);

namespace SpacePress\Media;

use SpacePress\App;
use SpacePress\HttpError;
use SpacePress\Response;
use SpacePress\Viewer;

/**
 * `/files/{bucket}` (phase 2 §7.2):
 *   POST   /files/{bucket}                 multipart `file` → 201 row with a signed url
 *   GET    /files/{bucket}/{id}            → row with a fresh signed url (bucket read rule)
 *   DELETE /files/{bucket}/{id}            → row (bucket delete rule); file columns holding it are nulled
 *   GET    /files/{bucket}/{id}/download?exp=&sig=   streams the bytes; the signature is the only grant
 */
final class FileRoutes {

	/** @return array{int, mixed}|Response */
	public static function dispatch( string $method, array $segments, array $query, string $body, Viewer $viewer, array $files, array $form ): array|Response {
		$n      = count( $segments );
		$bucket = $segments[1] ?? '';
		if ( $n < 2 || $n > 4 || ! isset( Files::buckets()[ $bucket ] ) ) {
			throw HttpError::notFound( $n < 2 ? 'No such files route' : "Unknown file bucket '$bucket'" );
		}
		if ( 2 === $n ) {
			App::allow( $method, array( 'POST' ) );
			$file = $files['file'] ?? null;
			if ( ! is_array( $file ) || is_array( $file['error'] ?? null ) ) {
				throw HttpError::invalidInput( 'Send the file as multipart/form-data field "file"', '/file' );
			}
			$err = (int) ( $file['error'] ?? UPLOAD_ERR_NO_FILE );
			if ( $err === UPLOAD_ERR_INI_SIZE || $err === UPLOAD_ERR_FORM_SIZE ) { // phpcs:ignore WordPress.PHP.YodaConditions.NotYoda -- Preserve the existing comparison order.
				throw new HttpError( 413, 'payload_too_large', 'The upload is larger than this server accepts' );
			}
			if ( $err !== UPLOAD_ERR_OK ) { // phpcs:ignore WordPress.PHP.YodaConditions.NotYoda -- Preserve the existing comparison order.
				throw HttpError::invalidInput( 'The upload failed (error ' . $err . ')', '/file' );
			}

			return array( 201, Files::upload( $bucket, (string) $file['tmp_name'], (string) ( $file['name'] ?? 'file' ), $viewer ) );
		}
		if ( ! preg_match( '/^\d{1,18}$/D', $segments[2] ) ) {
			throw HttpError::notFound( "No file {$segments[2]} in $bucket" );
		}
		$id = (int) $segments[2];
		if ( 4 === $n ) {
			if ( 'download' !== $segments[3] ) {
				throw HttpError::notFound( 'No such files route' );
			}
			App::allow( $method, array( 'GET' ) );

			return Files::download( $bucket, $id, $query );
		}
		App::allow( $method, array( 'GET', 'DELETE' ) );

		return array( 200, 'GET' === $method ? Files::get( $bucket, $id, $viewer ) : Files::delete( $bucket, $id, $viewer ) );
	}
}
