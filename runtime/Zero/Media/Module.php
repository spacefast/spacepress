<?php

declare(strict_types=1);

namespace Zero\Media;

use Zero\App;
use Zero\Extensions;
use Zero\HttpError;
use Zero\Viewer;

use function Zero\db;

/** Phase-1 media routes, shared by both targets. */
final class Module
{
    public static function register(): void
    {
        Extensions::route('media', self::dispatch(...));
    }

    /** @return array{int, mixed} */
    public static function dispatch(string $method, array $segments, array $query, string $body, Viewer $viewer, array $files, array $form): array
    {
        $n = count($segments);
        if ($n === 1) {
            App::allow($method, ['GET', 'POST']);
            if ($method === 'GET') {
                $opts = App::listOptions($query);
                if (isset($opts['with'])) {
                    throw HttpError::invalidQuery('media has no relations', '/with');
                }

                return [200, db()->mediaList($opts)];
            }
            $file = $files['file'] ?? null;
            if (!is_array($file) || is_array($file['error'] ?? null)) {
                throw HttpError::invalidInput('Send the file as multipart/form-data field "file"', '/file');
            }
            $err = (int) ($file['error'] ?? UPLOAD_ERR_NO_FILE);
            if ($err === UPLOAD_ERR_INI_SIZE || $err === UPLOAD_ERR_FORM_SIZE) {
                throw new HttpError(413, 'payload_too_large', 'The upload is larger than this server accepts');
            }
            if ($err !== UPLOAD_ERR_OK) {
                throw HttpError::invalidInput('The upload failed (error ' . $err . ')', '/file');
            }
            $alt = $form['alt'] ?? null;
            if ($alt !== null && !is_string($alt)) {
                throw HttpError::invalidInput('alt must be a string', '/alt');
            }

            return [201, db()->mediaUpload((string) $file['tmp_name'], (string) ($file['name'] ?? 'file'), $alt, $viewer)];
        }
        if ($n !== 2) {
            throw HttpError::notFound('No such media route');
        }
        App::allow($method, ['GET', 'DELETE']);
        $id = preg_match('/^\d{1,18}$/D', $segments[1]) ? (int) $segments[1] : -1;
        $missing = static fn () => HttpError::notFound("No media with id {$segments[1]}");

        return $method === 'GET'
            ? [200, db()->mediaGet($id) ?? throw $missing()]
            : [200, db()->mediaDelete($id, $viewer) ?? throw $missing()];
    }

}
