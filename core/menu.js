import inquirer from 'inquirer';
import { colors, showBanner, clearScreen } from './ui.js';

function formatRow(id, name, desc) {
    const c1 = id.padEnd(4).substring(0, 4);
    const c2 = name.padEnd(20).substring(0, 20);
    const c3 = desc.padEnd(30).substring(0, 30);
    return `${colors.primary('│')} ${colors.accent(c1)} ${colors.primary(c2)} ${colors.secondary(c3)} ${colors.primary('│')}`;
}

function formatExitRow() {
    const c1 = '[0]'.padEnd(4);
    const rest = 'Exit System'.padEnd(51).substring(0, 51);
    return `${colors.primary('│')} ${colors.error(c1)} ${colors.secondary(rest)} ${colors.primary('│')}`;
}

export async function showMenu(plugins) {
    let running = true;

    while (running) {
        await showBanner();
        
        if (plugins.length === 0) {
            console.log(colors.error('No plugins loaded. Please check the plugins directory.'));
            process.exit(1);
        }

        const choices = [
            new inquirer.Separator(colors.primary(`┌${'─'.repeat(58)}┐`))
        ];

        plugins.forEach((p, index) => {
            choices.push({
                name: formatRow(`[${index + 1}]`, p.name, p.description),
                value: p
            });
        });

        choices.push(new inquirer.Separator(colors.primary(`├${'─'.repeat(58)}┤`)));
        choices.push({
            name: formatExitRow(),
            value: 'exit'
        });
        choices.push(new inquirer.Separator(colors.primary(`└${'─'.repeat(58)}┘`)));

        const { selected } = await inquirer.prompt([
            {
                type: 'list',
                name: 'selected',
                message: colors.accent('root@letkira:~#'),
                choices: choices,
                pageSize: 20,
                loop: false
            }
        ]);

        if (selected === 'exit') {
            clearScreen();
            console.log(colors.success('Terminating session... Goodbye.\n'));
            running = false;
            process.exit(0);
        } else {
            clearScreen();
            
            try {
                await selected.run();
            } catch (err) {
                console.log(colors.error(`\n[!] Plugin Execution Error: ${err.message}\n`));
            }

            console.log();
            await inquirer.prompt([
                {
                    type: 'input',
                    name: 'cont',
                    message: colors.accent('Press Enter to return to main menu...')
                }
            ]);
        }
    }
}
