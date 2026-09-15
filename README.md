# synology-media-converter

为 **Synology Photos 自动生成图片预览、视频缩略图和 H.264 兼容播放版**，减少手动打开网页触发转换的操作。

本仓库 Fork 自 [1RandomDev/synology-media-converter](https://github.com/1RandomDev/synology-media-converter)，保留原项目功能，并增加 **Mac mini / macOS 原生 VideoToolbox 硬件转码、共享空间支持和 launchd 定时运行**。

> [!NOTE]
> 本项目为第三方工具，与群晖官方无隶属关系。它通过 Synology Photos API 工作，接口兼容性需要随 DSM / Photos 版本验证。

#生成视频720p视频后，手机上如果想远程查看视频卡顿，记得切换手机photos上的播放质量，改成以速度优先！！！
#生成视频720p视频后，手机上如果想远程查看视频卡顿，记得切换手机photos上的播放质量，改成以速度优先！！！
#生成视频720p视频后，手机上如果想远程查看视频卡顿，记得切换手机photos上的播放质量，改成以速度优先！！！


## 功能

- 自动查询 Photos 的待转换队列，按需处理新媒体。
- 生成图片和视频的三档 JPEG 缩略图：短边目标为 240、320、1280 像素。
- 通过 ImageMagick 处理 HEIC 等图片格式，具体支持取决于安装的格式解码器。
- 给需要转换的视频生成 H.264 播放版，视频短边最多 720 像素。
- 支持多个 Photos 账号、个人空间与共享空间。
- 支持交互式两步验证，并保存设备 ID。
- 支持软件编码、Linux VAAPI、macOS VideoToolbox。
- 支持 Docker Cron 和 macOS launchd 定时执行。
- 支持只查看队列、限制本轮处理数量、错误日志和临时文件清理。

## 工作流程

```text
NAS 中的照片 / 视频完成 Photos 索引
              ↓
通过 Photos API 查询待转换项目
              ↓
通过 Photos API 下载原片到临时目录
              ↓
ImageMagick 生成图片预览 / FFmpeg 生成视频与缩略图
              ↓
通过 ConvertedFile API 将结果上传给 Photos
              ↓
清理临时文件，记录结果，结束本轮
```

原片继续保存在 NAS。程序不直接写入 `@eaDir`，当前实现也不需要 SMB 挂载。

## 两种运行方式

| 运行环境 | 启动方式 | 视频编码 | 定时方式 |
| --- | --- | --- | --- |
| Mac mini / macOS | Node.js 原生执行 | VideoToolbox；也可指定软件编码 | launchd，默认每小时一次 |
| 群晖 / Linux | Docker 容器 | 软件编码或 Intel / AMD VAAPI | Cron，默认每天凌晨 1 点 |

Mac 版直接调用 macOS 的 VideoToolbox 编码器。每次启动后处理队列并退出，不需要一直开着终端。Mac 上的 Linux Docker 容器不使用这条 VideoToolbox 路径。

## macOS 安装

### 1. 准备运行环境

在**实际负责转码的 Mac** 上安装 Node.js 22 或更新版本、FFmpeg 和支持 HEIC 的 ImageMagick：

```sh
brew install node ffmpeg imagemagick
```

将项目放在固定目录，后台服务建议使用：

```text
~/Library/Application Support/SynologyMediaConverter
```

“文稿”和“桌面”等目录可能触发额外的 macOS 文件访问授权。进入项目目录后安装依赖：

```sh
npm ci --ignore-scripts
cp config.sample.json config.json
chmod 600 config.json
```

### 2. 配置 Photos 账号

编辑 `config.json`，以下为仅处理共享空间的示例：

```json
{
  "accounts": [
    {
      "url": "http://192.168.1.10:5000",
      "username": "photos-converter",
      "password": "填写账号密码",
      "space": "shared"
    }
  ]
}
```

| 配置项 | 含义 |
| --- | --- |
| `url` | NAS 的 DSM 地址及端口 |
| `username` / `password` | 允许使用 Photos 的账号及密码 |
| `space` | `personal` 表示该账号个人空间，`shared` 表示共享空间；省略时使用 `personal` |
| `deviceId` | 两步验证登录相关的设备 ID，由程序保存 |

多账号可在 `accounts` 数组中继续添加。需要同时处理两个空间时，可分别配置对应空间的账号条目。

建议使用专用普通账号，允许 Synology Photos 应用，并在 **Photos → 设置 → 共享空间** 中授予目标文件夹权限。Photos 内的权限与 DSM 共享文件夹权限需要分别核对；最低权限以实际接口返回为准。处理共享空间不需要访问其他用户的 `homes`，当前 API 方案不要求 SMB、File Station 或 NAS SSH 权限。

`config.json` 含有凭据，已加入 Git 忽略规则，不要提交或公开它。

### 3. 首次验证

先只查看可见队列，再限制为处理一个项目：

```sh
LIST_ONLY=true npm start
EXIT_ON_FAIL=true MAX_FILES=1 npm start
```

账号需要两步验证时，请在交互终端输入 OTP。完成后程序将设备 ID 保存在同一配置文件中。确认上传日志和 Photos 中的实际结果后，可运行完整队列：

```sh
EXIT_ON_FAIL=true npm start
```

### 4. 每小时自动运行

在目标 Mac 的最终项目目录中生成配置：

```sh
node scripts/launchd.js > local.synology-media-converter.plist
plutil -lint local.synology-media-converter.plist
mkdir -p ~/Library/LaunchAgents
cp local.synology-media-converter.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/local.synology-media-converter.plist
```

生成器默认设置：

- 每 3600 秒运行一次；加载时不立即执行。
- 使用当前 Node.js 的绝对路径和当前 PATH。
- 设置 `EXIT_ON_FAIL=true`，转换失败时保留后续重试机会。
- 标准日志写入 `logs/stdout.log`，错误写入 `logs/stderr.log`。

如需改变间隔，例如每 30 分钟，在生成时设置：

```sh
RUN_INTERVAL=1800 node scripts/launchd.js > local.synology-media-converter.plist
```

重新生成后，需要卸载旧任务、复制新 plist，再加载。`RUN_INTERVAL` 最小为 60 秒。

用户需要保持登录；Mac 睡眠期间不会按时转换。launchd 不会重叠启动同一任务，但应避免定时任务运行时另开手动实例。日志会持续追加，需要定期清理。

macOS 可能要求在 **系统设置 → 隐私与安全性 → 本地网络** 中允许 Node。SSH 中运行成功不代表后台权限已经生效，应单独验证 launchd 的日志和退出码。

```sh
# 查看任务状态
launchctl print gui/$(id -u)/local.synology-media-converter

# 立即执行一次
launchctl kickstart gui/$(id -u)/local.synology-media-converter

# 停用任务
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/local.synology-media-converter.plist

# 查看日志
tail -n 30 logs/stdout.log
tail -n 30 logs/stderr.log
```

更换安装目录或升级 Node 后，若原路径失效，需要重新生成并加载 plist。

## 群晖 / Linux Docker 安装

### 使用本 Fork 的代码

在本仓库目录构建镜像：

```sh
docker build -t synology-media-converter:local .
```

准备好宿主机上的 `config.json`，将下面示例中的 `/absolute/path/config.json` 替换为实际绝对路径：

```sh
docker run -d --name synology-media-converter \
  --network=host \
  -v /absolute/path/config.json:/app/config.json \
  -e TZ=Asia/Shanghai \
  -e CRON_INTERVAL="0 * * * *" \
  synology-media-converter:local
```

启用 Intel / AMD VAAPI 时，在镜像名之前增加：

```sh
-e USE_VAAPI=true \
--device /dev/dri/renderD128 \
```

需要主机具备对应设备、驱动与访问权限。原启动脚本会检查 `/dev/dri/renderD128`，设备不存在时关闭旧版 `USE_VAAPI` 开关。

### 使用上游发布的镜像或 Container Manager 模板

原项目镜像为 `ghcr.io/1randomdev/synology-media-converter`。仓库保留了 `ContainerManager_synology-media-converter.json` 导入模板，可按实际 NAS 路径修改配置文件挂载位置。

**上游镜像不包含本 Fork 新增的共享空间等改动。** 需要本仓库功能时，应构建当前代码，并在 Container Manager 中选择相应镜像。

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `VIDEO_BACKEND` | `auto` | `auto`、`software`、`vaapi`、`videotoolbox`；自动模式在 macOS 使用 VideoToolbox，其他平台使用软件编码 |
| `USE_VAAPI` | `false` | 保留上游开关；未设置 `VIDEO_BACKEND` 时生效 |
| `VIDEO_BITRATE` | `5M` | VideoToolbox 的目标视频码率，不是严格带宽上限 |
| `CONFIG_PATH` | 项目内 `config.json` | 配置文件路径；可使用绝对路径 |
| `TEMP_DIR` | 项目内 `tmp` | 临时目录，需要容纳原片及生成文件 |
| `LIST_ONLY` | `false` | 只输出待转换队列，不下载、不转换、不上传、不标记失败；登录可能保存本地设备 ID |
| `MAX_FILES` | `0` | 限制本轮转换尝试数量；0 表示不限 |
| `EXIT_ON_FAIL` | `false` | false 沿用上游的失败标记行为；true 遇到转换失败退出当前账号队列，不永久标记损坏 |
| `TZ` | Docker 镜像默认 UTC | 容器时区，例如 `Asia/Shanghai` |
| `CRON_INTERVAL` | `0 1 * * *` | Docker 定时表达式；不控制原生 macOS 运行 |
| `SINGLE_RUN` | `false` | Docker 只运行一次后退出；使用时关闭容器自动重启 |
| `RUN_INTERVAL` | `3600` | 仅供 launchd 生成器使用，单位为秒 |

## 输出规格与边界

- 视频沿用上游缩放规则：**短边最多 720 像素**；例如横屏 1280×720、竖屏 720×1280，保留原帧率。
- VideoToolbox 输出为 H.264 8 位视频、AAC 音频、支持 faststart 的 MP4。
- 未实现 HDR 色调映射，HDR 素材需单独核对画质。
- 队列串行处理，每个项目使用独立临时目录，失败后也执行清理。
- `list_convert_needed` 队列为空，不代表所有历史视频都有压缩版：本次实测发现历史 `broken` 项不在普通待处理队列里。
- Photos 的 `orig_h264` 表示原片本身兼容，不是额外生成的小视频。`high` 和 `medium` 是不同播放档位，应按实际存在的档位验证。
- 定时任务使用增量队列，不会每小时遍历整个媒体库，也不会自动重试历史 `broken` 项。

## 测试与验证

```sh
# 自动测试：后端选择、旧版参数、个人/共享空间 API、失败处理和清理
npm test

# 在 Apple Silicon Mac 上使用合成 HEVC、HEIC 做真实媒体测试
node scripts/smoke-media.js
```

已完成 Mac mini 原生转码、真实 NAS 下载与回传、历史失败项修复、播放文件读取，以及 launchd 后台运行验证。Linux/macOS 自动测试通过；物理 VAAPI 硬件及手机完整播放体验仍需在对应环境验证。

详见 [macOS 中文部署与验证说明](docs/MACOS.zh-CN.md)。

## 上游与许可证

- 上游项目：[1RandomDev/synology-media-converter](https://github.com/1RandomDev/synology-media-converter)
- 许可证：[GPL-3.0](LICENSE.md)
- 本 Fork 保留原项目 Git 历史，便于继续合并上游修复。
