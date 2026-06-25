import os from 'os';
import { colors, createSpinner } from '../../core/ui.js';

export default async function run() {
    console.log(colors.primary('\n--- System Resources ---'));
    const spinner = createSpinner('Gathering metrics...').start();
    
    await new Promise((resolve) => setTimeout(resolve, 1000));
    
    const totalMem = (os.totalmem() / 1024 / 1024).toFixed(2);
    const freeMem = (os.freemem() / 1024 / 1024).toFixed(2);
    const platform = os.platform();
    const arch = os.arch();
    
    spinner.succeed(colors.success('Metrics gathered successfully.'));
    
    console.log(`\n${colors.secondary('OS Platform:')} ${platform}`);
    console.log(`${colors.secondary('Architecture:')} ${arch}`);
    console.log(`${colors.secondary('Total Memory:')} ${totalMem} MB`);
    console.log(`${colors.secondary('Free Memory:')} ${freeMem} MB\n`);
}

