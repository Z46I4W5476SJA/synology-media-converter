const fs = require('node:fs');
const { Readable } = require('node:stream');
const { finished } = require('node:stream/promises');
const axios = require('axios');

async function login(account) {
    const space = account.space || 'personal';
    if (!['personal', 'shared'].includes(space)) throw new Error('Account space must be personal or shared');
    const session = { url: account.url, apiPrefix: space === 'shared' ? 'SYNO.FotoTeam' : 'SYNO.Foto' };
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
            api: session.apiPrefix + '.Upload.ConvertedFile',
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
        api: session.apiPrefix + '.Download',
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
        throw new Error(`Download of file ${unitId} returned JSON instead of media (API error ${res.error?.code ?? "unknown"})`);
    } else {
        const fileStream = fs.createWriteStream(savePath, { flags: 'w' });
        await finished(Readable.fromWeb(res.body).pipe(fileStream));
    }
}

async function uploadFiles(session, unitId, filePaths) {
    const form = {
        api: session.apiPrefix + '.Upload.ConvertedFile',
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
        api: session.apiPrefix + '.Upload.ConvertedFile',
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

module.exports = { login, checkConversionNeeded, downloadFile, uploadFiles, setBroken };
