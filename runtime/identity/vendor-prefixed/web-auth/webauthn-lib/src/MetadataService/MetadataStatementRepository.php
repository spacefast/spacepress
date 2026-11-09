<?php

declare(strict_types=1);

namespace First\Identity\Vendor\Webauthn\MetadataService;

use First\Identity\Vendor\Webauthn\MetadataService\Statement\MetadataStatement;

interface MetadataStatementRepository
{
    public function findOneByAAGUID(string $aaguid): ?MetadataStatement;
}
