throw new Error(
  'spacepress/server runs only on the server (compiled to PHP by SpacePress). ' +
  'Move server work into a query() or mutation() action and call it from client code, or use @spacepress/client.'
);
