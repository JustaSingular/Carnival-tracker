// Posts the newest shot to Instagram, and refreshes the access token.
//
//   node instagram.js whoami            check a token and print the account id
//   node instagram.js post
//   node instagram.js post --dry-run    print what would be sent, call nothing
//   node instagram.js refresh           extend the token's 60-day life
//
// Instagram never receives the image bytes — it fetches them itself from a
// public URL, which is why the workflow waits for Netlify to deploy before
// calling this. JPEG is the only format the API accepts; PNG containers are
// rejected outright.
//
// Environment:
//   IG_USER_ID       the Instagram professional account's id
//   IG_ACCESS_TOKEN  long-lived token, scopes: instagram_business_basic and
//                    instagram_business_content_publish
//   SITE_URL         where the images are published, e.g.
//                    https://ttcarnival.netlify.app
//   IG_API_BASE      optional. Defaults to the Instagram Login flavour. Use
//                    https://graph.facebook.com/v23.0 if the token came from
//                    the Facebook Login flavour instead.

const fs = require('fs');
const path = require('path');

const API_BASE = process.env.IG_API_BASE || 'https://graph.instagram.com/v23.0';
const INDEX_FILE = path.join(__dirname, 'shots', 'index.json');

// Rotated so 365 posts aren't 365 identical captions, which is the shape
// Instagram's spam heuristics look for.
const LINES = [
    'The road is calling.',
    'Counting down to the greatest show on earth.',
    'Somewhere, a pan is being tuned.',
    'Not long now.',
    'Mas in we blood.',
    'Every day closer to the road.',
    'Soca season approaching.'
];

const TAGS = '#trinidadcarnival #trinidad #carnival #playmas #soca #tt';

// Locally the token lives in daily.env, which is gitignored. In Actions it
// arrives as a real environment variable and this finds nothing to do.
function loadEnvFile() {
    const file = path.join(__dirname, 'daily.env');
    if (!fs.existsSync(file)) return;

    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
        const match = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)$/);
        if (match && !process.env[match[1]]) {
            process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
        }
    }
}

function requireEnv(name) {
    const value = process.env[name];
    if (!value) throw new Error('Missing ' + name);
    return value;
}

function latestShot() {
    if (!fs.existsSync(INDEX_FILE)) throw new Error('No shots/index.json — run daily.js first');

    const days = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
    if (!days.length) throw new Error('shots/index.json is empty');

    // daily.js writes newest first.
    return days[0];
}

function buildCaption(shot) {
    // "176 days till Carnival" → 176, so the rotation advances daily and is
    // stable for a given day no matter when the job runs.
    const days = parseInt(shot.caption, 10);
    const line = LINES[(Number.isFinite(days) ? days : 0) % LINES.length];

    return [shot.caption, '', line, '', TAGS].join('\n');
}

async function call(url, options = {}) {
    const response = await fetch(url, { method: 'POST', ...options });
    const text = await response.text();

    let body;
    try {
        body = JSON.parse(text);
    } catch {
        body = { raw: text.slice(0, 300) };
    }

    if (!response.ok) {
        const error = body.error || {};
        throw new Error(
            'Instagram API ' + response.status + ': ' +
            (error.message || body.raw || text.slice(0, 200)) +
            (error.error_user_msg ? ' — ' + error.error_user_msg : '')
        );
    }

    return body;
}

// Containers are usually ready immediately for images, but publishing an
// unfinished one fails with a misleading error, so confirm first.
async function waitForContainer(id, token) {
    for (let attempt = 0; attempt < 12; attempt++) {
        const url = new URL(API_BASE + '/' + id);
        url.searchParams.set('fields', 'status_code,status');
        url.searchParams.set('access_token', token);

        const body = await call(url, { method: 'GET' });

        if (body.status_code === 'FINISHED') return;
        if (body.status_code === 'ERROR' || body.status_code === 'EXPIRED') {
            throw new Error('Container ' + body.status_code + ': ' + (body.status || 'no detail'));
        }

        await new Promise(resolve => setTimeout(resolve, 5000));
    }

    throw new Error('Container never reached FINISHED');
}

async function post({ dryRun }) {
    const shot = latestShot();
    const caption = buildCaption(shot);
    const siteUrl = requireEnv('SITE_URL').replace(/\/+$/, '');
    const imageUrl = siteUrl + '/shots/' + shot.file;

    if (!shot.file.endsWith('.jpg')) {
        throw new Error('Instagram accepts JPEG only, but the latest shot is ' + shot.file);
    }

    console.log('image:   ' + imageUrl);
    console.log('caption: ' + caption.replace(/\n/g, '\n         '));

    if (dryRun) {
        console.log('Dry run: nothing published.');
        return;
    }

    const userId = requireEnv('IG_USER_ID');
    const token = requireEnv('IG_ACCESS_TOKEN');

    // The image must already be reachable — Instagram fetches it during this
    // call, not at publish time.
    const createUrl = new URL(API_BASE + '/' + userId + '/media');
    createUrl.searchParams.set('image_url', imageUrl);
    createUrl.searchParams.set('caption', caption);
    createUrl.searchParams.set('access_token', token);

    const container = await call(createUrl);
    console.log('container: ' + container.id);

    await waitForContainer(container.id, token);

    const publishUrl = new URL(API_BASE + '/' + userId + '/media_publish');
    publishUrl.searchParams.set('creation_id', container.id);
    publishUrl.searchParams.set('access_token', token);

    const published = await call(publishUrl);
    console.log('published: ' + published.id);
}

// Long-lived tokens last 60 days. Refreshing resets the clock, and only works
// on a token that is at least 24 hours old and not yet expired — so this has to
// run on a schedule, not once.
async function refresh() {
    const token = requireEnv('IG_ACCESS_TOKEN');

    const url = new URL('https://graph.instagram.com/refresh_access_token');
    url.searchParams.set('grant_type', 'ig_refresh_token');
    url.searchParams.set('access_token', token);

    const body = await call(url, { method: 'GET' });

    // Step outputs are not masked automatically, and this log is public. Tell
    // the runner to redact the new token before it can appear anywhere.
    if (process.env.GITHUB_ACTIONS) console.log('::add-mask::' + body.access_token);

    const days = Math.round((body.expires_in || 0) / 86400);
    console.log('Refreshed, valid ' + days + ' more days');

    // The workflow reads this to write the value back into the repo secret.
    if (process.env.GITHUB_OUTPUT) {
        fs.appendFileSync(process.env.GITHUB_OUTPUT, 'token=' + body.access_token + '\n');
    }

    // Never printed: it would land in the public build log.
    return body.access_token;
}

// Confirms a token works and reports the id to store as IG_USER_ID. Note this
// is user_id, not the "id" field — media endpoints want the former.
async function whoami() {
    const token = requireEnv('IG_ACCESS_TOKEN');

    const url = new URL('https://graph.instagram.com/v23.0/me');
    url.searchParams.set('fields', 'user_id,username,account_type');
    url.searchParams.set('access_token', token);

    const body = await call(url, { method: 'GET' });

    console.log('username:     ' + body.username);
    console.log('account_type: ' + body.account_type);
    console.log('IG_USER_ID:   ' + (body.user_id || body.id));
}

loadEnvFile();

const command = process.argv[2];
const dryRun = process.argv.includes('--dry-run');

const commands = { whoami, refresh, post: () => post({ dryRun }) };
const run = (commands[command] || commands.post)();

run.catch(err => {
    console.error(err.message);
    process.exit(1);
});
