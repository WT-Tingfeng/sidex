type Translations = Record<string, string>;

const sidexTranslations: Record<string, Translations> = {
	'zh-cn': {
		'remote.pick.placeholder': '选择一个选项来打开远程窗口',
		'remote.pick.connectToTunnel': '连接到隧道…',
		'remote.pick.tunnelsProvider': '远程隧道',
		'remote.pick.connectToHost': '连接到主机…',
		'remote.pick.sshProvider': '远程 SSH',
		'remote.pick.wsl': '连接到 WSL…',
		'remote.pick.wslProvider': '远程 WSL',
		'remote.pick.container': '在容器中打开文件夹…',
		'remote.pick.containerProvider': '开发容器',
		'remote.pick.codespace': '连接到 Codespace…',
		'remote.pick.codespaceProvider': 'GitHub Codespaces',
		'remote.codespace.tokenPrompt': '具有 codespace 范围的 GitHub 个人访问令牌',
		'remote.codespace.none': '未找到此帐户的 Codespace。',
		'remote.codespace.pick': '选择一个 Codespace',
		'remote.codespace.connected': '已连接到 Codespace: {0}',
		'remote.codespace.failed': 'Codespace 连接失败: {0}',
		'explorerViewlet.cloneRepository': '你可以在本地克隆一个仓库。\n{0}',
		remoteExplorer: '远程资源管理器',
		remoteExplorerViewIcon: '远程资源管理器视图图标。',
		'sidex.remote.refresh': '刷新远程资源管理器',
		'sidex.remote.openExplorer': '远程资源管理器',
		'remote.signInMicrosoft': '使用 Microsoft 登录',
		'remote.signInGitHub': '使用 GitHub 登录',
		'remote.ssh.noHosts': '未在 ~/.ssh/config 中找到 SSH 目标',
		'remote.ssh.empty': '~/.ssh/config 中没有 SSH 目标 — 在下方添加',
		'remote.codespaces.empty': '未找到 Codespace',
		'remote.containers.noContainers': '未找到运行中的容器',
		'remote.section.tunnels': '隧道',
		'remote.section.ssh': 'SSH',
		'remote.section.codespaces': 'GitHub Codespaces',
		'remote.section.containers': '开发容器',
		'remote.signIn': '登录',
		'remote.connect': '连接',
		'remote.tunnels': '隧道',
		'remote.ssh': 'SSH',
		'remote.codespaces': 'GitHub Codespaces',
		'remote.containers': '开发容器',
		'remote.wsl': 'WSL 目标',
		'remote.codespaces.signIn': '使用 GitHub 登录以查看你的 Codespace'
	},
	ja: {
		'remote.pick.placeholder': 'リモートウィンドウを開くオプションを選択',
		'remote.pick.connectToTunnel': 'トンネルに接続…',
		'remote.pick.connectToHost': 'ホストに接続…',
		'remote.pick.wsl': 'WSL に接続…',
		'remote.pick.container': 'コンテナーでフォルダーを開く…',
		'remote.pick.codespace': 'Codespace に接続…',
		remoteExplorer: 'リモート エクスプローラー'
	},
	ko: {
		'remote.pick.placeholder': '원격 창을 여는 옵션 선택',
		'remote.pick.connectToTunnel': '터널에 연결…',
		'remote.pick.connectToHost': '호스트에 연결…',
		'remote.pick.wsl': 'WSL에 연결…',
		'remote.pick.container': '컨테이너에서 폴더 열기…',
		'remote.pick.codespace': 'Codespace에 연결…',
		remoteExplorer: '원격 탐색기'
	}
};
// ─── Startup-safe translation loading ───────────────────────────────────────
// loadNlsMessages() runs before any VS Code module is imported (localize() is
// evaluated at module top-level), so it must never be able to hang the boot.
// Disk lookups go through the Rust extension manager (platform-correct user
// extensions dir); the marketplace/open-vsx fallbacks are hard-bounded so a
// blocked host degrades to an English launch instead of a frozen splash.

/** Timeout for one marketplace/open-vsx metadata request. */
const NLS_FETCH_TIMEOUT_MS = 600;
/** Timeout for one translation-bundle download. */
const NLS_BUNDLE_TIMEOUT_MS = 800;
/** Hard cap for the whole gallery fallback (metadata + bundle). */
const NLS_GALLERY_BUDGET_MS = 1600;
/** Timeout for the local nls.messages.json index (embedded asset). */
const NLS_INDEX_TIMEOUT_MS = 1200;

type TauriInvokeFn = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

async function getTauriInvoke(): Promise<TauriInvokeFn | null> {
	try {
		const { invoke } = await import('@tauri-apps/api/core');
		return invoke as TauriInvokeFn;
	} catch {
		return null;
	}
}

/** fetch() bounded by a timeout; rejects with an AbortError on expiry. */
async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
	try {
		return await fetch(url, { signal: controller.signal });
	} finally {
		clearTimeout(timer);
	}
}

/**
 * extensionId (lowercased) -> real on-disk extension directory, resolved once
 * per launch through the Rust extension manager. The legacy
 * ~/.sidex/extensions location is only a fallback for pre-0.1.5 installs.
 */
let installedExtensionDirsPromise: Promise<Map<string, string>> | undefined;

function getInstalledExtensionDirs(): Promise<Map<string, string>> {
	if (!installedExtensionDirsPromise) {
		installedExtensionDirsPromise = (async () => {
			const dirs = new Map<string, string>();
			try {
				const invoke = await getTauriInvoke();
				if (!invoke) {
					return dirs;
				}
				const installed = (await invoke('list_installed_extensions')) as
					| Array<{ id?: string; path?: string }>
					| null;
				for (const entry of installed ?? []) {
					if (entry?.id && entry?.path) {
						dirs.set(entry.id.toLowerCase(), entry.path);
					}
				}
			} catch {
				/* extension manager unavailable — callers fall back to legacy paths */
			}
			return dirs;
		})();
	}
	return installedExtensionDirsPromise;
}

async function getHomeDir(invoke: TauriInvokeFn | null): Promise<string | null> {
	if (!invoke) {
		return null;
	}
	return (
		((await invoke('get_env', { key: 'HOME' }).catch(() => null)) as string | null) ??
		((await invoke('get_env', { key: 'USERPROFILE' }).catch(() => null)) as string | null)
	);
}

/** Resolve an extension directory: Rust extension manager first, legacy layout second. */
async function resolveExtensionDir(extensionId: string): Promise<string | null> {
	const dirs = await getInstalledExtensionDirs();
	const fromManager = dirs.get(extensionId.toLowerCase());
	if (fromManager) {
		return fromManager;
	}
	const homedir = await getHomeDir(await getTauriInvoke());
	return homedir ? `${homedir}/.sidex/extensions/${extensionId}` : null;
}

export async function loadNlsMessages(): Promise<void> {
	const locale = localStorage.getItem('vscode.nls.locale');
	console.log('[SideX NLS] locale from localStorage:', locale);

	if (!locale || locale.toLowerCase().startsWith('en')) {
		return;
	}

	let extensionId = localStorage.getItem('vscode.nls.languagePackExtensionId');
	console.log('[SideX NLS] extensionId from localStorage:', extensionId);

	if (!extensionId) {
		extensionId = await detectInstalledLanguagePack(locale);
		if (extensionId) {
			localStorage.setItem('vscode.nls.languagePackExtensionId', extensionId);
			console.log('[SideX NLS] auto-detected language pack:', extensionId);
		}
	}

	try {
		// Prefer translations bundled with the app: they were built against this
		// fork's module paths, unlike a user-installed pack from another VS Code
		// version (a 1.131 pack cannot match a 1.110 fork). Falls back to the
		// installed pack, then the gallery.
		const bundled = await loadBundledTranslations(locale);
		const translations = bundled
			?? (extensionId ? ((await loadFromDisk(extensionId)) ?? (await loadFromGallery(extensionId))) : null);

		if (!translations) {
			console.warn('[SideX NLS] No translations found for locale:', locale);
			return;
		}

		// Merge SideX-specific translations for strings not in the VS Code language pack
		const sidexExtra = sidexTranslations[locale.toLowerCase()];
		if (sidexExtra) {
			for (const [key, val] of Object.entries(sidexExtra)) {
				if (!(key in translations)) {
					translations[key] = val;
				}
			}
		}

		// Local embedded index; bounded too so a broken asset protocol can never
		// stall the boot. On failure we fall through to key-based lookup.
		const indexRes = await fetchWithTimeout('/nls.messages.json', NLS_INDEX_TIMEOUT_MS).catch(() => null);
		if (indexRes?.ok) {
			const contentType = indexRes.headers.get('content-type') ?? '';
			if (contentType.includes('json')) {
				const nlsEntries: Array<{ key: string; msg: string }> = await indexRes.json();
				if (nlsEntries.length > 0) {
					(globalThis as any)._VSCODE_NLS_MESSAGES = nlsEntries.map(({ key, msg }) => {
						const shortKey = key.slice(key.lastIndexOf('/') + 1);
						return translations[key] ?? translations[shortKey] ?? msg;
					});
					(globalThis as any)._VSCODE_NLS_LANGUAGE = locale;
					console.log(`[SideX NLS] Loaded ${nlsEntries.length} translations for ${locale} (indexed mode)`);
					return;
				}
			}
		}

		(globalThis as any)._VSCODE_NLS_TRANSLATIONS = translations;
		(globalThis as any)._VSCODE_NLS_LANGUAGE = locale;
		console.log(`[SideX NLS] Loaded ${Object.keys(translations).length} translations for ${locale} (key mode)`);
	} catch (e) {
		console.warn('[SideX NLS] Failed to load translations:', e);
	}
}

async function loadFromDisk(extensionId: string): Promise<Translations | null> {
	try {
		const invoke = await getTauriInvoke();
		if (!invoke) {
			return null;
		}

		// Real, platform-correct extension directory (was hardcoded to
		// ~/.sidex/extensions, which never matched %APPDATA%\SideX\extensions
		// on Windows and forced a network round-trip on every launch).
		const extensionDir = await resolveExtensionDir(extensionId);
		if (!extensionDir) {
			return null;
		}

		const path = `${extensionDir}/translations/main.i18n.json`;
		const raw = (await invoke('read_file', { path })) as string;
		const result = parseBundle(raw);
		if (result) {
			console.log(`[SideX NLS] Loaded translations from disk: ${path}`);
		}
		return result;
	} catch {
		return null;
	}
}

async function loadFromGallery(extensionId: string): Promise<Translations | null> {
	const [publisher, name] = extensionId.split('.');
	if (!publisher || !name) {
		return null;
	}

	// Every request is bounded and the whole fallback is capped: a blackholed
	// marketplace/open-vsx connection must degrade to an English launch, not
	// hold the splash screen hostage.
	const deadline = Date.now() + NLS_GALLERY_BUDGET_MS;
	const remaining = (cap: number) => Math.max(1, Math.min(cap, deadline - Date.now()));
	const urls = [
		`https://marketplace.siden.ai/api/gallery/publishers/${publisher}/vsextensions/${name}/latest/vspackage`,
		`https://open-vsx.org/api/${publisher}/${name}/latest`
	];

	for (const metaUrl of urls) {
		if (Date.now() >= deadline) {
			break;
		}
		try {
			const metaRes = await fetchWithTimeout(metaUrl, remaining(NLS_FETCH_TIMEOUT_MS));
			const meta = metaRes.ok ? ((await metaRes.json()) as { version?: string } | null) : null;
			if (!meta?.version) {
				continue;
			}
			if (Date.now() >= deadline) {
				break;
			}
			const translationUrl = `https://open-vsx.org/vscode/unpkg/${publisher}/${name}/${meta.version}/extension/translations/main.i18n.json`;
			const res = await fetchWithTimeout(translationUrl, remaining(NLS_BUNDLE_TIMEOUT_MS));
			if (res.ok) {
				const result = parseBundle(await res.text());
				if (result) {
					console.log('[SideX NLS] Loaded translations from gallery');
					return result;
				}
			}
		} catch {
			// Timeout / offline / blocked: try the next source, then go English.
			continue;
		}
	}
	console.warn('[SideX NLS] Language pack could not be fetched in time; continuing in English');
	return null;
}

function parseBundle(raw: string): Translations | null {
	try {
		const parsed = JSON.parse(raw) as { contents?: unknown } | null;
		const contents = parsed && typeof parsed === 'object' && parsed.contents ? parsed.contents : parsed;
		if (!contents || typeof contents !== 'object') {
			return null;
		}
		// Language pack layout: contents[modulePath][shortKey] = translation.
		// The nls index keys entries as "modulePath/shortKey", so keep the
		// module path in the flattened key.
		const messages: Translations = {};
		for (const [moduleId, entries] of Object.entries(contents as Record<string, unknown>)) {
			if (!moduleId || !entries || typeof entries !== 'object' || Array.isArray(entries)) {
				continue;
			}
			for (const [key, value] of Object.entries(entries as Record<string, unknown>)) {
				if (typeof value === 'string') {
					messages[moduleId + '/' + key] = value;
				}
			}
		}
		return Object.keys(messages).length > 0 ? messages : null;
	} catch {
		return null;
	}
}

/** Translations bundled with the app (public/nls.<locale>.json), if present. */
async function loadBundledTranslations(locale: string): Promise<Translations | null> {
	try {
		const res = await fetchWithTimeout('/nls.' + locale.toLowerCase() + '.json', NLS_INDEX_TIMEOUT_MS);
		if (!res.ok) {
			return null;
		}
		const result = parseBundle(await res.text());
		if (result) {
			console.log('[SideX NLS] Loaded bundled translations for', locale);
		}
		return result;
	} catch {
		return null;
	}
}

const localeToPackName: Record<string, string> = {
	'zh-cn': 'MS-CEINTL.vscode-language-pack-zh-hans',
	'zh-tw': 'MS-CEINTL.vscode-language-pack-zh-hant',
	ja: 'MS-CEINTL.vscode-language-pack-ja',
	ko: 'MS-CEINTL.vscode-language-pack-ko',
	de: 'MS-CEINTL.vscode-language-pack-de',
	fr: 'MS-CEINTL.vscode-language-pack-fr',
	es: 'MS-CEINTL.vscode-language-pack-es',
	it: 'MS-CEINTL.vscode-language-pack-it',
	'pt-br': 'MS-CEINTL.vscode-language-pack-pt-BR',
	ru: 'MS-CEINTL.vscode-language-pack-ru',
	tr: 'MS-CEINTL.vscode-language-pack-tr',
	pl: 'MS-CEINTL.vscode-language-pack-pl',
	cs: 'MS-CEINTL.vscode-language-pack-cs',
	hu: 'MS-CEINTL.vscode-language-pack-hu'
};

async function detectInstalledLanguagePack(locale: string): Promise<string | null> {
	const knownId = localeToPackName[locale.toLowerCase()];
	if (!knownId) {
		return null;
	}
	try {
		// Ask the Rust extension manager where installed extensions really live
		// (Windows: %APPDATA%\SideX\extensions, etc.) instead of assuming the
		// legacy ~/.sidex/extensions layout.
		const dirs = await getInstalledExtensionDirs();
		if (dirs.has(knownId.toLowerCase())) {
			return knownId;
		}

		// Legacy fallback for pre-0.1.5 installs that kept extensions in ~/.sidex.
		const invoke = await getTauriInvoke();
		const homedir = await getHomeDir(invoke);
		if (!invoke || !homedir) {
			return null;
		}
		const path = `${homedir}/.sidex/extensions/${knownId}/translations/main.i18n.json`;
		if ((await invoke('read_file', { path }).catch(() => null)) !== null) {
			return knownId;
		}
		return null;
	} catch {
		return null;
	}
}
