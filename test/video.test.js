const { test } = require('node:test');
const assert = require('node:assert/strict');
const { selectBackend, videoArgs } = require('../lib/video');

test('native auto detection and legacy Linux settings', () => {
    assert.equal(selectBackend({}, 'darwin'), 'videotoolbox');
    assert.equal(selectBackend({}, 'linux'), 'software');
    assert.equal(selectBackend({ USE_VAAPI: 'true' }, 'linux'), 'vaapi');
    assert.equal(selectBackend({ USE_VAAPI: 'true', VIDEO_BACKEND: 'software' }, 'darwin'), 'software');
    assert.throws(() => selectBackend({ VIDEO_BACKEND: 'typo' }), /VIDEO_BACKEND/);
});
test('VideoToolbox generates compatible H264 with AAC and faststart', () => {
    const args = videoArgs('source with spaces.mp4', 'output.mp4', "'-2:min(720,ih)'", 'videotoolbox', {});
    for (const value of ['h264_videotoolbox', 'aac', 'yuv420p', '+faststart', '5M']) assert.ok(args.includes(value));
    assert.equal(args[args.indexOf('-allow_sw') + 1], '0');
    assert.ok(args.includes('source with spaces.mp4'));
    assert.ok(!args.includes('-preset'));
    assert.throws(() => videoArgs('a', 'b', 'c', 'videotoolbox', { VIDEO_BITRATE: '-1' }), /BITRATE/);
});
test('software and VAAPI command lines stay compatible with upstream', () => {
    assert.deepEqual(videoArgs('a', 'b', 's', 'software'), ['-v', 'error', '-y', '-i', 'a', '-filter:v', 'scale=s', '-c:v', 'h264', '-preset', 'slow', 'b']);
    assert.deepEqual(videoArgs('a', 'b', 's', 'vaapi'), ['-v', 'error', '-y', '-hwaccel', 'vaapi', '-hwaccel_output_format', 'vaapi', '-i', 'a', '-filter:v', 'scale_vaapi=s', '-c:v', 'h264_vaapi', '-preset', 'slow', 'b']);
});
