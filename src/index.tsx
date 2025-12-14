import '@spectrum-web-components/theme/sp-theme.js';
import '@spectrum-web-components/theme/express/theme-darkest.js';
import '@spectrum-web-components/theme/express/scale-medium.js';
import '@spectrum-web-components/button/sp-button.js';
import '@spectrum-web-components/textfield/sp-textfield.js';
import '@spectrum-web-components/action-button/sp-action-button.js';

import { App } from './components/App';

// Initialize the app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  const root = document.getElementById('root');
  if (root) {
    const app = new App(root);
    app.render();
  }
});

// Export for UXP panel lifecycle
export { App };
