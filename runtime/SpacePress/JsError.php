<?php

declare(strict_types=1);

namespace SpacePress;

/** A JavaScript `Error` (or subclass, named by $jsName) thrown by compiled code or a Js helper. */
class JsError extends \Exception {

	/** `AggregateError.errors`: the rejection reasons, in iterable order. */
	public ?JsArray $errors = null;

	/** The JavaScript error code attached by a Node built-in. */
	public ?string $nodeCode = null;

	public static function node( string $message, string $name, string $code ): self {
		$error = new self( $message, $name );
		$error->nodeCode = $code;
		return $error;
	}

	public function __construct( string $message, public readonly string $jsName = 'Error', public bool $hasMessage = true ) { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		parent::__construct( $message );
	}

	/** `delete error.message`: reads fall back to Error.prototype.message, the empty string. */
	public function deleteMessage(): void {
		$this->message    = '';
		$this->hasMessage = false; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
	}

	/** Receipt snapshots persist JS-visible fields, never PHP frames containing callbacks. */
	public function __serialize(): array {
		return array( $this->getMessage(), $this->jsName, $this->hasMessage, $this->nodeCode ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
	}

	public function __unserialize( array $data ): void {
		$this->__construct( $data[0], $data[1], $data[2] );
		$this->nodeCode = $data[3] ?? null;
	}
}
