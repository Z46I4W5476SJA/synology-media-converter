function selectBackend(env = process.env, platform = process.platform) {
    const backend = env.VIDEO_BACKEND || (env.USE_VAAPI === 'true' ? 'vaapi' : 'auto');
    if (!['auto', 'software', 'vaapi', 'videotoolbox'].includes(backend)) {
        throw new Error('VIDEO_BACKEND must be auto, software, vaapi, or videotoolbox');
    }
    return backend === 'auto' ? (platform === 'darwin' ? 'videotoolbox' : 'software') : backend;
}

function videoArgs(source, target, scale, backend, env = process.env) {
    const args = ['-v', 'error', '-y'];
    if (backend === 'vaapi') {
        // Preserve the upstream Linux hardware path.
        return [...args, '-hwaccel', 'vaapi', '-hwaccel_output_format', 'vaapi', '-i', source,
            '-filter:v', 'scale_vaapi=' + scale, '-c:v', 'h264_vaapi', '-preset', 'slow', target];
    }
    args.push('-i', source, '-filter:v', 'scale=' + scale);
    if (backend === 'videotoolbox') {
        const bitrate = env.VIDEO_BITRATE || '5M';
        if (!/^\d+(?:\.\d+)?[kKmM]?$/.test(bitrate) || parseFloat(bitrate) <= 0) throw new Error('Invalid VIDEO_BITRATE');
        args.push('-c:v', 'h264_videotoolbox', '-allow_sw', '0', '-pix_fmt', 'yuv420p',
            '-b:v', bitrate, '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart');
    } else {
        args.push('-c:v', 'h264', '-preset', 'slow');
    }
    return [...args, target];
}
module.exports = { selectBackend, videoArgs };
