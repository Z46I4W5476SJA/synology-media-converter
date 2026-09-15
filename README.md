# synology-media-converter

> [!NOTE]
> This project is not officially affiliated with Synology.

Since DSM version 7.2.2 Synology has removed the ability to generate thumbnails, transcode videos to H264 and display HEIC files in Synology Photos due to licensing restrictions. As an official solution they provide a tool called Synology Image Assistant which requires a computer and is only available for Windows and macOS. This project aims to restore the old way how Photos worked by providing a script that can be directly run on the NAS (or any other device that supports Docker) and automatically converts newly added media every night.

## Installation

**Container Manager:**\
You can easily install the service via the [Container manager](https://www.synology.com/de-de/dsm/feature/container-manager) by importing the file `ContainerManager_synology-media-converter.json` in the GUI. By default the script expects there to be a volume called docker that contains the `synology-media-converter.json` config described in [Configuration](#configuration). You can edit the host volume path at the very bottom of the preset file before importing it.

**Docker CLI:**
```bash
docker run -d --name=synology-media-converter \
    --network=host \
    -v <config_file>:/app/config.json \
    -e TZ=<timezone>
    -e CRON_INTERVAL="0 1 * * *" \
    -e USE_VAAPI=true \
    --device /dev/dri/renderD128 \
    ghcr.io/1randomdev/synology-media-converter
```

## Configuration
Example config for 2 users on the same device:
```json
{
    "accounts": [
        {
            "url": "http://192.168.1.10:5000",
            "username": "user1",
            "password": "secret"
        },
        {
            "url": "http://192.168.1.10:5000",
            "username": "user2",
            "password": "secret"
        }
    ]
}
```

## Environment Variables

| Variable | Description | Default |
| -------- | ----------- | ------- |
| TZ | Current timezone, necessary for crontab to use the correct time. [List](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones) of supported Timezones. | UTC |
| CRON_INTERVAL | Crontab interval that defines how often the script will be executed. [Crontab Generator](https://crontab.guru/) | `0 1 * * *` (Every day at 1am) |
| SINGLE_RUN | Only run the script once instead of using cron. Auto restart of the container must be disabled. | false |
| EXIT_ON_FAIL | Exit on conversion errors instead of permanently marking the affected file as broken. Usually only used for testing purposes. | false |
| USE_VAAPI | Enable hardware acceleration via VAAPI. For more info see [Hardware Acceleration](#hardware-acceleration). | false |

## Hardare Acceleration
Hardware transcoding to x264 is currently supported on Intel and AMD Graphics using VAAPI, which is what's available on most DiskStation models. To enable hardware acceleration add the environment variable `USE_VAAPI=true` and pass through the VAAPI device via `--device /dev/dri/renderD128`. The right permissions will be set automatically on startup.

## macOS (native, Apple Silicon / Mac mini)

[中文部署与验证说明](docs/MACOS.zh-CN.md)

This fork preserves the upstream Photos API flow, image and video thumbnails,
multiple accounts, interactive OTP/device ID, Docker cron, `SINGLE_RUN`, software
encoding and VAAPI. Native macOS automatically uses VideoToolbox for H.264
encoding. Run natively to access Apple hardware; the Linux Docker path remains VAAPI/software.

### Install and first run

Requires Node.js 22 or newer, FFmpeg (including `h264_videotoolbox`) and ImageMagick
with HEIC support. On the **Mac that will run the converter**:

```sh
brew install node ffmpeg imagemagick
npm ci
cp config.sample.json config.json
chmod 600 config.json
```

Set each account's `space` to `personal` (default, preserves upstream behavior)
or `shared` (uses `SYNO.FotoTeam` for queue, download, upload and failure marking).
For a service account processing only Shared Space, configure just one account
with `"space": "shared"`. This does not grant access to anyone else's Personal Space.

Edit `config.json` with your NAS URL and Photos account(s). Keep this file private;
it is ignored by Git. Run interactively first so that any OTP can be entered and
the device ID saved. The account needs access to the media in Photos.

```sh
LIST_ONLY=true npm start
EXIT_ON_FAIL=true MAX_FILES=1 npm start
```

Each native invocation processes the queue and exits. `SINGLE_RUN` and
`CRON_INTERVAL` belong to the Docker entrypoint; launchd schedules native runs.
Results are submitted through Photos' ConvertedFile API. API upload success is
logged, but playback and Photos indexing still require validation on your NAS.
No direct writes to `@eaDir` are performed.

### Native settings

| Variable | Default | Meaning |
| --- | --- | --- |
| `VIDEO_BACKEND` | `auto` | `auto`, `software`, `vaapi`, `videotoolbox`; auto selects VideoToolbox on macOS and software elsewhere |
| `USE_VAAPI` | `false` | Legacy setting retained; used when `VIDEO_BACKEND` is unset |
| `VIDEO_BITRATE` | `5M` | VideoToolbox target video bitrate (not a hard bandwidth cap) |
| `LIST_ONLY` | `false` | Log the visible queue without downloading, converting, uploading or marking failures |
| `MAX_FILES` | `0` | Stop after this many attempted conversions; 0 means unlimited |
| `CONFIG_PATH` | Repository `config.json` | Absolute or working-directory-relative configuration path |
| `TEMP_DIR` | Repository `tmp` | Temporary storage; allow space for an original plus generated files |
| `EXIT_ON_FAIL` | `false` | Upstream behavior retained: false marks conversion failures broken; true exits the account queue without marking |

Video sizing preserves upstream behavior: the **short edge** is at most 720 pixels
(1280×720 landscape, 720×1280 portrait for 16:9 media). Frame rate is preserved.
VideoToolbox output uses H.264 8-bit, AAC audio and MP4 faststart. HDR tone mapping
is not implemented; validate HDR footage separately. Processing is serial.
Temporary files are isolated per run/item and removed even after failures.
Dependency checks run before Photos access; failures return a nonzero exit status.

### Hourly launchd task

Generate on the target Mac, after moving the checkout to its permanent location:

```sh
node scripts/launchd.js > local.synology-media-converter.plist
plutil -lint local.synology-media-converter.plist
mkdir -p ~/Library/LaunchAgents
cp local.synology-media-converter.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/local.synology-media-converter.plist
```

The generator embeds absolute paths and the current PATH. It defaults to every
3600 seconds, does not run immediately when loaded, and sets `EXIT_ON_FAIL=true`
so initial failures remain retryable. Override `RUN_INTERVAL` (seconds, >=60),
`VIDEO_BACKEND`, `VIDEO_BITRATE`, `CONFIG_PATH`, `TEMP_DIR`, or `EXIT_ON_FAIL` when generating.
It does not install or load the task itself. The user must be logged in; sleeping
Macs do not process on schedule. launchd does not overlap its own job, but avoid
manual runs while the scheduled task is active. Logs append to `logs/stdout.log`
and `logs/stderr.log`; periodically rotate/remove old logs.

```sh
# Inspect / trigger / remove the job
launchctl print gui/$(id -u)/local.synology-media-converter
launchctl kickstart gui/$(id -u)/local.synology-media-converter
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/local.synology-media-converter.plist
```

### Validation

```sh
npm test
# Real generated HEVC (landscape, portrait, 4K120) + HEIC tests on Apple Silicon:
node scripts/smoke-media.js
```

Linux software/VAAPI arguments are covered by regression tests; physical VAAPI
hardware and a real Synology Photos end-to-end run must be tested separately.
