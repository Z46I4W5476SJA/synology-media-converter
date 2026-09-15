// Real media checks, deliberately separate from unit tests. No NAS connection.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { executeCommand, processVideo, processImage } = require('../lib/media');
(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'converter.smoke-'));
    try {
        for (const [name, size, rate] of [['landscape', '1920x1080', 30], ['portrait', '1080x1920', 30], ['highfps', '3840x2160', 120]]) {
            const source = path.join(dir, `${name}.original.mp4`);
            await executeCommand('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=${rate}`, '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '1', '-c:v', 'hevc_videotoolbox', '-allow_sw', '0', '-tag:v', 'hvc1', '-c:a', 'aac', source]);
            const result = await processVideo(source, true, true);
            assert.equal(Object.keys(result).length, 4);
            for (const output of Object.values(result)) {
                assert.equal(path.dirname(output), dir);
                assert.ok(fs.statSync(output).size > 0);
            }
            const probe = JSON.parse(await executeCommand('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', result.film_h264]));
            const video = probe.streams.find(s => s.codec_type === 'video');
            assert.equal(video.codec_name, 'h264');
            assert.equal(video.pix_fmt, 'yuv420p');
            assert.equal(Math.min(video.width, video.height), 720);
            assert.equal(probe.streams.find(s => s.codec_type === 'audio').codec_name, 'aac');
            console.log(`${name}: HEVC -> H264 ${video.width}x${video.height} ${video.avg_frame_rate}, AAC; 3 thumbnails OK`);
        }
        const source = path.join(dir, 'image.original.heic');
        await executeCommand('magick', ['-size', '1600x1200', 'gradient:', source]);
        const images = await processImage(source);
        assert.equal(Object.keys(images).length, 3);
        for (const output of Object.values(images)) assert.ok(fs.statSync(output).size > 0);
        console.log('HEIC -> 3 JPEG thumbnails OK');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
})().catch(err => { console.error(err.message); process.exitCode = 1; });
