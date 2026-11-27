<?php
declare(strict_types=1);
namespace SpacePress;

final class JsArguments {

	public array $p = array();
	public mixed $length;
	/** `delete arguments.length` removed the own property; a later write restores it. */
	public bool $lengthDeleted = false; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.PropertyNotSnakeCase -- Preserve the existing PHP property name.

	public function __construct( public array $a ) {
		$this->length = count( $a ); }
}
