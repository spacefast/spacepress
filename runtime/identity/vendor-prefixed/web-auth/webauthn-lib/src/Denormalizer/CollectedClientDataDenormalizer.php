<?php

declare(strict_types=1);

namespace First\Identity\Vendor\Webauthn\Denormalizer;

use const JSON_THROW_ON_ERROR;
use JsonException;
use First\Identity\Vendor\Symfony\Component\Serializer\Normalizer\DenormalizerAwareInterface;
use First\Identity\Vendor\Symfony\Component\Serializer\Normalizer\DenormalizerAwareTrait;
use First\Identity\Vendor\Symfony\Component\Serializer\Normalizer\DenormalizerInterface;
use First\Identity\Vendor\Webauthn\CollectedClientData;

final class CollectedClientDataDenormalizer implements DenormalizerInterface, DenormalizerAwareInterface
{
    use DenormalizerAwareTrait;

    /**
     * @throws JsonException
     */
    public function denormalize(mixed $data, string $type, ?string $format = null, array $context = []): mixed
    {
        /** @var string $data */
        /** @var array<string, mixed> $decoded */
        $decoded = json_decode($data, true, flags: JSON_THROW_ON_ERROR);

        return CollectedClientData::create($data, $decoded);
    }

    public function supportsDenormalization(
        mixed $data,
        string $type,
        ?string $format = null,
        array $context = []
    ): bool {
        return $type === CollectedClientData::class;
    }

    /**
     * @return array<class-string, bool>
     */
    public function getSupportedTypes(?string $format): array
    {
        return [
            CollectedClientData::class => true,
        ];
    }
}
