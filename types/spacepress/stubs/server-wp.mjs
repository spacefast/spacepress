throw new Error(
  'spacepress/server/wp runs only on the server (compiled to PHP by SpacePress). ' +
  'Call WordPress functions or abilities from a query() or mutation() action, or invoke abilities via @spacepress/client.'
);
