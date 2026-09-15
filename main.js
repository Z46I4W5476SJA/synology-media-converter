const fs = require('fs');
const readline = require('readline');
const path = require('node:path');
const { processVideo, processImage, executeCommand } = require('./lib/media');
const { selectBackend } = require('./lib/video');
const { login, checkConversionNeeded, downloadFile, uploadFiles, setBroken } = require('./lib/photos');
const configPath = path.resolve(process.env.CONFIG_PATH || path.join(__dirname, 'config.json'));
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const tempRoot = path.resolve(process.env.TEMP_DIR || path.join(__dirname, 'tmp'));
const log = (...args) => console.log(new Date().toISOString(), ...args);

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
        const listOnly = process.env.LIST_ONLY === 'true';
        const maxFiles = Number(process.env.MAX_FILES || 0);
        if (!Number.isInteger(maxFiles) || maxFiles < 0) throw new Error('MAX_FILES must be a nonnegative integer');
        const backend = selectBackend();
        log(`Video backend: ${backend}`);
        // Check dependencies before contacting Photos or marking any file broken.
        if (!listOnly) {
            await executeCommand('ffprobe', ['-version']);
            await executeCommand('magick', ['-version']);
            const encoders = await executeCommand('ffmpeg', ['-hide_banner', '-encoders']);
            const encoder = { software: 'libx264', vaapi: 'h264_vaapi', videotoolbox: 'h264_videotoolbox' }[backend];
            if(!encoders.includes(encoder)) throw new Error(`FFmpeg is missing ${encoder}`);
        }
        for(const account of config.accounts) {
            log(`Logging in as ${account.username} on ${account.url}, space=${account.space || "personal"}`);
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
                if (listOnly) {
                    log(`Visible queue entries: ${conversionNeeded.length}`);
                    for (const item of conversionNeeded) log(JSON.stringify(item));
                    break;
                }
                if(conversionNeeded.length == 0) {
                    log('Finished, no files for conversion left');
                    break;
                }
                
                for(const fileInfo of conversionNeeded) {
                    if (maxFiles && succeeded + failed >= maxFiles) {
                        log(`Reached MAX_FILES=${maxFiles}`);
                        return;
                    }
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
