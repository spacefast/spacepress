# Realtime notices carry ids, never rows

Zero apps need live updates, and hosts deliver them over their own transports.
One room usually serves every viewer of a site, so a pushed payload reaches
viewers whose access rules differ. Zero cannot run per-viewer access checks
inside a host's fanout.

We chose notices that name only the collection, the operations and the row ids.
Clients re-run their normal access-checked read when a notice arrives. For
shared rooms, `Realtime\Module::shared()` also drops ids for collections an
anonymous visitor cannot list.

Pushing row data, filtered per subscriber, would save one read per change. It
needs the server to hold each subscriber's query and viewer, which a PHP-only
request runtime cannot do. We accept one extra read per change for every
watcher. We also accept that a viewer can see that a private collection changed,
and when.
