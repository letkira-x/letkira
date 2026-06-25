import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createSpinner, colors } from './ui.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGINS_DIR = path.join(__dirname, '../plugins');

export async function loadPlugins() {
    const spinner = createSpinner('Initializing plugin architecture...').start();
    const plugins = [];

    try {
        await fs.access(PLUGINS_DIR);
    } catch {
        await fs.mkdir(PLUGINS_DIR, { recursive: true });
    }

    try {
        const entries = await fs.readdir(PLUGINS_DIR, { withFileTypes: true });

        for (const entry of entries) {
            if (entry.isDirectory()) {
                const pluginPath = path.join(PLUGINS_DIR, entry.name);
                const metaPath = path.join(pluginPath, 'plugin.json');
                const indexPath = path.join(pluginPath, 'index.js');

                try {
                    const metaData = JSON.parse(await fs.readFile(metaPath, 'utf-8'));
                    const module = await import(`file://${indexPath}`);
                    plugins.push({
                        ...metaData,
                        run: module.default
                    });
                } catch (err) {
                    console.log(colors.error(`\n[!] Failed to load plugin ${entry.name}: ${err.message}`));
                }
            }
        }
        spinner.succeed(colors.success(`System Ready: Loaded ${plugins.length} external modules.`));
    } catch (err) {
        spinner.fail(colors.error('Critical failure in plugin architecture.'));
    }

    return plugins;
}

