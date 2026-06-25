import inquirer from 'inquirer';
import { colors } from './ui.js';

export async function showMenu(plugins) {
    let running = true;

    while (running) {
        console.log();
        
        if (plugins.length === 0) {
            console.log(colors.error('No plugins loaded. Please check the plugins directory.'));
            process.exit(1);
        }

        const choices = plugins.map((p, index) => ({
            name: `[${index + 1}] ${colors.primary(p.name)} - ${colors.secondary(p.description)}`,
            value: p
        }));

        choices.push(new inquirer.Separator());
        choices.push({ name: `[0] ${colors.error('Exit System')}`, value: 'exit' });

        const { selected } = await inquirer.prompt([
            {
                type: 'list',
                name: 'selected',
                message: colors.accent('root@letkira:~#'),
                choices: choices,
                pageSize: 15,
                loop: false
            }
        ]);

        if (selected === 'exit') {
            console.log(colors.success('\nTerminating session... Goodbye.\n'));
            running = false;
            process.exit(0);
        } else {
            console.clear();
            
            try {
                await selected.run();
            } catch (err) {
                console.log(colors.error(`\n[!] Plugin Execution Error: ${err.message}\n`));
            }

            const { cont } = await inquirer.prompt([
                {
                    type: 'input',
                    name: 'cont',
                    message: colors.accent('Press Enter to return to main menu...')
                }
            ]);
            console.clear();
        }
    }
}
