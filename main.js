const fs = require('fs');
const readline = require('readline');
const { Readable } = require('stream');
const { finished } = require('stream/promises');
const path = require('node:path');
const { processVideo, processImage, executeCommand } = require('./lib/media');
const { selectBackend } = require('./lib/video');
const axios = require('axios');
const configPath = path.resolve(process.env.CONFIG_PATH || path.join(__dirname, 'config.json'));
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const tempRoot = path.resolve(process.env.TEMP_DIR || path.join(__dirname, 'tmp'));
const log = (...args) => console.log(new Date().toISOString(), ...args);

async function login(account) {
    const session = { url: account.url };
    let res = await fetch(account.url+'/webapi/entry.cgi', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
            api: 'SYNO.API.Auth',
            version: 7,
            method: 'login',
            enable_syno_token: 'yes',
            enable_device_token: 'yes',
            format: 'sid',
            device_name: 'SynologyMediaConverter',
            device_id: account.deviceId || '',
            account: account.username,
            passwd: account.password,
            otp_code: account.otpCode || ''
        })
    });
    res = await res.json();
    if(!res.success) {
        if(res.error.code == 403) {
            session.requireOtp = true;
            return session;
        } else {
            throw new Error('Authentication failed with error '+JSON.stringify(res.error));
        }
    }

    session.did = res.data.device_id;
    session.sid = res.data.sid;
    session.synoToken = res.data.synotoken;
    return session;
}

async function checkConversionNeeded(session) {
    let res = await fetch(session.url+'/webapi/entry.cgi', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-Syno-Token': session.synoToken,
            'Cookie': `did=${session.did}; id=${session.sid}`
        },
        body: new URLSearchParams({
            api: 'SYNO.Foto.Upload.ConvertedFile',
            version: 3,
            method: 'list_convert_needed',
            type: '["photo","video","live_video"]',
            preset: 'windows'
        })
    });
    res = await res.json();
    if(!res.success) throw new Error('Requesting conversion needed failed with error '+JSON.stringify(res.error));
    return res.data.list;
}

async function downloadFile(session, unitId, savePath) {
    let res = await fetch(session.url+'/webapi/entry.cgi?'+new URLSearchParams({
        api: 'SYNO.Foto.Download',
        version: 1,
        method: 'download',
        unit_id: '['+unitId+']'
    }), {
        headers: {
            'X-Syno-Token': session.synoToken,
            'Cookie': `did=${session.did}; id=${session.sid}`
        }
    });
    if(!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
    if((res.headers.get('content-type') || '').includes('json')) {
        res = await res.json();
        throw new Error(`Download of file ${unitId} returned JSON instead of media`);
    } else {
        const fileStream = fs.createWriteStream(savePath, { flags: 'w' });
        await finished(Readable.fromWeb(res.body).pipe(fileStream));
    }
}

/*async function uploadFiles(session, unitId, filePaths) {
    // Upload fails due to bug in Fetch API or built in FormData
    const form = new FormData();
    form.set('api', 'SYNO.Foto.Upload.ConvertedFile');
    form.set('version', '3');
    form.set('method', 'upload');
    form.set('unit_id', unitId);
    for(const name in filePaths) {
        const path = filePaths[name];
        form.set(name, fs.createReadStream(path));
    }

    let res = await fetch(session.url+'/webapi/entry.cgi', {
        method: 'POST',
        headers: {
            'X-Syno-Token': session.synoToken,
            'Cookie': `did=${session.did}; id=${session.sid}`
        },
        body: form
    });
    res = await res.json();
    console.log(res)
    if(!res.success) throw new Error(`Upload of file ${unitId} failed with error `+JSON.stringify(res.error));
}*/
async function uploadFiles(session, unitId, filePaths) {
    const form = {
        api: 'SYNO.Foto.Upload.ConvertedFile',
        version: 3,
        method: 'upload',
        unit_id: unitId
    };
    for(const name in filePaths) {
        const path = filePaths[name];
        form[name] = fs.createReadStream(path);
    }
    const res = await axios.postForm(session.url+'/webapi/entry.cgi', form, {
        headers: {
            'X-Syno-Token': session.synoToken,
            'Cookie': `did=${session.did}; id=${session.sid}`
        }
    });
    if(!res.data.success) throw new Error(`Upload of file ${unitId} failed with error `+JSON.stringify(res.data.error));
}

async function setBroken(session, unitId) {
    if(process.env.EXIT_ON_FAIL == 'true') {
        throw new Error('Exit on broken file is enabled.');
    }

    let res = await fetch(session.url+'/webapi/entry.cgi?'+new URLSearchParams({
        api: 'SYNO.Foto.Upload.ConvertedFile',
        version: 3,
        method: 'set_broken',
        id: '['+unitId+']',
        type: '["photo","video"]' // TODO: only set affacted types broken
    }), {
        headers: {
            'X-Syno-Token': session.synoToken,
            'Cookie': `did=${session.did}; id=${session.sid}`
        }
    });
    res = await res.json();
    if(!res.success) throw new Error(`Marking file ${unitId} as broken failed with error `+JSON.stringify(res.error));
}

async function cleanupFiles(filePaths) {
    for(const path of Object.values(filePaths)) {
        await fs.promises.unlink(path);
    }
}

function readLine(prompt) {
    return new Promise(resolve => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        rl.question(prompt, text => {
            rl.close();
            resolve(text);
        });
    });
}


(async () => {
    fs.mkdirSync(tempRoot, { recursive: true });
    const runDir = fs.mkdtempSync(path.join(tempRoot, 'run-'));
    let succeeded = 0, failed = 0;
    const started = Date.now();

    try {
        const backend = selectBackend();
        log(`Video backend: ${backend}`);
        // Check dependencies before contacting Photos or marking any file broken.
        await executeCommand('ffprobe', ['-version']);
        await executeCommand('magick', ['-version']);
        const encoders = await executeCommand('ffmpeg', ['-hide_banner', '-encoders']);
        const encoder = { software: 'libx264', vaapi: 'h264_vaapi', videotoolbox: 'h264_videotoolbox' }[backend];
        if(!encoders.includes(encoder)) throw new Error(`FFmpeg is missing ${encoder}`);
        for(const account of config.accounts) {
            log(`Logging in as ${account.username} on ${account.url}`);
            let session = await login(account);
            if(session.requireOtp) {
                if(!process.stdin.isTTY) throw new Error('2FA required: run npm start interactively first.');
                account.otpCode = await readLine('Account requires 2FA, please enter OTP code: ');
                session = await login(account);
                delete account.otpCode;
                if(session.requireOtp) throw new Error('OTP was rejected; run again with a fresh code.');
            }
            if(!account.deviceId) {
                account.deviceId = session.did;
                fs.writeFileSync(configPath, JSON.stringify(config, null, 4), { mode: 0o600 });
            }
            
            checkLoop: while(true) {
                log('Checking if conversion is needed');
                const conversionNeeded = await checkConversionNeeded(session);
                if(conversionNeeded.length == 0) {
                    log('Finished, no files for conversion left');
                    break;
                }
                
                for(const fileInfo of conversionNeeded) {
                    const itemDir = fs.mkdtempSync(path.join(runDir, 'item-'));
                    const itemStarted = Date.now();
                    try {
                        log(`Converting file "${fileInfo.filename}" (${fileInfo.unit_id})`);
                        const srcPath = path.join(itemDir, path.basename(fileInfo.filename));
                        let filePaths = {};
                        
                        await downloadFile(session, fileInfo.unit_id, srcPath);
                        try {
                            switch(fileInfo.type) {
                                case 0:
                                    filePaths = await processImage(srcPath);
                                    break;
                                case 1:
                                    filePaths = await processVideo(srcPath, fileInfo.need_thumbnail, fileInfo.need_video);
                                    break;
                                default:
                                    throw new Error(`Unsupported media type: ${fileInfo.type}`);
                            }
                        } catch(err) {
                            failed++;
                            process.exitCode = 1;
                            console.error('Conversion failed:', err.message);
                            await setBroken(session, fileInfo.unit_id);
                            continue;
                        }
                        await uploadFiles(session, fileInfo.unit_id, filePaths);
                        succeeded++;
                        log(`Uploaded ${fileInfo.filename} in ${((Date.now() - itemStarted) / 1000).toFixed(1)}s`);
                        filePaths['src'] = srcPath;
                        await cleanupFiles(filePaths);
                    } catch(err) {
                        process.exitCode = 1;
                        console.error(err.message);
                        break checkLoop;
                    } finally {
                        fs.rmSync(itemDir, { recursive: true, force: true });
                    }
                }
            }
        }
    } catch(err) {
        process.exitCode = 1;
        console.error(err.message);
    } finally {
        fs.rmSync(runDir, { recursive: true, force: true });
        log(`Run finished: uploaded=${succeeded}, conversion_failed=${failed}, elapsed=${((Date.now() - started) / 1000).toFixed(1)}s, exit=${process.exitCode || 0}`);
    }
})();
