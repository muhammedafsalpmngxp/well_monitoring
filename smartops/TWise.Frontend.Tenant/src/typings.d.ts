import type { AppEnvironment } from './environments/runtime-env';

// jspdf and html2canvas ship their own type declarations; do not re-add module stubs for them here.
declare global {
  interface Window {
    __TWISE_ENV__?: Partial<AppEnvironment>;
  }
}
