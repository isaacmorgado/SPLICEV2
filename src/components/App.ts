import { PremiereAPI } from '../api/premiere';
import { AIServices } from '../api/ai-services';
import { logger } from '../lib/logger';

export class App {
  private container: HTMLElement;
  private premiereAPI: PremiereAPI;
  private aiServices: AIServices;

  constructor(container: HTMLElement) {
    this.container = container;
    this.premiereAPI = new PremiereAPI();
    this.aiServices = new AIServices();
  }

  render(): void {
    this.container.innerHTML = `
      <sp-theme theme="express" color="darkest" scale="medium" style="width: 100%; height: 100%;">
        <div class="splice-container" style="padding: 16px; display: flex; flex-direction: column; gap: 16px;">
          <header class="splice-header">
            <h1 style="margin: 0; font-size: 18px; font-weight: 600; color: var(--spectrum-global-color-gray-50);">
              Splice
            </h1>
            <p style="margin: 4px 0 0; font-size: 12px; color: var(--spectrum-global-color-gray-400);">
              AI-powered automation for Premiere Pro
            </p>
          </header>

          <section class="splice-actions" style="display: flex; flex-direction: column; gap: 8px;">
            <sp-button variant="cta" id="btn-analyze">
              Analyze Timeline
            </sp-button>

            <sp-button variant="primary" id="btn-autocut">
              Auto-Cut Silence
            </sp-button>

            <sp-button variant="secondary" id="btn-color">
              AI Color Match
            </sp-button>
          </section>

          <section class="splice-settings" style="display: flex; flex-direction: column; gap: 8px;">
            <sp-textfield
              id="input-api-key"
              type="password"
              placeholder="AI Service API Key"
              style="width: 100%;"
            ></sp-textfield>
          </section>

          <footer class="splice-status" style="margin-top: auto;">
            <div id="status-message" style="font-size: 11px; color: var(--spectrum-global-color-gray-500);">
              Ready
            </div>
          </footer>
        </div>
      </sp-theme>
    `;

    this.attachEventListeners();
    logger.info('Splice app initialized');
  }

  private attachEventListeners(): void {
    const btnAnalyze = this.container.querySelector('#btn-analyze');
    const btnAutocut = this.container.querySelector('#btn-autocut');
    const btnColor = this.container.querySelector('#btn-color');

    btnAnalyze?.addEventListener('click', () => this.handleAnalyze());
    btnAutocut?.addEventListener('click', () => this.handleAutocut());
    btnColor?.addEventListener('click', () => this.handleColorMatch());
  }

  private async handleAnalyze(): Promise<void> {
    this.setStatus('Analyzing timeline...');
    try {
      const result = await this.premiereAPI.analyzeTimeline();
      this.setStatus(`Found ${result.clipCount} clips`);
      logger.info('Timeline analysis complete', result);
    } catch (error) {
      this.setStatus('Analysis failed');
      logger.error('Timeline analysis failed', error);
    }
  }

  private async handleAutocut(): Promise<void> {
    this.setStatus('Processing auto-cut...');
    try {
      const result = await this.premiereAPI.autoCutSilence();
      this.setStatus(`Removed ${result.cutsApplied} silent sections`);
      logger.info('Auto-cut complete', result);
    } catch (error) {
      this.setStatus('Auto-cut failed');
      logger.error('Auto-cut failed', error);
    }
  }

  private async handleColorMatch(): Promise<void> {
    const apiKey = this.getAPIKey();
    if (!apiKey) {
      this.setStatus('Please enter API key');
      return;
    }

    this.setStatus('Matching colors with AI...');
    try {
      const result = await this.aiServices.colorMatch(apiKey);
      this.setStatus('Color matching complete');
      logger.info('Color match complete', result);
    } catch (error) {
      this.setStatus('Color match failed');
      logger.error('Color match failed', error);
    }
  }

  private setStatus(message: string): void {
    const statusEl = this.container.querySelector('#status-message');
    if (statusEl) {
      statusEl.textContent = message;
    }
  }

  private getAPIKey(): string {
    const input = this.container.querySelector('#input-api-key') as HTMLInputElement;
    return input?.value || '';
  }
}
