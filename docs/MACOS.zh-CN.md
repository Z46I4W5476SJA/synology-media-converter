# Mac mini 原生转码

保留上游的图片预览、图片/视频缩略图、待转换队列、多账号、OTP/设备 ID、
失败标记、Docker 定时任务、软件编码和 VAAPI。macOS 原生运行时自动使用
VideoToolbox 编码；从 Photos API 下载原片，生成结果后通过 API 上传。

## 专用 Photos 账号

建议普通用户 `photos-converter`，允许 Synology Photos 应用，不加入管理员组。
本方案不需要 SMB、SSH、File Station 或其他用户的 homes 权限。

Photos 共享空间可先设“自定义”，仅给目标文件夹及子文件夹“管理者”。
这是一组待实机验证的初始权限：群晖未公开 ConvertedFile 接口的完整权限规则，
需验证它能否列出并处理自定义权限范围的文件，不能把空队列直接当成全部完成。
若需要提高权限，先明确实际接口报错与可见范围，再决定。

其他人的个人空间不纳入本次部署。仅配置这个专用账号，勿把家庭成员账号填入配置。

## 安装与验证

在实际运行的 Mac mini 上使用 Node.js 22+、FFmpeg、ImageMagick（含 HEIC）。

```sh
npm ci --ignore-scripts
npm test
node scripts/smoke-media.js
cp config.sample.json config.json
chmod 600 config.json
```

编辑 `config.json`，填写 NAS URL 和专用账号。不要提交该文件。
首次手动运行：

```sh
EXIT_ON_FAIL=true npm start
```

需要 OTP 时在交互终端输入；设备 ID 会保存在同一配置文件中。
默认每次按队列串行处理。检查成功上传日志和 Photos 中的实际缩略图、播放结果。
当前输出沿用上游的短边最多 720 像素，不降低帧率；VideoToolbox 目标码率默认 5M。
120fps、HDR 或高动态场景应以真实素材再核对画质；未实现 HDR 色调映射。

## 定时运行

确认真实 Photos 验证通过后，在最终安装目录生成 plist：

```sh
node scripts/launchd.js > local.synology-media-converter.plist
plutil -lint local.synology-media-converter.plist
mkdir -p ~/Library/LaunchAgents
cp local.synology-media-converter.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/local.synology-media-converter.plist
```

默认每小时一次，加载时不立即运行。生成器默认设置 `EXIT_ON_FAIL=true`，
转换失败时保留以后重试的机会；显式设为 false 可继续使用上游 set_broken 行为。
用户需保持登录，睡眠期间不运行；不要同时手动启动第二份进程。
日志在项目 logs 目录中，需定期清理。

停用：

```sh
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/local.synology-media-converter.plist
```

## 验证记录（2026-09-15）

目标机器：Mac mini，Apple Silicon，macOS 15.6.1。

- 8 项自动测试通过：后端选择、旧版参数、模拟 Photos 上传与失败流程、临时文件清理。
- 合成 HEVC 横屏、竖屏、4K120：硬件转为 H.264 + AAC，短边 720，视频三档缩略图成功。
- 合成 HEIC：三档 JPEG 缩略图成功。
- `npm ci` 审计报告为 0 个已知漏洞。
- 尚待验证：专用用户访问真实 NAS 队列、上传注册、手机速度优先播放、真实 VAAPI 硬件。

这些合成素材测试不等于真实 DJI 素材或 Synology Photos 端到端验证。
