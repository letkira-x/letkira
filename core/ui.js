import chalk from 'chalk';
import figlet from 'figlet';
import ora from 'ora';

export const colors = {
    primary: chalk.greenBright,
    secondary: chalk.white,
    accent: chalk.cyanBright,
    success: chalk.green,
    error: chalk.redBright
};

export async function showBanner() {
    return new Promise((resolve) => {
        console.clear();
        figlet('LETKIRA', { font: 'Standard' }, (err, data) => {
            if (!err) {
                console.log(colors.primary(data));
                console.log(colors.secondary('     Ethical Hacking Framework\n'));
            }
            resolve();
        });
    });
}

export function createSpinner(text) {
    return ora({
        text: colors.secondary(text),
        color: 'green',
        spinner: 'bouncingBar'
    });
}
