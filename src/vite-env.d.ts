/// <reference types="vite/client" />

/** App version string injected by vite.config.web.ts's `define`; used by the (future) service worker cache name and the web About line. Desktop build does not define this. */
declare const __APP_VERSION__: string;
