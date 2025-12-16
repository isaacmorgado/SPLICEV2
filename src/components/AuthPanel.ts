import { backendClient } from '../api/backend-client';
import { logger } from '../lib/logger';

/**
 * Authentication panel for login and registration
 * Handles user authentication flow before main app access
 */
export class AuthPanel {
  private container: HTMLElement;
  private mode: 'login' | 'register' = 'login';
  private onSuccess: () => void;
  private isProcessing: boolean = false;

  constructor(container: HTMLElement, onSuccess: () => void) {
    this.container = container;
    this.onSuccess = onSuccess;
  }

  render(): void {
    this.container.innerHTML = `
      <sp-theme theme="express" color="darkest" scale="medium" style="width: 100%; height: 100%;">
        <div class="auth-container" style="
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          height: 100%;
          padding: 24px;
          gap: 24px;
        ">
          <!-- Logo / Header -->
          <div style="text-align: center;">
            <h1 style="margin: 0; font-size: 24px; font-weight: 700; color: var(--spectrum-global-color-gray-50);">
              Splice
            </h1>
            <p style="margin: 8px 0 0 0; font-size: 13px; color: var(--spectrum-global-color-gray-400);">
              AI-powered video editing automation
            </p>
          </div>

          <!-- Auth Form Card -->
          <div style="
            width: 100%;
            background: var(--spectrum-global-color-gray-200);
            border-radius: 8px;
            padding: 20px;
          ">
            <!-- Tab Selector -->
            <div style="display: flex; gap: 8px; margin-bottom: 20px;">
              <sp-action-button
                id="auth-tab-login"
                size="m"
                ${this.mode === 'login' ? 'selected' : ''}
                style="flex: 1;"
              >
                Login
              </sp-action-button>
              <sp-action-button
                id="auth-tab-register"
                size="m"
                ${this.mode === 'register' ? 'selected' : ''}
                style="flex: 1;"
              >
                Register
              </sp-action-button>
            </div>

            <!-- Form -->
            <form id="auth-form" style="display: flex; flex-direction: column; gap: 16px;">
              <sp-textfield
                id="auth-email"
                placeholder="email@example.com"
                type="email"
                required
                quiet
                style="width: 100%;"
              >
                <span slot="label">Email</span>
              </sp-textfield>

              <sp-textfield
                id="auth-password"
                placeholder="Enter password"
                type="password"
                required
                quiet
                style="width: 100%;"
              >
                <span slot="label">Password</span>
              </sp-textfield>

              ${
                this.mode === 'register'
                  ? `
              <sp-textfield
                id="auth-password-confirm"
                placeholder="Confirm password"
                type="password"
                required
                quiet
                style="width: 100%;"
              >
                <span slot="label">Confirm Password</span>
              </sp-textfield>
              `
                  : ''
              }

              <!-- Error Message -->
              <div id="auth-error" style="
                display: none;
                padding: 8px;
                background: var(--spectrum-global-color-red-600);
                color: var(--spectrum-global-color-gray-50);
                border-radius: 4px;
                font-size: 12px;
              "></div>

              <!-- Submit Button -->
              <sp-button
                id="auth-submit"
                variant="cta"
                type="submit"
                ${this.isProcessing ? 'disabled' : ''}
                style="width: 100%;"
              >
                ${this.isProcessing ? 'Please wait...' : this.mode === 'login' ? 'Login' : 'Create Account'}
              </sp-button>
            </form>

            <!-- Additional Info for Register -->
            ${
              this.mode === 'register'
                ? `
            <div style="margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--spectrum-global-color-gray-300);">
              <p style="font-size: 11px; color: var(--spectrum-global-color-gray-500); line-height: 1.4; margin: 0;">
                By creating an account, you get:
              </p>
              <ul style="font-size: 11px; color: var(--spectrum-global-color-gray-400); line-height: 1.4; margin: 8px 0 0 0; padding-left: 20px;">
                <li>10 free minutes per month</li>
                <li>AI transcription & analysis</li>
                <li>Smart silence detection</li>
                <li>Take detection & labeling</li>
              </ul>
            </div>
            `
                : ''
            }
          </div>

          <!-- Service Status -->
          <div id="auth-service-status" style="font-size: 10px; color: var(--spectrum-global-color-gray-500);"></div>
        </div>
      </sp-theme>
    `;

    this.attachEventListeners();
    this.checkServiceHealth();
  }

  private attachEventListeners(): void {
    // Tab switching
    this.container.querySelector('#auth-tab-login')?.addEventListener('click', () => {
      this.mode = 'login';
      this.render();
    });

    this.container.querySelector('#auth-tab-register')?.addEventListener('click', () => {
      this.mode = 'register';
      this.render();
    });

    // Form submission
    const form = this.container.querySelector('#auth-form') as HTMLFormElement;
    form?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleSubmit();
    });

    // Enter key support for textfields
    this.container.querySelectorAll('sp-textfield').forEach((field) => {
      field.addEventListener('keydown', (e) => {
        if ((e as KeyboardEvent).key === 'Enter') {
          this.handleSubmit();
        }
      });
    });
  }

  private async handleSubmit(): Promise<void> {
    if (this.isProcessing) return;

    const emailField = this.container.querySelector('#auth-email') as any;
    const passwordField = this.container.querySelector('#auth-password') as any;
    const confirmField = this.container.querySelector('#auth-password-confirm') as any;

    const email = emailField?.value?.trim();
    const password = passwordField?.value;

    // Validation
    if (!email || !password) {
      this.showError('Please enter both email and password');
      return;
    }

    if (!this.isValidEmail(email)) {
      this.showError('Please enter a valid email address');
      return;
    }

    if (password.length < 8) {
      this.showError('Password must be at least 8 characters');
      return;
    }

    if (this.mode === 'register') {
      const confirmPassword = confirmField?.value;
      if (password !== confirmPassword) {
        this.showError('Passwords do not match');
        return;
      }
    }

    // Hide error and set processing state
    this.hideError();
    this.isProcessing = true;
    this.render();

    try {
      if (this.mode === 'login') {
        logger.info('Attempting login...');
        await backendClient.login(email, password);
        logger.info('Login successful');
      } else {
        logger.info('Attempting registration...');
        await backendClient.register(email, password);
        logger.info('Registration successful');
      }

      // Success - trigger callback to load main app
      this.onSuccess();
    } catch (error) {
      logger.error(`${this.mode} failed`, error);
      const errorMessage = error instanceof Error ? error.message : 'Authentication failed';
      this.showError(errorMessage);
      this.isProcessing = false;
      this.render();
    }
  }

  private async checkServiceHealth(): Promise<void> {
    const statusEl = this.container.querySelector('#auth-service-status');
    if (!statusEl) return;

    try {
      const isHealthy = await backendClient.checkHealth();

      // Clear existing content
      statusEl.innerHTML = '';

      // Create status indicator span
      const indicator = document.createElement('span');

      if (isHealthy) {
        indicator.style.color = 'var(--spectrum-global-color-green-500)';
        indicator.textContent = '● ';
        statusEl.appendChild(indicator);
        statusEl.appendChild(document.createTextNode('Service online'));
      } else {
        indicator.style.color = 'var(--spectrum-global-color-orange-500)';
        indicator.textContent = '● ';
        statusEl.appendChild(indicator);
        statusEl.appendChild(document.createTextNode('Service degraded'));
      }
    } catch {
      // Clear existing content
      statusEl.innerHTML = '';

      const indicator = document.createElement('span');
      indicator.style.color = 'var(--spectrum-global-color-red-500)';
      indicator.textContent = '● ';
      statusEl.appendChild(indicator);
      statusEl.appendChild(
        document.createTextNode('Service offline - Please check your connection')
      );
    }
  }

  private showError(message: string): void {
    const errorEl = this.container.querySelector('#auth-error');
    if (errorEl) {
      errorEl.textContent = message;
      (errorEl as HTMLElement).style.display = 'block';
    }
  }

  private hideError(): void {
    const errorEl = this.container.querySelector('#auth-error');
    if (errorEl) {
      (errorEl as HTMLElement).style.display = 'none';
    }
  }

  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }
}
