<?php

// Canonical schema.php v3 data; shared by the compiler golden and PHP runtime suites.
declare(strict_types=1);

return json_decode(file_get_contents(__DIR__ . '/../blog.schema.json'), true, 512, JSON_THROW_ON_ERROR);
