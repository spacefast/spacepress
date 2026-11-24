<?php
declare(strict_types=1);
namespace SpacePressOfficialPlugins;

const FIELD_TYPES = array( 'text', 'email', 'textarea', 'number', 'tel', 'url', 'date', 'select', 'radio', 'checkbox', 'checkbox-group', 'file', 'hidden' );
function valid_form( array $input ): array|\WP_Error {
	if ( ! is_string( $input['name'] ?? null ) || ! trim( $input['name'] ) || ! is_array( $input['pages'] ?? null ) || ! $input['pages'] ) {
		return problem( 'invalid_form', 'A name and at least one page are required' );
	}
	$names = array();
	foreach ( $input['pages'] as $page ) {
		if ( ! is_array( $page ) || ! is_array( $page['fields'] ?? null ) ) {
			return problem( 'invalid_form', 'Each page needs fields' ); }
		foreach ( $page['fields'] as $field ) {
			if ( ! is_array( $field ) || ! in_array( $field['type'] ?? '', FIELD_TYPES, true )
				|| ! is_string( $field['name'] ?? null ) || ! preg_match( '/^[a-z][a-z0-9_]{0,63}$/D', $field['name'] )
				|| isset( $names[ $field['name'] ] ) || ! is_string( $field['label'] ?? null ) ) {
				return problem( 'invalid_form', 'Fields need unique lowercase names, labels, and a supported type' );
			}
			if ( 'website' === $field['name'] || 'data' === $field['name'] ) {
				return problem( 'invalid_form', 'Reserved field name' ); }
			if ( isset( $field['validation']['pattern'] ) && @preg_match( '~' . str_replace( '~', '\\~', $field['validation']['pattern'] ) . '~u', '' ) === false ) {
				return problem( 'invalid_form', 'Invalid field pattern' );
			}
			$names[ $field['name'] ] = true;
		}
	}
	return array(
		'name'     => sanitize_text_field( $input['name'] ),
		'pages'    => $input['pages'],
		'status'   => ( $input['status'] ?? 'active' ) === 'paused' ? 'paused' : 'active',
		'settings' => ( is_array( $input['settings'] ?? null ) ? $input['settings'] : array() ) + array(
			'confirmationMessage' => 'Thanks — your message is saved.',
			'submitLabel'         => 'Send message',
			'spamProtection'      => 'honeypot',
			'retentionDays'       => 0,
		),
	);
}
function visible( array $field, array $values ): bool {
	if ( ! isset( $field['condition'] ) ) {
		return true; }
	$condition = $field['condition'];
	$value     = $values[ $condition['field'] ?? '' ] ?? '';
	return match ( $condition['op'] ?? '' ) {
		'eq' => $value === ( $condition['value'] ?? '' ), 'neq' => $value !== ( $condition['value'] ?? '' ),
		'filled' => '' !== $value && null !== $value, 'empty' => '' === $value || null === $value,
		default => false,
	};
}
function public_definition( int $id ): array|\WP_Error {
	if ( ! require_post( $id, 'zpl_form' ) ) {
		return problem( 'not_found', 'Form not found', 404 ); }
	$form = stored( $id );
	if ( 'active' !== $form['status'] ) {
		return problem( 'paused', 'This form is paused', 409 ); }
	// Notification recipients, webhook credentials and retention policy stay in the admin API.
	return array(
		'id'       => $id,
		'name'     => $form['name'],
		'pages'    => $form['pages'],
		'settings' => array_intersect_key( $form['settings'], array_flip( array( 'confirmationMessage', 'submitLabel', 'nextLabel', 'prevLabel' ) ) ),
	);
}
function submit( \WP_REST_Request $request ): array|\WP_Error {
	$id         = (int) $request['id'];
	$definition = public_definition( $id );
	if ( is_wp_error( $definition ) ) {
		return $definition; }
	$form = stored( $id );
	if ( 'turnstile' === $form['settings']['spamProtection'] ) {
		return problem( 'provider_required', 'Configure the real Turnstile verification provider before accepting this form', 424 ); }
	if ( $request->get_param( 'website' ) ) {
		return problem( 'spam', 'Submission rejected', 422 ); }
	$input = $request->get_param( 'data' );
	if ( is_string( $input ) ) {
		$input = json_decode( $input, true ); }
	if ( ! is_array( $input ) ) {
		return problem( 'invalid_submission', 'data must be an object' ); }
	$values  = array();
	$files   = $request->get_file_params();
	$uploads = array();
	foreach ( $form['pages'] as $page ) {
		foreach ( $page['fields'] as $field ) {
			if ( ! visible( $field, $input ) ) {
				continue; }
			$name  = $field['name'];
			$type  = $field['type'];
			$value = $input[ $name ] ?? null;
			if ( 'file' === $type ) {
				$file = $files[ $name ] ?? null;
				if ( ! $file || $file['error'] === UPLOAD_ERR_NO_FILE ) {
					if ( $field['required'] ?? false ) {
						return problem( 'required', "$name is required" ); }
					continue;
				}
				$limit = min( 2097152, (int) ( $field['validation']['maxFileSize'] ?? 2097152 ) );
				if ( $file['error'] !== UPLOAD_ERR_OK || $file['size'] > $limit ) {
					return problem( 'invalid_file', "$name exceeds the upload limit" ); }
				$check = wp_check_filetype_and_ext(
					$file['tmp_name'],
					$file['name'],
					array(
						'png'      => 'image/png',
						'jpg|jpeg' => 'image/jpeg',
						'pdf'      => 'application/pdf',
					)
				);
				if ( ! $check['type'] ) {
					return problem( 'invalid_file', 'Only verified PNG, JPEG and PDF files are accepted' ); }
				$uploads[ $name ] = $file;
				continue;
			}
			if ( ( $field['required'] ?? false ) && ( null === $value || '' === $value || array() === $value || ( 'checkbox' === $type && ! in_array( $value, array( true, '1', 'on' ), true ) ) ) ) {
				return problem( 'required', "$name is required" );
			}
			if ( null === $value || '' === $value || array() === $value ) {
				continue; }
			if ( 'checkbox-group' === $type ) {
				if ( ! is_array( $value ) ) {
					return problem( 'invalid_field', "$name must be a list" ); }
				foreach ( $value as $selected ) {
					if ( ! in_array( $selected, array_column( $field['options'] ?? array(), 'value' ), true ) ) {
						return problem( 'invalid_field', "$name has an invalid selection" ); }
				}
				$values[ $name ] = $value;
				continue;
			}
			if ( ! is_scalar( $value ) ) {
				return problem( 'invalid_field', "$name must be scalar" ); }
			if ( 'email' === $type && ! is_email( (string) $value ) ) {
				return problem( 'invalid_email', "$name needs a valid email" ); }
			if ( 'url' === $type && ! filter_var( $value, FILTER_VALIDATE_URL ) ) {
				return problem( 'invalid_url', "$name needs a valid URL" ); }
			if ( 'date' === $type ) {
				$date = \DateTimeImmutable::createFromFormat( '!Y-m-d', (string) $value );
				if ( ! $date || $date->format( 'Y-m-d' ) !== $value ) {
					return problem( 'invalid_date', "$name needs a valid date" ); }
			}
			if ( in_array( $type, array( 'select', 'radio' ), true ) && ! in_array( $value, array_column( $field['options'] ?? array(), 'value' ), true ) ) {
				return problem( 'invalid_choice', "$name has an invalid choice" ); }
			$validation = $field['validation'] ?? array();
			if ( 'number' === $type ) {
				if ( ! is_numeric( $value ) || ( isset( $validation['min'] ) && $value < $validation['min'] ) || ( isset( $validation['max'] ) && $value > $validation['max'] ) ) {
					return problem( 'invalid_number', "$name is out of range" ); }
				$value = 0 + $value;
			} else {
				$value = sanitize_textarea_field( (string) $value );
				if ( strlen( $value ) < ( $validation['minLength'] ?? 0 ) || strlen( $value ) > ( $validation['maxLength'] ?? 10000 ) ) {
					return problem( 'invalid_length', "$name has an invalid length" ); }
				if ( isset( $validation['pattern'] ) && preg_match( '~' . str_replace( '~', '\\~', $validation['pattern'] ) . '~u', $value ) !== 1 ) {
					return problem( 'invalid_pattern', "$name has an invalid format" ); }
			}
			$values[ $name ] = $value;
		}
	}
	// Validate every field before making durable writes or moving files.
	$submission = array(
		'formId'    => $id,
		'data'      => $values,
		'files'     => array(),
		'status'    => 'new',
		'starred'   => false,
		'createdAt' => gmdate( 'c' ),
	);
	if ( $uploads ) {
		require_once ABSPATH . 'wp-admin/includes/file.php';
		require_once ABSPATH . 'wp-admin/includes/media.php';
		require_once ABSPATH . 'wp-admin/includes/image.php';
		foreach ( $uploads as $name => $file ) {
			$media = media_handle_sideload( $file, 0 );
			if ( is_wp_error( $media ) ) {
				foreach ( $submission['files'] as $saved ) {
					wp_delete_attachment( $saved['mediaId'], true ); }
				return problem( 'upload_failed', $media->get_error_message(), 500 );
			}
			$submission['files'][] = array(
				'fieldName'   => $name,
				'mediaId'     => $media,
				'filename'    => sanitize_file_name( $file['name'] ),
				'contentType' => get_post_mime_type( $media ),
				'size'        => $file['size'],
			);
		}
	}
	$submission_id = store( 'zpl_submit', $form['name'], $submission );
	update_post_meta( $submission_id, '_zpl_form', $id );
	record(
		'form.submitted',
		array(
			'submissionId' => $submission_id,
			'formId'       => $id,
		)
	);
	notify(
		'form.submitted',
		array(
			'submissionId' => $submission_id,
			'formId'       => $id,
			'data'         => $values,
		)
	);
	return array(
		'id'      => $submission_id,
		'message' => $form['settings']['confirmationMessage'],
	);
}
