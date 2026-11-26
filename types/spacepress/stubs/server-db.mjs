throw new Error(
  'spacepress/server/db runs only on the server (compiled to PHP by SpacePress). ' +
  'Read data from browser code via a server action or @spacepress/client.'
);
