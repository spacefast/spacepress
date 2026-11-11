<?php

declare(strict_types=1);

namespace First\Identity\Vendor\Webauthn\MetadataService;

use First\Identity\Vendor\Webauthn\MetadataService\Statement\StatusReport;

interface StatusReportRepository
{
    /**
     * @return StatusReport[]
     */
    public function findStatusReportsByAAGUID(string $aaguid): array;
}
