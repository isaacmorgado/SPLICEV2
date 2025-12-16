import '@spectrum-web-components/theme/sp-theme.js';
import '@spectrum-web-components/theme/express/theme-darkest.js';
import '@spectrum-web-components/theme/express/scale-medium.js';
import '@spectrum-web-components/button/sp-button.js';
import '@spectrum-web-components/textfield/sp-textfield.js';
import '@spectrum-web-components/action-button/sp-action-button.js';

import { App } from './components/App';

// Initialize the app
async function initApp() {
  const root = document.getElementById('root');
  if (!root) return;

  try {
    const app = new App(root);
    await app.init();
  } catch (error) {
    // Display error in UI for debugging
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : '';
    root.innerHTML = `
      <div style="padding: 16px; color: #ff6b6b; font-family: monospace; font-size: 12px;">
        <h3 style="margin: 0 0 8px 0;">Splice Init Error</h3>
        <p style="margin: 0 0 8px 0;">${message}</p>
        <pre style="margin: 0; white-space: pre-wrap; font-size: 10px; color: #888;">${stack}</pre>
      </div>
    `;
    console.error('Splice init error:', error);
  }
}

// ES modules are deferred, so DOMContentLoaded may have already fired
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  // DOM is already ready
  initApp();
}

// Export for UXP panel lifecycle
export { App };
