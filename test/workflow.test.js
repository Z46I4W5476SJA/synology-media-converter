const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

for (const scenario of ['success', 'conversion-error', 'retryable-error', 'upload-error', 'missing-tool']) {
    test(`Photos workflow: ${scenario}`, async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'converter-test-'));
        const bin = path.join(dir, 'bin'); fs.mkdirSync(bin);
        const tool = `#!${process.execPath}\nconst fs=require('fs');const path=require('path');const args=process.argv.slice(2);const name=path.basename(process.argv[1]);
if(args.includes('-version'))process.exit(0);
if(args.includes('-encoders')){console.log('libx264 h264_vaapi h264_videotoolbox');process.exit(0);}
if(name==='ffprobe'){console.log('width=1920\\nheight=1080');process.exit(0);}
if(process.env.TEST_FAIL==='true'){console.error('simulated conversion failure');process.exit(1);}
fs.writeFileSync(args.at(-1),'generated-media');`;
        for (const name of ['ffprobe', 'ffmpeg', 'magick']) fs.writeFileSync(path.join(bin, name), tool, { mode: 0o755 });
        if (scenario === 'missing-tool') fs.unlinkSync(path.join(bin, 'magick'));
        let handled = false; const calls = []; let upload = '';
        const server = http.createServer(async (req, res) => {
            let body = ''; for await (const chunk of req) body += chunk;
            const params = new URL(req.url, 'http://localhost').searchParams;
            const form = new URLSearchParams(body);
            const method = params.get('method') || form.get('method');
            calls.push(method || 'upload');
            let data = {};
            if (method === 'login') data = { device_id: 'test-device', sid: 'test-session', synotoken: 'test-token' };
            else if (method === 'list_convert_needed') data = { list: handled ? [] : [{ filename: 'clip.original.mp4', unit_id: 1, type: 1, need_thumbnail: true, need_video: true }] };
            else if (method === 'download') { res.setHeader('content-type', 'video/mp4'); res.end('original'); return; }
            else if (method === 'set_broken') handled = true;
            else { upload = body; handled = true; }
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify(scenario === 'upload-error' && !method ? { success: false, error: { code: 999 } } : { success: true, data }));
        });
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        try {
            const configPath = path.join(dir, 'config.json');
            fs.writeFileSync(configPath, JSON.stringify({ accounts: [{ url: `http://127.0.0.1:${server.address().port}`, username: 'test', password: 'test' }] }));
            const child = spawn(process.execPath, [path.resolve(__dirname, '../main.js')], {
                cwd: dir, env: { ...process.env, PATH: bin, CONFIG_PATH: configPath, TEMP_DIR: path.join(dir, 'tmp'), VIDEO_BACKEND: 'software', EXIT_ON_FAIL: String(scenario === 'retryable-error'), TEST_FAIL: String(['conversion-error', 'retryable-error'].includes(scenario)) },
            });
            let output = ''; child.stdout.on('data', b => output += b); child.stderr.on('data', b => output += b);
            const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
            assert.equal(code, scenario === 'success' ? 0 : 1, output);
            assert.deepEqual(fs.readdirSync(path.join(dir, 'tmp')), []);
            assert.equal(calls.includes('set_broken'), scenario === 'conversion-error');
            if (scenario === 'missing-tool') assert.deepEqual(calls, []);
            if (scenario === 'success') {
                for (const name of ['film_h264', 'thumb_sm', 'thumb_m', 'thumb_xl']) assert.ok(upload.includes(`name="${name}"`));
                assert.equal(JSON.parse(fs.readFileSync(configPath)).accounts[0].deviceId, 'test-device');
                assert.ok(output.includes('uploaded=1'));
            }
        } finally {
            await new Promise(resolve => server.close(resolve));
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
}
