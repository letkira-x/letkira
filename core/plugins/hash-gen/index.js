import inquirer from 'inquirer';
import crypto from 'crypto';
import { colors, createSpinner } from '../../core/ui.js';

export default async function run() {
    console.log(colors.primary('\n--- Cryptographic Hash Generator ---'));

    const { textToHash, algo } = await inquirer.prompt([
        {
            type: 'input',
            name: 'textToHash',
            message: colors.accent('Enter string payload:'),
            validate: (input) => input.length > 0 ? true : 'Payload cannot be empty.'
        },
        {
            type: 'list',
            name: 'algo',
            message: colors.accent('Select hashing algorithm:'),
            choices: ['md5', 'sha1', 'sha256', 'sha512']
        }
    ]);

    const spinner = createSpinner('Computing hash array...').start();

    await new Promise((resolve) => setTimeout(resolve, 800));

    try {
        const hash = crypto.createHash(algo).update(textToHash).digest('hex');
        spinner.succeed(colors.success('Hash computation complete.'));

        console.log(`\n${colors.secondary('Input Payload:')} ${textToHash}`);
        console.log(`${colors.secondary('Algorithm:')}     ${algo.toUpperCase()}`);
        console.log(`${colors.secondary('Output Hash:')}   ${colors.accent(hash)}\n`);
    } catch (err) {
        spinner.fail(colors.error('Hash computation failed.'));
    }
}
