/*---------------------------------------------------------------------------------------------
 *  SideX Settings — shared read/write helpers for the settings panel.
 *
 *  Settings are stored by the Rust backend as a single JSON object with flat
 *  dotted keys ("sidex.cascade.background"). Older builds of the settings UI
 *  persisted values through JSON.stringify(), so a stored boolean can be the
 *  JSON string 'true' and a stored select value can be the JSON string
 *  '"Agent"'. The helpers below read, unwrap and type-coerce those legacy
 *  encodings while always writing plain JSON values back.
 *
 *  Reading is deliberately tolerant of both backend shapes:
 *   - a section read ({ section: 'sidex.cascade' }) returns the stored keys
 *     with the prefix stripped ('background', 'previews', ...);
 *   - when the backend cannot answer a section prefix (older Rust build or a
 *     value stored under a parent object), each key is read exactly.
 *--------------------------------------------------------------------------------------------*/

export type TauriInvoke = ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | null;

export interface SettingsSectionValues {
	readonly [key: string]: unknown;
}

/** JSON values that were stored as strings by the legacy JSON.stringify() writes. */
const ENCODED_JSON_PREFIX = /^\s*[\[{"]/;

/**
 * Unwrap values written by the legacy `JSON.stringify()` path.
 *
 * Examples: `'true'` -> `true`, `'"Agent"'` -> `'Agent'`,
 * `'["a","b"]'` -> `['a','b']`. Plain (unencoded) strings are returned
 * unchanged. Bounded to a few passes so a pathologically double-encoded value
 * cannot loop forever.
 */
export function decodeSettingValue(value: unknown): unknown {
	let decoded: unknown = value;
	for (let pass = 0; pass < 4 && typeof decoded === 'string'; pass++) {
		const raw = decoded.trim();
		if (raw.length === 0) {
			return decoded;
		}
		if (raw === 'true') {
			return true;
		}
		if (raw === 'false') {
			return false;
		}
		if (raw === 'null') {
			return null;
		}
		if (!ENCODED_JSON_PREFIX.test(raw)) {
			// A plain, unencoded string (e.g. 'Agent', 'HTTP/1.1').
			return decoded;
		}
		try {
			decoded = JSON.parse(raw);
		} catch {
			return decoded;
		}
	}
	return decoded;
}

/** Read a boolean setting, tolerating legacy `'true'`/`'false'` strings. */
export function toSettingBoolean(value: unknown, fallback: boolean): boolean {
	const decoded = decodeSettingValue(value);
	if (typeof decoded === 'boolean') {
		return decoded;
	}
	if (typeof decoded === 'number') {
		return decoded !== 0;
	}
	return fallback;
}

/** Read a string setting, tolerating legacy JSON-encoded strings. */
export function toSettingString(value: unknown, fallback: string): string {
	const decoded = decodeSettingValue(value);
	return typeof decoded === 'string' ? decoded : fallback;
}

/** Read a number setting, tolerating legacy stringified numbers. */
export function toSettingNumber(value: unknown, fallback: number): number {
	const decoded = decodeSettingValue(value);
	if (typeof decoded === 'number' && Number.isFinite(decoded)) {
		return decoded;
	}
	if (typeof decoded === 'string' && decoded.trim().length > 0) {
		const parsed = Number(decoded);
		if (Number.isFinite(parsed)) {
			return parsed;
		}
	}
	return fallback;
}

/**
 * Read a string-array setting (allowed origins, allow/deny lists).
 * Legacy values are a JSON-encoded array string; new values are plain arrays.
 */
export function toSettingStringArray(value: unknown, fallback: readonly string[]): string[] {
	const decoded = decodeSettingValue(value);
	if (Array.isArray(decoded)) {
		return decoded.filter((entry): entry is string => typeof entry === 'string');
	}
	return [...fallback];
}

/** Read a single setting by its full dotted key. Returns `null` when unset. */
export async function readSettingValue(invoke: TauriInvoke, fullKey: string): Promise<unknown> {
	if (!invoke) {
		return null;
	}

	try {
		const exact = await invoke('settings_get', { section: fullKey });
		if (exact !== null && exact !== undefined) {
			return decodeSettingValue(exact);
		}
	} catch {
		// Fall through to the parent-section lookup below.
	}

	// Backends that only answer section-prefix reads: look the leaf up inside
	// its parent section (e.g. 'sidex.beta.updateChannel' -> 'sidex.beta').
	const separator = fullKey.lastIndexOf('.');
	if (separator > 0) {
		const parent = fullKey.substring(0, separator);
		const leaf = fullKey.substring(separator + 1);
		try {
			const section = await invoke('settings_get', { section: parent });
			const value = pickSectionValue(section, parent, leaf);
			if (value !== undefined) {
				return decodeSettingValue(value);
			}
		} catch {
			// Unset / unsupported — report as unset.
		}
	}

	return null;
}

/**
 * Read a whole settings section (keys already stripped of `prefix.`).
 *
 * The section-prefix backend returns every stored key under the prefix, so a
 * missing key simply means it was never persisted and the caller's default
 * applies. When the section read itself yields nothing (older exact-key-only
 * backend, or a value stored under a parent object), each key is then read
 * exactly as a fallback.
 */
export async function readSettingsSection(
	invoke: TauriInvoke,
	prefix: string,
	keys: readonly string[]
): Promise<SettingsSectionValues> {
	const values: Record<string, unknown> = {};
	if (!invoke) {
		return values;
	}

	let sectionResolved = false;
	try {
		const raw = await invoke('settings_get', { section: prefix });
		const section = decodeSettingValue(raw);
		if (section && typeof section === 'object' && !Array.isArray(section)) {
			const record = section as Record<string, unknown>;
			for (const [key, value] of Object.entries(record)) {
				const shortKey = key.startsWith(prefix + '.') ? key.substring(prefix.length + 1) : key;
				if (keys.indexOf(shortKey) !== -1) {
					values[shortKey] = decodeSettingValue(value);
				}
			}
			sectionResolved = true;
		}
	} catch {
		// Fall through to per-key reads.
	}

	if (!sectionResolved) {
		const resolved = await Promise.all(keys.map(key => readSettingValue(invoke, prefix + '.' + key)));
		keys.forEach((key, index) => {
			if (resolved[index] !== null && resolved[index] !== undefined) {
				values[key] = resolved[index];
			}
		});
	}

	return values;
}

/** Persist a setting as a plain JSON value (never JSON.stringify()-ed). */
export async function writeSettingValue(invoke: TauriInvoke, key: string, value: unknown): Promise<void> {
	if (!invoke) {
		return;
	}
	await invoke('settings_update', { key, value, scope: 'user' });
}

function pickSectionValue(section: unknown, prefix: string, leaf: string): unknown {
	const decoded = decodeSettingValue(section);
	if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
		return undefined;
	}
	const record = decoded as Record<string, unknown>;
	if (leaf in record) {
		return record[leaf];
	}
	const fullKey = prefix + '.' + leaf;
	return fullKey in record ? record[fullKey] : undefined;
}
