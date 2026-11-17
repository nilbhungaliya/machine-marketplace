import { registerRootComponent } from 'expo';
// Before ./App: a crash while the bundle evaluates is the one we most want, and
// Sentry cannot report what happened before it started. No-op without a DSN.
import { initErrorReporting } from './lib/error-reporting';

initErrorReporting();
import App from './App';

registerRootComponent(App);
