import { PremiereAPI } from '../api/premiere';
import { AIServices, aiServices } from '../api/ai-services';
import { subscriptionService } from '../services/subscription';
import { takeDetector } from '../services/take-detector';
import { exportPresetsService } from '../services/export-presets';
import { serviceStatus } from '../services/service-status';
import { secureStorage } from '../lib/secure-storage';
import { logger, LogLevel } from '../lib/logger';
import { isSpliceError, wrapError } from '../lib/errors';
import { openExternalUrl } from '../lib/utils';
import { backendClient } from '../api/backend-client';
import { AuthPanel } from './AuthPanel';

type TabId = 'home' | 'silence' | 'takes' | 'settings';

interface AppState {
  activeTab: TabId;
  projectName: string;
  projectPath: string;
  clipCount: number;
  duration: number;
  tracks: number;
  status: string;
  isProcessing: boolean;
  // Silence tab state
  silenceThreshold: number;
  useVoiceIsolation: boolean;
  silentSections: number;
  timeToRemove: number;
  selectedPresetId: string | null;
  availablePresets: SilenceDetectionPreset[];
  // Takes tab state
  transcript: string;
  takes: NormalizedTake[];
  takeGroups: TakeGroup[];
  takeSelectionStrategy: TakeSelectionStrategy;
  takePreview: TakePreview | null;
  // Settings tab state
  tier: TierId;
  minutesUsed: number;
  minutesLimit: number;
  subscriptionStatus: 'active' | 'canceled' | 'expired';
  periodEnd: Date | null;
  // Debug panel state
  debugPanelExpanded: boolean;
  debugFilterLevel: LogLevel;
}

export class App {
  private container: HTMLElement;
  private premiereAPI: PremiereAPI;
  private aiServices: AIServices;
  private state: AppState;
  private pollingInterval: ReturnType<typeof setInterval> | null = null;
  private pollCount: number = 0;
  private readonly maxPollCount: number = 60; // Poll for 5 minutes max (60 * 5 sec)
  private authPanel: AuthPanel | null = null;
  private isAuthenticated: boolean = false;

  constructor(container: HTMLElement) {
    this.container = container;
    this.premiereAPI = new PremiereAPI();
    this.aiServices = aiServices;
    this.state = {
      activeTab: 'home',
      projectName: '',
      projectPath: '',
      clipCount: 0,
      duration: 0,
      tracks: 0,
      status: 'Ready',
      isProcessing: false,
      silenceThreshold: -40,
      useVoiceIsolation: false,
      silentSections: 0,
      timeToRemove: 0,
      selectedPresetId: null,
      availablePresets: [],
      transcript: '',
      takes: [],
      takeGroups: [],
      takeSelectionStrategy: 'best_only',
      takePreview: null,
      tier: 'free',
      minutesUsed: 0,
      minutesLimit: 10,
      subscriptionStatus: 'active',
      periodEnd: null,
      debugPanelExpanded: false,
      debugFilterLevel: 'info',
    };
  }

  async init(): Promise<void> {
    // Check if user is authenticated
    this.isAuthenticated = await secureStorage.isAuthenticated();

    if (!this.isAuthenticated) {
      // Show authentication panel
      logger.info('User not authenticated, showing auth panel');
      this.showAuthPanel();
      return;
    }

    // User is authenticated, load main app
    await this.loadMainApp();
  }

  private showAuthPanel(): void {
    this.authPanel = new AuthPanel(this.container, async () => {
      // Auth success callback
      this.authPanel = null;
      this.isAuthenticated = true;
      await this.loadMainApp();
    });
    this.authPanel.render();
  }

  private async loadMainApp(): Promise<void> {
    // Run health check in background (don't block init)
    backendClient.checkHealth().catch((e) => logger.warn('Health check failed', e));

    await this.loadProjectInfo();
    await this.loadSubscriptionInfo();
    await this.loadPresets();
    this.render();

    // Subscribe to service status changes
    serviceStatus.subscribe(() => {
      // Re-render header when status changes
      this.updateServiceStatusIndicator();
    });

    // Listen for visibility changes to refresh subscription when user returns from Stripe
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.pollingInterval) {
        this.handleVisibilityReturn();
      }
    });

    logger.info('Splice app initialized');
  }

  render(): void {
    this.container.innerHTML = `
      <sp-theme theme="express" color="darkest" scale="medium" style="width: 100%; height: 100%;">
        <div class="splice-container" style="padding: 12px; display: flex; flex-direction: column; height: 100%; gap: 12px;">
          ${this.renderHeader()}
          ${this.renderTabNavigation()}
          <div class="tab-content" style="flex: 1; overflow-y: auto;">
            ${this.renderTabContent()}
          </div>
          ${this.renderStatusBar()}
        </div>
      </sp-theme>
    `;

    this.attachEventListeners();
  }

  // ============================================
  // Header & Navigation
  // ============================================

  private renderHeader(): string {
    const statusColor = serviceStatus.getStatusColor();
    const statusTitle = serviceStatus.getStatusMessage();

    return `
      <header class="splice-header" style="display: flex; justify-content: space-between; align-items: center;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <h1 style="margin: 0; font-size: 16px; font-weight: 600; color: var(--spectrum-global-color-gray-50);">
            Splice
          </h1>
          <div
            id="service-status-indicator"
            style="width: 8px; height: 8px; border-radius: 50%; background: ${statusColor};"
            title="${statusTitle}"
          ></div>
        </div>
        <div style="font-size: 10px; color: var(--spectrum-global-color-gray-500);">
          ${this.state.tier.toUpperCase()}
        </div>
      </header>
    `;
  }

  private renderTabNavigation(): string {
    const tabs: { id: TabId; label: string }[] = [
      { id: 'home', label: 'Home' },
      { id: 'silence', label: 'Silence' },
      { id: 'takes', label: 'Takes' },
      { id: 'settings', label: 'Settings' },
    ];

    return `
      <nav class="tab-nav" style="display: flex; gap: 4px; border-bottom: 1px solid var(--spectrum-global-color-gray-300); padding-bottom: 8px;">
        ${tabs
          .map(
            (tab) => `
          <sp-action-button
            id="tab-${tab.id}"
            size="s"
            ${this.state.activeTab === tab.id ? 'selected' : ''}
            style="flex: 1; ${this.state.activeTab === tab.id ? 'background: var(--spectrum-global-color-gray-200);' : ''}"
          >
            ${tab.label}
          </sp-action-button>
        `
          )
          .join('')}
      </nav>
    `;
  }

  private renderStatusBar(): string {
    return `
      <footer class="splice-status" style="border-top: 1px solid var(--spectrum-global-color-gray-300); padding-top: 8px;">
        <div id="status-message" style="font-size: 11px; color: var(--spectrum-global-color-gray-500); display: flex; align-items: center; gap: 8px;">
          ${this.state.isProcessing ? '<sp-progress-circle size="s" indeterminate></sp-progress-circle>' : ''}
          ${this.state.status}
        </div>
      </footer>
    `;
  }

  private renderSubscriptionStatusBar(): string {
    const usagePercent = (this.state.minutesUsed / this.state.minutesLimit) * 100;

    // Color coding based on usage
    let progressColor = 'var(--spectrum-global-color-green-500)';
    let statusColor = 'var(--spectrum-global-color-green-500)';
    let statusText = 'Plenty of minutes remaining';

    if (usagePercent >= 80) {
      progressColor = 'var(--spectrum-global-color-red-500)';
      statusColor = 'var(--spectrum-global-color-red-500)';
      statusText = 'Running low on minutes!';
    } else if (usagePercent >= 50) {
      progressColor = 'var(--spectrum-global-color-orange-500)';
      statusColor = 'var(--spectrum-global-color-orange-400)';
      statusText = 'Using your minutes steadily';
    }

    // Tier badge colors
    const tierColors: Record<string, string> = {
      free: 'var(--spectrum-global-color-gray-500)',
      pro: 'var(--spectrum-global-color-blue-500)',
      studio: 'var(--spectrum-global-color-purple-500)',
    };

    const tierBadgeColor = tierColors[this.state.tier] || tierColors.free;

    return `
      <section class="subscription-status-bar" style="
        background: var(--spectrum-global-color-gray-200);
        padding: 12px;
        border-radius: 4px;
        margin-bottom: 16px;
      ">
        <!-- Tier Badge Row -->
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="
              display: inline-block;
              padding: 4px 8px;
              border-radius: 4px;
              font-size: 10px;
              font-weight: 700;
              letter-spacing: 0.5px;
              background: ${tierBadgeColor};
              color: white;
            ">${this.state.tier.toUpperCase()}</span>
            <span style="font-size: 13px; font-weight: 500; color: var(--spectrum-global-color-gray-50);">
              Plan
            </span>
          </div>
          <div style="font-size: 12px; color: ${statusColor}; font-weight: 500;">
            ${this.state.minutesUsed.toFixed(1)} / ${this.state.minutesLimit} min
          </div>
        </div>

        <!-- Progress Bar -->
        <div style="
          height: 6px;
          background: var(--spectrum-global-color-gray-300);
          border-radius: 3px;
          overflow: hidden;
          margin-bottom: 8px;
        ">
          <div style="
            height: 100%;
            width: ${Math.min(100, usagePercent)}%;
            background: ${progressColor};
            border-radius: 3px;
            transition: width 0.3s ease, background 0.3s ease;
          "></div>
        </div>

        <!-- Usage Text -->
        <div style="font-size: 10px; color: var(--spectrum-global-color-gray-400); text-align: center;">
          ${statusText}${this.state.tier === 'free' ? ' - Upgrade for more!' : ''}
        </div>
      </section>
    `;
  }

  // ============================================
  // Tab Content Rendering
  // ============================================

  private renderTabContent(): string {
    switch (this.state.activeTab) {
      case 'home':
        return this.renderHomeTab();
      case 'silence':
        return this.renderSilenceTab();
      case 'takes':
        return this.renderTakesTab();
      case 'settings':
        return this.renderSettingsTab();
      default:
        return this.renderHomeTab();
    }
  }

  private renderHomeTab(): string {
    return `
      <div class="home-tab" style="display: flex; flex-direction: column; gap: 16px;">
        <!-- Project Info -->
        <section class="project-info" style="background: var(--spectrum-global-color-gray-200); padding: 12px; border-radius: 4px;">
          <div style="font-size: 11px; color: var(--spectrum-global-color-gray-500); margin-bottom: 4px;">PROJECT</div>
          <div style="font-size: 13px; font-weight: 500; color: var(--spectrum-global-color-gray-50);">
            ${this.state.projectName || 'No project open'}
          </div>
          ${
            this.state.projectPath
              ? `<div style="font-size: 10px; color: var(--spectrum-global-color-gray-400); margin-top: 2px; word-break: break-all;">${this.state.projectPath}</div>`
              : ''
          }
        </section>

        <!-- Timeline Stats -->
        <section class="timeline-stats" style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px;">
          <div style="background: var(--spectrum-global-color-gray-200); padding: 8px; border-radius: 4px; text-align: center;">
            <div style="font-size: 18px; font-weight: 600; color: var(--spectrum-global-color-blue-500);">${this.state.clipCount}</div>
            <div style="font-size: 10px; color: var(--spectrum-global-color-gray-500);">Clips</div>
          </div>
          <div style="background: var(--spectrum-global-color-gray-200); padding: 8px; border-radius: 4px; text-align: center;">
            <div style="font-size: 18px; font-weight: 600; color: var(--spectrum-global-color-blue-500);">${this.formatDuration(this.state.duration)}</div>
            <div style="font-size: 10px; color: var(--spectrum-global-color-gray-500);">Duration</div>
          </div>
          <div style="background: var(--spectrum-global-color-gray-200); padding: 8px; border-radius: 4px; text-align: center;">
            <div style="font-size: 18px; font-weight: 600; color: var(--spectrum-global-color-blue-500);">${this.state.tracks}</div>
            <div style="font-size: 10px; color: var(--spectrum-global-color-gray-500);">Tracks</div>
          </div>
        </section>

        <!-- Quick Actions -->
        <section class="quick-actions" style="display: flex; flex-direction: column; gap: 8px;">
          <sp-button variant="cta" id="btn-analyze" ${this.state.isProcessing ? 'disabled' : ''}>
            Analyze Timeline
          </sp-button>
          <sp-button variant="primary" id="btn-quick-silence" ${this.state.isProcessing ? 'disabled' : ''}>
            Quick Silence Cut
          </sp-button>
        </section>

        <!-- Usage -->
        <section class="usage-info" style="background: var(--spectrum-global-color-gray-200); padding: 12px; border-radius: 4px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <div style="font-size: 11px; color: var(--spectrum-global-color-gray-500);">USAGE</div>
            <div style="font-size: 11px; color: var(--spectrum-global-color-gray-400);">${this.state.minutesUsed} / ${this.state.minutesLimit} min</div>
          </div>
          <div style="height: 4px; background: var(--spectrum-global-color-gray-300); border-radius: 2px; overflow: hidden;">
            <div style="height: 100%; width: ${Math.min(100, (this.state.minutesUsed / this.state.minutesLimit) * 100)}%; background: var(--spectrum-global-color-blue-500);"></div>
          </div>
        </section>
      </div>
    `;
  }

  private renderSilenceTab(): string {
    return `
      <div class="silence-tab" style="display: flex; flex-direction: column; gap: 16px;">
        <!-- Preset Selection -->
        <section class="preset-selection" style="display: flex; flex-direction: column; gap: 8px;">
          <label style="font-size: 11px; color: var(--spectrum-global-color-gray-400);">PRESET</label>
          <select
            id="preset-selector"
            style="width: 100%; padding: 6px; background: var(--spectrum-global-color-gray-200); border: 1px solid var(--spectrum-global-color-gray-300); border-radius: 4px; color: var(--spectrum-global-color-gray-50);"
          >
            <option value="">Custom Settings</option>
            ${this.state.availablePresets
              .map(
                (preset) => `
              <option value="${preset.id}" ${this.state.selectedPresetId === preset.id ? 'selected' : ''}>
                ${preset.name}${preset.description ? ` - ${preset.description}` : ''}
              </option>
            `
              )
              .join('')}
          </select>
        </section>

        <!-- Settings -->
        <section class="silence-settings" style="display: flex; flex-direction: column; gap: 12px;">
          <div>
            <label style="font-size: 11px; color: var(--spectrum-global-color-gray-400); display: block; margin-bottom: 4px;">
              Silence Threshold: ${this.state.silenceThreshold} dB
            </label>
            <input
              type="range"
              id="silence-threshold"
              min="-60"
              max="-20"
              value="${this.state.silenceThreshold}"
              style="width: 100%;"
            />
            <div style="display: flex; justify-content: space-between; font-size: 9px; color: var(--spectrum-global-color-gray-500);">
              <span>Quieter (-60)</span>
              <span>Louder (-20)</span>
            </div>
          </div>

          <div style="display: flex; align-items: center; gap: 8px;">
            <input
              type="checkbox"
              id="voice-isolation"
              ${this.state.useVoiceIsolation ? 'checked' : ''}
            />
            <label for="voice-isolation" style="font-size: 12px; color: var(--spectrum-global-color-gray-300);">
              Use voice isolation (slower, more accurate)
            </label>
          </div>

          <div style="display: flex; gap: 8px;">
            <sp-button variant="secondary" id="btn-save-preset" size="s" style="flex: 1;">
              Save as Preset
            </sp-button>
          </div>
        </section>

        <!-- Actions -->
        <section class="silence-actions" style="display: flex; flex-direction: column; gap: 8px;">
          <sp-button variant="cta" id="btn-detect-silence" ${this.state.isProcessing ? 'disabled' : ''}>
            Detect Silence
          </sp-button>
          <sp-button variant="primary" id="btn-apply-cuts" ${this.state.isProcessing || this.state.silentSections === 0 ? 'disabled' : ''}>
            Apply Cuts (${this.state.silentSections} sections)
          </sp-button>
        </section>

        <!-- Results -->
        ${
          this.state.silentSections > 0
            ? `
          <section class="silence-results" style="background: var(--spectrum-global-color-gray-200); padding: 12px; border-radius: 4px;">
            <div style="font-size: 11px; color: var(--spectrum-global-color-gray-500); margin-bottom: 8px;">DETECTED</div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
              <div>
                <div style="font-size: 20px; font-weight: 600; color: var(--spectrum-global-color-orange-500);">${this.state.silentSections}</div>
                <div style="font-size: 10px; color: var(--spectrum-global-color-gray-500);">Silent Sections</div>
              </div>
              <div>
                <div style="font-size: 20px; font-weight: 600; color: var(--spectrum-global-color-orange-500);">${this.state.timeToRemove.toFixed(1)}s</div>
                <div style="font-size: 10px; color: var(--spectrum-global-color-gray-500);">Time to Remove</div>
              </div>
            </div>
          </section>
        `
            : ''
        }

        <!-- Info -->
        <section style="font-size: 11px; color: var(--spectrum-global-color-gray-500); line-height: 1.4;">
          <strong>How it works:</strong><br/>
          1. Extracts audio from timeline<br/>
          2. Detects silent sections below threshold<br/>
          3. Uses AI to preserve natural pauses<br/>
          4. Cuts silent sections with ripple delete
        </section>
      </div>
    `;
  }

  private renderTakesTab(): string {
    return `
      <div class="takes-tab" style="display: flex; flex-direction: column; gap: 16px;">
        <!-- Transcription -->
        <section class="transcription-section" style="display: flex; flex-direction: column; gap: 8px;">
          <sp-button variant="cta" id="btn-transcribe" ${this.state.isProcessing ? 'disabled' : ''}>
            Transcribe Timeline
          </sp-button>

          ${
            this.state.transcript
              ? `
            <div style="background: var(--spectrum-global-color-gray-200); padding: 12px; border-radius: 4px; max-height: 100px; overflow-y: auto;">
              <div style="font-size: 11px; color: var(--spectrum-global-color-gray-500); margin-bottom: 8px;">TRANSCRIPT</div>
              <div style="font-size: 12px; color: var(--spectrum-global-color-gray-300); line-height: 1.5;">
                ${this.state.transcript.slice(0, 500)}${this.state.transcript.length > 500 ? '...' : ''}
              </div>
            </div>
          `
              : ''
          }
        </section>

        <!-- Take Analysis -->
        ${
          this.state.transcript
            ? `
          <section class="take-analysis" style="display: flex; flex-direction: column; gap: 8px;">
            <sp-button variant="primary" id="btn-analyze-takes" ${this.state.isProcessing ? 'disabled' : ''}>
              Analyze Takes
            </sp-button>

            ${this.state.takeGroups.length > 0 ? this.renderTakeSelectionControls() : ''}
            ${this.state.takeGroups.length > 0 ? this.renderTakeGroups() : ''}
          </section>
        `
            : ''
        }

        <!-- Apply Takes Button -->
        ${
          this.state.takeGroups.length > 0
            ? `
          <section class="take-actions" style="display: flex; flex-direction: column; gap: 8px;">
            ${this.state.takePreview ? this.renderTakePreview() : ''}
            <sp-button variant="cta" id="btn-apply-takes" ${this.state.isProcessing ? 'disabled' : ''}>
              Apply Takes to Timeline (${this.getTotalTakesCount()} takes)
            </sp-button>
          </section>
        `
            : ''
        }

        <!-- Info -->
        <section style="font-size: 11px; color: var(--spectrum-global-color-gray-500); line-height: 1.4;">
          <strong>Take Selection:</strong><br/>
          Transcribe your timeline, then let AI analyze multiple takes of the same content.
          The best take is highlighted. Click "Apply" to cut, color, and rename clips.
        </section>
      </div>
    `;
  }

  private renderTakeGroups(): string {
    return `
      <div style="display: flex; flex-direction: column; gap: 8px; max-height: 300px; overflow-y: auto;">
        ${this.state.takeGroups
          .map(
            (group, groupIdx) => `
          <div style="background: var(--spectrum-global-color-gray-200); padding: 10px; border-radius: 4px;">
            <div style="font-size: 11px; font-weight: 500; color: var(--spectrum-global-color-gray-300); margin-bottom: 8px;">
              "${group.phrase.slice(0, 40)}${group.phrase.length > 40 ? '...' : ''}"
            </div>
            <div style="display: flex; flex-direction: column; gap: 4px;">
              ${group.takes.map((take, takeIdx) => this.renderTakeItem(take, groupIdx, takeIdx)).join('')}
            </div>
          </div>
        `
          )
          .join('')}
      </div>
    `;
  }

  private renderTakeItem(take: NormalizedTake, groupIdx: number, takeIdx: number): string {
    const colorCSS = takeDetector.getColorCSS(take.colorIndex);
    const isBest = take.isBest;

    return `
      <div style="
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 6px 8px;
        background: var(--spectrum-global-color-gray-300);
        border-radius: 3px;
        border-left: 3px solid ${isBest ? 'var(--spectrum-global-color-green-500)' : colorCSS};
      ">
        <div style="display: flex; align-items: center; gap: 8px;">
          <div style="
            width: 12px;
            height: 12px;
            border-radius: 2px;
            background: ${colorCSS};
          " title="${takeDetector.getColorName(take.colorIndex)}"></div>
          <span style="font-size: 11px; color: var(--spectrum-global-color-gray-300);">
            Take ${take.takeNumber} ${isBest ? '(Best)' : ''}
          </span>
          <span style="font-size: 10px; color: var(--spectrum-global-color-gray-500);">
            ${take.start.toFixed(2)}s - ${take.end.toFixed(2)}s
          </span>
          <span style="font-size: 10px; color: var(--spectrum-global-color-gray-500);">
            ${(take.score * 100).toFixed(0)}%
          </span>
        </div>
        <sp-action-button
          size="xs"
          id="btn-goto-take-${groupIdx}-${takeIdx}"
          title="Go to this take"
          style="min-width: 40px;"
        >
          Go to
        </sp-action-button>
      </div>
    `;
  }

  private getTotalTakesCount(): number {
    return this.state.takeGroups.reduce((sum, g) => sum + g.takes.length, 0);
  }

  private renderTakeSelectionControls(): string {
    return `
      <div style="background: var(--spectrum-global-color-gray-200); padding: 12px; border-radius: 4px; margin-top: 8px;">
        <div style="font-size: 11px; color: var(--spectrum-global-color-gray-500); margin-bottom: 8px;">SELECTION STRATEGY</div>
        <div style="display: flex; gap: 8px; margin-bottom: 8px;">
          <sp-action-button
            id="strategy-best-only"
            size="s"
            ${this.state.takeSelectionStrategy === 'best_only' ? 'selected' : ''}
            style="flex: 1;"
          >
            Best Only
          </sp-action-button>
          <sp-action-button
            id="strategy-all-takes"
            size="s"
            ${this.state.takeSelectionStrategy === 'all_takes' ? 'selected' : ''}
            style="flex: 1;"
          >
            All Takes
          </sp-action-button>
          <sp-action-button
            id="strategy-manual"
            size="s"
            ${this.state.takeSelectionStrategy === 'manual' ? 'selected' : ''}
            style="flex: 1;"
          >
            Manual
          </sp-action-button>
        </div>
        <sp-button variant="secondary" id="btn-preview-takes" size="s" style="width: 100%;">
          Preview Selection
        </sp-button>
      </div>
    `;
  }

  private renderTakePreview(): string {
    if (!this.state.takePreview) return '';

    const preview = this.state.takePreview;
    const keepPercent = (preview.keepDuration / preview.totalDuration) * 100;
    const removePercent = (preview.removeDuration / preview.totalDuration) * 100;

    return `
      <div style="background: var(--spectrum-global-color-gray-200); padding: 12px; border-radius: 4px; margin-bottom: 8px;">
        <div style="font-size: 11px; color: var(--spectrum-global-color-gray-500); margin-bottom: 8px;">PREVIEW</div>
        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; margin-bottom: 8px;">
          <div>
            <div style="font-size: 16px; font-weight: 600; color: var(--spectrum-global-color-blue-500);">${preview.totalDuration.toFixed(1)}s</div>
            <div style="font-size: 10px; color: var(--spectrum-global-color-gray-500);">Total</div>
          </div>
          <div>
            <div style="font-size: 16px; font-weight: 600; color: var(--spectrum-global-color-green-500);">${preview.keepDuration.toFixed(1)}s</div>
            <div style="font-size: 10px; color: var(--spectrum-global-color-gray-500);">Keep (${keepPercent.toFixed(0)}%)</div>
          </div>
          <div>
            <div style="font-size: 16px; font-weight: 600; color: var(--spectrum-global-color-red-500);">${preview.removeDuration.toFixed(1)}s</div>
            <div style="font-size: 10px; color: var(--spectrum-global-color-gray-500);">Remove (${removePercent.toFixed(0)}%)</div>
          </div>
        </div>
      </div>
    `;
  }

  private renderSettingsTab(): string {
    const isPaidUser = this.state.tier !== 'free';

    return `
      <div class="settings-tab" style="display: flex; flex-direction: column; gap: 16px;">
        <!-- Subscription Status Bar -->
        ${this.renderSubscriptionStatusBar()}

        <!-- Subscription Actions -->
        <section class="subscription-actions" style="display: flex; gap: 8px; align-items: center;">
          ${
            isPaidUser
              ? `
            <sp-button variant="secondary" id="btn-manage-subscription" style="flex: 1;">
              Manage Subscription
            </sp-button>
          `
              : `
            <sp-button variant="cta" id="btn-upgrade-pro" style="flex: 1;">
              Pro - $14.99/mo
            </sp-button>
            <sp-button variant="primary" id="btn-upgrade-studio" style="flex: 1;">
              Studio - $39.99/mo
            </sp-button>
          `
          }
          <sp-action-button id="btn-refresh-subscription" size="s" title="Refresh subscription status">
            ↻
          </sp-action-button>
        </section>

        <!-- LLM Provider Selection -->
        <section class="llm-provider" style="display: flex; flex-direction: column; gap: 8px;">
          <div style="font-size: 11px; color: var(--spectrum-global-color-gray-500);">LLM PROVIDER</div>
          <div style="display: flex; gap: 8px;">
            <sp-action-button id="llm-openai" size="s" selected>OpenAI</sp-action-button>
            <sp-action-button id="llm-gemini" size="s">Gemini</sp-action-button>
          </div>
        </section>

        <!-- Info -->
        <section style="font-size: 11px; color: var(--spectrum-global-color-gray-500); line-height: 1.4;">
          <strong>Tiers:</strong><br/>
          Free: 10 min/month (transcription, voice isolation)<br/>
          Pro: 120 min/month + take analysis<br/>
          Studio: 500 min/month + take analysis
        </section>

        <!-- Account Actions -->
        <section style="display: flex; flex-direction: column; gap: 8px;">
          <sp-button variant="secondary" id="btn-logout" style="width: 100%;">
            Logout
          </sp-button>
        </section>

        <!-- Debug Panel -->
        ${this.renderDebugPanel()}
      </div>
    `;
  }

  private renderDebugPanel(): string {
    const logs = logger.getLogsFiltered(this.state.debugFilterLevel, 50);
    const levelColors: Record<LogLevel, string> = {
      debug: 'var(--spectrum-global-color-gray-400)',
      info: 'var(--spectrum-global-color-blue-500)',
      warn: 'var(--spectrum-global-color-orange-500)',
      error: 'var(--spectrum-global-color-red-500)',
    };

    return `
      <section class="debug-panel" style="margin-top: 16px; border-top: 1px solid var(--spectrum-global-color-gray-300); padding-top: 12px;">
        <div
          id="debug-panel-header"
          style="display: flex; justify-content: space-between; align-items: center; cursor: pointer;"
        >
          <div style="font-size: 11px; color: var(--spectrum-global-color-gray-500); display: flex; align-items: center; gap: 4px;">
            <span style="font-size: 10px;">${this.state.debugPanelExpanded ? '▼' : '▶'}</span>
            DEBUG LOGS
            <span style="font-size: 9px; background: var(--spectrum-global-color-gray-300); padding: 1px 4px; border-radius: 8px;">
              ${logs.length}
            </span>
          </div>
          ${
            this.state.debugPanelExpanded
              ? `
            <div style="display: flex; gap: 4px;">
              <sp-action-button id="btn-export-logs" size="xs" title="Export logs">
                Export
              </sp-action-button>
              <sp-action-button id="btn-clear-logs" size="xs" title="Clear logs">
                Clear
              </sp-action-button>
            </div>
          `
              : ''
          }
        </div>

        ${
          this.state.debugPanelExpanded
            ? `
          <!-- Filter controls -->
          <div style="display: flex; gap: 4px; margin-top: 8px; margin-bottom: 8px;">
            <sp-action-button
              id="debug-filter-error"
              size="xs"
              ${this.state.debugFilterLevel === 'error' ? 'selected' : ''}
              style="font-size: 9px;"
            >
              Errors
            </sp-action-button>
            <sp-action-button
              id="debug-filter-warn"
              size="xs"
              ${this.state.debugFilterLevel === 'warn' ? 'selected' : ''}
              style="font-size: 9px;"
            >
              Warnings
            </sp-action-button>
            <sp-action-button
              id="debug-filter-info"
              size="xs"
              ${this.state.debugFilterLevel === 'info' ? 'selected' : ''}
              style="font-size: 9px;"
            >
              Info
            </sp-action-button>
            <sp-action-button
              id="debug-filter-debug"
              size="xs"
              ${this.state.debugFilterLevel === 'debug' ? 'selected' : ''}
              style="font-size: 9px;"
            >
              Debug
            </sp-action-button>
          </div>

          <!-- Log entries -->
          <div style="
            background: var(--spectrum-global-color-gray-100);
            border-radius: 4px;
            padding: 8px;
            max-height: 200px;
            overflow-y: auto;
            font-family: monospace;
            font-size: 10px;
            line-height: 1.4;
          ">
            ${
              logs.length > 0
                ? logs
                    .map((entry) => {
                      const time = entry.timestamp.split('T')[1].split('.')[0];
                      const color = levelColors[entry.level];
                      return `
                      <div style="display: flex; gap: 8px; margin-bottom: 4px; word-break: break-word;">
                        <span style="color: var(--spectrum-global-color-gray-500); white-space: nowrap;">${time}</span>
                        <span style="color: ${color}; font-weight: 500; white-space: nowrap;">${entry.level.toUpperCase().padEnd(5)}</span>
                        <span style="color: var(--spectrum-global-color-gray-300);">${this.escapeHtml(entry.message)}</span>
                      </div>
                    `;
                    })
                    .join('')
                : '<div style="color: var(--spectrum-global-color-gray-500);">No logs at this level</div>'
            }
          </div>
        `
            : ''
        }
      </section>
    `;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // ============================================
  // Event Handlers
  // ============================================

  private attachEventListeners(): void {
    // Tab navigation
    const tabs: TabId[] = ['home', 'silence', 'takes', 'settings'];
    tabs.forEach((tab) => {
      const btn = this.container.querySelector(`#tab-${tab}`);
      btn?.addEventListener('click', () => this.switchTab(tab));
    });

    // Home tab
    this.container
      .querySelector('#btn-analyze')
      ?.addEventListener('click', () => this.handleAnalyze());
    this.container
      .querySelector('#btn-quick-silence')
      ?.addEventListener('click', () => this.handleQuickSilence());

    // Silence tab
    this.container.querySelector('#preset-selector')?.addEventListener('change', (e) => {
      this.handlePresetChange((e.target as HTMLSelectElement).value);
    });
    this.container.querySelector('#silence-threshold')?.addEventListener('input', (e) => {
      this.state.silenceThreshold = parseInt((e.target as HTMLInputElement).value);
      this.state.selectedPresetId = null; // Clear preset when manually adjusting
      const label = this.container.querySelector('label[for="silence-threshold"]');
      if (label) label.textContent = `Silence Threshold: ${this.state.silenceThreshold} dB`;
    });
    this.container.querySelector('#voice-isolation')?.addEventListener('change', (e) => {
      this.state.useVoiceIsolation = (e.target as HTMLInputElement).checked;
      this.state.selectedPresetId = null; // Clear preset when manually adjusting
    });
    this.container
      .querySelector('#btn-save-preset')
      ?.addEventListener('click', () => this.handleSavePreset());
    this.container
      .querySelector('#btn-detect-silence')
      ?.addEventListener('click', () => this.handleDetectSilence());
    this.container
      .querySelector('#btn-apply-cuts')
      ?.addEventListener('click', () => this.handleApplyCuts());

    // Takes tab - Strategy selection
    this.container
      .querySelector('#strategy-best-only')
      ?.addEventListener('click', () => this.handleStrategyChange('best_only'));
    this.container
      .querySelector('#strategy-all-takes')
      ?.addEventListener('click', () => this.handleStrategyChange('all_takes'));
    this.container
      .querySelector('#strategy-manual')
      ?.addEventListener('click', () => this.handleStrategyChange('manual'));
    this.container
      .querySelector('#btn-preview-takes')
      ?.addEventListener('click', () => this.handlePreviewTakes());

    // Takes tab
    this.container
      .querySelector('#btn-transcribe')
      ?.addEventListener('click', () => this.handleTranscribe());
    this.container
      .querySelector('#btn-analyze-takes')
      ?.addEventListener('click', () => this.handleAnalyzeTakes());
    this.container
      .querySelector('#btn-apply-takes')
      ?.addEventListener('click', () => this.handleApplyTakes());

    // Go-to buttons for each take
    this.state.takeGroups.forEach((group, groupIdx) => {
      group.takes.forEach((take, takeIdx) => {
        this.container
          .querySelector(`#btn-goto-take-${groupIdx}-${takeIdx}`)
          ?.addEventListener('click', () => this.handleGoToTake(take));
      });
    });

    // Settings tab - Subscription buttons
    this.container
      .querySelector('#btn-upgrade-pro')
      ?.addEventListener('click', () => this.handleUpgrade('pro'));
    this.container
      .querySelector('#btn-upgrade-studio')
      ?.addEventListener('click', () => this.handleUpgrade('studio'));
    this.container
      .querySelector('#btn-manage-subscription')
      ?.addEventListener('click', () => this.handleManageSubscription());
    this.container
      .querySelector('#btn-refresh-subscription')
      ?.addEventListener('click', () => this.handleRefreshSubscription());
    // LLM provider selection
    this.container
      .querySelector('#llm-openai')
      ?.addEventListener('click', () => this.setLLMProvider('openai'));
    this.container
      .querySelector('#llm-gemini')
      ?.addEventListener('click', () => this.setLLMProvider('gemini'));
    // Logout button
    this.container
      .querySelector('#btn-logout')
      ?.addEventListener('click', () => this.handleLogout());

    // Debug panel
    this.container
      .querySelector('#debug-panel-header')
      ?.addEventListener('click', () => this.toggleDebugPanel());
    this.container.querySelector('#btn-export-logs')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.handleExportLogs();
    });
    this.container.querySelector('#btn-clear-logs')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.handleClearLogs();
    });
    this.container
      .querySelector('#debug-filter-error')
      ?.addEventListener('click', () => this.setDebugFilter('error'));
    this.container
      .querySelector('#debug-filter-warn')
      ?.addEventListener('click', () => this.setDebugFilter('warn'));
    this.container
      .querySelector('#debug-filter-info')
      ?.addEventListener('click', () => this.setDebugFilter('info'));
    this.container
      .querySelector('#debug-filter-debug')
      ?.addEventListener('click', () => this.setDebugFilter('debug'));
  }

  private switchTab(tab: TabId): void {
    this.state.activeTab = tab;
    this.render();
  }

  // ============================================
  // Action Handlers
  // ============================================

  private async handleAnalyze(): Promise<void> {
    this.setStatus('Analyzing timeline...', true);
    try {
      const result = await this.premiereAPI.analyzeTimeline();
      this.state.clipCount = result.clipCount;
      this.state.duration = result.duration;
      this.state.tracks = result.tracks;
      this.setStatus(`Found ${result.clipCount} clips`);
      this.render();
      logger.info('Timeline analysis complete', result);
    } catch (error) {
      this.handleError(error, 'Analysis failed');
    }
  }

  private async handleQuickSilence(): Promise<void> {
    this.switchTab('silence');
    await this.handleDetectSilence();
  }

  private async handleDetectSilence(): Promise<void> {
    this.setStatus('Extracting audio...', true);
    try {
      // Get settings from state
      const { silenceThreshold, useVoiceIsolation } = this.state;

      // Detect silence with options
      this.setStatus('Analyzing audio for silence...', true);
      const result = await this.premiereAPI.autoCutSilence(silenceThreshold, {
        useVoiceIsolation,
        useAIAnalysis: true,
      });

      this.state.silentSections = result.silentSections;
      this.state.timeToRemove = result.timeRemoved;

      if (result.silentSections === 0) {
        this.setStatus('No cuttable silence found');
      } else {
        this.setStatus(
          `Found ${result.silentSections} silent sections (${result.timeRemoved.toFixed(1)}s)`
        );
      }

      this.render();
      logger.info('Silence detection complete', result);
    } catch (error) {
      this.handleError(error, 'Silence detection failed');
    }
  }

  private async handleApplyCuts(): Promise<void> {
    this.setStatus('Applying cuts...', true);
    try {
      // Apply the pending silence cuts
      const result = await this.premiereAPI.applySilenceCuts();

      // Reset state
      this.state.silentSections = 0;
      this.state.timeToRemove = 0;

      // Build status message with partial success handling
      let statusMessage: string;
      if (result.cutsApplied === 0) {
        statusMessage = 'No cuts were applied';
      } else if (result.errors.length === 0) {
        statusMessage = `Removed ${result.cutsApplied} sections (${result.timeRemoved.toFixed(1)}s)`;
      } else {
        // Partial success
        const failed = result.cutsAttempted - result.cutsApplied;
        statusMessage = `Completed ${result.cutsApplied}/${result.cutsAttempted} cuts. ${failed} failed.`;
        logger.warn('Some cuts failed:', result.errors);
      }
      this.setStatus(statusMessage);

      this.render();
      logger.info('Cuts applied', result);
    } catch (error) {
      this.handleError(error, 'Failed to apply cuts');
    }
  }

  private async handleTranscribe(): Promise<void> {
    this.setStatus('Transcribing...', true);
    try {
      // Extract audio and transcribe
      const audio = await this.premiereAPI.extractAudio();
      const result = await this.aiServices.transcribe(audio.buffer);
      this.state.transcript = result.text;
      this.setStatus('Transcription complete');
      this.render();
      logger.info('Transcription complete');
    } catch (error) {
      this.handleError(error, 'Transcription failed');
    }
  }

  private async handleAnalyzeTakes(): Promise<void> {
    if (!this.state.transcript) {
      this.setStatus('Please transcribe first');
      return;
    }

    this.setStatus('Analyzing takes...', true);
    try {
      // Use the take detector service
      const groups = await takeDetector.detectTakes(this.state.transcript);

      // Store groups and flat list
      this.state.takeGroups = groups;
      this.state.takes = takeDetector.flattenTakeGroups(groups);

      // Store in PremiereAPI for later application
      this.premiereAPI.pendingTakes = this.state.takes;

      const totalTakes = this.getTotalTakesCount();
      if (totalTakes === 0) {
        this.setStatus('No takes detected');
      } else {
        this.setStatus(`Found ${totalTakes} takes in ${groups.length} groups`);
      }

      this.render();
      logger.info('Take analysis complete', { groups: groups.length, takes: totalTakes });
    } catch (error) {
      this.handleError(error, 'Take analysis failed');
    }
  }

  private async handleApplyTakes(): Promise<void> {
    if (this.state.takeGroups.length === 0) {
      this.setStatus('No takes to apply');
      return;
    }

    const totalTakes = this.getTotalTakesCount();
    this.setStatus('Applying takes to timeline...', true);
    try {
      const result = await this.premiereAPI.applyTakesToTimeline();

      // Clear state after application
      this.state.takeGroups = [];
      this.state.takes = [];

      // Build status message with partial success handling
      let statusMessage: string;
      if (result.takesApplied === 0) {
        statusMessage = 'No takes were applied';
      } else if (result.errors.length === 0) {
        statusMessage = `Applied ${result.takesApplied} takes, ${result.cutsCreated} cuts`;
      } else {
        // Partial success
        statusMessage = `Completed ${result.takesApplied}/${totalTakes} takes. ${result.errors.length} failed.`;
        logger.warn('Some takes had errors:', result.errors);
      }
      this.setStatus(statusMessage);

      this.render();
      logger.info('Takes applied to timeline', result);
    } catch (error) {
      this.handleError(error, 'Failed to apply takes');
    }
  }

  private async handleGoToTake(take: NormalizedTake): Promise<void> {
    try {
      await this.premiereAPI.goToTime(take.start);
      this.setStatus(`Moved to ${take.clipName}`);
    } catch (error) {
      this.handleError(error, 'Failed to navigate');
    }
  }

  private async handleUpgrade(tier: TierId): Promise<void> {
    this.setStatus(`Opening ${tier} checkout...`, true);
    try {
      const url = await subscriptionService.upgradeTo(tier);
      if (url) {
        const opened = await openExternalUrl(url);
        if (opened) {
          this.setStatus('Checkout opened in browser. Return here when done.');
          // Start polling for subscription change
          this.startSubscriptionPolling();
        } else {
          this.setStatus('Failed to open checkout');
        }
      } else {
        this.setStatus('Failed to create checkout session');
      }
    } catch (error) {
      this.handleError(error, 'Upgrade failed');
    }
  }

  private async handleManageSubscription(): Promise<void> {
    this.setStatus('Opening billing portal...', true);
    try {
      const url = await subscriptionService.openBillingPortal();
      if (url) {
        const opened = await openExternalUrl(url);
        if (opened) {
          this.setStatus('Billing portal opened in browser.');
          // Start polling for subscription change
          this.startSubscriptionPolling();
        } else {
          this.setStatus('Failed to open billing portal');
        }
      } else {
        this.setStatus('Failed to create portal session');
      }
    } catch (error) {
      this.handleError(error, 'Failed to open billing portal');
    }
  }

  private async handleRefreshSubscription(): Promise<void> {
    this.setStatus('Refreshing subscription...', true);
    try {
      subscriptionService.clearCache();
      await this.loadSubscriptionInfo();
      this.setStatus('Subscription updated');
      this.render();
    } catch (error) {
      this.handleError(error, 'Failed to refresh subscription');
    }
  }

  private async handleLogout(): Promise<void> {
    this.setStatus('Logging out...', true);
    try {
      await backendClient.logout();
      await secureStorage.clearAll();
      this.isAuthenticated = false;
      logger.info('User logged out successfully');

      // Show auth panel again
      this.showAuthPanel();
    } catch (error) {
      this.handleError(error, 'Failed to logout');
    }
  }

  private setLLMProvider(provider: 'openai' | 'gemini'): void {
    // Update visual state
    const openaiBtn = this.container.querySelector('#llm-openai') as HTMLElement;
    const geminiBtn = this.container.querySelector('#llm-gemini') as HTMLElement;

    if (openaiBtn) openaiBtn.toggleAttribute('selected', provider === 'openai');
    if (geminiBtn) geminiBtn.toggleAttribute('selected', provider === 'gemini');

    // Store preference
    secureStorage.setPreferredLLM(provider);
    this.setStatus(`LLM provider set to ${provider}`);
  }

  private toggleDebugPanel(): void {
    this.state.debugPanelExpanded = !this.state.debugPanelExpanded;
    this.render();
  }

  private setDebugFilter(level: LogLevel): void {
    this.state.debugFilterLevel = level;
    this.render();
  }

  private handleExportLogs(): void {
    const logs = logger.exportLogs(this.state.debugFilterLevel);
    const blob = new Blob([logs], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `splice-logs-${new Date().toISOString().split('T')[0]}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    this.setStatus('Logs exported');
  }

  private handleClearLogs(): void {
    logger.clearLogs();
    this.render();
    this.setStatus('Logs cleared');
  }

  /**
   * Update the service status indicator without a full re-render.
   */
  private updateServiceStatusIndicator(): void {
    const indicator = this.container.querySelector('#service-status-indicator') as HTMLElement;
    if (indicator) {
      indicator.style.background = serviceStatus.getStatusColor();
      indicator.title = serviceStatus.getStatusMessage();
    }
  }

  // ============================================
  // Utility Methods
  // ============================================

  private async loadProjectInfo(): Promise<void> {
    try {
      const info = await this.premiereAPI.getProjectInfo();
      this.state.projectName = info.name;
      this.state.projectPath = info.path;

      const timeline = await this.premiereAPI.analyzeTimeline();
      this.state.clipCount = timeline.clipCount;
      this.state.duration = timeline.duration;
      this.state.tracks = timeline.tracks;
    } catch (error) {
      logger.error('Failed to load project info', error);
    }
  }

  private async loadSubscriptionInfo(): Promise<void> {
    try {
      const status = await subscriptionService.getStatus();
      this.state.tier = status.tier;
      this.state.minutesUsed = status.minutesUsed;
      this.state.minutesLimit = status.minutesLimit;
      this.state.subscriptionStatus = status.status;
      this.state.periodEnd = status.periodEnd;
    } catch (error) {
      logger.error('Failed to load subscription info', error);
      // Keep existing state or set defaults
      if (!this.state.tier) {
        this.state.tier = 'free';
        this.state.minutesUsed = 0;
        this.state.minutesLimit = 10;
        this.state.subscriptionStatus = 'active';
      }
    }
  }

  private async loadPresets(): Promise<void> {
    try {
      const result = await exportPresetsService.loadPresets();
      if (result.success) {
        this.state.availablePresets = result.presets;
        logger.info(`Loaded ${result.presets.length} presets`);
      } else {
        logger.error('Failed to load presets', result.error);
        this.state.availablePresets = [];
      }
    } catch (error) {
      logger.error('Failed to load presets', error);
      this.state.availablePresets = [];
    }
  }

  private async handlePresetChange(presetId: string): Promise<void> {
    if (!presetId) {
      // Custom settings selected
      this.state.selectedPresetId = null;
      return;
    }

    const preset = this.state.availablePresets.find((p) => p.id === presetId);
    if (!preset) {
      logger.warn(`Preset not found: ${presetId}`);
      return;
    }

    // Apply preset settings
    this.state.selectedPresetId = presetId;
    this.state.silenceThreshold = preset.threshold;
    this.state.useVoiceIsolation = preset.useVoiceIsolation;
    this.setStatus(`Applied preset: ${preset.name}`);
    this.render();
  }

  private async handleSavePreset(): Promise<void> {
    // Prompt for preset name
    const name = prompt('Enter preset name:');
    if (!name) return;

    const description = prompt('Enter description (optional):');

    const result = await exportPresetsService.savePreset({
      name,
      description: description || undefined,
      threshold: this.state.silenceThreshold,
      minSilenceDuration: 0.5, // Default value
      padding: 0.15, // Default value
      useVoiceIsolation: this.state.useVoiceIsolation,
    });

    if (result.success && result.preset) {
      this.state.availablePresets.push(result.preset);
      this.state.selectedPresetId = result.preset.id;
      this.setStatus(`Saved preset: ${result.preset.name}`);
      this.render();
    } else {
      this.setStatus(`Failed to save preset: ${result.error}`);
    }
  }

  private handleStrategyChange(strategy: TakeSelectionStrategy): void {
    this.state.takeSelectionStrategy = strategy;
    takeDetector.setSelectionStrategy(strategy);

    // Re-detect takes with new strategy
    if (this.state.transcript) {
      this.handleAnalyzeTakes();
    } else {
      this.render();
    }
  }

  private handlePreviewTakes(): void {
    if (this.state.takeGroups.length === 0) {
      this.setStatus('No takes to preview');
      return;
    }

    this.state.takePreview = takeDetector.generatePreview(this.state.takeGroups);
    this.setStatus('Preview generated');
    this.render();
  }

  private startSubscriptionPolling(): void {
    // Clear any existing polling
    this.stopSubscriptionPolling();

    this.pollCount = 0;

    // Poll every 5 seconds
    this.pollingInterval = setInterval(async () => {
      this.pollCount++;

      if (this.pollCount >= this.maxPollCount) {
        this.stopSubscriptionPolling();
        this.setStatus('Subscription check timed out');
        return;
      }

      try {
        // Clear cache and fetch fresh status
        subscriptionService.clearCache();
        const oldTier = this.state.tier;
        await this.loadSubscriptionInfo();

        // If tier changed, stop polling and update UI
        if (this.state.tier !== oldTier) {
          this.stopSubscriptionPolling();
          this.setStatus(`Subscription updated to ${this.state.tier.toUpperCase()}!`);
          this.render();
          logger.info(`Subscription changed from ${oldTier} to ${this.state.tier}`);
        }
      } catch (error) {
        logger.error('Polling subscription status failed', error);
      }
    }, 5000);

    logger.debug('Started subscription polling');
  }

  private stopSubscriptionPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
      this.pollCount = 0;
      logger.debug('Stopped subscription polling');
    }
  }

  private async handleVisibilityReturn(): Promise<void> {
    // Only check if polling is active (user went to Stripe)
    logger.debug('User returned to plugin, checking subscription...');
    subscriptionService.clearCache();
    const oldTier = this.state.tier;
    await this.loadSubscriptionInfo();

    // Check if tier changed
    if (this.state.tier !== oldTier) {
      this.stopSubscriptionPolling();
      this.setStatus(`Welcome back! Your plan is now ${this.state.tier.toUpperCase()}`);
      this.render();
    }
  }

  private setStatus(message: string, isProcessing: boolean = false): void {
    this.state.status = message;
    this.state.isProcessing = isProcessing;
    const statusEl = this.container.querySelector('#status-message');
    if (statusEl) {
      statusEl.innerHTML = `
        ${isProcessing ? '<sp-progress-circle size="s" indeterminate></sp-progress-circle>' : ''}
        ${message}
      `;
    }
  }

  /**
   * Handle errors consistently across all action handlers.
   * Displays user-friendly messages for SpliceErrors, generic message for others.
   */
  private handleError(error: unknown, fallbackMessage: string): void {
    let displayMessage: string;

    if (isSpliceError(error)) {
      // Show user-friendly message with error code
      displayMessage = error.toDisplayString();
      logger.error(error.toLogString(), error);
    } else {
      // Wrap and log unknown errors
      const wrapped = wrapError(error);
      displayMessage = fallbackMessage;
      logger.error(`${fallbackMessage}: ${wrapped.message}`, error);
    }

    this.setStatus(displayMessage, false);
  }

  private formatDuration(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }
}
