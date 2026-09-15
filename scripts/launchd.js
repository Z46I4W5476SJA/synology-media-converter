#!/usr/bin/env node
// Generate a reviewable plist; installation is an explicit manual step.
const path = require('node:path');
const fs = require('node:fs');
const root = path.resolve(__dirname, '..');
const interval = Number(process.env.RUN_INTERVAL || 3600);
if (!Number.isInteger(interval) || interval < 60) throw new Error('RUN_INTERVAL must be at least 60 seconds');
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
const config = path.resolve(process.env.CONFIG_PATH || path.join(root, 'config.json'));
fs.mkdirSync(path.join(root, 'logs'), { recursive: true });
const env = {
    PATH: process.env.PATH || '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin',
    CONFIG_PATH: config,
    VIDEO_BACKEND: process.env.VIDEO_BACKEND || 'auto',
    VIDEO_BITRATE: process.env.VIDEO_BITRATE || '5M',
    // Preserve retryability during initial native deployment; users can opt into set_broken.
    EXIT_ON_FAIL: process.env.EXIT_ON_FAIL || 'true',
};
if (process.env.TEMP_DIR) env.TEMP_DIR = path.resolve(process.env.TEMP_DIR);
console.log(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>local.synology-media-converter</string>
<key>ProgramArguments</key><array><string>${escape(process.execPath)}</string><string>${escape(path.join(root, 'main.js'))}</string></array>
<key>WorkingDirectory</key><string>${escape(root)}</string>
<key>EnvironmentVariables</key><dict>${Object.entries(env).map(([key, value]) => `<key>${key}</key><string>${escape(value)}</string>`).join('')}</dict>
<key>StartInterval</key><integer>${interval}</integer>
<key>RunAtLoad</key><false/>
<key>StandardOutPath</key><string>${escape(path.join(root, 'logs/stdout.log'))}</string>
<key>StandardErrorPath</key><string>${escape(path.join(root, 'logs/stderr.log'))}</string>
</dict></plist>`);
