import { showBanner } from './core/ui.js';
import { loadPlugins } from './core/pluginManager.js';
import { showMenu } from './core/menu.js';
import { checkUpdates } from './core/updater.js';

async function init() {
    await showBanner();
    await checkUpdates();
    const plugins = await loadPlugins();
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await showMenu(plugins);
}

init().catch(console.error);
