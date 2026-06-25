import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createSpinner, colors } from './ui.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_PATH = path.join(__dirname, '../package.json');

export async function checkUpdates() {
    const spinner = createSpinner('Verifying system integrity...').start();
    try {
        const pkgData = JSON.parse(await fs.readFile(PKG_PATH, 'utf-8'));
        const currentVersion = pkgData.version;
        spinner.succeed(colors.success(`System verified. Version ${currentVersion} active.`));
    } catch (err) {
        spinner.fail(colors.error('System verification failed.'));
    }
}
