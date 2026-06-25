import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const colors = {
    primary: chalk.greenBright,
    secondary: chalk.white,
    accent: chalk.cyanBright,
    success: chalk.green,
    error: chalk.redBright
};

export function clearScreen() {
    process.stdout.write('\x1Bc');
}

export async function showBanner() {
    clearScreen();
    try {
        const asciiPath = path.join(__dirname, '../ascii.txt');
        const asciiArt = await fs.readFile(asciiPath, 'utf-8');
        console.log(colors.primary(asciiArt));
    } catch (err) {
        console.log(colors.primary('LETKIRA'));
    }
    console.log(colors.secondary('     LETKIRA.ONIOM\n'));
}

export function createSpinner(text) {
    return ora({
        text: colors.secondary(text),
        color: 'green',
        spinner: 'bouncingBar'
    });
}
