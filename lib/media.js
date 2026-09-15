const path = require('node:path');
const childProcess = require('node:child_process');
const { selectBackend, videoArgs } = require('./video');

function executeCommand(cmd, args) {
    return new Promise((resolve, reject) => {
        const proc = childProcess.spawn(cmd, args);
        //console.log(cmd, args.join(' '));

        let buffer = '', errbuffer = '';
        proc.stdout.on('data', data => buffer += data);
        proc.stderr.on('data', data => errbuffer += data);

        proc.on('close', code => {
            if(code != 0) {
                reject(new Error(errbuffer.trim()));
                return;
            }
            resolve(buffer);
        });
        proc.on('error', err => reject(new Error(err)));
    });
}

async function processVideo(srcPath, needThumbnails, needVideo) {
    // Sizes (fit short edge): SM 240    M 320    XL 1280    H264 720
    let dimensions = await executeCommand('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:stream_side_data=rotation', '-of', 'flat', srcPath]);
    dimensions = {
        width: dimensions.match(/width=(.+)/)[1],
        height: dimensions.match(/height=(.+)/)[1],
        rotation: dimensions.match(/rotation=(.+)/)?.[1],
    };
    if(dimensions.rotation == '90' || dimensions.rotation == '-90') {
        [dimensions.width, dimensions.height] = [dimensions.height, dimensions.width];
        delete dimensions.rotation;
    }
    const landscape = dimensions.width > dimensions.height;

    let thumbs = {};
    if(needVideo) thumbs['film_h264'] = 720;
    if(needThumbnails) {
        thumbs['thumb_sm'] = 240;
        thumbs['thumb_m'] = 320;
        thumbs['thumb_xl'] = 1280;
    }
    for(const thumbType in thumbs) {
        const maxSize = thumbs[thumbType];
        const scale = landscape ? `'-2:min(${maxSize},ih)'` : `'min(${maxSize},iw):-2'`;
        let newPath = path.join(path.dirname(srcPath), path.parse(srcPath).name)+'-'+thumbType;
        
        if(thumbType != 'film_h264') {
            newPath += '.jpg';
            await executeCommand('ffmpeg', ['-v', 'error', '-y', '-i', srcPath, '-filter:v', 'thumbnail,scale='+scale, '-frames:v', '1', newPath]);
        } else {
            newPath += '.mp4';
            await executeCommand('ffmpeg', videoArgs(srcPath, newPath, scale, selectBackend()));
        }
        thumbs[thumbType] = newPath;
    }
    return thumbs;
}

async function processImage(srcPath) {
    let thumbs = {
        thumb_sm: 240,
        thumb_m: 320,
        thumb_xl: 1280
    };

    for(const thumbType in thumbs) {
        const maxSize = thumbs[thumbType];
        let newPath = path.join(path.dirname(srcPath), path.parse(srcPath).name)+'-'+thumbType+'.jpg';
        await executeCommand('magick', [srcPath, '-resize', `${maxSize}x${maxSize}^>`, newPath]);
        thumbs[thumbType] = newPath;
    }
    return thumbs;
}


module.exports = { executeCommand, processVideo, processImage };
