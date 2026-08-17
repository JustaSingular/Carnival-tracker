// Captures the countdown once a day and delivers it somewhere the phone can
// reach, so the image can be saved to the camera roll.
//
//   node daily.js
//   node daily.js --dry-run    capture only, deliver nothing
//   node daily.js --notify     also send a push notification about it
//
// Two delivery routes, either or both:
//
//   PUSH_BASE_URL   uploads to the push app's /api/shot, where every day is
//                   browsable at /shot.html. Silent: nothing is published
//                   unless --notify is passed.
//   SAVE_DIR        writes carnival-YYYY-MM-DD.png into a local folder, which
//                   is only useful if something else is watching it.
//
// Config comes from daily.env next to this file (see daily.env.example), or
// from real environment variables — Task Scheduler makes those awkward to set,
// hence the file.

const fs = require('fs');
const path = require('path');
const { takeScreenshot } = require('./screenshot');

const CONFIG_FILE = path.join(__dirname, 'daily.env');

// flag.mp4 is 1920x1080 and the CSS fits it with object-fit: cover, so any
// other aspect ratio crops the flag. Matching it captures the whole thing.
const SHOT = { width: 1920, height: 1080, out: 'shots/daily.png', wait: 5000 };

function loadConfig() {
    const config = {
        PUSH_BASE_URL: process.env.PUSH_BASE_URL || '',
        PUSH_TOKEN: process.env.PUSH_TOKEN || '',
        SAVE_DIR: process.env.SAVE_DIR || ''
    };

    if (fs.existsSync(CONFIG_FILE)) {
        for (const line of fs.readFileSync(CONFIG_FILE, 'utf8').split(/\r?\n/)) {
            const match = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)$/);
            // Real environment variables win over the file.
            if (match && match[1] in config && !config[match[1]]) {
                config[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
            }
        }
    }

    if (!config.SAVE_DIR && !config.PUSH_BASE_URL) {
        throw new Error('Set SAVE_DIR or PUSH_BASE_URL. Copy daily.env.example to daily.env and fill it in.');
    }
    if (config.PUSH_BASE_URL && !config.PUSH_TOKEN) {
        throw new Error('PUSH_BASE_URL is set but PUSH_TOKEN is missing.');
    }

    return {
        saveDir: config.SAVE_DIR,
        baseUrl: config.PUSH_BASE_URL.replace(/\/+$/, ''),
        token: config.PUSH_TOKEN
    };
}

// Local date, not toISOString() — that converts to UTC and can name yesterday.
function today() {
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    return now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
}

// The page has already done the date maths; read the result rather than
// reimplementing the Easter calculation in Node and letting the two drift.
function readCountdown(dom) {
    const text = className => {
        const match = dom.match(new RegExp('class="' + className + '"[^>]*>([^<]*)<'));
        return match ? match[1].trim() : '';
    };

    const number = text('countdown-number');
    const label = text('countdown-label');

    // "176" + "days till Carnival", or "It's Carnival Monday!" + "Play mas!".
    return [number, label].filter(part => part && part !== '—').join(' ');
}

async function post(url, options) {
    const response = await fetch(url, options);
    const body = await response.text();

    if (!response.ok) {
        throw new Error('POST ' + url.split('?')[0] + ' → ' + response.status + ' ' + body.slice(0, 200));
    }

    return body;
}

async function main() {
    const dryRun = process.argv.includes('--dry-run');
    const notify = process.argv.includes('--notify');
    const config = dryRun ? {} : loadConfig();
    const day = today();

    const { outPath, dom } = await takeScreenshot(SHOT);
    const png = fs.readFileSync(outPath);
    const caption = readCountdown(dom) || 'Carnival countdown';

    console.log('Captured ' + SHOT.width + 'x' + SHOT.height + ' (' + Math.round(png.length / 1024) + ' KB) — ' + caption);

    if (dryRun) {
        console.log('Dry run: nothing delivered.');
        return;
    }

    if (config.saveDir) {
        // Dated filenames so the folder becomes an archive rather than one file
        // that quietly changes under yesterday's copy.
        const target = path.join(config.saveDir, 'carnival-' + day + '.png');
        fs.mkdirSync(config.saveDir, { recursive: true });
        fs.writeFileSync(target, png);
        console.log('Saved ' + target);
    }

    if (config.baseUrl) {
        await post(config.baseUrl + '/api/shot?d=' + day, {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + config.token,
                'Content-Type': 'image/png'
            },
            body: png
        });
        console.log('Uploaded to ' + config.baseUrl + '/shot.html?d=' + day);

        if (notify) {
            const result = await post(config.baseUrl + '/api/publish', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer ' + config.token,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    title: 'Carnival',
                    message: caption,
                    url: config.baseUrl + '/shot.html?d=' + day,
                    // Today's replaces yesterday's rather than stacking up.
                    tag: 'carnival'
                })
            });
            console.log('Pushed: ' + result);
        }
    }
}

main().catch(err => {
    console.error(err.message);
    process.exit(1);
});
