function action__cheer(\First\JsObject $__t1)
{
    $arguments = \First\Js::arguments(func_get_args());
    $__t2 = \First\Js::requirePresent($__t1);
    $noteId = \First\Js::dataGet($__t2, 'noteId');
    $note = \First\Seam::findFirst('notes', ['where' => ['id' => $noteId, 'status' => 'published']]);
    if (!(!\First\Js::isNullish($note))) {
        throw new \First\HttpError((int) 404, 'not_found', 'No published note has that id');
    }
    $row = \First\Seam::findFirst('cheers', ['where' => ['noteId' => $noteId]]);
    if (!\First\Js::isNullish($row)) {
        \First\Seam::update('cheers', (new \First\JsObject(['count' => \First\Js::add(\First\Js::dataGet($row, 'count'), 1)])), ['id' => \First\Js::dataGet($row, 'id')]);
        return (new \First\JsObject(['count' => \First\Js::add(\First\Js::dataGet($row, 'count'), 1)]));
    }
    \First\Seam::insert('cheers', (new \First\JsObject(['noteId' => $noteId, 'count' => 1])));
    return (new \First\JsObject(['count' => 1]));
    return \First\Js::undefined();
}
