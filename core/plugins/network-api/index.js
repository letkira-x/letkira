import axios from 'axios';
import inquirer from 'inquirer';
import { colors, createSpinner } from '../../core/ui.js';
import { config } from '../../config/config.js';

export default async function run() {
    console.log(colors.primary('\n--- Network Recon ---'));
    const { targetHost } = await inquirer.prompt([
        {
            type: 'input',
            name: 'targetHost',
            message: colors.accent('Enter target node (e.g., test.com):'),
            default: 'jsonplaceholder.typicode.com'
        }
    ]);

    const spinner = createSpinner('Establishing connection...').start();
    try {
        const res = await axios.get(`https://${targetHost}/posts/1`, {
            timeout: config.timeout
        });
        spinner.succeed(colors.success('Connection established. Packet data retrieved:'));
        console.log(`\n${colors.secondary('Payload:')} ${res.data.title}\n`);
    } catch (err) {
        spinner.fail(colors.error('Connection refused or timed out.'));
    }
}

