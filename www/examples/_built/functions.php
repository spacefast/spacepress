function action__cheer(\TypedPress\JsObject $__t1)
{
    $arguments = \TypedPress\Js::arguments(func_get_args());
    $__t2 = \TypedPress\Js::requirePresent($__t1);
    $noteId = \TypedPress\Js::dataGet($__t2, 'noteId');
    $note = \TypedPress\Seam::findFirst('notes', ['where' => ['id' => $noteId, 'status' => 'published']]);
    if (!(!\TypedPress\Js::isNullish($note))) {
        throw new \TypedPress\HttpError((int) 404, 'not_found', 'No published note has that id');
    }
    $row = \TypedPress\Seam::findFirst('cheers', ['where' => ['noteId' => $noteId]]);
    if (!\TypedPress\Js::isNullish($row)) {
        \TypedPress\Seam::update('cheers', (new \TypedPress\JsObject(['count' => \TypedPress\Js::add(\TypedPress\Js::dataGet($row, 'count'), 1)])), ['id' => \TypedPress\Js::dataGet($row, 'id')]);
        return (new \TypedPress\JsObject(['count' => \TypedPress\Js::add(\TypedPress\Js::dataGet($row, 'count'), 1)]));
    }
    \TypedPress\Seam::insert('cheers', (new \TypedPress\JsObject(['noteId' => $noteId, 'count' => 1])));
    return (new \TypedPress\JsObject(['count' => 1]));
    return \TypedPress\Js::undefined();
}
