<?php

declare(strict_types=1);

/*
 * Assembles a standalone app root for the blog fixture (tests/fixtures/blog/{schema,functions}.php),
 * as `zero build --target standalone` would lay it out: runtime, CLI, front controller and the
 * SQLite migration below (hand-written; what R's migrate.rs must produce for the blog).
 *
 *   require 'blog_app.php'; $root = blogApp($dir);   // from PHP
 *   php tests/php/blog_app.php <dir>                  // from the e2e test; prints the root
 */

const BLOG_MIGRATION = <<<'SQL'
    CREATE TABLE "authors" (
    	"id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    	"name" text NOT NULL,
    	"email" text NOT NULL,
    	"bio" text,
    	"avatar" integer,
    	"userId" integer,
    	"status" text DEFAULT 'published' NOT NULL,
    	"publishedAt" text
    );
    --> statement-breakpoint
    CREATE UNIQUE INDEX "authors_email_unique" ON "authors" ("email");
    --> statement-breakpoint
    CREATE TABLE "posts" (
    	"id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    	"title" text NOT NULL,
    	"slug" text,
    	"body" text,
    	"excerpt" text,
    	"cover" integer,
    	"tags" text DEFAULT '[]' NOT NULL,
    	"authorId" integer REFERENCES "authors"("id") ON DELETE set null,
    	"seo" text,
    	"gallery" text,
    	"sections" text,
    	"createdAt" text NOT NULL,
    	"updatedAt" text NOT NULL,
    	"status" text DEFAULT 'published' NOT NULL,
    	"publishedAt" text
    );
    --> statement-breakpoint
    CREATE UNIQUE INDEX "posts_slug_unique" ON "posts" ("slug");
    --> statement-breakpoint
    CREATE INDEX "posts_status_publishedAt" ON "posts" ("status", "publishedAt");
    --> statement-breakpoint
    CREATE TABLE "comments" (
    	"id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    	"postId" integer NOT NULL REFERENCES "posts"("id") ON DELETE cascade,
    	"name" text NOT NULL,
    	"body" text NOT NULL,
    	"approved" integer DEFAULT 0 NOT NULL,
    	"createdAt" text NOT NULL
    );
    SQL;

const BLOG_INDEX_PHP = <<<'PHP'
    <?php
    declare(strict_types=1);
    if (PHP_SAPI === 'cli-server' && is_file(__DIR__ . parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH)) && !str_ends_with(parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH), '.php')) {
        return false;
    }
    require __DIR__ . '/../zero/runtime/bootstrap.php';
    \Zero\App::boot(dirname(__DIR__))->handleHttp();
    PHP;

/** Copy the runtime (recursively) and the CLI into $root/zero/. */
function copyRuntime(string $root): void
{
    $runtime = dirname(__DIR__, 2) . '/runtime';
    $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($runtime . '/Zero', FilesystemIterator::SKIP_DOTS));
    foreach ($it as $file) {
        $rel = substr($file->getPathname(), strlen($runtime . '/Zero/'));
        if (str_starts_with($rel, 'Wp/')) {
            continue; // the WP stores are W's and not part of a standalone build
        }
        $dest = "$root/zero/runtime/$rel";
        @mkdir(dirname($dest), 0777, true);
        copy($file->getPathname(), $dest);
    }
    @mkdir("$root/zero/bin", 0777, true);
    copy($runtime . '/bin/zero.php', "$root/zero/bin/zero.php");
}

function blogApp(string $root): string
{
    $fixtures = dirname(__DIR__) . '/fixtures/blog';
    foreach (['zero/app/migrations', 'public', 'data'] as $d) {
        @mkdir("$root/$d", 0777, true);
    }
    copy("$fixtures/schema.php", "$root/zero/app/schema.php");
    copy("$fixtures/functions.php", "$root/zero/app/functions.php");
    file_put_contents("$root/zero/app/migrations/0001_init.sql", BLOG_MIGRATION);
    file_put_contents("$root/public/index.php", BLOG_INDEX_PHP);
    copyRuntime($root);

    return $root;
}

if (PHP_SAPI === 'cli' && realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) {
    $dir = $argv[1] ?? (sys_get_temp_dir() . '/zero-blog-' . bin2hex(random_bytes(4)));
    echo blogApp($dir), "\n";
}
