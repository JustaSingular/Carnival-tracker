// Screenshots the page with headless Chrome. No dependencies — it uses the
// browser already installed on this machine.
//
//   node screenshot.js
//   node screenshot.js --width 390 --height 844 --out shots/phone.png
//   node screenshot.js --wait 6000
//
// The page is served over http rather than opened as a file:// URL, because
// localStorage (which the font toggle uses) is restricted on file://.
//
// push.js imports takeScreenshot() from here rather than shelling out, so the
// daily push and a manual capture always go through the same code.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.mp4': 'video/mp4',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml'
};

// Linux paths are for the GitHub Actions runner, which has Chrome preinstalled.
const CHROME_PATHS = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium'
].filter(Boolean);

const DEFAULTS = {
    width: 1440,
    height: 900,
    out: 'shots/carnival.png',
    wait: 4000
};

function parseArgs(argv) {
    const options = { ...DEFAULTS };

    for (let i = 0; i < argv.length; i += 2) {
        const key = argv[i].replace(/^--/, '');
        const value = argv[i + 1];
        if (!(key in options)) continue;
        options[key] = key === 'out' ? value : Number(value);
    }

    return options;
}

function findBrowser() {
    const browser = CHROME_PATHS.find(fs.existsSync);
    if (!browser) {
        throw new Error('No Chrome or Edge install found. Edit CHROME_PATHS with your browser path.');
    }
    return browser;
}

// Minimal static server rooted at this project folder.
function startServer(root) {
    const server = http.createServer((req, res) => {
        const urlPath = decodeURIComponent(req.url.split('?')[0]);
        const filePath = path.join(root, urlPath === '/' ? 'index.html' : urlPath);

        // Refuse anything that escapes the project folder.
        if (!filePath.startsWith(root)) {
            res.writeHead(403).end('Forbidden');
            return;
        }

        fs.readFile(filePath, (err, data) => {
            if (err) {
                res.writeHead(404).end('Not found');
                return;
            }
            res.writeHead(200, { 'Content-Type': MIME_TYPES[path.extname(filePath)] || 'application/octet-stream' });
            res.end(data);
        });
    });

    return new Promise(resolve => {
        server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
    });
}

// --dump-dom rides along on the same run and costs nothing extra. It gives
// callers the rendered countdown text without recomputing the date maths that
// script.js already does.
function capture(browser, url, options, outPath) {
    const profileDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'carnival-shot-'));

    const args = [
        '--headless=new',
        '--disable-gpu',
        '--hide-scrollbars',
        '--autoplay-policy=no-user-gesture-required',
        // Chrome's sandbox needs kernel privileges a CI container doesn't grant.
        ...(process.env.CI ? ['--no-sandbox'] : []),
        '--user-data-dir=' + profileDir,
        '--window-size=' + options.width + ',' + options.height,
        '--virtual-time-budget=' + options.wait,
        '--screenshot=' + outPath,
        '--dump-dom',
        url
    ];

    return new Promise((resolve, reject) => {
        const child = spawn(browser, args, { stdio: ['ignore', 'pipe', 'ignore'] });
        let dom = '';
        child.stdout.on('data', chunk => { dom += chunk; });
        child.on('error', reject);
        child.on('exit', code => {
            fs.rmSync(profileDir, { recursive: true, force: true });
            code === 0 ? resolve(dom) : reject(new Error('Browser exited with code ' + code));
        });
    });
}

// Returns { outPath, dom }. Overrides use the same names as the CLI flags.
async function takeScreenshot(overrides = {}) {
    const options = { ...DEFAULTS, ...overrides };
    const root = __dirname;
    const outPath = path.resolve(root, options.out);
    const browser = findBrowser();

    fs.mkdirSync(path.dirname(outPath), { recursive: true });

    const { server, port } = await startServer(root);
    const url = 'http://127.0.0.1:' + port + '/index.html';

    try {
        const dom = await capture(browser, url, options, outPath);
        return { outPath, dom };
    } finally {
        server.close();
    }
}

async function main() {
    const options = parseArgs(process.argv.slice(2));

    console.log('Capturing at ' + options.width + 'x' + options.height + '...');
    const { outPath } = await takeScreenshot(options);

    const kb = Math.round(fs.statSync(outPath).size / 1024);
    console.log('Saved ' + path.relative(__dirname, outPath) + ' (' + kb + ' KB)');
}

if (require.main === module) {
    main().catch(err => {
        console.error(err.message);
        process.exit(1);
    });
}

module.exports = { takeScreenshot };
