<?php

declare(strict_types=1);

namespace First\Identity\Vendor\Webauthn\Denormalizer;

use First\Identity\Vendor\Symfony\Component\Serializer\Normalizer\DenormalizerInterface;
use First\Identity\Vendor\Webauthn\AttestationStatement\AttestationStatement;
use First\Identity\Vendor\Webauthn\AttestationStatement\AttestationStatementSupportManager;
use First\Identity\Vendor\Webauthn\Exception\InvalidDataException;

final readonly class AttestationStatementDenormalizer implements DenormalizerInterface
{
    public function __construct(
        private AttestationStatementSupportManager $attestationStatementSupportManager
    ) {
    }

    /**
     * @throws InvalidDataException
     */
    public function denormalize(mixed $data, string $type, ?string $format = null, array $context = []): mixed
    {
        /** @var array{fmt: string, attStmt: array<string, mixed>, authData: string} $data */
        $attestationStatementSupport = $this->attestationStatementSupportManager->get($data['fmt']);

        return $attestationStatementSupport->load($data);
    }

    public function supportsDenormalization(
        mixed $data,
        string $type,
        ?string $format = null,
        array $context = []
    ): bool {
        return $type === AttestationStatement::class;
    }

    /**
     * @return array<class-string, bool>
     */
    public function getSupportedTypes(?string $format): array
    {
        return [
            AttestationStatement::class => true,
        ];
    }
}
