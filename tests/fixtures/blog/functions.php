<?php

// Hand-written frozen fixture: the compiled functions for examples/blog (design §1.9) as the
// compiler (R) must emit them, using the §2 calling conventions:
//   hooks: v1 arguments + trailing $ctx = ['user' => ?array, 'target' => string]
//   access: $fn($ctx) with $ctx = ['user', 'target', 'op', 'data'] → bool | filter array
//   validate: $fn($value, $ctx) with $ctx = ['data', 'user', 'target'] → true/null ok, string = rejection
//   actions: $fn($input, $ctx)
// Hook bodies follow design §1.9's note: beforeCreate looks up the author by userId and sets
// authorId; afterCreate approves staff comments via db.update.

declare(strict_types=1);

namespace ZeroApp;

use Zero\HttpError;

// beforeCreate(data, ctx) { if (data.authorId == null && ctx.user) {
//   const author = await db.query.authors.findFirst({ where: { userId: ctx.user.id } });
//   if (author) data.authorId = author.id; } }
function posts__beforeCreate(array &$data, $ctx)
{
    if (($data['authorId'] ?? null) === null && $ctx['user'] !== null) {
        $author = \Zero\db()->findFirst('authors', ['where' => ['userId' => $ctx['user']['id']]]);
        if ($author !== null) {
            $data['authorId'] = $author['id'];
        }
    }
}

// afterCreate(row, ctx) { if (ctx.user && ctx.user.role !== "subscriber") {
//   await db.update(comments).set({ approved: true }).where({ id: row.id }); } }
function comments__afterCreate($row, $ctx)
{
    if ($ctx['user'] !== null && $ctx['user']['role'] !== 'subscriber') {
        \Zero\db()->update('comments', ['approved' => true], ['id' => $row['id']]);
    }
}

// read: (ctx) => ctx.user && ctx.user.role !== "subscriber" ? true : { status: "published" }
function posts__access__read($ctx)
{
    return \Zero\Js::truthy($ctx['user'] !== null ? $ctx['user']['role'] !== 'subscriber' : null) ? true : ['status' => 'published'];
}

// update: (ctx) => ctx.user?.role === "admin" || ctx.user?.role === "editor" ? true : { author: { userId: ctx.user?.id ?? -1 } }
function posts__access__update($ctx)
{
    return ($ctx['user']['role'] ?? null) === 'admin' || ($ctx['user']['role'] ?? null) === 'editor'
        ? true
        : ['author' => ['userId' => $ctx['user']['id'] ?? -1]];
}

// read: (ctx) => ctx.user ? true : { approved: true }
function comments__access__read($ctx)
{
    return $ctx['user'] !== null ? true : ['approved' => true];
}

// body: .validate((v) => v.includes("http://") ? "No links in comments" : true)
function comments__validate__body($v, $ctx)
{
    return str_contains($v, 'http://') ? 'No links in comments' : true;
}

// approveComment: handler({ id }) { const [row] = await db.update(comments).set({ approved: true }).where({ id }).returning();
//   if (!row) throw new HttpError(404, "not_found", `No comment ${id}`); return row; }
function action__approveComment($input, $ctx)
{
    $id = $input['id'];
    $row = \Zero\db()->update('comments', ['approved' => true], ['id' => $id], true)[0] ?? null;
    if ($row === null) {
        throw new HttpError(404, 'not_found', 'No comment ' . \Zero\Js::numStr($id));
    }

    return $row;
}

// publishedCount: handler() { const rows = await db.query.posts.findMany({ where: { status: "published" }, columns: { id: true } });
//   return { count: rows.length }; }
function action__publishedCount($input, $ctx)
{
    $rows = \Zero\db()->findMany('posts', ['where' => ['status' => 'published'], 'columns' => ['id' => true]]);

    return ['count' => count($rows)];
}
