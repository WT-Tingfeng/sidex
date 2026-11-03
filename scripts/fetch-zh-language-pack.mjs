#!/usr/bin/env node
/**
 * Downloads the Simplified Chinese language pack for the VS Code base SideX
 * builds against and writes it to public/nls.zh-cn.json, so the app can
 * localize its core UI without depending on a user-installed pack (whose
 * version may not match the fork's module paths).
 *
 * Best effort: a network failure leaves the file absent and the app falls
 * back to a user-installed language pack / English.
 *
 * Language pack content: (c) Microsoft Corporation, MIT License
 * (https://github.com/microsoft/vscode-loc).
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = process.env.SIDEX_NLS_ZH_VERSION || '1.110.0';
const URL = `https://open-vsx.org/vscode/unpkg/MS-CEINTL/vscode-language-pack-zh-hans/${VERSION}/extension/translations/main.i18n.json`;
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const target = join(root, 'public', 'nls.zh-cn.json');

async function main() {
	const response = await fetch(URL, { signal: AbortSignal.timeout(30_000) });
	if (!response.ok) {
		throw new Error(`HTTP ${response.status}`);
	}
	const raw = await response.json();
	const contents = raw && typeof raw === 'object' && raw.contents ? raw.contents : raw;
	if (!contents || typeof contents !== 'object') {
		throw new Error('unexpected language pack shape');
	}
	let modules = 0;
	for (const [moduleId, entries] of Object.entries(contents)) {
		if (moduleId && entries && typeof entries === 'object' && !Array.isArray(entries)) {
			modules++;
		}
	}
	mkdirSync(dirname(target), { recursive: true });
	writeFileSync(target, JSON.stringify({ version: VERSION, contents }));
	console.log(`[nls] wrote ${target} (${modules} modules, version ${VERSION})`);
}

main().catch((error) => {
	console.warn(`[nls] could not fetch the zh-CN language pack (continuing without it): ${error.message}`);
});
