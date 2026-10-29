<?php

declare(strict_types=1);

namespace Zero\Sync;

use Zero\Extensions;
use Zero\HttpError;
use Zero\Js;
use Zero\Viewer;
use Zero\Wp\Plugin;

use function Zero\db;

/** Content sync (§5): stable uids, the site id, and the `/sync` routes. */
final class Module
{
    private const SITE_OPTION = 'zero_runtime_site_id';
    private const SITE_GLOBAL = '__site';

    public static function register(): void
    {
        Extensions::onWrite(self::onWrite(...));
        Extensions::onWritten(self::onWritten(...));
        Extensions::schemaDescribe(self::describe(...));
        Extensions::route('sync', Routes::dispatch(...));
    }

    /** Mint a uid on create when the writer gave none; refuse to change one. */
    public static function onWrite(string $op, string $collection, array &$data, ?array $existing, ?Viewer $viewer, array $provided): void
    {
        if (!(db()->schema()->collection($collection)['uid'] ?? false)) {
            return;
        }
        if ($op === 'create') {
            $data['uid'] ??= Uid::mint();
        } elseif ($op === 'update' && array_key_exists('uid', $data) && ($existing['uid'] ?? null) !== null && $data['uid'] !== $existing['uid']) {
            throw HttpError::invalidInput('uid is immutable', '/uid');
        }
    }

    /** Rows written outside the API pipeline (wp-admin, core REST) get their uid here. */
    public static function onWritten(string $op, string $collection, array $row, ?array $previous): void
    {
        if ($op !== 'delete' && ($row['uid'] ?? null) === null && (db()->schema()->collection($collection)['uid'] ?? false)) {
            self::ensureUids($collection, [$row]);
        }
    }

    /**
     * Give every row in $rows that has none a uid, stored directly (bookkeeping: no hooks, no revision).
     *
     * @param list<array> $rows full rows
     * @return list<array> the rows with `uid` filled
     */
    public static function ensureUids(string $collection, array $rows): array
    {
        $pk = db()->schema()->collection($collection)['primaryKey'];
        foreach ($rows as &$row) {
            if (($row['uid'] ?? null) === null) {
                $row['uid'] = Uid::mint();
                db()->store()->update($collection, $row[$pk], ['uid' => $row['uid']]);
            }
        }
        unset($row);

        return $rows;
    }

    /** This site's identity, minted once: base files are keyed by it (§5.4). */
    public static function siteId(): string
    {
        if (db()->target() === 'wp') {
            // add_option() overwrites on a concurrent first boot; the first id written must win.
            $connection = Plugin::instance()->connection();
            $options = $connection->wpdb()->options;
            $connection->run("INSERT IGNORE INTO `$options` (option_name, option_value, autoload) VALUES (?, ?, 'off')", [self::SITE_OPTION, Js::uuid()]);
            $connection->touchOption(self::SITE_OPTION);

            return (string) $connection->run("SELECT option_value FROM `$options` WHERE option_name = ?", [self::SITE_OPTION])[0]['option_value'];
        }
        $store = db()->store();
        $id = $store->globalRead(self::SITE_GLOBAL)['id'] ?? null;
        if (!is_string($id)) {
            $id = Js::uuid();
            $store->globalWrite(self::SITE_GLOBAL, ['id' => $id]);
        }

        return $id;
    }

    public static function describe(array $describe): array
    {
        try {
            db();
        } catch (\LogicException) {
            return $describe; // a schema described without a running app has no site
        }
        $describe['site'] = ['id' => self::siteId()];

        return $describe;
    }
}
