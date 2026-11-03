/*---------------------------------------------------------------------------------------------
 *  Agents section for SideX Settings panel.
 *  Text size, submit behavior, subagents, agent review, attribution, and git.
 *--------------------------------------------------------------------------------------------*/

import type { SettingsSection } from '../sidexSettingsPanel.js';
import { createCustomDropdown } from '../sidexSettingsStyles.js';
import {
	decodeSettingValue,
	readSettingValue,
	readSettingsSection,
	toSettingBoolean,
	toSettingNumber,
	toSettingString,
	writeSettingValue,
	type SettingsSectionValues,
	type TauriInvoke
} from '../settingsReadback.js';

const AGENTS_SECTION = 'sidex.agents';
const AGENTS_SETTING_KEYS = [
	'textSize',
	'submitWithCmdEnter',
	'maxTabCount',
	'maxTabCountMode',
	'queueMessages',
	'usageSummary',
	'agentAutocomplete',
	'autoApproveModeTransitions',
	'exploreSubagentModel',
	'startReviewOnCommit',
	'includeSubmodules',
	'includeUntracked',
	'defaultApproach',
	'commitAttribution',
	'prAttribution',
	'branchPrefix'
];

export class AgentsSection implements SettingsSection {
	private _container: HTMLElement | null = null;
	private _invoke: TauriInvoke;
	private _settings: SettingsSectionValues = {};
	/** User-supplied models (from ModelsSection) — there is no curated catalog to preset this from. */
	private _modelOptions: string[] = [];

	constructor(invoke: TauriInvoke) {
		this._invoke = invoke;
	}

	async render(container: HTMLElement): Promise<void> {
		this._container = container;

		if (this._invoke) {
			// Section read first, exact per-key reads for anything the backend
			// does not return (works with both backend shapes).
			this._settings = await readSettingsSection(this._invoke, AGENTS_SECTION, AGENTS_SETTING_KEYS);
			await this._loadModelOptions();
		}

		const title = document.createElement('div');
		title.className = 'sidex-settings-section-title';
		title.textContent = 'Agents';
		container.appendChild(title);

		this._renderMainSettings(container);
		this._renderSubagents(container);
		this._renderAgentReview(container);
		this._renderAttribution(container);
		this._renderGit(container);
	}

	private _renderMainSettings(container: HTMLElement): void {
		const card = this._createCard(container);

		this._createDropdownRow(card, 'Text Size', 'Controls conversation text size', 'sidex.agents.textSize',
			['Default', 'Small', 'Large'], this._getText('textSize', 'Default'));

		this._createToggleRow(card, 'Submit with Cmd+Enter', 'When enabled, Cmd+Enter submits and Enter inserts newline',
			'sidex.agents.submitWithCmdEnter', this._getBoolean('submitWithCmdEnter', false));

		this._createNumberWithDropdownRow(card, 'Max Tab Count', 'Maximum number of concurrent tabs',
			'sidex.agents.maxTabCount', this._getNumber('maxTabCount', 5),
			['Custom', 'Unlimited'], this._getText('maxTabCountMode', 'Custom'));

		this._createDropdownRow(card, 'Queue Messages', 'Behavior when sending messages while one is active', 'sidex.agents.queueMessages',
			['Send after current message', 'Queue all', 'Ask each time'], this._getText('queueMessages', 'Send after current message'));

		this._createDropdownRow(card, 'Usage Summary', 'When to show usage summary after responses', 'sidex.agents.usageSummary',
			['Auto', 'Always', 'Never'], this._getText('usageSummary', 'Auto'));

		this._createToggleRow(card, 'Agent Autocomplete', 'Contextual suggestions while prompting',
			'sidex.agents.agentAutocomplete', this._getBoolean('agentAutocomplete', true));

		this._createToggleRow(card, 'Auto-Approve Mode Transitions', 'Allow agent to switch modes without asking',
			'sidex.agents.autoApproveModeTransitions', this._getBoolean('autoApproveModeTransitions', false));
	}

	private _renderSubagents(container: HTMLElement): void {
		const title = document.createElement('div');
		title.className = 'sidex-settings-section-title';
		title.textContent = 'Subagents';
		title.style.marginTop = '24px';
		container.appendChild(title);

		const card = this._createCard(container);

		const row = document.createElement('div');
		row.className = 'sidex-settings-row';

		const left = document.createElement('div');
		const label = document.createElement('div');
		label.className = 'sidex-settings-row-label';
		label.textContent = 'Explore subagent model';
		left.appendChild(label);
		row.appendChild(left);

		const action = document.createElement('div');
		action.className = 'sidex-settings-row-action';
		action.style.display = 'flex';
		action.style.alignItems = 'center';
		action.style.gap = '8px';

		if (this._modelOptions.length === 0) {
			// No preset list to fall back to — point at where models actually
			// get added instead of showing a dropdown with nothing real in it.
			const link = document.createElement('span');
			link.className = 'sidex-settings-link';
			link.style.cssText = 'font-size:12px;cursor:pointer;';
			link.textContent = 'Add a model to choose one';
			link.addEventListener('click', () => {
				window.dispatchEvent(new CustomEvent('sidex-settings-navigate', { detail: 'models' }));
			});
			action.appendChild(link);
		} else {
			const currentModel = this._getText('exploreSubagentModel', this._modelOptions[0]);
			const dropdown = createCustomDropdown(this._modelOptions, currentModel, (newValue) => {
				this._saveSetting('sidex.agents.exploreSubagentModel', newValue);
			});
			action.appendChild(dropdown);

			const gearIcon = document.createElement('span');
			gearIcon.className = 'codicon codicon-settings-gear';
			gearIcon.style.cursor = 'pointer';
			gearIcon.style.opacity = '0.7';
			gearIcon.title = 'Configure model';
			gearIcon.addEventListener('click', () => {
				window.dispatchEvent(new CustomEvent('sidex-settings-navigate', { detail: 'models' }));
			});
			action.appendChild(gearIcon);
		}

		row.appendChild(action);
		card.appendChild(row);
	}

	private _renderAgentReview(container: HTMLElement): void {
		const title = document.createElement('div');
		title.className = 'sidex-settings-section-title';
		title.textContent = 'Agent Review';
		title.style.marginTop = '24px';
		container.appendChild(title);

		const card = this._createCard(container);

		this._createToggleRow(card, 'Start Agent Review on Commit', 'Automatically start review when committing',
			'sidex.agents.startReviewOnCommit', this._getBoolean('startReviewOnCommit', false));

		this._createToggleRow(card, 'Include Submodules in Agent Review', 'Include git submodule changes in review',
			'sidex.agents.includeSubmodules', this._getBoolean('includeSubmodules', true));

		this._createToggleRow(card, 'Include Untracked Files in Agent Review', 'Include new untracked files in review',
			'sidex.agents.includeUntracked', this._getBoolean('includeUntracked', true));

		this._createDropdownRow(card, 'Default Approach', 'How thorough agent review should be', 'sidex.agents.defaultApproach',
			['Quick', 'Thorough'], this._getText('defaultApproach', 'Quick'));
	}

	private _renderAttribution(container: HTMLElement): void {
		const title = document.createElement('div');
		title.className = 'sidex-settings-section-title';
		title.textContent = 'Attribution';
		title.style.marginTop = '24px';
		container.appendChild(title);

		const card = this._createCard(container);

		this._createToggleRow(card, 'Commit Attribution', 'Mark commits as \'Made with SideX\'',
			'sidex.agents.commitAttribution', this._getBoolean('commitAttribution', true));

		this._createToggleRow(card, 'PR Attribution', 'Mark pull requests as made with SideX',
			'sidex.agents.prAttribution', this._getBoolean('prAttribution', true));
	}

	private _renderGit(container: HTMLElement): void {
		const title = document.createElement('div');
		title.className = 'sidex-settings-section-title';
		title.textContent = 'Git';
		title.style.marginTop = '24px';
		container.appendChild(title);

		const card = this._createCard(container);

		this._createInputRow(card, 'Branch Prefix', 'Prefix applied to branches created by the agent',
			'sidex.agents.branchPrefix', this._getText('branchPrefix', ''), 'cursor/');
	}

	/** Mirrors ModelsSection's 'sidex.models.custom' — the only source of model ids now that there's no preset catalog. */
	private async _loadModelOptions(): Promise<void> {
		if (!this._invoke) { return; }
		try {
			const raw = await readSettingValue(this._invoke, 'sidex.models.custom');
			const arr = decodeSettingValue(raw);
			if (!Array.isArray(arr)) { return; }
			this._modelOptions = arr
				.map((entry: string | { id?: string }) => typeof entry === 'string' ? entry : entry?.id)
				.filter((id): id is string => !!id);
		} catch { /* no models configured yet */ }
	}

	// --- Helpers ---

	private _getBoolean(key: string, defaultValue: boolean): boolean {
		return toSettingBoolean(this._settings[key], defaultValue);
	}

	private _getText(key: string, defaultValue: string): string {
		return toSettingString(this._settings[key], defaultValue);
	}

	private _getNumber(key: string, defaultValue: number): number {
		return toSettingNumber(this._settings[key], defaultValue);
	}

	private _saveSetting(key: string, value: unknown): void {
		if (!this._invoke) { return; }
		// Plain JSON value; legacy builds stored JSON.stringify()-ed strings.
		writeSettingValue(this._invoke, key, value).catch(() => {});
	}

	private _createCard(parent: HTMLElement): HTMLElement {
		const card = document.createElement('div');
		card.className = 'sidex-settings-card';
		parent.appendChild(card);
		return card;
	}

	private _createToggleRow(parent: HTMLElement, label: string, description: string, settingKey: string, initialState: boolean): void {
		const row = document.createElement('div');
		row.className = 'sidex-settings-row';

		const left = document.createElement('div');
		const lbl = document.createElement('div');
		lbl.className = 'sidex-settings-row-label';
		lbl.textContent = label;
		left.appendChild(lbl);

		if (description) {
			const desc = document.createElement('div');
			desc.className = 'sidex-settings-row-description';
			desc.textContent = description;
			left.appendChild(desc);
		}
		row.appendChild(left);

		const action = document.createElement('div');
		action.className = 'sidex-settings-row-action';
		const toggle = document.createElement('div');
		toggle.className = 'sidex-settings-toggle' + (initialState ? ' on' : '');
		toggle.addEventListener('click', () => {
			toggle.classList.toggle('on');
			this._saveSetting(settingKey, toggle.classList.contains('on'));
		});
		action.appendChild(toggle);
		row.appendChild(action);

		parent.appendChild(row);
	}

	private _createDropdownRow(parent: HTMLElement, label: string, description: string, settingKey: string, options: string[], currentValue: string): void {
		const row = document.createElement('div');
		row.className = 'sidex-settings-row';

		const left = document.createElement('div');
		const lbl = document.createElement('div');
		lbl.className = 'sidex-settings-row-label';
		lbl.textContent = label;
		left.appendChild(lbl);

		if (description) {
			const desc = document.createElement('div');
			desc.className = 'sidex-settings-row-description';
			desc.textContent = description;
			left.appendChild(desc);
		}
		row.appendChild(left);

		const action = document.createElement('div');
		action.className = 'sidex-settings-row-action';
		const dropdown = createCustomDropdown(options, currentValue, (newValue) => {
			this._saveSetting(settingKey, newValue);
		});
		action.appendChild(dropdown);
		row.appendChild(action);

		parent.appendChild(row);
	}

	private _createInputRow(parent: HTMLElement, label: string, description: string, settingKey: string, currentValue: string, placeholder: string): void {
		const row = document.createElement('div');
		row.className = 'sidex-settings-row';

		const left = document.createElement('div');
		const lbl = document.createElement('div');
		lbl.className = 'sidex-settings-row-label';
		lbl.textContent = label;
		left.appendChild(lbl);

		if (description) {
			const desc = document.createElement('div');
			desc.className = 'sidex-settings-row-description';
			desc.textContent = description;
			left.appendChild(desc);
		}
		row.appendChild(left);

		const action = document.createElement('div');
		action.className = 'sidex-settings-row-action';
		const wrapper = document.createElement('div');
		wrapper.className = 'sidex-input-wrapper';
		wrapper.style.width = '160px';
		const input = document.createElement('input');
		input.type = 'text';
		input.value = currentValue;
		input.placeholder = placeholder;
		input.addEventListener('change', () => this._saveSetting(settingKey, input.value));
		wrapper.appendChild(input);
		action.appendChild(wrapper);
		row.appendChild(action);

		parent.appendChild(row);
	}

	private _createNumberWithDropdownRow(parent: HTMLElement, label: string, description: string, settingKey: string, currentNumber: number, modeOptions: string[], currentMode: string): void {
		const row = document.createElement('div');
		row.className = 'sidex-settings-row';

		const left = document.createElement('div');
		const lbl = document.createElement('div');
		lbl.className = 'sidex-settings-row-label';
		lbl.textContent = label;
		left.appendChild(lbl);

		if (description) {
			const desc = document.createElement('div');
			desc.className = 'sidex-settings-row-description';
			desc.textContent = description;
			left.appendChild(desc);
		}
		row.appendChild(left);

		const action = document.createElement('div');
		action.className = 'sidex-settings-row-action';
		action.style.display = 'flex';
		action.style.alignItems = 'center';
		action.style.gap = '8px';

		const numWrapper = document.createElement('div');
		numWrapper.className = 'sidex-number-input-wrapper';
		numWrapper.style.width = '60px';
		const numInput = document.createElement('input');
		numInput.type = 'number';
		numInput.min = '1';
		numInput.max = '50';
		numInput.value = String(currentNumber);
		numInput.style.textAlign = 'center';
		numInput.addEventListener('change', () => this._saveSetting(settingKey, parseInt(numInput.value, 10) || currentNumber));
		numWrapper.appendChild(numInput);

		const select = createCustomDropdown(modeOptions, currentMode, (newValue) => {
			const isUnlimited = newValue === 'Unlimited';
			numInput.disabled = isUnlimited;
			numWrapper.style.opacity = isUnlimited ? '0.5' : '1';
			this._saveSetting(settingKey + 'Mode', newValue);
			if (isUnlimited) {
				this._saveSetting(settingKey, -1);
			}
		});

		action.appendChild(numWrapper);
		action.appendChild(select);
		row.appendChild(action);

		if (currentMode === 'Unlimited') {
			numInput.disabled = true;
			numWrapper.style.opacity = '0.5';
		}

		parent.appendChild(row);
	}

	dispose(): void {
		this._container = null;
	}
}
