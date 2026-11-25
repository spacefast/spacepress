<?php

declare(strict_types=1);

namespace SpacePress\Wp;

use SpacePress\Dialect;
use SpacePress\Links;
use SpacePress\Schema;
use SpacePress\Source;
use SpacePress\Store;

/**
 * The plugin's Store (§4.9): routes each collection to WpPostStore (`editor: true`) or WpTableStore
 * (`editor: false`), and each taxonomy to WpTermStore. All share one Connection, so one transaction
 * spans posts, terms, meta, custom tables and options. Globals always go to the options-backed
 * WpTableStore.
 */
final class CompositeStore implements Store, Links {

	private ?\SpacePress\Commerce\Store $commerce = null;
	public function __construct(
		private readonly Schema $schema,
		public readonly Connection $db,
		public readonly WpPostStore $posts,
		public readonly WpTableStore $tables,
		public readonly ?WpUserStore $users = null,
		public readonly ?WpTermStore $terms = null,
	) {
	}

	public static function create( Schema $schema, Connection $db ): self {
		$dialect = $db->sqlite() ? Dialect::mysqlOnSqlite() : Dialect::mysql( $db->ciCollation() );
		$tables  = new WpTableStore( $db, $schema, $dialect );

		$users = ( $schema->auth()['collection'] ?? null ) !== null ? new WpUserStore( $db, $schema, $dialect, $tables ) : null;
		$terms = $schema->taxonomies() !== array() ? new WpTermStore( $db, $schema, $dialect ) : null;

		return new self( $schema, $db, new WpPostStore( $db, $schema, $dialect ), $tables, $users, $terms );
	}

	public function isPostBacked( string $collection ): bool {
		$spec = $this->schema->collection( $collection );

		return ( $spec['editor'] ?? true ) && ( $spec['wp'] ?? null ) !== null;
	}

	private function for( string $collection ): Store {
		// The auth collection's rows are WordPress users (§6.2).
		if ( null !== $this->users && $collection === ( $this->schema->auth()['collection'] ?? null ) ) { // phpcs:ignore WordPress.PHP.YodaConditions.NotYoda -- Preserve the existing comparison order.
			return $this->users;
		}
		if ( isset( $this->schema->collection( $collection )['commerce'] ) && ! isset( $this->schema->taxonomies()[ $collection ] ) ) {
			return $this->commerce ??= new \SpacePress\Commerce\Store( $this->db, $this->schema, $this->tables );
		}
		if ( isset( $this->schema->taxonomies()[ $collection ] ) ) {
			return $this->terms ?? throw new \LogicException( 'No term store' );
		}

		return $this->isPostBacked( $collection ) ? $this->posts : $this->tables;
	}

	public function afterCommit( callable $fn ): void { // phpcs:ignore Universal.NamingConventions.NoReservedKeywordParameterNames.fnFound -- Preserve the existing PHP parameter name.
		$this->db->afterCommit( $fn );
	}

	public function applySystemStatements( array $statements ): void {
		$this->tables->applySystemStatements( $statements );
	}

	public function transaction( callable $fn ): mixed { // phpcs:ignore Universal.NamingConventions.NoReservedKeywordParameterNames.fnFound -- Preserve the existing PHP parameter name.
		return $this->db->transaction( $fn );
	}

	public function select( string $collection, array $q ): array {
		return $this->for( $collection )->select( $collection, $q );
	}

	/** The post or native Woo store reads its just-trashed row for the update lifecycle. */
	public function withTrash( string $collection, callable $fn ): mixed { // phpcs:ignore Universal.NamingConventions.NoReservedKeywordParameterNames.fnFound -- Preserve the existing PHP parameter name.
		$store = $this->for( $collection );
		return method_exists( $store, 'withTrash' ) ? $store->withTrash( $fn ) : $fn();
	}

	public function insert( string $collection, array $values ): int|string {
		return $this->for( $collection )->insert( $collection, $values );
	}

	public function update( string $collection, int|string $pk, array $values ): void {
		$this->for( $collection )->update( $collection, $pk, $values );
	}

	public function delete( string $collection, int|string $pk ): void {
		$this->for( $collection )->delete( $collection, $pk );
	}

	public function softDelete( string $collection, int|string $pk, string $at, ?int $userId, ?string $group ): void { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		$store = $this->for( $collection );
		if ( method_exists( $store, 'softDelete' ) ) {
			$store->softDelete( $collection, $pk, $at, $userId, $group ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
			return;
		}
		$store->delete( $collection, $pk );
	}

	public function restore( string $collection, int|string $pk ): void {
		$store = $this->for( $collection );
		if ( ! method_exists( $store, 'restore' ) ) {
			throw new \LogicException( "Store for $collection does not support restore()" );
		}
		$store->restore( $collection, $pk );
	}

	public function dialect(): Dialect {
		return $this->tables->dialect();
	}

	public function source( string $collection ): Source {
		return $this->for( $collection )->source( $collection );
	}

	public function showsUnique( string $collection, string $column, \SpacePress\Viewer $viewer ): bool {
		return $this->for( $collection )->showsUnique( $collection, $column, $viewer );
	}

	public function readGuards( string $collection, \SpacePress\Viewer $viewer, bool $forSelect = false ): array { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		return $this->for( $collection )->readGuards( $collection, $viewer, $forSelect ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
	}

	public function globalRead( string $name ): ?array {
		return $this->tables->globalRead( $name );
	}

	public function globalWrite( string $name, array $values ): void {
		$this->tables->globalWrite( $name, $values );
	}

	public function revisions( string $collection, int|string $pk ): array {
		return $this->for( $collection )->revisions( $collection, $pk );
	}

	public function revisionWrite( string $collection, int|string $pk, array $encodedRow, ?int $userId, array $meta = array() ): void { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		if ( ( $meta['op'] ?? null ) === 'purge' && $this->isPostBacked( $collection ) ) {
			// Permanent wp_delete_post removes all WP child revisions, so persist the purge audit snapshot in sp__revisions.
			if ( $this->tables->hasRevisionsTable() ) {
				$this->tables->revisionWrite( $collection, $pk, $encodedRow, $userId, $meta ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
			}

			return;
		}
		$this->for( $collection )->revisionWrite( $collection, $pk, $encodedRow, $userId, $meta ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
	}

	public function revision( string $collection, int|string $pk, int $revisionId, bool $byVersion = false ): ?array { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		return $this->for( $collection )->revision( $collection, $pk, $revisionId, $byVersion ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
	}

	public function latestSchemaMigration(): ?string {
		return $this->tables->latestSchemaMigration();
	}

	public function promoteDue( string $collection, string $nowIso ): array { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		return $this->for( $collection )->promoteDue( $collection, $nowIso ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
	}

	public function mapError( \Throwable $e ): \Throwable {
		return $this->tables->mapError( $e );
	}

	// Join tables are SpacePress's own tables, whatever stores their two sides; a `terms` field's links
	// (`term:<taxonomy>`) are core's term relationships.

	private function links_for( string $join ): Links {
		return str_starts_with( $join, 'term:' ) ? ( $this->terms ?? throw new \LogicException( 'No term store' ) ) : $this->tables;
	}

	public function linkTable( string $join ): string {
		return $this->links_for( $join )->linkTable( $join );
	}

	public function links( string $join, string $by, array $ids, bool $forUpdate = false ): array { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		return $this->links_for( $join )->links( $join, $by, $ids, $forUpdate ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
	}

	public function setLinks( string $join, int|string $owner, array $targets ): void {
		$this->links_for( $join )->setLinks( $join, $owner, $targets );
	}

	public function unlink( string $join, string $by, int|string $id ): void {
		$this->links_for( $join )->unlink( $join, $by, $id );
	}
}
