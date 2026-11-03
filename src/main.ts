/*---------------------------------------------------------------------------------------------
 *  SideX — Tauri-based VSCode port
 *  Entry point. Globals set by inline script in index.html.
 *--------------------------------------------------------------------------------------------*/

import { loadNlsMessages } from './nls-loader.js';

const SPLASH_ID = 'sidex-splash';
// Keep in sync with the #sidex-splash transition in index.html. Short enough
// that the fade does not add a visible delay once the workbench has mounted.
const SPLASH_FADE_MS = 120;
const SPLASH_FADE_CLEANUP_MS = 60;
const SPLASH_SAFETY_TIMEOUT_MS = 15_000;

let splashRemoved = false;

// ─── OS-opened files bridge (Rust -> workbench) ─────────────────────────────
// The Rust side buffers paths passed on the command line (file associations,
// "Open with", second-instance launches) and emits them through this event
// while the app is running. Paths that arrived before this script ran are
// drained once via `open_paths_take`.
const OPEN_FILE_EVENT = 'sidex://open-file';
const OPEN_PATHS_TAKE_COMMAND = 'open_paths_take';
const OPEN_PATHS_DELIVERY_EVENT = 'sidex-open-paths';
const OPEN_PATHS_RETRY_INTERVAL_MS = 100;
const OPEN_PATHS_RETRY_TIMEOUT_MS = 15_000;

/** Paths waiting for the workbench, in arrival order. */
const pendingOpenPaths: string[] = [];
const seenOpenPaths = new Set<string>();
let openPathsRetryTimer: ReturnType<typeof setTimeout> | null = null;
let openPathsRetryStartedAt = 0;

/**
 * Fade out the inline startup splash (index.html) and drop it from the DOM.
 * Idempotent: safe to call from the ready path, the failure path and the
 * safety timeout below.
 */
function removeSplash() {
	if (splashRemoved) {
		return;
	}
	splashRemoved = true;

	const splash = document.getElementById(SPLASH_ID);
	if (!splash) {
		return;
	}

	splash.classList.add('sidex-splash-hiding');
	window.setTimeout(() => splash.remove(), SPLASH_FADE_MS + SPLASH_FADE_CLEANUP_MS);
}

/**
 * Show the native window once the splash has had a chance to paint. The window
 * is configured `visible: false`, so this is what puts it on screen; failures
 * (e.g. a missing capability) are non-fatal because the Rust setup also shows
 * the window.
 */
function showNativeWindowAfterFirstPaint() {
	requestAnimationFrame(() => {
		import('@tauri-apps/api/window').then(({ getCurrentWindow }) => getCurrentWindow().show()).catch(() => {});
	});
}

/**
 * Resolve once `create()` has mounted the workbench root (`.monaco-workbench`).
 * `create()` returns synchronously and the workbench is appended by its async
 * startup, so observe the DOM instead of awaiting the call.
 */
function whenWorkbenchMounted(): Promise<void> {
	if (document.querySelector('.monaco-workbench')) {
		return Promise.resolve();
	}

	return new Promise<void>(resolve => {
		const observer = new MutationObserver(() => {
			if (document.querySelector('.monaco-workbench')) {
				observer.disconnect();
				resolve();
			}
		});
		observer.observe(document.body, { childList: true, subtree: true });
	});
}

/** Accept `{ paths: string[] }` (Tauri payload), a bare string[] or a single string. */
function normalizeOpenPaths(payload: unknown): string[] {
	let value: unknown = payload;
	if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
		value = (value as { paths?: unknown }).paths;
	}
	if (typeof value === 'string') {
		return value.length > 0 ? [value] : [];
	}
	if (!Array.isArray(value)) {
		return [];
	}
	return value.filter((path): path is string => typeof path === 'string' && path.length > 0);
}

/** Queue de-duplicated paths and try to hand them to the workbench. */
function queueOpenPaths(payload: unknown): void {
	const paths = normalizeOpenPaths(payload);
	let queued = false;
	for (const path of paths) {
		if (!seenOpenPaths.has(path)) {
			seenOpenPaths.add(path);
			pendingOpenPaths.push(path);
			queued = true;
		}
	}
	if (queued && !deliverOpenPaths()) {
		startOpenPathsDeliveryRetry();
	}
}

/**
 * Hand the queued paths to the workbench. Returns `true` when the queue was
 * delivered (or is empty) and `false` while the workbench is not ready yet.
 * Never throws: a failing handler must not break boot().
 */
function deliverOpenPaths(): boolean {
	if (pendingOpenPaths.length === 0) {
		return true;
	}
	const host = globalThis as {
		__sidex_openPaths?: (paths: string[]) => unknown;
		__sidex_editorService?: unknown;
	};
	// Both signals are published by web.main.ts once the workbench is created.
	if (!document.querySelector('.monaco-workbench') || (!host.__sidex_openPaths && !host.__sidex_editorService)) {
		return false;
	}
	const paths = pendingOpenPaths.slice();
	try {
		if (typeof host.__sidex_openPaths === 'function') {
			Promise.resolve(host.__sidex_openPaths(paths)).catch(error =>
				console.error('[SideX] Failed to open paths:', error)
			);
		} else {
			window.dispatchEvent(new CustomEvent(OPEN_PATHS_DELIVERY_EVENT, { detail: { paths } }));
		}
	} catch (error) {
		console.error('[SideX] Failed to deliver open paths:', error);
		return false;
	}
	pendingOpenPaths.length = 0;
	// The de-dupe set only guards the pending queue (startup drain + early event
	// can report the same path); clearing it lets the same file be opened again
	// later, e.g. from the OS after the user closed its tab.
	seenOpenPaths.clear();
	return true;
}

/** Poll (bounded) until the workbench can accept the queued paths. */
function startOpenPathsDeliveryRetry(): void {
	if (openPathsRetryTimer !== null) {
		return;
	}
	openPathsRetryStartedAt = Date.now();
	const retry = () => {
		openPathsRetryTimer = null;
		if (deliverOpenPaths()) {
			return;
		}
		if (Date.now() - openPathsRetryStartedAt >= OPEN_PATHS_RETRY_TIMEOUT_MS) {
			// Keep the queue: a later open-file event re-arms delivery.
			console.warn('[SideX] Workbench not ready; ' + pendingOpenPaths.length + ' path(s) still queued');
			return;
		}
		openPathsRetryTimer = setTimeout(retry, OPEN_PATHS_RETRY_INTERVAL_MS);
	};
	openPathsRetryTimer = setTimeout(retry, 0);
}

/**
 * SideX: forward OS-opened files from the Rust side to the workbench.
 * Registration is best-effort and dependency-free: `@tauri-apps/api` is already
 * a dependency and is imported lazily so a plain browser build still boots.
 */
function setupOpenFileBridge(): void {
	import('@tauri-apps/api/event')
		.then(({ listen }) => listen(OPEN_FILE_EVENT, event => queueOpenPaths(event?.payload)))
		.catch(error => console.warn('[SideX] Open-file event bridge unavailable:', error));

	import('@tauri-apps/api/core')
		.then(({ invoke }) => invoke(OPEN_PATHS_TAKE_COMMAND))
		.then(paths => queueOpenPaths(paths))
		.catch(error => console.warn('[SideX] "open_paths_take" unavailable:', error));
}

async function sidexOpenFolder() {
	try {
		const { open } = await import('@tauri-apps/plugin-dialog');
		const { URI } = await import('./vs/base/common/uri.js');
		const selected = await open({ directory: true, multiple: false });
		if (selected && typeof selected === 'string') {
			navigateToFolder(URI.file(selected).toString());
		}
	} catch (e) {
		console.error('[SideX] Failed to open folder picker:', e);
	}
}
(window as any).__sidex_openFolder = sidexOpenFolder;

function navigateToFolder(folderUri: string) {
	const url = new URL(window.location.href);
	url.searchParams.set('folder', folderUri);
	window.location.href = url.toString();
}

async function boot() {
	// The splash is already painted by index.html; show the native window as
	// soon as possible and never let the splash outlive startup.
	showNativeWindowAfterFirstPaint();
	window.setTimeout(removeSplash, SPLASH_SAFETY_TIMEOUT_MS);

	// SideX: start forwarding OS-opened paths as early as possible; delivery to
	// the workbench is deferred until it is mounted and its services are ready.
	setupOpenFileBridge();

	// Load locale translations before any VS Code module imports
	await loadNlsMessages();

	await Promise.all([
		import('./vs/workbench/workbench.common.main.js').catch(e => {
			console.error('[SideX] Barrel "common" failed:', e);
			throw e;
		}),
		import('./vs/workbench/browser/web.main.js').catch(e => {
			console.error('[SideX] Barrel "web.main" failed:', e);
			throw e;
		}),
		import('./vs/workbench/browser/parts/dialogs/dialog.web.contribution.js').catch(e => {
			console.error('[SideX] Barrel "web-dialog" failed:', e);
			throw e;
		}),
		import('./vs/workbench/workbench.web.main.js').catch(e => {
			console.error('[SideX] Barrel "web-services" failed:', e);
			throw e;
		})
	]);

	// SideX Rust bridge initialization — make services available before workbench creation
	if ((globalThis as any).__SIDEX_TAURI__) {
		const {
			SideXEditorBridge,
			SideXSyntaxService,
			SideXGitService,
			SideXSearchService,
			SideXSettingsService,
			SideXThemeService,
			SideXExtensionService,
			SideXKeymapService,
			SideXFileSystemProvider
		} = await import('./vs/platform/sidex/common/sidexServices.js');

		(globalThis as any).__SIDEX_SERVICES__ = {
			editor: SideXEditorBridge.getInstance(),
			syntax: new SideXSyntaxService(),
			git: new SideXGitService(),
			search: new SideXSearchService(),
			settings: new SideXSettingsService(),
			theme: new SideXThemeService(),
			extensions: new SideXExtensionService(),
			keymap: new SideXKeymapService(),
			fileSystem: new SideXFileSystemProvider()
		};

		console.log('[SideX] Rust bridge services initialized');
	}

	const { create } = await import('./vs/workbench/browser/web.factory.js');
	const { URI } = await import('./vs/base/common/uri.js');

	if (document.readyState === 'loading') {
		await new Promise<void>(r => window.addEventListener('DOMContentLoaded', () => r()));
	}

	const urlParams = new URLSearchParams(window.location.search);
	const folderParam = urlParams.get('folder');

	let workspace: any = undefined;
	if (folderParam) {
		const parsed = URI.parse(folderParam);
		if (parsed.scheme === 'file' || parsed.scheme === 'vscode-remote' || parsed.scheme === 'vscode-vfs') {
			workspace = { folderUri: parsed };
		}
	}

	const options: any = {
		initialColorTheme: {
			themeType: 'dark'
		},

		additionalTrustedDomains: ['https://github.com', 'https://*.github.com', 'https://*.githubusercontent.com'],

		// The workspace provider tells VSCode what folder/workspace to open
		workspaceProvider: {
			workspace,
			trusted: true,
			open: async (_workspace: any, _options: any) => {
				// When VSCode asks to open a new workspace, reload with the folder param
				if (_workspace && 'folderUri' in _workspace) {
					navigateToFolder(_workspace.folderUri.toString());
				}
				return true;
			}
		},
		windowIndicator: {
			label: folderParam ? decodeURIComponent(folderParam.split('/').pop() || 'SideX') : 'SideX',
			tooltip: 'SideX — Tauri Code Editor',
			command: undefined
		},
		productConfiguration: {
			nameShort: 'SideX',
			nameLong: 'SideX',
			applicationName: 'sidex',
			dataFolderName: '.sidex',
			version: '1.110.0',
			linkProtectionTrustedDomains: ['https://github.com', 'https://*.github.com', 'https://*.githubusercontent.com']
		},
		settingsSyncOptions: {
			enabled: false
		},
		additionalBuiltinExtensions: [],
		configurationDefaults: {
			'workbench.startupEditor': 'welcomePage',
			'workbench.enableExperiments': false,
			'workbench.iconTheme': 'vs-seti',
			'workbench.colorTheme': 'Dark Modern',
			'editor.experimentalGpuAcceleration': 'auto',
			'workbench.productIconTheme': 'Default',
			'workbench.editor.showTabs': 'multiple',
			'workbench.editor.enablePreview': false,
			'workbench.editor.tabCloseButton': 'right',
			'window.menuBarVisibility': navigator.userAgent.includes('Mac') ? 'hidden' : 'classic',
			'window.titleBarStyle': 'custom',
			'window.commandCenter': true,
			'scm.defaultViewMode': 'list',
			'telemetry.telemetryLevel': 'off',
			'update.mode': 'none',
			'update.showReleaseNotes': false,
			'extensions.autoUpdate': false,
			'extensions.autoCheckUpdates': false,
			'extensions.autoRestart': true,
			'workbench.settings.enableNaturalLanguageSearch': false,
			'chat.editor.enabled': false,
			'chat.commandCenter.enabled': false,
			'editor.bracketPairColorization.enabled': true,
			'editor.guides.bracketPairs': true,
			'editor.linkedEditing': true,
			'editor.suggest.showStatusBar': true,
			'editor.inlineSuggest.enabled': true,
			'editor.stickyScroll.enabled': true,
			'editor.minimap.enabled': false,
			'terminal.integrated.defaultProfile.osx': 'zsh',
			'terminal.integrated.defaultProfile.linux': 'bash',
			'terminal.integrated.profiles.osx': {
				zsh: { path: 'zsh', args: ['-l'] },
				bash: { path: 'bash', args: ['-l'], icon: 'terminal-bash' },
				fish: { path: 'fish', args: ['-l'] },
				tmux: { path: 'tmux', icon: 'terminal-tmux' },
				pwsh: { path: 'pwsh', icon: 'terminal-powershell' }
			},
			'terminal.integrated.profiles.linux': {
				bash: { path: 'bash', args: ['-l'], icon: 'terminal-bash' },
				zsh: { path: 'zsh', args: ['-l'] },
				fish: { path: 'fish', args: ['-l'] },
				tmux: { path: 'tmux', icon: 'terminal-tmux' },
				pwsh: { path: 'pwsh', icon: 'terminal-powershell' }
			},
			'terminal.integrated.enablePersistentSessions': false,
			'editor.formatOnPaste': false,
			'editor.renderWhitespace': 'selection',
			'editor.smoothScrolling': false,
			'editor.cursorBlinking': 'smooth',
			'editor.cursorSmoothCaretAnimation': 'off',
			'editor.mouseWheelZoom': true,
			'editor.wordWrap': 'off',
			'editor.suggest.preview': true,
			'editor.parameterHints.enabled': true,
			'editor.hover.enabled': true,
			'editor.folding': true,
			'editor.foldingImportsByDefault': true,
			'editor.showFoldingControls': 'mouseover',
			'editor.glyphMargin': true,
			'editor.lightbulb.enabled': 'on',
			'editor.colorDecorators': true,
			'editor.renderLineHighlight': 'all',
			'editor.matchBrackets': 'always',
			'editor.occurrencesHighlight': 'singleFile',
			'workbench.editor.highlightModifiedTabs': true,
			'workbench.tree.renderIndentGuides': 'always',
			'security.workspace.trust.startupPrompt': 'never',
			'security.workspace.trust.banner': 'never',
			'security.workspace.trust.enabled': false
		}
	};

	const workbenchContainer = document.getElementById('workbench');
	if (workbenchContainer) {
		create(workbenchContainer, options);
	} else {
		create(document.body, options);
	}

	// Drop the splash once the workbench root is mounted, one animation frame
	// later so the first workbench frame is painted before it fades out.
	whenWorkbenchMounted()
		.then(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())))
		.then(removeSplash)
		.catch(err => {
			console.error('[SideX] Waiting for workbench mount failed:', err);
			removeSplash();
		});

	setupTauriExternalOpener();
	setupMenuActions();
	setupWindowStateSave();
	setupNativeWindowDragging();
	setupWindowsEditorNewlineKeybindings();
	updateNativeMenuLabels();

	console.log(
		'[SideX] Workbench created' + (folderParam ? ` (folder: ${folderParam})` : ' (no folder)'),
		'workspace:',
		workspace
	);
}

function setupTauriExternalOpener() {
	import('@tauri-apps/plugin-shell')
		.then(shell => {
			(window as any).__sidex_shellOpen = (url: string) => {
				shell.open(url).catch(() => {});
			};
		})
		.catch(() => {});
}

function setupWindowStateSave() {
	import('@tauri-apps/api/core')
		.then(({ invoke }) => {
			let saveTimer: ReturnType<typeof setTimeout> | null = null;
			const debouncedSave = () => {
				if (saveTimer) {
					clearTimeout(saveTimer);
				}
				saveTimer = setTimeout(() => {
					invoke('save_window_state', { label: 'main' }).catch(() => {});
				}, 500);
			};

			window.addEventListener('resize', debouncedSave);
			window.addEventListener('beforeunload', () => {
				invoke('save_window_state', { label: 'main' }).catch(() => {});
			});
		})
		.catch(() => {});
}

const TITLEBAR_NO_DRAG_SELECTOR =
	'a, button, input, select, textarea, [contenteditable="true"], [draggable="true"], ' +
	'.action-item, .command-center, .window-controls-container, .window-icon, ' +
	'.menubar, .monaco-menu, .monaco-action-bar, .window-title, .action-toolbar-container, ' +
	'.center-adjacent-toolbar-container, .tabs-container, .tab, .monaco-list, .pane-header, ' +
	'.composite.title, .split-view-view, .editor-group-container';

function setupNativeWindowDragging() {
	let appWindow: { startDragging(): Promise<void> } | null = null;
	import('@tauri-apps/api/window')
		.then(mod => {
			appWindow = mod.getCurrentWindow();
		})
		.catch(() => {});

	document.addEventListener('mousedown', (e: MouseEvent) => {
		if (e.button !== 0 || e.defaultPrevented || !appWindow) {
			return;
		}
		const target = e.target as HTMLElement | null;
		if (!target?.closest('.part.titlebar')) {
			return;
		}
		if (target.closest(TITLEBAR_NO_DRAG_SELECTOR)) {
			return;
		}
		appWindow.startDragging().catch(() => {});
	});
}

function setupWindowsEditorNewlineKeybindings() {
	if (!navigator.userAgent.includes('Windows')) {
		return;
	}

	window.addEventListener('keydown', event => {
		if (event.defaultPrevented || event.key !== 'Enter' || !event.ctrlKey || event.altKey || event.metaKey) {
			return;
		}

		const target = event.target instanceof HTMLElement ? event.target : document.activeElement;
		if (!(target instanceof HTMLElement) || !target.closest('.monaco-editor')) {
			return;
		}

		const commandService = (
			window as { __sidex_commandService?: { executeCommand(commandId: string): Promise<unknown> } }
		).__sidex_commandService;
		if (!commandService) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();

		const commandId = event.shiftKey ? 'editor.action.insertLineBefore' : 'editor.action.insertLineAfter';
		commandService.executeCommand(commandId).catch(error => {
			console.error(`[SideX] Failed to execute ${commandId}:`, error);
		});
	});
}

function setupMenuActions() {
	const menuToCommand: Record<string, string> = {
		// File
		new_file: 'workbench.action.files.newUntitledFile',
		new_window: 'workbench.action.newWindow',
		open_file: 'workbench.action.files.openFile',
		open_folder: 'workbench.action.files.openFolder',
		save: 'workbench.action.files.save',
		save_as: 'workbench.action.files.saveAs',
		save_all: 'workbench.action.files.saveAll',
		close_editor: 'workbench.action.closeActiveEditor',
		close_window: 'workbench.action.closeWindow',
		// Edit
		find: 'actions.find',
		replace: 'editor.action.startFindReplaceAction',
		find_in_files: 'workbench.action.findInFiles',
		replace_in_files: 'workbench.action.replaceInFiles',
		// Selection
		expand_selection: 'editor.action.smartSelect.expand',
		shrink_selection: 'editor.action.smartSelect.shrink',
		copy_line_up: 'editor.action.copyLinesUpAction',
		copy_line_down: 'editor.action.copyLinesDownAction',
		move_line_up: 'editor.action.moveLinesUpAction',
		move_line_down: 'editor.action.moveLinesDownAction',
		add_cursor_above: 'editor.action.insertCursorAbove',
		add_cursor_below: 'editor.action.insertCursorBelow',
		select_all_occurrences: 'editor.action.selectHighlights',
		// View
		command_palette: 'workbench.action.showCommands',
		explorer: 'workbench.view.explorer',
		search: 'workbench.view.search',
		source_control: 'workbench.view.scm',
		debug: 'workbench.view.debug',
		extensions: 'workbench.view.extensions',
		problems: 'workbench.actions.view.problems',
		output: 'workbench.action.output.toggleOutput',
		terminal: 'workbench.action.terminal.toggleTerminal',
		debug_console: 'workbench.debug.action.toggleRepl',
		toggle_fullscreen: 'workbench.action.toggleFullScreen',
		zoom_in: 'workbench.action.zoomIn',
		zoom_out: 'workbench.action.zoomOut',
		reset_zoom: 'workbench.action.zoomReset',
		// Go
		back: 'workbench.action.navigateBack',
		forward: 'workbench.action.navigateForward',
		go_to_file: 'workbench.action.quickOpen',
		go_to_symbol: 'workbench.action.showAllSymbols',
		go_to_line: 'workbench.action.gotoLine',
		go_to_definition: 'editor.action.revealDefinition',
		go_to_references: 'editor.action.goToReferences',
		// Run
		start_debugging: 'workbench.action.debug.start',
		run_without_debugging: 'workbench.action.debug.run',
		stop_debugging: 'workbench.action.debug.stop',
		restart_debugging: 'workbench.action.debug.restart',
		toggle_breakpoint: 'editor.debug.action.toggleBreakpoint',
		// Terminal
		new_terminal: 'workbench.action.terminal.new',
		split_terminal: 'workbench.action.terminal.split',
		run_task: 'workbench.action.tasks.runTask',
		run_build_task: 'workbench.action.tasks.build',
		// Help
		keyboard_shortcuts: 'workbench.action.keybindingsEditor'
	};

	(window as any).__sidex_menu_action = async (menuId: string) => {
		if (menuId === 'open_folder') {
			sidexOpenFolder();
			return;
		}

		if (menuId === 'find') {
			const editorService = (window as any).__sidex_editorService;
			if (editorService?.activeEditor?.typeId === 'workbench.editors.webviewInput') {
				try {
					await (window as any).__sidex_commandService?.executeCommand('editor.action.webvieweditor.showFind');
				} catch {}
				return;
			}
		}

		const commandId = menuToCommand[menuId];
		if (!commandId) {
			console.warn(`[SideX] Unknown menu action: ${menuId}`);
			return;
		}
		try {
			const event = new CustomEvent('sidex-command', { detail: { commandId } });
			window.dispatchEvent(event);
		} catch (e) {
			console.error(`[SideX] Failed to execute menu command ${commandId}:`, e);
		}
	};

	// Native menu events arrive as CustomEvents from the Rust backend
	window.addEventListener('sidex-native-menu', ((e: CustomEvent) => {
		const menuId = e.detail;
		if (typeof menuId === 'string' && (window as any).__sidex_menu_action) {
			(window as any).__sidex_menu_action(menuId);
		}
	}) as EventListener);

	// Listen for command execution via keyboard shortcuts forwarded from native menu
	window.addEventListener('sidex-command', async (e: any) => {
		const commandId = e.detail?.commandId;
		if (!commandId) {
			return;
		}
		if (
			commandId === 'workbench.action.files.openFolder' ||
			commandId === 'workbench.action.files.openFolderViaWorkspace'
		) {
			sidexOpenFolder();
			return;
		}
		try {
			const commandService = (window as any).__sidex_commandService;
			if (commandService) {
				await commandService.executeCommand(commandId);
			} else {
				console.warn(`[SideX] Command service not ready, queuing: ${commandId}`);
			}
		} catch (err) {
			console.error(`[SideX] Command ${commandId} failed:`, err);
		}
	});
}

/**
 * After NLS translations are loaded into `_VSCODE_NLS_MESSAGES`, send
 * translated labels to the Rust side so the native macOS menu bar updates.
 */
async function updateNativeMenuLabels() {
	if (!navigator.userAgent.includes('Mac')) {
		return;
	}

	const nlsMessages: string[] | undefined = (globalThis as any)._VSCODE_NLS_MESSAGES;
	if (!nlsMessages) {
		return;
	}

	// NLS key -> native menu item ID.
	// Submenu headers use the submenu IDs from lib.rs; individual items use
	// the MenuItemBuilder IDs.  Keys come from menubarControl.ts / the
	// various contribution files.
	const nlsKeyToMenuId: Record<string, string> = {
		// Submenu titles
		mFile: 'file_menu',
		mEdit: 'edit_menu',
		mSelection: 'selection_menu',
		mView: 'view_menu',
		mGoto: 'go_menu',
		mRun: 'run_menu',
		mTerminal: 'terminal_menu',
		mHelp: 'help_menu',
		// File menu items
		miNewFile: 'new_file',
		miNewWindow: 'new_window',
		miOpenFile: 'open_file',
		miSave: 'save',
		miSaveAs: 'save_as',
		miCloseEditor: 'close_editor',
		// Edit menu items
		miFind: 'find',
		miReplace: 'replace',
		miFindInFiles: 'find_in_files',
		miReplaceInFiles: 'replace_in_files',
		// View menu items
		miCommandPalette: 'command_palette',
		miToggleFullScreen: 'toggle_fullscreen',
		miZoomIn: 'zoom_in',
		miZoomOut: 'zoom_out',
		miZoomReset: 'reset_zoom',
		// Go menu items
		miBack: 'back',
		miForward: 'forward',
		miGotoFile: 'go_to_file',
		miGotoSymbolInWorkspace: 'go_to_symbol',
		miGotoLine: 'go_to_line',
		miGotoDefinition: 'go_to_definition',
		// Run menu items
		miStartDebugging: 'start_debugging',
		miRunWithoutDebugging: 'run_without_debugging',
		miStopDebugging: 'stop_debugging',
		miRestartDebugging: 'restart_debugging',
		miToggleBreakpoint: 'toggle_breakpoint',
		// Terminal menu items
		miNewTerminal: 'new_terminal',
		miSplitTerminal: 'split_terminal',
		miRunTask: 'run_task',
		miRunBuildTask: 'run_build_task',
		// Help menu items
		miWelcome: 'welcome',
		miDocumentation: 'documentation',
		miReleaseNotes: 'release_notes',
		miKeyboardShortcuts: 'keyboard_shortcuts',
		miReportIssue: 'report_issue'
	};

	try {
		const indexRes = await fetch('/nls.messages.json');
		if (!indexRes.ok) {
			return;
		}
		const nlsEntries: Array<{ key: string; msg: string }> = await indexRes.json();

		const labels: Record<string, string> = {};

		for (let i = 0; i < nlsEntries.length; i++) {
			const menuId = nlsKeyToMenuId[nlsEntries[i].key];
			if (menuId) {
				const translated = nlsMessages[i];
				if (typeof translated === 'string' && translated !== nlsEntries[i].msg) {
					labels[menuId] = translated.replace(/&&/g, '').replace(/&/g, '');
				}
			}
		}

		if (Object.keys(labels).length === 0) {
			return;
		}

		const { invoke } = await import('@tauri-apps/api/core');
		await invoke('update_menu_labels', { labels });
	} catch (e) {
		console.warn('[SideX] Could not update native menu labels:', e);
	}
}

boot().catch(err => {
	console.error('[SideX] Fatal:', err);
	const container = document.createElement('div');
	container.style.cssText = 'padding:40px;color:#ccc;font-family:system-ui';
	const h2 = document.createElement('h2');
	h2.textContent = 'SideX failed to start';
	const pre = document.createElement('pre');
	pre.style.cssText = 'color:#f88;white-space:pre-wrap';
	pre.textContent = (err as Error)?.stack || String(err);
	container.append(h2, pre);
	document.body.replaceChildren(container);
});
