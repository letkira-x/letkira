import inquirer from 'inquirer';
import fs from 'fs/promises';
import path from 'path';
import { exec, execSync } from 'child_process';
import express from 'express';
import { fileURLToPath } from 'url';
import { colors, createSpinner } from '../../core/ui.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOSTS_DIR = path.join(__dirname, 'hosted_projects');

let serverInstance = null;
let tunnelProcess = null;

function checkRequirements() {
    const spinner = createSpinner('Checking system requirements...').start();
    try {
        execSync('command -v cloudflared', { stdio: 'ignore' });
        spinner.succeed(colors.success('System requirements satisfied (cloudflared).'));
        return true;
    } catch {
        spinner.info(colors.accent('Installing missing dependency: cloudflared...\n'));
        try {
            execSync('pkg update -y && pkg install cloudflared -y', { stdio: 'inherit' });
            console.log(colors.success('\n[+] Successfully installed cloudflared.'));
            return true;
        } catch (err) {
            console.log(colors.error('\n[!] Failed to auto-install cloudflared.'));
            console.log(colors.accent('Please install manually by typing: pkg install cloudflared'));
            return false;
        }
    }
}

export default async function run() {
    console.log(colors.primary('\n--- Web Host (Temp) Tool ---'));
    
    const isReady = checkRequirements();
    if (!isReady) {
        console.log(colors.error('Cannot proceed without required dependencies. Exiting tool...'));
        return;
    }

    try {
        await fs.access(HOSTS_DIR);
    } catch {
        await fs.mkdir(HOSTS_DIR, { recursive: true });
    }

    const { projectName } = await inquirer.prompt([
        {
            type: 'input',
            name: 'projectName',
            message: colors.accent('Enter project name:'),
            validate: (input) => input.trim().length > 0 ? true : 'Project name cannot be empty.'
        }
    ]);

    const projectPath = path.join(HOSTS_DIR, projectName);
    try {
        await fs.access(projectPath);
    } catch {
        await fs.mkdir(projectPath, { recursive: true });
    }

    await manageProject(projectName, projectPath);
}

async function manageProject(projectName, projectPath) {
    const indexPath = path.join(projectPath, 'index.html');
    let hasHtml = false;

    try {
        await fs.access(indexPath);
        hasHtml = true;
    } catch {}

    if (!hasHtml) {
        console.log(colors.error('\n[!] No index.html found for this project.'));
        await editHtml(indexPath);
    }

    let managing = true;
    while (managing) {
        console.log(`\n${colors.secondary('Project:')} ${colors.accent(projectName)}`);
        
        const { action } = await inquirer.prompt([
            {
                type: 'list',
                name: 'action',
                message: colors.accent('Select action:'),
                choices: [
                    { name: 'Run Website (Cloudflare Tunnel)', value: 'run' },
                    { name: 'Edit index.html', value: 'edit' },
                    { name: 'Back to Framework Menu', value: 'back' }
                ]
            }
        ]);

        if (action === 'back') {
            stopServer();
            managing = false;
        } else if (action === 'edit') {
            await editHtml(indexPath);
        } else if (action === 'run') {
            await startHosting(projectPath);
        }
    }
}

async function editHtml(indexPath) {
    console.log(colors.primary('\n--- HTML Editor ---'));
    
    try {
        await fs.access(indexPath);
    } catch {
        const defaultHtml = '<!DOCTYPE html>\n<html>\n<head><title>Hosted Site</title></head>\n<body>\n<h1>Hello From Letkira Tunnel</h1>\n</body>\n</html>';
        await fs.writeFile(indexPath, defaultHtml, 'utf-8');
    }

    try {
        execSync(`nano "${indexPath}"`, { stdio: 'inherit' });
        console.log(colors.success('\n[+] index.html saved successfully.'));
    } catch (err) {
        console.log(colors.error('\n[!] Failed to open nano. Please install manually: pkg install nano'));
    }
}

async function startHosting(projectPath) {
    stopServer();

    const port = 8080;
    const app = express();
    app.use(express.static(projectPath));

    serverInstance = app.listen(port);
    console.log(colors.success(`\n[+] Local HTTP server initialized on port ${port}.`));

    const spinner = createSpinner('Establishing secure Cloudflare Tunnel connection...').start();

    tunnelProcess = exec(`cloudflared tunnel --url http://localhost:${port}`);

    tunnelProcess.stderr.on('data', (data) => {
        const match = data.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
        if (match) {
            spinner.succeed(colors.success('Tunnel live broadcast established!'));
            console.log(`\n${colors.primary('┌────────────────────────────────────────────────────────┐')}`);
            console.log(`${colors.primary('│')} ${colors.secondary('Live URL:')} ${colors.accent(match[0].padEnd(45))} ${colors.primary('│')}`);
            console.log(`${colors.primary('└────────────────────────────────────────────────────────┘')}\n`);
            console.log(colors.error('Press Ctrl+C inside this screen context or exit to stop hosting.\n'));
        }
    });

    await inquirer.prompt([
        {
            type: 'input',
            name: 'stop',
            message: colors.accent('Press Enter to close tunnel connection and return...')
        }
    ]);

    stopServer();
}

function stopServer() {
    if (tunnelProcess) {
        tunnelProcess.kill();
        tunnelProcess = null;
    }
    if (serverInstance) {
        serverInstance.close();
        serverInstance = null;
    }
    console.log(colors.error('[*] Core hosting streams terminated.'));
}
