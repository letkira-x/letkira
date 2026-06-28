import inquirer from 'inquirer';
import express from 'express';
import { execSync } from 'child_process';
import { createRequire } from 'module';
import { colors, createSpinner } from '../../core/ui.js';

const require = createRequire(import.meta.url);

async function ensureDependencies() {
    const spinner = createSpinner('Checking system requirements...').start();
    try {
        require.resolve('qrcode');
        spinner.succeed(colors.success('System requirements satisfied (qrcode).'));
        return true;
    } catch (e) {
        spinner.info(colors.accent('Installing missing npm package: qrcode...\n'));
        try {
            execSync('npm install qrcode', { stdio: 'inherit' });
            console.log(colors.success('\n[+] Successfully installed qrcode.'));
            return true;
        } catch (err) {
            console.log(colors.error('\n[!] Failed to auto-install qrcode.'));
            console.log(colors.accent('Please install manually by typing: npm install qrcode'));
            return false;
        }
    }
}

let serverInstance = null;

export default async function run() {
    console.log(colors.primary('\n--- QR Code Generator Tool ---'));

    const isReady = await ensureDependencies();
    if (!isReady) {
        console.log(colors.error('Cannot proceed without required dependencies. Exiting tool...'));
        return;
    }

    const qrcode = (await import('qrcode')).default;

    const { content } = await inquirer.prompt([
        {
            type: 'input',
            name: 'content',
            message: colors.accent('Enter URL or text payload:'),
            validate: (input) => input.trim().length > 0 ? true : 'Payload cannot be empty.'
        }
    ]);

    const spinner = createSpinner('Generating cryptographic matrix...').start();
    
    try {
        const asciiQr = await qrcode.toString(content, { type: 'terminal', small: true });
        const imageBuffer = await qrcode.toBuffer(content, { type: 'png', width: 500, margin: 2 });
        
        spinner.succeed(colors.success('QR Matrix successfully generated.'));

        console.log('\n' + asciiQr);

        const port = 8181;
        const app = express();

        app.get('/download', (req, res) => {
            const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
            const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
            console.log(`${colors.accent(`[${timestamp}]`)} Download triggered: ${colors.secondary(ip)}`);
            
            res.setHeader('Content-Disposition', 'attachment; filename="payload_qr.png"');
            res.setHeader('Content-Type', 'image/png');
            res.send(imageBuffer);
        });

        serverInstance = app.listen(port);
        console.log(colors.success(`[+] Local HTTP server initialized on port ${port}.`));
        
        console.log(`\n${colors.primary('┌────────────────────────────────────────────────────────┐')}`);
        console.log(`${colors.primary('│')} ${colors.secondary('Download URL:')} ${colors.accent(`http://localhost:${port}/download`.padEnd(41))} ${colors.primary('│')}`);
        console.log(`${colors.primary('└────────────────────────────────────────────────────────┘')}\n`);

        await inquirer.prompt([
            {
                type: 'input',
                name: 'stop',
                message: colors.accent('Press Enter to close server and return...')
            }
        ]);

        if (serverInstance) {
            serverInstance.close();
            serverInstance = null;
        }
        console.log(colors.error('[*] Core hosting streams terminated.'));

    } catch (err) {
        spinner.fail(colors.error('Failed to generate QR sequence.'));
    }
}

