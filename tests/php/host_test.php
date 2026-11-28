<?php

declare(strict_types=1);

require __DIR__ . '/../../runtime/SpacePress/bootstrap.php';
require __DIR__ . '/harness.php';

use SpacePress\Host;

// Host::names(PHP_OS_FAMILY, PHP_OS, php_uname('m')) against Node's process.platform and
// navigator.platform (lib/internal/navigator.js getNavigatorPlatform), for every OS on one runner.
eq(
	'Windows is win32 / Win32 whatever the machine',
	array( Host::names( 'Windows', 'WINNT', 'AMD64' ), Host::names( 'Windows', 'WINNT', 'x86' ) ),
	array( array( 'win32', 'Win32' ), array( 'win32', 'Win32' ) )
);
eq(
	'macOS is darwin / MacIntel on Apple silicon and Intel',
	array( Host::names( 'Darwin', 'Darwin', 'arm64' ), Host::names( 'Darwin', 'Darwin', 'x86_64' ) ),
	array( array( 'darwin', 'MacIntel' ), array( 'darwin', 'MacIntel' ) )
);
eq(
	'Linux names the architecture as Node does',
	array(
		Host::names( 'Linux', 'Linux', 'x86_64' ),
		Host::names( 'Linux', 'Linux', 'aarch64' ),
		Host::names( 'Linux', 'Linux', 'i686' ),
		Host::names( 'Linux', 'Linux', 'armv7l' ),
		Host::names( 'Linux', 'Linux', 'ppc64le' ),
		Host::names( 'Linux', 'Linux', 's390x' ),
		Host::names( 'Linux', 'Linux', 'riscv64' ),
		Host::names( 'Linux', 'Linux', 'loongarch64' ),
		Host::names( 'Linux', 'Linux', 'MIPS64' ),
	),
	array(
		array( 'linux', 'Linux x86_64' ),
		array( 'linux', 'Linux arm64' ),
		array( 'linux', 'Linux i686' ),
		array( 'linux', 'Linux arm' ),
		array( 'linux', 'Linux ppc64' ),
		array( 'linux', 'Linux s390x' ),
		array( 'linux', 'Linux riscv64' ),
		array( 'linux', 'Linux loong64' ),
		array( 'linux', 'Linux mips64' ),
	)
);
eq(
	'FreeBSD and OpenBSD use amd64 and i386',
	array(
		Host::names( 'BSD', 'FreeBSD', 'amd64' ),
		Host::names( 'BSD', 'FreeBSD', 'i386' ),
		Host::names( 'BSD', 'OpenBSD', 'amd64' ),
		Host::names( 'BSD', 'OpenBSD', 'arm64' ),
	),
	array( array( 'freebsd', 'FreeBSD amd64' ), array( 'freebsd', 'FreeBSD i386' ), array( 'openbsd', 'OpenBSD amd64' ), array( 'openbsd', 'OpenBSD arm64' ) )
);
eq(
	'Solaris is sunos, i86pc for ia32',
	array( Host::names( 'Solaris', 'SunOS', 'i86pc' ), Host::names( 'Solaris', 'SunOS', 'i386' ), Host::names( 'Solaris', 'SunOS', 'sparc64' ) ),
	array( array( 'sunos', 'SunOS i86pc' ), array( 'sunos', 'SunOS i86pc' ), array( 'sunos', 'SunOS sparc64' ) )
);
eq(
	'AIX is AIX; other systems upper-case the first letter',
	array( Host::names( 'Unknown', 'AIX', '00F84C0C4C00' ), Host::names( 'BSD', 'NetBSD', 'amd64' ), Host::names( 'Unknown', 'Haiku', 'x86_64' ) ),
	array( array( 'aix', 'AIX' ), array( 'netbsd', 'Netbsd x64' ), array( 'haiku', 'Haiku x64' ) )
);
eq(
	'without php_uname, 64-bit PHP reports x64 and 32-bit PHP ia32',
	array( Host::names( 'Linux', 'Linux', null, 8 ), Host::names( 'Linux', 'Linux', null, 4 ), Host::names( 'Windows', 'WINNT', null, 4 ) ),
	array( array( 'linux', 'Linux x86_64' ), array( 'linux', 'Linux i686' ), array( 'win32', 'Win32' ) )
);
eq(
	'the request values come from this PHP',
	array( Host::platform(), Host::navigatorPlatform() ),
	Host::names( PHP_OS_FAMILY, PHP_OS, php_uname( 'm' ) )
);
finish( 'host' );
