<?php declare(strict_types = 1);

namespace First\Identity\Vendor\PHPStan\PhpDocParser\Ast\NodeVisitor;

use First\Identity\Vendor\PHPStan\PhpDocParser\Ast\AbstractNodeVisitor;
use First\Identity\Vendor\PHPStan\PhpDocParser\Ast\Attribute;
use First\Identity\Vendor\PHPStan\PhpDocParser\Ast\Node;

final class CloningVisitor extends AbstractNodeVisitor
{

	public function enterNode(Node $originalNode): Node
	{
		$node = clone $originalNode;
		$node->setAttribute(Attribute::ORIGINAL_NODE, $originalNode);

		return $node;
	}

}
