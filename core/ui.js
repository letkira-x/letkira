import chalk from 'chalk';
import figlet from 'figlet';
import ora from 'ora';

export const colors = {
    primary: chalk.cyanBright,
    secondary: chalk.magentaBright,
    accent: chalk.yellowBright,
    success: chalk.greenBright,
    error: chalk.redBright
};

export async function showBanner() {
    return new Promise((resolve) => {
        figlet('LETKIRA', { font: 'Slant' }, (err, data) => {
            if (!err) {
                console.log(colors.primary(data));
                console.log(colors.secondary('     Termux Multi-Tool | Cyberpunk Edition\n'));
            }
            resolve();
        });
    });
}

export function createSpinner(text) {
    return ora({
        text: colors.accent(text),
        color: 'cyan',
        spinner: 'dots'
    });
}

