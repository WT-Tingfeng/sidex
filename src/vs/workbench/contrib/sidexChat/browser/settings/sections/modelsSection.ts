import type { SettingsSection } from '../sidexSettingsPanel.js';
import { restartServer } from '../../localServer.js';
import { showConfirmDialog } from '../../components/confirmDialog.js';
import { createProductMark, productMarkKind } from '../productMarks.js';
import { createCustomDropdown, type DropdownOption } from '../sidexSettingsStyles.js';

type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

interface ProviderModel { id: string; name: string }
interface LocalServerInfo { provider: string; label: string; baseUrl: string; models: string[] }
interface AccountInfo {
	provider: string;
	displayName: string;
	available: boolean;
	expired: boolean;
	connected: boolean;
	location: string;
	credentialKind: string;
	subscriptionTier: string | null;
	accountEmail: string | null;
}
interface ProviderStatusInfo {
	id: string;
	label: string;
	baseUrl: string;
	configured: boolean;
	enabled: boolean;
	source: string | null;
	keyless: boolean;
	envVar: string | null;
	/** New contract: an API key is stored for this provider (masked field). */
	hasKey?: boolean;
	/** True for providers defined in `sidex.providers.custom`. */
	custom?: boolean;
	protocol?: string | null;
	authStyle?: string | null;
}

// The provider catalogue itself lives in Rust (providers_catalog) — this is
// just the shape we render cards from, not a source of truth.
interface ProviderCatalogEntry {
	id: string;
	label: string;
	defaultBaseUrl: string;
	envVars: string[];
	consoleUrl: string;
	keyless: boolean;
	custom?: boolean;
	protocol?: string;
	authStyle?: string;
}

/** A provider stored under the `sidex.providers.custom` setting. */
interface CustomProviderDef {
	id: string;
	label: string;
	/** `openai` (chat-completions compatible) or `anthropic` (messages compatible). */
	protocol: string;
	baseUrl: string;
	/** `bearer`, `x-api-key`, `api-key` or `none`. */
	auth: string;
	models?: string[];
}

/** Result of the Rust `providers_test` command. */
interface ProviderTestResult { ok: boolean; status?: number; latencyMs?: number; modelCount?: number; message?: string }

type ApiKeyAction = 'keep' | 'set' | 'clear';

const PROTOCOL_LABELS: Record<string, string> = { openai: 'OpenAI-compatible', anthropic: 'Anthropic-compatible' };
const AUTH_LABELS: Record<string, string> = {
	bearer: 'Bearer token',
	'x-api-key': 'x-api-key header',
	'api-key': 'api-key header',
	none: 'No key',
};

// A configured key is never sent back to the UI. This placeholder marks a
// field as already-set without exposing the value, and doubles as a sentinel
// so the blur/keydown save handlers don't mistake the display value for edited input.
const MASKED_KEY = '••••••••••••';

export class ModelsSection implements SettingsSection {
	private _invoke: Invoke | null;
	private _container: HTMLElement | null = null;
	private _enabledIds: Set<string> = new Set();
	private _customModels: string[] = [];
	/** Display names, where the provider gave one. Keyed by model id. */
	private _modelNames: Map<string, string> = new Map();
	private _providerCatalog: ProviderCatalogEntry[] = [];
	private _providerStatus: Map<string, ProviderStatusInfo> = new Map();
	private _addingCustom = false;
	private _addModelProvider = '';
	private _enabledListContainer: HTMLElement | null = null;
	private _apiKeysContainer: HTMLElement | null = null;
	private _discoveryContainer: HTMLElement | null = null;
	private _customRowContainer: HTMLElement | null = null;
	// Custom providers are defined in settings and merged into the render-only
	// catalog below, so they get the same key/toggle cards as built-ins.
	private _customProvidersContainer: HTMLElement | null = null;
	private _customProviderDefs: CustomProviderDef[] = [];
	private _customProviderFormOpen = false;
	private _editingCustomProviderId: string | null = null;
	private _customModelCounts: Map<string, number> = new Map();
	// The catalog is pushing 30 providers. Once at least one is configured,
	// the rest collapse behind a disclosure by default — this remembers that
	// the user opened it, so re-rendering after a save doesn't snap it shut.
	private _apiKeysExpanded = false;

	constructor(invoke: Invoke | null) {
		this._invoke = invoke;
	}

	async render(container: HTMLElement): Promise<void> {
		this._container = container;
		container.innerHTML = '';
		await this._loadState();
		this._renderModelListSection(container);

		// Custom provider endpoints sit between the model list and the built-in
		// provider catalogue: define an endpoint here, then enable its models.
		this._customProvidersContainer = document.createElement('div');
		container.appendChild(this._customProvidersContainer);
		this._renderCustomProvidersSection(this._customProvidersContainer);

		// Create API Keys Container placeholder and render it
		this._apiKeysContainer = document.createElement('div');
		container.appendChild(this._apiKeysContainer);
		this._renderApiKeysSection(this._apiKeysContainer);

		this._discoveryContainer = document.createElement('div');
		container.appendChild(this._discoveryContainer);
		void this._renderDiscoverySection(this._discoveryContainer);
	}

	private async _loadState(): Promise<void> {
		if (!this._invoke) { return; }

		try {
			const raw = await this._invoke('settings_get', { section: 'sidex.models.enabled' });
			const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
			// There is no curated catalog to seed from anymore — an unset value
			// just means no models are enabled yet, same as an explicit empty array.
			if (Array.isArray(arr)) { this._enabledIds = new Set(arr); }
		} catch { /* nothing enabled yet */ }

		try {
			const raw = await this._invoke('settings_get', { section: 'sidex.models.custom' });
			const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
			if (Array.isArray(arr)) {
				this._customModels = [];
				for (const entry of arr as Array<string | { id?: string; name?: string }>) {
					const id = typeof entry === 'string' ? entry : entry?.id;
					if (!id) { continue; }
					this._customModels.push(id);
					const name = typeof entry === 'object' ? entry?.name : undefined;
					if (name) { this._modelNames.set(id, name); }
				}
			}
		} catch { /* empty */ }

		// Union in anything enabled that isn't in the registry (e.g. carried
		// over from an older build) so an enabled model never disappears from the list.
		for (const id of this._enabledIds) {
			if (!this._customModels.includes(id)) { this._customModels.push(id); }
		}

		try {
			this._providerCatalog = (await this._invoke('providers_catalog') as ProviderCatalogEntry[]) || [];
		} catch { this._providerCatalog = []; }

		await this._loadCustomProviders();
		this._mergeCustomProvidersIntoCatalog();

		await this._refreshProviderStatus();
	}

	private async _refreshProviderStatus(): Promise<void> {
		if (!this._invoke) { return; }
		try {
			const statuses = (await this._invoke('providers_status') as ProviderStatusInfo[]) || [];
			this._providerStatus = new Map(statuses.map(s => [s.id, s]));
		} catch { /* keep the last known status rather than blanking every card */ }
	}

	private _renderModelListSection(container: HTMLElement): void {
		const section = document.createElement('div');

		const title = document.createElement('div');
		title.className = 'sidex-settings-section-title';
		title.textContent = 'Models';
		section.appendChild(title);

		const desc = document.createElement('div');
		desc.className = 'sidex-settings-row-description sidex-settings-section-desc';
		desc.textContent = 'Add the model IDs your providers serve. Nothing is enabled until you add it here.';
		section.appendChild(desc);

		const card = document.createElement('div');
		card.className = 'sidex-settings-card';
		card.style.cssText = 'display: flex; flex-direction: column;';

		const search = this._buildSearchInput();
		card.appendChild(search);

		const enabledList = document.createElement('div');
		enabledList.className = 'sidex-models-enabled-list';
		this._enabledListContainer = enabledList;
		this._renderEnabledModels(enabledList);
		card.appendChild(enabledList);

		this._customRowContainer = this._buildAddCustomRow();
		card.appendChild(this._customRowContainer);
		section.appendChild(card);
		container.appendChild(section);
	}

	/**
	 * `createCustomDropdown`'s menu has no height cap of its own. That was fine
	 * for a handful of options, but the provider picker here now lists the
	 * whole catalog (pushing 30) and a provider's model list can run into the
	 * dozens — uncapped, the menu would render off the bottom of the screen
	 * with no way to reach the rest. Same contract, just a bounded menu.
	 */
	private _boundedDropdown(options: (string | DropdownOption)[], currentValue: string, onChange: (value: string) => void): HTMLElement {
		const dropdown = createCustomDropdown(options, currentValue, onChange);
		const menu = dropdown.querySelector('.sidex-custom-dropdown-menu') as HTMLElement | null;
		if (menu) { menu.style.cssText += 'max-height:240px;overflow-y:auto;'; }
		return dropdown;
	}

	private _buildSearchInput(): HTMLElement {
		const wrap = document.createElement('div');
		wrap.className = 'sidex-settings-model-search';
		const icon = document.createElement('span');
		icon.className = 'codicon codicon-search';
		wrap.appendChild(icon);
		const input = document.createElement('input');
		input.type = 'text';
		input.placeholder = 'Search your models';
		input.addEventListener('input', () => this._onSearch(input.value));
		wrap.appendChild(input);
		return wrap;
	}

	private _renderEnabledModels(container: HTMLElement): void {
		container.innerHTML = '';
		for (const id of this._customModels) {
			container.appendChild(this._buildModelRow(id));
		}
		if (this._customModels.length === 0) {
			const empty = document.createElement('div');
			empty.className = 'sidex-settings-row-description';
			empty.style.padding = '8px 14px';
			empty.textContent = 'No models added yet. Add a model ID below to enable it.';
			container.appendChild(empty);
		}
	}

	private _buildModelRow(id: string): HTMLElement {
		const row = document.createElement('div');
		row.className = 'sidex-settings-model-item';
		const displayName = this._modelNames.get(id);
		row.dataset.modelId = id;
		row.dataset.modelName = `${displayName ?? ''} ${id}`.toLowerCase();

		const nameEl = document.createElement('div');
		nameEl.className = 'sidex-settings-model-name';
		nameEl.textContent = displayName ?? id;
		// Keep the routable id visible: two providers can label a model the
		// same way, and the id is what actually gets sent.
		if (displayName) {
			const idEl = document.createElement('span');
			idEl.className = 'sidex-settings-row-description';
			idEl.style.cssText = 'margin-left:8px;opacity:0.6;';
			idEl.textContent = id;
			nameEl.appendChild(idEl);
		}
		row.appendChild(nameEl);

		// Every row here is a user-added model, so removal is always available —
		// there's no curated entry underneath to fall back to.
		const trash = document.createElement('span');
		trash.className = 'codicon codicon-trash sidex-settings-model-remove';
		trash.addEventListener('click', (e) => {
			e.stopPropagation();
			this._removeCustomModel(id);
		});
		row.appendChild(trash);

		const isOn = this._enabledIds.has(id);
		const toggle = document.createElement('div');
		toggle.className = 'sidex-settings-toggle' + (isOn ? ' on' : '');
		toggle.addEventListener('click', (e) => {
			e.stopPropagation();
			if (this._enabledIds.has(id)) {
				this._enabledIds.delete(id);
			} else {
				this._enabledIds.add(id);
			}
			this._saveEnabledModels();
			if (this._enabledListContainer) { this._renderEnabledModels(this._enabledListContainer); }
		});
		row.appendChild(toggle);

		return row;
	}

	private _buildAddCustomRow(): HTMLElement {
		const wrap = document.createElement('div');
		wrap.style.cssText = 'padding:12px 20px;';

		if (!this._addingCustom) {
			const btn = document.createElement('span');
			btn.className = 'sidex-settings-link';
			btn.style.cssText = 'font-size:12px;cursor:pointer;';
			btn.textContent = '+ Add Model';
			btn.addEventListener('click', () => {
				this._addingCustom = true;
				this._updateCustomRow();
			});
			wrap.appendChild(btn);
			return wrap;
		}

		const form = document.createElement('div');
		form.style.cssText = 'display:flex;flex-direction:column;gap:8px;';

		const idInput = document.createElement('input');
		idInput.type = 'text';
		idInput.placeholder = 'Model ID (e.g. anthropic/claude-opus-4.6)';

		// The selected provider qualifies the id that actually gets routed:
		// "<provider>/<input>", unless the input already carries that prefix.
		const routeHint = document.createElement('div');
		routeHint.className = 'sidex-settings-row-description';
		routeHint.style.cssText = 'font-size:11px;display:none;';
		const qualify = (raw: string): string => {
			const value = raw.trim();
			const provider = this._addModelProvider;
			if (!provider || !value) { return value; }
			return value.startsWith(`${provider}/`) ? value : `${provider}/${value}`;
		};
		const updateRouteHint = (): void => {
			if (!this._addModelProvider) {
				routeHint.style.display = 'none';
				return;
			}
			routeHint.textContent = `Will route to ${qualify(idInput.value) || `${this._addModelProvider}/<model-id>`}`;
			routeHint.style.display = '';
		};
		idInput.addEventListener('input', updateRouteHint);

		const suggestions = document.createElement('div');
		suggestions.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);display:flex;flex-direction:column;gap:4px;';

		// Picking a configured provider fetches what it can actually serve, so
		// users aren't guessing at IDs — but the text input below still takes
		// anything, for providers we can't introspect or haven't set a key for.
		const loadSuggestions = async (provider: string): Promise<void> => {
			suggestions.innerHTML = '';
			if (!provider || !this._invoke) { return; }
			suggestions.textContent = 'Loading models…';
			try {
				const models = (await this._invoke('providers_list_models', { provider }) as ProviderModel[]) || [];
				suggestions.innerHTML = '';
				if (models.length === 0) {
					suggestions.textContent = 'No models reported yet — enter an ID manually below.';
					return;
				}
				// Remember the labels now: picking one should carry its name
				// through even though the input only holds the id.
				for (const m of models) {
					if (m?.id && m.name) { this._modelNames.set(m.id, m.name); }
				}
				const label = document.createElement('div');
				label.textContent = `${models.length} available — pick one, or type your own:`;
				suggestions.appendChild(label);
				suggestions.appendChild(this._boundedDropdown(
					models.map(m => m.id), '', (value) => { idInput.value = value; updateRouteHint(); }));
			} catch {
				// Not configured, offline, or the provider just doesn't support
				// listing — the manual text input below still works either way.
				suggestions.textContent = 'Couldn\'t reach this provider to list its models — enter an ID manually below.';
			}
		};

		const providerOptions = [
			{ value: '', label: 'Custom (any provider)' },
			...this._providerCatalog.map(p => ({ value: p.id, label: p.label })),
		];
		form.appendChild(this._boundedDropdown(providerOptions, this._addModelProvider, (value) => {
			this._addModelProvider = value;
			// Carry an already-typed id over to the new provider prefix instead of
			// silently keeping it unprefixed (same prefix is left untouched).
			if (idInput.value.trim()) { idInput.value = qualify(idInput.value); }
			void loadSuggestions(value);
			updateRouteHint();
		}));
		form.appendChild(suggestions);

		const row = document.createElement('div');
		row.style.cssText = 'display:flex;align-items:center;gap:8px;';
		const wrapper = document.createElement('div');
		wrapper.className = 'sidex-input-wrapper';
		wrapper.style.flex = '1';
		wrapper.appendChild(idInput);
		row.appendChild(wrapper);

		const addBtn = document.createElement('span');
		addBtn.className = 'sidex-settings-link';
		addBtn.style.cssText = 'font-size:12px;cursor:pointer;font-weight:500;';
		addBtn.textContent = 'Add';
		addBtn.addEventListener('click', () => {
			const val = qualify(idInput.value);
			if (val) { this._addCustomModel(val); }
		});
		row.appendChild(addBtn);

		const cancelBtn = document.createElement('span');
		cancelBtn.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);cursor:pointer;';
		cancelBtn.textContent = 'Cancel';
		cancelBtn.addEventListener('click', () => {
			this._addingCustom = false;
			this._addModelProvider = '';
			this._updateCustomRow();
		});
		row.appendChild(cancelBtn);

		idInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') { const v = qualify(idInput.value); if (v) { this._addCustomModel(v); } }
			if (e.key === 'Escape') { this._addingCustom = false; this._addModelProvider = ''; this._updateCustomRow(); }
		});
		form.appendChild(row);
		form.appendChild(routeHint);
		wrap.appendChild(form);

		updateRouteHint();
		if (this._addModelProvider) { void loadSuggestions(this._addModelProvider); }

		return wrap;
	}

	private _updateCustomRow(): void {
		if (this._customRowContainer) {
			this._customRowContainer.innerHTML = '';
			const freshRow = this._buildAddCustomRow();
			while (freshRow.firstChild) {
				this._customRowContainer.appendChild(freshRow.firstChild);
			}
		}
	}

	private _onSearch(query: string): void {
		if (!this._container) { return; }
		const q = query.toLowerCase();
		this._container.querySelectorAll('.sidex-settings-model-item').forEach(el => {
			const name = (el as HTMLElement).dataset.modelName || '';
			const id = (el as HTMLElement).dataset.modelId || '';
			(el as HTMLElement).style.display = (!q || name.includes(q) || id.includes(q)) ? '' : 'none';
		});
	}

	private _renderApiKeysSection(container: HTMLElement): void {
		container.innerHTML = '';
		const section = document.createElement('div');
		const title = document.createElement('div');
		title.className = 'sidex-settings-section-title';
		title.textContent = 'API Keys';
		section.appendChild(title);

		const desc = document.createElement('div');
		desc.className = 'sidex-settings-row-description sidex-settings-section-desc';
		desc.textContent = 'Configure provider API keys to use models at cost through your own accounts.';
		section.appendChild(desc);

		const card = document.createElement('div');
		card.className = 'sidex-settings-card';

		const configured: ProviderCatalogEntry[] = [];
		const rest: ProviderCatalogEntry[] = [];
		for (const provider of this._providerCatalog) {
			(this._providerStatus.get(provider.id)?.configured ? configured : rest).push(provider);
		}

		// Past a handful of providers the full catalog is too long to scan on
		// open, so whatever is already working stays pinned in view and
		// everything else collapses behind a disclosure. On a fresh install
		// nothing is configured yet, so there's no "long tail" to hide —
		// showing the whole list is what's actually useful there.
		if (configured.length > 0) {
			const header = document.createElement('div');
			header.className = 'sidex-settings-model-group-header';
			header.textContent = 'Configured';
			card.appendChild(header);
			for (const provider of configured) { card.appendChild(this._buildProviderCard(provider)); }
		}

		if (rest.length > 0) {
			if (configured.length === 0) {
				for (const provider of rest) { card.appendChild(this._buildProviderCard(provider)); }
			} else {
				const expanded = this._apiKeysExpanded;
				const disclosureHeader = document.createElement('div');
				disclosureHeader.className = 'sidex-settings-expandable-header' + (expanded ? ' expanded' : '');
				const chevron = document.createElement('span');
				chevron.className = 'codicon codicon-chevron-right';
				disclosureHeader.appendChild(chevron);
				const disclosureLabel = document.createElement('span');
				disclosureLabel.textContent = `${rest.length} more provider${rest.length === 1 ? '' : 's'}`;
				disclosureHeader.appendChild(disclosureLabel);
				disclosureHeader.addEventListener('click', () => {
					this._apiKeysExpanded = !this._apiKeysExpanded;
					this._renderApiKeysSection(container);
				});
				card.appendChild(disclosureHeader);

				const disclosureContent = document.createElement('div');
				disclosureContent.className = 'sidex-settings-expandable-content' + (expanded ? ' visible' : '');
				for (const provider of rest) { disclosureContent.appendChild(this._buildProviderCard(provider)); }
				card.appendChild(disclosureContent);
			}
		}

		section.appendChild(card);
		container.appendChild(section);
	}

	/**
	 * A generic "OpenAI-compatible" entry has no fixed console to send people
	 * to and no default endpoint to fall back on, unlike every named provider
	 * in the catalog — so the copy has to describe what's actually true for
	 * this card rather than assume a console link and a working default.
	 */
	private _providerDescriptionHtml(config: ProviderCatalogEntry): string {
		if (config.custom) {
			// Custom endpoints are defined in this panel, not shipped by SideX, so
			// point at where they can be edited instead of a key console.
			return config.keyless
				? `${config.label} is a custom endpoint that doesn't require a key. Edit or remove it under Custom Providers.`
				: `Custom endpoint defined under Custom Providers. Enter an API key to use ${config.label} models.`;
		}
		if (config.keyless) {
			return `${config.label} doesn't require a key. Set a base URL below if it isn't running at the default location.`;
		}
		const keyPart = config.consoleUrl
			? `Get a key from <a href="${config.consoleUrl}" class="sidex-settings-link" target="_blank">${config.label}</a> to use its models at cost.`
			: `Enter an API key to use ${config.label} models at cost.`;
		const envPart = config.envVars.length ? ` Picked up automatically if ${config.envVars.join(' or ')} is already set in your shell.` : '';
		const baseUrlPart = config.defaultBaseUrl ? '' : ' This provider has no default endpoint, so a base URL is required below.';
		return keyPart + envPart + baseUrlPart;
	}

	private _buildProviderCard(config: ProviderCatalogEntry): HTMLElement {
		const row = document.createElement('div');
		row.className = 'sidex-settings-row';

		// The row itself is a flex container, so the label and its description
		// have to share one column or they end up side by side.
		// The row itself is a flex container, so label and description have to
		// live in one column or they land side by side. The text column sits
		// beside the toggle rather than under it, so the description lines up
		// with the label whatever width the toggle happens to be.
		const infoCol = document.createElement('div');
		infoCol.style.cssText = 'display:flex;align-items:flex-start;gap:10px;min-width:0;flex:1;padding-right:16px;';

		const textCol = document.createElement('div');
		textCol.style.cssText = 'display:flex;flex-direction:column;min-width:0;';

		const titleWrap = document.createElement('div');
		titleWrap.style.cssText = 'display:flex;align-items:center;';

		const status = this._providerStatus.get(config.id);
		// `enabled` is the user's on/off choice; `configured` is whether a
		// credential exists. A keyless provider is always configured, so the
		// toggle has to follow `enabled` or it can never be switched off.
		const isEnabled = status?.enabled !== false;
		const hasCredential = status?.configured ?? false;
		const isOn = isEnabled && hasCredential;
		const toggle = document.createElement('div');
		toggle.className = 'sidex-settings-toggle' + (isOn ? ' on' : '');
		toggle.style.flexShrink = '0';
		toggle.style.marginTop = '1px';
		infoCol.appendChild(toggle);

		const label = document.createElement('div');
		label.className = 'sidex-settings-row-label';
		label.textContent = config.label;
		titleWrap.appendChild(label);

		textCol.appendChild(titleWrap);

		const descEl = document.createElement('div');
		descEl.className = 'sidex-settings-row-description';
		descEl.innerHTML = this._providerDescriptionHtml(config);
		descEl.querySelectorAll('a').forEach(link => {
			link.addEventListener('click', (e) => {
				e.preventDefault();
				const href = link.getAttribute('href');
				if (href && this._invoke) {
					this._invoke('open_external_url', { url: href }).catch(() => {
						window.open(href, '_blank');
					});
				}
			});
		});
		textCol.appendChild(descEl);
		infoCol.appendChild(textCol);
		row.appendChild(infoCol);

		const fieldsWrap = document.createElement('div');
		fieldsWrap.className = 'sidex-settings-row-action';
		fieldsWrap.style.cssText = 'flex-direction:column;gap:6px;flex-shrink:0;';

		// A provider that ships with no default base URL has nothing to fall
		// back to — leaving it blank wouldn't "use the default", it would
		// resolve to an empty endpoint. The field has to be required, not
		// merely suggested.
		const needsBaseUrl = !config.defaultBaseUrl;
		interface FieldSpec { id: 'apiKey' | 'baseUrl'; type: string; placeholder: string; prefill?: string; required?: boolean }
		const fields: FieldSpec[] = [];
		if (!config.keyless) {
			fields.push({ id: 'apiKey', type: 'password', placeholder: `Enter your ${config.label} API Key` });
		}
		fields.push({
			id: 'baseUrl', type: 'text',
			placeholder: needsBaseUrl ? 'Base URL (required, e.g. https://your-host/v1)' : config.defaultBaseUrl,
			// A custom provider's endpoint is owned by the Custom Providers form
			// (Rust reads it from settings, not from this key card), so show it
			// read-only here instead of pretending an override would stick.
			prefill: config.custom
				? (status?.baseUrl || config.defaultBaseUrl || undefined)
				: (status?.baseUrl && status.baseUrl !== config.defaultBaseUrl ? status.baseUrl : undefined),
			required: needsBaseUrl,
		});

		// Populated once the fields below exist, and read by both the field
		// loop and the save call — declared here so both can see it.
		const errorEl = document.createElement('div');
		errorEl.className = 'sidex-settings-row-description';
		errorEl.style.cssText = 'display:none;max-width:260px;color:var(--vscode-editorError-foreground, #f85149);';

		const fieldInputs: Map<string, HTMLInputElement> = new Map();
		// A masked field means "a key is stored", not "you may not change it":
		// explicit Replace / Clear actions sit next to it (a disabled input was
		// a dead end — nothing could ever remove or rotate the key).
		const storedKey = this._hasStoredKey(status);
		for (const field of fields) {
			const wrapper = document.createElement('div');
			wrapper.className = 'sidex-input-wrapper';
			const input = document.createElement('input');
			input.type = field.type;
			input.placeholder = field.placeholder;
			if (field.required) {
				input.setAttribute('aria-required', 'true');
			}
			if (field.prefill) { input.value = field.prefill; }
			const isKeyField = field.id === 'apiKey';
			if (isKeyField && storedKey) {
				input.value = MASKED_KEY;
				input.readOnly = true;
				input.setAttribute('aria-label', 'Stored API key');
			}
			if (field.id === 'baseUrl' && config.custom) {
				input.readOnly = true;
				input.style.opacity = '0.8';
				input.setAttribute('aria-label', 'Endpoint from Custom Providers');
			}
			// Saving restarts the server and re-renders this section, which
			// destroys the focused input and fires another blur. Without an
			// equality check that loops: the base URL field is pre-filled, so
			// it always looks "dirty" on the way out.
			const initialValue = input.value;
			const saveIfChanged = async (): Promise<void> => {
				if (isKeyField) {
					// The masked value is never a real key, and an empty key field
					// means "leave the stored key alone" — only Clear removes it.
					const replaced = !input.readOnly && input.value.trim().length > 0 && input.value !== MASKED_KEY;
					if (!replaced) { return; }
					const error = await this._saveProviderKey(config, fieldInputs, 'set');
					errorEl.textContent = error ?? '';
					errorEl.style.display = error ? '' : 'none';
					return;
				}
				if (input.value === initialValue) { return; }
				const error = await this._saveProviderKey(config, fieldInputs, 'keep');
				errorEl.textContent = error ?? '';
				errorEl.style.display = error ? '' : 'none';
			};
			input.addEventListener('blur', () => { void saveIfChanged(); });
			input.addEventListener('keydown', (e) => {
				if (e.key === 'Enter') { void saveIfChanged(); }
			});
			// A fresh edit makes the last save attempt's error stale — clear it
			// rather than leaving it pinned under the field they're now fixing.
			input.addEventListener('input', () => { errorEl.style.display = 'none'; });
			wrapper.appendChild(input);
			fieldInputs.set(field.id, input);
			fieldsWrap.appendChild(wrapper);
			if (isKeyField && storedKey) {
				fieldsWrap.appendChild(this._buildKeyActionsRow(config, input, errorEl));
			}
			if (field.id === 'baseUrl' && config.custom) {
				const note = document.createElement('div');
				note.className = 'sidex-settings-row-description';
				note.style.cssText = 'font-size:11px;max-width:260px;';
				note.textContent = 'Edit this endpoint under Custom Providers.';
				fieldsWrap.appendChild(note);
			}
		}
		fieldsWrap.appendChild(errorEl);

		// The model list is only worth fetching once the provider can actually
		// resolve a request — offering it while off or unconfigured would just
		// trade one silent failure for a confusing one.
		if (isOn) {
			fieldsWrap.appendChild(this._buildImportModelsRow(config));
		}
		row.appendChild(fieldsWrap);

		toggle.addEventListener('click', async () => {
			if (isOn) {
				await this._setProviderEnabled(config.id, false);
				return;
			}
			// Re-enabling something that already has a credential (or needs
			// none) just switches it back on; otherwise the user still has to
			// supply a key, so put the cursor where they can.
			if (!isEnabled && hasCredential) {
				await this._setProviderEnabled(config.id, true);
				return;
			}
			const firstInput = Array.from(fieldInputs.values())[0];
			if (firstInput) { firstInput.focus(); }
		});

		return row;
	}

	/**
	 * Per-card "pull in this provider's real models" action. `_adoptModelsFrom`
	 * already does the work (it's also called right after a connect/enable),
	 * but that was the only way to reach it — a provider configured earlier in
	 * the session, or one whose auto-adopt found nothing the first time, had
	 * no way to retry. This puts the same helper one click away on every
	 * configured card, and — unlike those call sites, which treat a failure as
	 * best-effort — reports it back instead of swallowing it.
	 */
	private _buildImportModelsRow(config: ProviderCatalogEntry): HTMLElement {
		const wrap = document.createElement('div');
		wrap.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;';

		const link = document.createElement('span');
		link.className = 'sidex-settings-link';
		link.style.cssText = 'font-size:11px;cursor:pointer;white-space:nowrap;';
		link.textContent = 'Import models';
		wrap.appendChild(link);

		const resultEl = document.createElement('span');
		resultEl.className = 'sidex-settings-row-description';
		resultEl.style.margin = '0';
		wrap.appendChild(resultEl);

		const run = async (): Promise<void> => {
			link.style.pointerEvents = 'none';
			link.style.opacity = '0.5';
			resultEl.style.color = '';
			resultEl.textContent = 'Importing…';
			try {
				const added = await this._adoptModelsFrom(config.id);
				resultEl.textContent = added > 0
					? `Added ${added} model${added === 1 ? '' : 's'}.`
					: 'No new models found.';
			} catch (e) {
				resultEl.textContent = e instanceof Error ? e.message : String(e);
				resultEl.style.color = 'var(--vscode-editorError-foreground, #f85149)';
			} finally {
				link.style.pointerEvents = '';
				link.style.opacity = '';
			}
		};
		link.addEventListener('click', () => { void run(); });

		return wrap;
	}

	// ─── Custom providers ───────────────────────────────────────────────────
	//
	// Custom endpoints live in settings (`sidex.providers.custom`), not in the
	// fixed Rust catalogue. Rust merges them into catalog/status/resolve; the
	// panel mirrors them locally too, so a custom endpoint is listed even while
	// the server is restarting (and on an older backend that hasn't merged it).

	private async _loadCustomProviders(): Promise<void> {
		if (!this._invoke) { return; }
		try {
			const raw = await this._invoke('settings_get', { section: 'sidex.providers.custom' });
			const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
			// Rust ignores entries that shadow a built-in provider or that have an
			// id it cannot turn into an env var; drop the same ones here so the
			// panel never offers a card whose key save would hit a built-in id.
			const builtinIds = new Set(this._providerCatalog.filter(p => !p.custom).map(p => p.id));
			this._customProviderDefs = this._normalizeCustomProviders(arr).filter(def => !builtinIds.has(def.id));
		} catch { this._customProviderDefs = []; }
	}

	private _normalizeCustomProviders(raw: unknown): CustomProviderDef[] {
		if (!Array.isArray(raw)) { return []; }
		const defs: CustomProviderDef[] = [];
		const seen = new Set<string>();
		for (const entry of raw as Array<Partial<CustomProviderDef>>) {
			if (!entry || typeof entry !== 'object') { continue; }
			const id = typeof entry.id === 'string' ? entry.id.trim() : '';
			// Same id rule Rust enforces (valid_custom_provider_id): a bad id would
			// be silently ignored by the backend, leaving a card that cannot route.
			if (!id || id.length > 64 || !/^[a-z0-9][a-z0-9._-]*$/.test(id) || seen.has(id)) { continue; }
			seen.add(id);
			defs.push({
				id,
				label: typeof entry.label === 'string' && entry.label.trim() ? entry.label.trim() : id,
				protocol: entry.protocol === 'anthropic' ? 'anthropic' : 'openai',
				baseUrl: typeof entry.baseUrl === 'string' ? entry.baseUrl.trim() : '',
				auth: this._normalizeAuth(entry.auth),
				...(Array.isArray(entry.models)
					? { models: entry.models.filter((m): m is string => typeof m === 'string' && m.length > 0) }
					: {}),
			});
		}
		return defs;
	}

	private _normalizeAuth(auth: unknown): string {
		return auth === 'x-api-key' || auth === 'api-key' || auth === 'none' ? auth : 'bearer';
	}

	/** Merge settings-defined providers into the render-only catalogue. */
	private _mergeCustomProvidersIntoCatalog(): void {
		// Remove synthetic entries from a previous merge first; then mark the
		// ones Rust already merged as custom so this panel can identify them.
		this._providerCatalog = this._providerCatalog.filter(p => !p.custom);
		const byId = new Map(this._customProviderDefs.map(def => [def.id, def]));
		for (const provider of this._providerCatalog) {
			const def = byId.get(provider.id);
			if (def) {
				provider.custom = true;
				provider.protocol = provider.protocol ?? def.protocol;
				provider.authStyle = provider.authStyle ?? def.auth;
			}
		}
		const known = new Set(this._providerCatalog.map(p => p.id));
		for (const def of this._customProviderDefs) {
			if (known.has(def.id)) { continue; }
			this._providerCatalog.push({
				id: def.id,
				label: def.label,
				defaultBaseUrl: def.baseUrl,
				envVars: [],
				consoleUrl: '',
				keyless: def.auth === 'none',
				custom: true,
				protocol: def.protocol,
				authStyle: def.auth,
			});
		}
	}

	private _renderCustomProvidersSection(container: HTMLElement): void {
		container.innerHTML = '';
		const section = document.createElement('div');

		const title = document.createElement('div');
		title.className = 'sidex-settings-section-title';
		title.textContent = 'Custom Providers';
		section.appendChild(title);

		const desc = document.createElement('div');
		desc.className = 'sidex-settings-row-description sidex-settings-section-desc';
		desc.textContent = 'Use any OpenAI-compatible or Anthropic-compatible endpoint with its own base URL, auth style and key.';
		section.appendChild(desc);

		const list = document.createElement('div');
		list.className = 'sidex-settings-card';
		if (this._customProviderDefs.length === 0) {
			const empty = document.createElement('div');
			empty.className = 'sidex-settings-empty-state';
			empty.textContent = 'No custom providers yet. Add an endpoint to use an API that does not ship with SideX.';
			list.appendChild(empty);
		} else {
			for (const def of this._customProviderDefs) {
				list.appendChild(this._buildCustomProviderRow(def));
			}
		}
		section.appendChild(list);

		if (this._customProviderFormOpen) {
			section.appendChild(this._buildCustomProviderForm());
		} else {
			const actions = document.createElement('div');
			actions.style.cssText = 'display:flex;justify-content:flex-end;margin:8px 20px 0;';
			const addBtn = document.createElement('button');
			addBtn.type = 'button';
			addBtn.className = 'sidex-settings-btn';
			addBtn.textContent = '+ Add Provider';
			addBtn.addEventListener('click', () => {
				this._customProviderFormOpen = true;
				this._editingCustomProviderId = null;
				this._renderCustomProvidersSection(container);
			});
			actions.appendChild(addBtn);
			section.appendChild(actions);
		}

		container.appendChild(section);
	}

	private _buildCustomProviderRow(def: CustomProviderDef): HTMLElement {
		const row = document.createElement('div');
		row.className = 'sidex-settings-row';
		row.style.alignItems = 'flex-start';

		const infoCol = document.createElement('div');
		infoCol.style.cssText = 'display:flex;flex-direction:column;min-width:0;flex:1;padding-right:16px;';

		const label = document.createElement('div');
		label.className = 'sidex-settings-row-label';
		label.textContent = def.label;
		infoCol.appendChild(label);

		const url = document.createElement('div');
		url.className = 'sidex-settings-row-description';
		url.style.cssText = 'font-family:var(--monaco-monospace-font, monospace);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
		url.textContent = def.baseUrl;
		url.title = def.baseUrl;
		infoCol.appendChild(url);

		const meta = document.createElement('div');
		meta.className = 'sidex-settings-row-description';
		meta.style.cssText = 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;';
		const appendPart = (text: string): HTMLSpanElement => {
			if (meta.childNodes.length > 0) { meta.appendChild(document.createTextNode(' · ')); }
			const part = document.createElement('span');
			part.textContent = text;
			meta.appendChild(part);
			return part;
		};
		appendPart(PROTOCOL_LABELS[def.protocol] ?? def.protocol);
		appendPart(AUTH_LABELS[def.auth] ?? def.auth);
		const countEl = appendPart(this._formatModelCount(this._customModelCounts.get(def.id) ?? def.models?.length));
		this._fillCustomModelCount(def, countEl);
		const statusText = this._customProviderStatusText(def);
		const statusEl = appendPart(statusText);
		if (statusText === 'Key required') {
			statusEl.style.color = 'var(--vscode-editorWarning-foreground, #cca700)';
		} else if (statusText !== 'Disabled') {
			statusEl.style.color = 'var(--vscode-testing-iconPassed, #89d185)';
		}
		infoCol.appendChild(meta);

		const resultEl = document.createElement('div');
		resultEl.className = 'sidex-settings-row-description';
		resultEl.style.cssText = 'display:none;';
		infoCol.appendChild(resultEl);

		row.appendChild(infoCol);

		const actions = document.createElement('div');
		actions.className = 'sidex-settings-row-action';
		actions.style.cssText = 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end;';

		const testBtn = this._buildRowButton('Test connection');
		testBtn.addEventListener('click', () => { void this._testCustomProvider(def, testBtn, resultEl); });
		actions.appendChild(testBtn);

		const editBtn = this._buildRowButton('Edit');
		editBtn.addEventListener('click', () => {
			this._customProviderFormOpen = true;
			this._editingCustomProviderId = def.id;
			if (this._customProvidersContainer) { this._renderCustomProvidersSection(this._customProvidersContainer); }
		});
		actions.appendChild(editBtn);

		const deleteBtn = this._buildRowButton('Delete');
		deleteBtn.addEventListener('click', () => { void this._deleteCustomProvider(def); });
		actions.appendChild(deleteBtn);

		row.appendChild(actions);
		return row;
	}

	private _buildRowButton(label: string): HTMLButtonElement {
		const button = document.createElement('button');
		button.type = 'button';
		button.className = 'sidex-settings-btn';
		button.textContent = label;
		return button;
	}

	private _formatModelCount(count: number | undefined): string {
		if (typeof count !== 'number' || Number.isNaN(count)) { return 'Model count unknown'; }
		return `${count} model${count === 1 ? '' : 's'}`;
	}

	/** Best-effort live model count for a custom provider; declared models are the fallback. */
	private _fillCustomModelCount(def: CustomProviderDef, el: HTMLElement): void {
		if (this._customModelCounts.has(def.id) || !this._invoke) { return; }
		void this._invoke('providers_list_models', { provider: def.id }).then(models => {
			if (!Array.isArray(models)) { return; }
			this._customModelCounts.set(def.id, models.length);
			if (el.isConnected) { el.textContent = this._formatModelCount(models.length); }
		}).catch(() => { /* keep the declared count / unknown */ });
	}

	private _customProviderStatusText(def: CustomProviderDef): string {
		const status = this._providerStatus.get(def.id);
		if (status && status.enabled === false) { return 'Disabled'; }
		if (def.auth === 'none') { return 'No key needed'; }
		if (status?.source === 'env') { return 'Configured via environment'; }
		if (this._hasStoredKey(status)) { return 'Key set'; }
		if (status?.configured) { return 'Configured via environment'; }
		return 'Key required';
	}

	private _buildCustomProviderForm(): HTMLElement {
		const form = document.createElement('div');
		form.className = 'sidex-settings-card';
		form.style.cssText = 'margin-top:8px;padding:14px 20px;display:flex;flex-direction:column;gap:10px;';

		const editing = this._editingCustomProviderId
			? this._customProviderDefs.find(def => def.id === this._editingCustomProviderId)
			: undefined;

		const wrapInput = (placeholder: string, value: string, readOnly = false): HTMLInputElement => {
			const wrapper = document.createElement('div');
			wrapper.className = 'sidex-input-wrapper';
			wrapper.style.cssText = 'max-width:none;width:100%;';
			const input = document.createElement('input');
			input.type = 'text';
			input.placeholder = placeholder;
			input.value = value;
			if (readOnly) {
				input.readOnly = true;
				input.style.opacity = '0.7';
			}
			wrapper.appendChild(input);
			return input;
		};

		const controlOf = (input: HTMLInputElement): HTMLElement => input.parentElement as HTMLElement;

		const nameInput = wrapInput('My provider', editing?.label ?? '');
		const nameControl = controlOf(nameInput);
		const idInput = wrapInput('lowercase-id', editing?.id ?? '', !!editing);
		const idControl = controlOf(idInput);
		const urlInput = wrapInput('https://your-host/v1', editing?.baseUrl ?? '');
		const urlControl = controlOf(urlInput);
		const modelsInput = wrapInput('e.g. gpt-4.1, claude-sonnet-4.6', editing?.models?.join(', ') ?? '');
		const modelsControl = controlOf(modelsInput);

		let protocol = editing?.protocol ?? 'openai';
		let auth = editing?.auth ?? 'bearer';

		const fullWidth = (dropdown: HTMLElement): HTMLElement => {
			dropdown.style.width = '100%';
			const trigger = dropdown.querySelector('.sidex-custom-select-trigger') as HTMLElement | null;
			if (trigger) { trigger.style.width = '100%'; }
			return dropdown;
		};
		const protocolControl = fullWidth(this._boundedDropdown(
			[{ value: 'openai', label: 'OpenAI-compatible' }, { value: 'anthropic', label: 'Anthropic-compatible' }],
			protocol,
			value => { protocol = value; }));
		const authControl = fullWidth(this._boundedDropdown(
			[
				{ value: 'bearer', label: 'Bearer token' },
				{ value: 'x-api-key', label: 'x-api-key header' },
				{ value: 'api-key', label: 'api-key header' },
				{ value: 'none', label: 'No key' },
			],
			auth,
			value => { auth = value; }));

		const slugify = (value: string): string => value.trim().toLowerCase()
			.replace(/[^a-z0-9._-]+/g, '-')
			.replace(/^-+|-+$/g, '');
		let idTouched = !!editing;
		nameInput.addEventListener('input', () => {
			if (!idTouched) { idInput.value = slugify(nameInput.value); }
		});
		idInput.addEventListener('input', () => { idTouched = true; });

		const errorEl = document.createElement('div');
		errorEl.className = 'sidex-settings-row-description';
		errorEl.style.cssText = 'display:none;color:var(--vscode-editorError-foreground, #f85149);';
		const fail = (message: string): void => {
			errorEl.textContent = message;
			errorEl.style.display = '';
		};

		form.appendChild(this._buildCustomFormRow('Display name', nameControl));
		form.appendChild(this._buildCustomFormRow('Provider ID', idControl));
		form.appendChild(this._buildCustomFormRow('Protocol', protocolControl));
		form.appendChild(this._buildCustomFormRow('Base URL', urlControl));
		form.appendChild(this._buildCustomFormRow('Auth', authControl));
		form.appendChild(this._buildCustomFormRow('Models (comma separated, optional)', modelsControl));
		form.appendChild(errorEl);

		const buttons = document.createElement('div');
		buttons.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;padding-top:2px;';

		const cancelBtn = document.createElement('button');
		cancelBtn.type = 'button';
		cancelBtn.className = 'sidex-settings-btn';
		cancelBtn.textContent = 'Cancel';
		cancelBtn.addEventListener('click', () => {
			this._customProviderFormOpen = false;
			this._editingCustomProviderId = null;
			if (this._customProvidersContainer) { this._renderCustomProvidersSection(this._customProvidersContainer); }
		});
		buttons.appendChild(cancelBtn);

		const saveBtn = document.createElement('button');
		saveBtn.type = 'button';
		saveBtn.className = 'sidex-settings-btn sidex-settings-btn-primary';
		saveBtn.textContent = editing ? 'Save changes' : 'Add provider';
		saveBtn.addEventListener('click', () => {
			void (async () => {
				errorEl.style.display = 'none';
				const displayName = nameInput.value.trim();
				const id = idInput.value.trim();
				const baseUrl = urlInput.value.trim();
				const models = modelsInput.value.split(',').map(m => m.trim()).filter(Boolean);
				if (!displayName) { return fail('A display name is required.'); }
				if (!id) { return fail('A provider ID is required.'); }
				if (!/^[a-z0-9][a-z0-9._-]*$/.test(id)) {
					return fail('Provider ID may only contain lowercase letters, digits, dots, dashes and underscores.');
				}
				if (!/^https?:\/\/\S+$/i.test(baseUrl)) {
					return fail('A base URL starting with http:// or https:// is required.');
				}
				if (id.length > 64) {
					return fail('Provider ID is too long (max 64 characters).');
				}
				const editedId = this._editingCustomProviderId;
				if (id !== editedId && this._customProviderDefs.some(def => def.id === id)) {
					return fail(`Provider ID "${id}" is already in use.`);
				}
				if (id !== editedId && this._providerCatalog.some(provider => provider.id === id && !provider.custom)) {
					return fail(`Provider ID "${id}" is reserved by a built-in provider.`);
				}
				const def: CustomProviderDef = { id, label: displayName, protocol, baseUrl, auth };
				if (models.length > 0) { def.models = models; }

				const defs = [...this._customProviderDefs];
				const index = editedId ? defs.findIndex(entry => entry.id === editedId) : -1;
				if (index >= 0) { defs[index] = def; } else { defs.push(def); }

				saveBtn.disabled = true;
				this._customProviderFormOpen = false;
				this._editingCustomProviderId = null;
				const error = await this._persistCustomProviders(defs);
				saveBtn.disabled = false;
				if (error) {
					this._customProviderFormOpen = true;
					this._editingCustomProviderId = editedId;
					fail(error);
				}
			})();
		});
		buttons.appendChild(saveBtn);
		form.appendChild(buttons);

		return form;
	}

	private _buildCustomFormRow(labelText: string, control: HTMLElement): HTMLElement {
		const row = document.createElement('div');
		row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:16px;';
		const label = document.createElement('div');
		label.className = 'sidex-settings-row-label';
		label.textContent = labelText;
		row.appendChild(label);
		const controlWrap = document.createElement('div');
		controlWrap.style.cssText = 'width:300px;max-width:55%;flex-shrink:0;';
		controlWrap.appendChild(control);
		row.appendChild(controlWrap);
		return row;
	}

	private async _persistCustomProviders(defs: CustomProviderDef[]): Promise<string | null> {
		if (!this._invoke) { return 'Settings are unavailable.'; }
		try {
			await this._invoke('settings_update', { key: 'sidex.providers.custom', value: defs, scope: 'user' });
		} catch (e) {
			return e instanceof Error ? e.message : String(e);
		}
		this._customProviderDefs = defs;
		this._customModelCounts.clear();
		this._mergeCustomProvidersIntoCatalog();
		if (this._customProvidersContainer) { this._renderCustomProvidersSection(this._customProvidersContainer); }
		// The server reads the provider list from its environment at spawn time.
		await this._applyCredentialChange();
		return null;
	}

	private async _testCustomProvider(def: CustomProviderDef, button: HTMLButtonElement, resultEl: HTMLElement): Promise<void> {
		if (!this._invoke) { return; }
		button.disabled = true;
		resultEl.style.display = '';
		resultEl.style.color = '';
		resultEl.textContent = 'Testing…';
		try {
			const result = await this._invoke('providers_test', { provider: def.id }) as ProviderTestResult;
			if (result?.ok) {
				const parts: string[] = [];
				if (typeof result.status === 'number') { parts.push(`HTTP ${result.status}`); }
				if (typeof result.latencyMs === 'number') { parts.push(`${Math.round(result.latencyMs)} ms`); }
				if (typeof result.modelCount === 'number') { parts.push(this._formatModelCount(result.modelCount)); }
				resultEl.textContent = `✓ ${parts.length > 0 ? parts.join(' · ') : 'Connected'}${result.message ? ` — ${result.message}` : ''}`;
				resultEl.style.color = 'var(--vscode-testing-iconPassed, #89d185)';
				if (typeof result.modelCount === 'number') { this._customModelCounts.set(def.id, result.modelCount); }
			} else {
				const detail = result?.message
					|| (typeof result?.status === 'number' ? `HTTP ${result.status}` : 'Connection failed');
				resultEl.textContent = `✗ ${detail}`;
				resultEl.style.color = 'var(--vscode-editorError-foreground, #f85149)';
			}
		} catch (e) {
			resultEl.textContent = `✗ ${e instanceof Error ? e.message : String(e)}`;
			resultEl.style.color = 'var(--vscode-editorError-foreground, #f85149)';
		} finally {
			button.disabled = false;
		}
	}

	private async _deleteCustomProvider(def: CustomProviderDef): Promise<void> {
		const confirmed = await showConfirmDialog({
			title: `Delete custom provider ${def.label}?`,
			body: [
				`SideX will stop using the "${def.label}" endpoint and forget its API key.`,
				`Models declared by "${def.label}" stay in the model list but will stop working until another provider serves them.`,
			],
			confirmLabel: 'Delete',
			danger: true,
		});
		if (!confirmed) { return; }
		const defs = this._customProviderDefs.filter(entry => entry.id !== def.id);
		const error = await this._persistCustomProviders(defs);
		if (error) {
			console.error('Failed to delete custom provider:', error);
			return;
		}
		// Best effort: clear the key/off-switch slots the card may have created.
		if (this._invoke) { this._invoke('providers_delete', { provider: def.id }).catch(() => { /* already gone */ }); }
	}

	/**
	 * Everything the app can already reach without the user typing a key:
	 * loopback model servers, an existing Claude Code / Codex login, and keys
	 * already exported in their shell.
	 */
	private async _renderDiscoverySection(container: HTMLElement): Promise<void> {
		container.innerHTML = '';
		if (!this._invoke) { return; }

		const section = document.createElement('div');
		const title = document.createElement('div');
		title.className = 'sidex-settings-section-title';
		title.textContent = 'Detected on this machine';
		section.appendChild(title);

		const desc = document.createElement('div');
		desc.className = 'sidex-settings-row-description sidex-settings-section-desc';
		desc.textContent = 'Credentials and model servers SideX can use without any setup. No account required.';
		section.appendChild(desc);

		const card = document.createElement('div');
		card.className = 'sidex-settings-card';

		const [local, accounts, statuses] = await Promise.all([
			this._invoke('providers_detect_local').catch(() => []) as Promise<LocalServerInfo[]>,
			this._invoke('accounts_list').catch(() => []) as Promise<AccountInfo[]>,
			this._invoke('providers_status').catch(() => []) as Promise<ProviderStatusInfo[]>,
		]);

		// --- local model servers ---
		if (local.length === 0) {
			card.appendChild(this._buildInfoRow(
				'No local model server found',
				'Start Ollama or LM Studio and reopen this panel to use local models with no key.'));
		} else {
			for (const server of local) {
				const count = server.models.length;
				card.appendChild(this._buildInfoRow(
					`${server.label} — ready`,
					count > 0
						? `${count} model${count === 1 ? '' : 's'} at ${server.baseUrl}`
						: `Running at ${server.baseUrl}, but no models are pulled yet.`));
			}
		}

		// --- connect an account you are already signed into ---
		for (const account of accounts) {
			const row = document.createElement('div');
			row.className = 'sidex-settings-row';

			const infoCol = document.createElement('div');
			infoCol.style.cssText = 'display:flex;flex-direction:column;min-width:0;flex:1;padding-right:16px;';

			const labelRow = document.createElement('div');
			labelRow.className = 'sidex-product-label-row';
			const markKind = productMarkKind(account.provider) ?? productMarkKind(account.displayName);
			if (markKind) {
				labelRow.appendChild(createProductMark(markKind));
			}
			const label = document.createElement('div');
			label.className = 'sidex-settings-row-label';
			label.textContent = `${account.displayName} account`;
			labelRow.appendChild(label);
			infoCol.appendChild(labelRow);

			const action = document.createElement('button');
			action.className = 'sidex-settings-btn';
			action.style.cssText = 'flex-shrink:0;white-space:nowrap;';
			if (account.connected) {
				action.textContent = 'Disconnect';
			} else {
				action.textContent = 'Connect';
				action.disabled = !account.available;
			}

			const sub = document.createElement('div');
			sub.className = 'sidex-settings-row-description';
			sub.style.cssText = 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
			const who = account.accountEmail
				? `${account.accountEmail}${account.subscriptionTier ? ` · ${account.subscriptionTier}` : ''}`
				: account.subscriptionTier ?? '';
			if (account.expired) {
				sub.textContent = `Signed out or expired. Sign in with ${account.displayName} again, then reconnect.`;
			} else if (account.connected) {
				sub.textContent = who
					? `Connected — ${who}`
					: `Connected — using the login at ${account.location}`;
			} else if (account.available) {
				sub.textContent = who
					? `Signed in as ${who}. Connect to use it for ${account.provider} models.`
					: `Found at ${account.location}. Connect to use it for ${account.provider} models.`;
			} else {
				sub.textContent = `Not signed in to ${account.displayName} on this machine.`;
			}
			infoCol.appendChild(sub);

			// A subscription login is issued for that CLI. Say so plainly rather
			// than letting someone connect it without knowing.
			if (account.available && account.credentialKind === 'oauth') {
				const warn = document.createElement('div');
				warn.className = 'sidex-settings-row-description';
				warn.style.cssText = 'color:var(--vscode-editorWarning-foreground);margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
				warn.textContent = 'Subscription login, not a billed API key.';
				infoCol.appendChild(warn);
			}
			row.appendChild(infoCol);
			row.appendChild(action);

			if (account.connected || account.available) {
				action.addEventListener('click', () => {
					void this._setAccountConnected(account, !account.connected, sub);
				});
			}
			card.appendChild(row);
		}

		// --- keys already in the environment ---
		const fromEnv = statuses.filter(p => p.source === 'env');
		for (const p of fromEnv) {
			card.appendChild(this._buildInfoRow(
				`${p.label} — using ${p.envVar ?? 'your environment'}`,
				'Picked up from your shell. A key entered above overrides it.'));
		}

		section.appendChild(card);
		container.appendChild(section);
	}

	private _buildInfoRow(label: string, description: string): HTMLElement {
		const row = document.createElement('div');
		row.className = 'sidex-settings-row';

		const labelEl = document.createElement('div');
		labelEl.className = 'sidex-settings-row-label';
		labelEl.textContent = label;
		row.appendChild(labelEl);

		const descEl = document.createElement('div');
		descEl.className = 'sidex-settings-row-description';
		descEl.textContent = description;
		row.appendChild(descEl);
		return row;
	}

	/**
	 * Connecting hands another product's credential to the agent, so it asks
	 * first rather than flipping silently on a single click.
	 */
	private async _confirmAccountChange(account: AccountInfo, connect: boolean): Promise<boolean> {
		if (!connect) {
			return showConfirmDialog({
				title: `Disconnect ${account.displayName}?`,
				body: [
					`SideX will stop using your ${account.displayName} login for ${account.provider} models.`,
					'Your login itself is untouched — this only stops SideX reading it.'
				],
				confirmLabel: 'Disconnect',
				danger: true
			});
		}

		const who = account.accountEmail ?? 'the account signed in on this machine';
		const body = [
			`SideX will use your ${account.displayName} login (${who}) to run ${account.provider} models.`,
			`The credential is read from ${account.location} and passed only to the agent server running on your own machine. It is never sent anywhere else, and never shown in the app.`
		];

		return showConfirmDialog({
			title: `Connect ${account.displayName}?`,
			body,
			// A subscription login is issued for that product. Say so before the
			// user commits, not after.
			caution: account.credentialKind === 'oauth'
				? `This is a subscription login, not a billed API key. Using it from another app may not be permitted by ${account.displayName}'s terms — entering an API key above avoids that entirely.`
				: undefined,
			confirmLabel: 'Connect'
		});
	}

	private async _setAccountConnected(account: AccountInfo, connect: boolean, statusEl: HTMLElement): Promise<void> {
		if (!this._invoke) { return; }

		if (!await this._confirmAccountChange(account, connect)) { return; }

		statusEl.textContent = connect
			? `Connecting your ${account.displayName} account…`
			: `Disconnecting your ${account.displayName} account…`;
		statusEl.style.color = '';

		try {
			await this._invoke(connect ? 'accounts_connect' : 'accounts_disconnect', { provider: account.provider });
			// A freshly connected account is useless without models, so pull in
			// what it can actually reach before re-rendering. Caught locally,
			// not by the catch below: a model-listing hiccup right after connect
			// shouldn't be reported as the connect itself having failed — the
			// "Import models" action on the card covers retrying it.
			if (connect) {
				try {
					const added = await this._adoptModelsFrom(account.provider);
					if (added > 0) {
						statusEl.textContent = `Connected — added ${added} model${added === 1 ? '' : 's'}.`;
						// Do NOT persist a model here: the user didn't explicitly
						// choose one. Forcing the first account model into
						// localStorage pins a stale snapshot ID that survives
						// future re-fetches. Leave the selection unset so it
						// re-resolves to whatever the account currently serves.
					}
				} catch { /* connected fine; the card's own Import models action can retry */ }
			}
			await this._applyCredentialChange();
		} catch (e) {
			// Connecting fails when the login is missing or expired; the Rust
			// side returns a message written for the user, so show it in place.
			statusEl.textContent = e instanceof Error ? e.message : String(e);
			statusEl.style.color = 'var(--vscode-editorError-foreground)';
		}
	}

	/** True when the backend holds a stored (typed) API key for this provider. */
	private _hasStoredKey(status: ProviderStatusInfo | undefined): boolean {
		if (!status) { return false; }
		if (typeof status.hasKey === 'boolean') {
			// `hasKey` also counts an environment variable, which the Clear
			// button cannot remove — leave those editable so a typed key can
			// override the environment instead.
			return status.hasKey && status.source !== 'env';
		}
		// Backend without the new `hasKey` field: a settings-sourced credential
		// is a stored key (env/loopback credentials are not ours to clear).
		return status.configured && status.source === 'settings';
	}

	/**
	 * Save a provider card. `action` follows the Rust contract: `keep` leaves
	 * the stored key alone (so editing a base URL can never silently destroy
	 * it), `set` stores the typed key and `clear` removes it. Returns a
	 * user-facing message on failure so the card can show it inline, or
	 * `null` on success / when there was nothing to save.
	 */
	private async _saveProviderKey(config: ProviderCatalogEntry, inputs: Map<string, HTMLInputElement>, action: ApiKeyAction = 'keep'): Promise<string | null> {
		if (!this._invoke) { return null; }
		const apiKeyInput = inputs.get('apiKey');
		// A read-only field is showing the masked placeholder, not a real value.
		// An empty key field means "leave the stored key alone" — only the Clear
		// action removes a key.
		const typedKey = apiKeyInput && !apiKeyInput.readOnly && apiKeyInput.value !== MASKED_KEY
			? apiKeyInput.value.trim()
			: '';
		const apiKey = typedKey || null;
		// Custom endpoints come from `sidex.providers.custom`; the Rust resolver
		// ignores a per-provider base-URL override for them, so don't write one.
		const baseUrl = config.custom ? null : (inputs.get('baseUrl')?.value.trim() || null);
		const apiKeyAction: ApiKeyAction = action === 'clear' ? 'clear' : (apiKey ? 'set' : 'keep');
		if (apiKeyAction === 'keep' && !baseUrl) { return null; }

		// A provider that ships with no default base URL has nowhere to fall
		// back to — an empty base URL would resolve to "" on the Rust side and
		// every request would just fail. Catch that here instead of letting
		// the save "succeed" into a provider that can never actually resolve.
		if (!config.defaultBaseUrl && !baseUrl && !this._providerStatus.get(config.id)?.baseUrl) {
			return `${config.label} has no default endpoint — enter a base URL to save.`;
		}

		try {
			await this._invoke('providers_save', { provider: config.id, apiKey, baseUrl, apiKeyAction });
		} catch (e) {
			return e instanceof Error ? e.message : String(e);
		}
		await this._applyCredentialChange();
		return null;
	}

	/** Explicit "forget this key" action; keeps the configured endpoint intact. */
	private async _clearProviderKey(config: ProviderCatalogEntry): Promise<string | null> {
		if (!this._invoke) { return null; }
		const status = this._providerStatus.get(config.id);
		const baseUrl = status?.baseUrl && status.baseUrl !== config.defaultBaseUrl ? status.baseUrl : null;
		try {
			await this._invoke('providers_save', { provider: config.id, apiKey: null, baseUrl, apiKeyAction: 'clear' });
		} catch (e) {
			return e instanceof Error ? e.message : String(e);
		}
		await this._applyCredentialChange();
		return null;
	}

	/**
	 * Replace / Clear buttons shown next to a masked key field. The field used
	 * to be disabled once a key was stored, which left the user with no way to
	 * rotate or remove it.
	 */
	private _buildKeyActionsRow(config: ProviderCatalogEntry, input: HTMLInputElement, errorEl: HTMLElement): HTMLElement {
		const actions = document.createElement('div');
		actions.style.cssText = 'display:flex;align-items:center;gap:6px;';

		const replaceBtn = document.createElement('button');
		replaceBtn.type = 'button';
		replaceBtn.className = 'sidex-settings-btn';
		replaceBtn.textContent = 'Replace';
		replaceBtn.addEventListener('click', () => {
			input.readOnly = false;
			input.value = '';
			input.placeholder = `Enter your ${config.label} API Key`;
			input.focus();
			actions.style.display = 'none';
		});

		// Leaving the field empty without saving restores the mask and the
		// actions, so a stray click on Replace doesn't look like the key is gone.
		input.addEventListener('blur', () => {
			if (input.readOnly || input.value.trim()) { return; }
			input.value = MASKED_KEY;
			input.readOnly = true;
			actions.style.display = '';
		});

		const clearBtn = document.createElement('button');
		clearBtn.type = 'button';
		clearBtn.className = 'sidex-settings-btn';
		clearBtn.textContent = 'Clear';
		clearBtn.addEventListener('click', () => {
			void (async () => {
				clearBtn.disabled = true;
				errorEl.style.display = 'none';
				const error = await this._clearProviderKey(config);
				if (error) {
					errorEl.textContent = error;
					errorEl.style.display = '';
					clearBtn.disabled = false;
				}
			})();
		});

		actions.appendChild(replaceBtn);
		actions.appendChild(clearBtn);
		return actions;
	}

	/**
	 * Credentials reach the model server through its environment, which is read
	 * once at spawn — so a change only takes effect after a restart.
	 */
	private _applyingCredentialChange = false;

	private async _applyCredentialChange(): Promise<void> {
		// Re-render can trigger blur handlers, so refuse to re-enter rather
		// than restarting the server in a loop.
		if (this._applyingCredentialChange) { return; }
		this._applyingCredentialChange = true;
		try {
			await this._doApplyCredentialChange();
		} finally {
			this._applyingCredentialChange = false;
		}
	}

	private async _doApplyCredentialChange(): Promise<void> {
		// Re-rendering resets scroll to the top, which is jarring when the user
		// is part-way down a long provider list.
		const scroller = this._container?.closest('.sidex-settings-content') as HTMLElement | null;
		const scrollTop = scroller?.scrollTop ?? 0;

		try {
			await restartServer();
		} catch { /* the chat panel surfaces the disconnected state on its own */ }
		await this._refreshProviderStatus();
		if (this._customProvidersContainer) { this._renderCustomProvidersSection(this._customProvidersContainer); }
		if (this._apiKeysContainer) { this._renderApiKeysSection(this._apiKeysContainer); }
		if (this._discoveryContainer) { await this._renderDiscoverySection(this._discoveryContainer); }

		if (scroller) { scroller.scrollTop = scrollTop; }
	}

	private async _setProviderEnabled(provider: string, enabled: boolean): Promise<void> {
		if (!this._invoke) { return; }
		try {
			await this._invoke('providers_set_enabled', { provider, enabled });
			if (enabled) {
				// Best-effort, same as on account connect: the toggle flipping on
				// is the part that must not fail here, so a model-listing hiccup
				// (not reachable yet, nothing exposed) is swallowed rather than
				// reported as "failed to enable". The card's own Import models
				// action covers retrying it.
				try { await this._adoptModelsFrom(provider); } catch { /* see above */ }
			}
			await this._applyCredentialChange();
		} catch (e) { console.error(`Failed to ${enabled ? 'enable' : 'disable'} ${provider}:`, e); }
	}

	/**
	 * Pull in the models a newly-usable provider actually offers.
	 *
	 * Without this the user connects an account and still faces an empty model
	 * list. Only models we don't already know about are added, and they are
	 * enabled so the provider is usable straight away.
	 *
	 * Listing can fail for a subscription login even when chat will work
	 * (or the other way around). Fall back to the known-good ids for that
	 * provider so Connect still leaves the picker usable.
	 */
	private static readonly FALLBACK_ACCOUNT_MODELS: Record<string, ProviderModel[]> = {
		anthropic: [
			{ id: 'anthropic/claude-sonnet-4.6', name: 'Claude Sonnet 4.6' },
			{ id: 'anthropic/claude-opus-4.6', name: 'Claude Opus 4.6' },
			{ id: 'anthropic/claude-haiku-4.5', name: 'Claude Haiku 4.5' },
		],
		openai: [
			{ id: 'openai/gpt-5.6-terra', name: 'GPT-5.6 Terra' },
			{ id: 'openai/gpt-5.5', name: 'GPT-5.5' },
			{ id: 'openai/gpt-5.4-mini', name: 'GPT-5.4 mini' },
		],
	};

	private async _adoptModelsFrom(provider: string): Promise<number> {
		if (!this._invoke) { return 0; }
		let models: ProviderModel[] = [];
		try {
			models = (await this._invoke('providers_list_models', { provider }) as ProviderModel[]) || [];
		} catch {
			models = [];
		}
		if (models.length === 0) {
			models = ModelsSection.FALLBACK_ACCOUNT_MODELS[provider] ?? [];
		}
		// Record names even for models already known, so a stale entry added by
		// hand picks up its proper label.
		for (const m of models) {
			if (m?.id && m.name) { this._modelNames.set(m.id, m.name); }
		}
		const added = models.map(m => m?.id).filter((id): id is string => !!id && !this._customModels.includes(id));
		if (added.length === 0) { return 0; }

		this._customModels.push(...added);
		for (const id of added) { this._enabledIds.add(id); }
		await this._saveCustomModels();
		await this._saveEnabledModels();
		if (this._enabledListContainer) { this._renderEnabledModels(this._enabledListContainer); }
		return added.length;
	}

	private async _deleteProviderKey(provider: string): Promise<void> {
		if (!this._invoke) { return; }
		try {
			await this._invoke('providers_delete', { provider });
			await this._applyCredentialChange();
		} catch (e) { console.error(`Failed to delete key for ${provider}:`, e); }
	}

	private async _saveCustomModels(): Promise<void> {
		if (!this._invoke) { return; }
		const value = this._customModels.map(id => {
			const name = this._modelNames.get(id);
			return name ? { id, name } : id;
		});
		await this._invoke('settings_update', { key: 'sidex.models.custom', value, scope: 'user' });
	}

	private async _saveEnabledModels(): Promise<void> {
		if (!this._invoke) { return; }
		try {
			// Store as a real JSON array (not a stringified string) so every
			// reader — Rust models_get_enabled, the chat service, this panel —
			// sees the same type.
			await this._invoke('settings_update', { key: 'sidex.models.enabled', value: [...this._enabledIds], scope: 'user' });
			// Tell the chat service to re-filter its model list immediately
			window.dispatchEvent(new CustomEvent('sidex-models-changed'));
		} catch (e) { console.error('Failed to save enabled models:', e); }
	}

	private async _addCustomModel(id: string): Promise<void> {
		if (!this._invoke) { return; }
		if (!this._customModels.includes(id)) { this._customModels.push(id); }
		this._enabledIds.add(id);
		this._addingCustom = false;
		this._addModelProvider = '';
		try {
			await this._saveCustomModels();
			await this._saveEnabledModels();
		} catch (e) { console.error('Failed to add custom model:', e); }

		if (this._enabledListContainer) { this._renderEnabledModels(this._enabledListContainer); }
		this._updateCustomRow();
	}

	private async _removeCustomModel(id: string): Promise<void> {
		if (!this._invoke) { return; }
		this._customModels = this._customModels.filter(m => m !== id);
		this._enabledIds.delete(id);
		try {
			await this._saveCustomModels();
			await this._saveEnabledModels();
		} catch (e) { console.error('Failed to remove custom model:', e); }

		if (this._enabledListContainer) { this._renderEnabledModels(this._enabledListContainer); }
	}

	dispose(): void {
		this._container = null;
		this._customProvidersContainer = null;
	}
}
