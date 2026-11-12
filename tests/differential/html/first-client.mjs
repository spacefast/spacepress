// "first/client" for the React half of the parity test: the hooks a client component's first
// render uses are React's own, and the browser-only ones do nothing on the server, as in React.
export { useState, useRef, useEffect } from "react";
export const useMount = () => {};
export const useEvent = () => {};
export const sharedState = (initial) => initial;
