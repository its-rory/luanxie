# 《乱写 (Luanxie)》项目部署与架构改造 Wiki 文档

本 Wiki 记录了《乱写》项目从最初的 macOS 独占版本到**多平台兼容适配**，再到**全新子卡片流式关联架构**的全部技术演进路径、部署手册与排错实录。

---

## 📖 目录
1. [项目背景与技术选型](#一-项目背景与技术选型)
2. [多平台兼容与 API 适配改造 (Mac / Linux / Windows)](#二-多平台兼容与-api-适配改造)
3. [核心变革：子卡片流式关联架构](#三-核心变革子卡片流式关联架构)
4. [智能体验：合并 AI 自动命名机制](#四-智能体验合并-ai-自动命名机制)
5. [前端交互与媒体展示优化](#五-前端交互与媒体展示优化)
6. [Linux 服务器部署保姆级教程](#六-linux-服务器部署保姆级教程)
7. [经典踩坑实录与避坑指南 (Troubleshooting)](#七-经典踩坑实录与避坑指南)

---

## 一、 项目背景与技术选型

《乱写》是一款高效率的个人私有化知识库整理系统：
- **无脑收录**：支持将语音（Web 录音）、文本碎片、图片附件拖入系统。
- **净化去噪**：AI 后台过滤语气助词、错别字，转译为得体、条理清晰的书面陈述。
- **自动归档**：AI 自动判断归入已有主题，或按需开辟新主题，并增量同步写入本地的 Obsidian 仓库。

---

## 二、 多平台兼容与 API 适配改造

原始项目深度绑定 macOS 硬件生态（如 `mlx-whisper` 和 plist 守护进程）。为支持低成本 Linux 云服务器和 Windows 部署，进行了如下改造：

### 1. PEP 508 条件性平台依赖安装 (`pyproject.toml`)
配置条件表达式，使系统自动根据平台和 CPU 架构安装对应的语音转写库：
- macOS Apple Silicon (ARM64) ➡️ 安装 `mlx-whisper`。
- 其他平台 (Linux / Windows / Intel Mac) ➡️ 自动降级安装 `faster-whisper`。

### 2. FFmpeg 强力预转码压缩 (`transcribe.py`)
在上传任何语音到云端 API 前，系统会在本地启动 `ffmpeg`，将浏览器录制的各种格式音频（如 webm, m4a）统一转码为 **16kHz 单声道 64kbps 的极轻量 `.mp3`**。这避免了非标准格式导致 API 500 报错，同时使上传文件体积压缩 5~10 倍，极大降低了请求延迟。

### 3. LLM 结构化输出兼容层 (`llm.py`)
- **双协议兼容**：通过 `call_structured` 薄封装，无缝转换 Anthropic 协议与标准 OpenAI 协议（以兼容 SiliconFlow、DeepSeek、OpenRouter 等接口）。
- **Payload 智能转换**：自动将 Anthropic 专属的多段 System 消息扁平化为 OpenAI 系统提示词；将 Anthropic 图像 base64 数据重写为标准的 OpenAI `image_url`。

---

## 三、 核心变革：子卡片流式关联架构

### 1. 为什么废弃旧版“LLM 全文重组合并”？
在老版本中，当新碎片加入主题时，系统会调用高级 LLM（如 Opus）将新数据重写并入主题的 `body_md` 中。该方案有三个致命缺陷：
1. **信息丢失**：随着文本增长，LLM 在反复重写中容易漏掉此前记录的微小事实。
2. **AI 幻觉与性能瓶颈**：长文本重写会导致响应时间指数级上升，且容易无中生有。
3. **溯源困难**：合并后，很难直观回溯某句话究竟是哪一天从哪条语音/图片中收录而来的。

### 2. 子卡片流式关联架构设计
我们将系统重构为 **子卡片（Sub-card Capture）与大主题（Topic）直接关联的多对一链接架构**：
- **大主题**：仅存标题、摘要和分类标签，不再存有冗长易错的 `body_md` 主体。
- **子卡片**：每条碎片（Capture）作为独立卡片依附于主题。卡片内完整保留了该条记录的**原始附件（音频/图片）、转写原文、AI解析、记录轨迹和精确到分钟的创建时间**。
- **流式合并渲染**：在前端主题详情页中，将所有关联的子卡片按照时间顺序以瀑布流形式渲染呈现，页面布局统一、紧凑。

### 3. 独立的版本快照与一键回退
- 数据库增设 `capture_versions` 快照表，每次用户手动修改某张子卡片的 AI 解析或转写原文时，系统都会自动记录前一版本的快照。
- 允许用户查看每张子卡片独立的**版本编辑历史与逐行 Diff 对比**，并支持一键 rollback（回滚），真正实现 100% 数据安全保障。

---

## 四、 智能体验：合并 AI 自动命名机制

由于取消了全文合并，为保证卡片拥有可读的标题以供检索和快速浏览，我们Repurposed了 **“合并 AI” (Merge AI)** 大模型，在后台执行**自动命名**：
1. **自动生成子卡片标题**：捕获记录净化完毕后，Merge AI 提取关键事实并自动生成 4~12 字的名词短语标题（如“一二期分拣机高度差”），展示在子卡片头部。
2. **自动生成新主题卡片标题**：若该记录判定为开辟新主题，Merge AI 会基于其内容生成一个大类别的概括性标题（如“分拣系统规划”）。
3. **手动修改支持**：在每张子卡片的编辑状态中，提供了“子卡片标题”输入框，支持手动修改并同步录入版本历史。
4. **高可用降级兜底**：如果 Merge AI 因 API 额度超限或网络抖动调用失败，系统会自动截取 AI 解析的前 12 个字作为默认标题，避免流水线阻塞。

---

## 五、 前端交互与媒体展示优化

1. **置信门槛配置优化**：去除了旧版数据库冗余的 API 置信度字段。在设置页中将阈值（High/Medium/Low）融合进按钮状态中，交互简单，且修改实时入库生效。
2. **图片附件 Lightbox 放大预览**：对图片卡片，摒弃了“听原音”字眼，改为“看原图”和直观的缩略图展示。点击缩略图会自动调起沉浸式 Lightbox 蒙层放大展示，再次点击任意处关闭。
3. **列表缩进适配**：修正了 ReactMarkdown 列表在 `.sub-card` 容器下的样式继承，添加了 `padding-left: 22px` 以免无序列表小黑点溢出卡片边缘。
4. **PWA 安全麦克风捕获**：添加了 Audio recorder 各种 null safety 检查，保证多平台环境下的安全录音与上传。

---

## 六、 Linux 服务器部署保姆级教程

### 1. 部署前置要求
- **系统要求**：Ubuntu 20.04+ 或 Debian 11+
- **必要工具**：`Node.js (18+)`、`npm`、`ffmpeg`、`uv`（极速包管理器）
```bash
sudo apt update
sudo apt install -y nodejs npm ffmpeg
curl -LsSf https://astral.sh/uv/install.sh | sh
```

### 2. 获取源码与配置 `.env`
```bash
git clone https://github.com/its-rory/luanxie.git /opt/luanxie
cd /opt/luanxie
cp .env.example .env
nano .env
```
在 `.env` 中按需填写您的 LLM Key，大模型推荐使用 **DeepSeek-V3 / DeepSeek-R1**：
```ini
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-xxxx
OPENAI_BASE_URL=https://api.siliconflow.cn/v1
TRANSCRIPTION_API_KEY=sk-xxxx
TRANSCRIPTION_BASE_URL=https://api.siliconflow.cn/v1
TRANSCRIPTION_MODEL=FunAudioLLM/SenseVoiceSmall # 中文推荐 SenseVoice，极速且准
CLASSIFY_MODEL=deepseek-ai/DeepSeek-V3
MERGE_MODEL=deepseek-ai/DeepSeek-R1 # 自动命名采用该满血推理大模型
```

### 3. 前端静态构建
```bash
cd /opt/luanxie/web
npm install
npm run build
cd ..
```

### 4. 创建 Python 3.12 虚拟环境并试运行
为了保障稳定性，**强烈建议锁死使用 Python 3.12 虚拟环境**，避开过新版本导致依赖库在 Linux 上现场 C++ 编译卡死的问题：
```bash
uv venv --python 3.12
# 使用阿里云镜像源极速安装依赖并运行
UV_INDEX_URL=https://mirrors.aliyun.com/pypi/simple/ uv run --python 3.12 uvicorn server.main:app --host 0.0.0.0 --port 8787
```

### 5. 注册 Systemd 后台常驻服务
将 `uv` 命令软链接至全局路径，然后注册 systemd 服务以开机自启：
```bash
sudo ln -sf /root/.local/bin/uv /usr/local/bin/uv
sudo ln -sf /root/.local/bin/uvx /usr/local/bin/uvx
sudo cp /opt/luanxie/scripts/luanxie.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now luanxie
```

### 6. 反向代理与 HTTPS 配置 (手机录音刚需)
iOS / Android 手机浏览器由于安全策略，**必须在 HTTPS 环境下才允许激活麦克风**。
- **推荐方案**：使用 1Panel 或 Nginx 反向代理，将二级域名指向服务器的 `127.0.0.1:8787` 端口。
- **证书获取**：在 1Panel 中网站设置中选择启用 HTTPS，验证方式选 **HTTP 自动**，系统将基于 Let's Encrypt 自动完成证书申领和自动续签。

---

## 七、 经典踩坑实录与避坑指南

### 1. Systemd 服务启动时报 Status 127 找不到 `uv`
- **原因**：`uv` 默认安装在当前用户的 `~/.local/bin` 下，Systemd 启动的干净环境不包含此 PATH。
- **解决**：参考部署步骤第 5 步，建立 `/usr/local/bin/uv` 软链接。

### 2. 依赖打包阶段进度条无限卡死在 `llvmlite`
- **原因**：Linux 系统的默认 Python 版本如果过新（如 3.14），`llvmlite` 和 `numba` 没有现成的预编译 wheel 包，uv 会在本地现场进行 C++ 源码编译，低配服务器会因为 CPU 或内存耗尽而卡死。
- **解决**：在创建虚拟环境时强行锁死 Python 3.12：`uv venv --python 3.12`。

### 3. Systemd 日志卡在 `Waiting to acquire exclusive lock`
- **原因**：异常 Ctrl+C 关闭或多进程争抢，导致 `.venv/.lock` 锁文件未被正确清除。
- **解决**：
  ```bash
  sudo systemctl stop luanxie
  sudo pkill -9 -f uv
  sudo pkill -9 -f python
  rm -f /opt/luanxie/.venv/.lock
  sudo systemctl start luanxie
  ```

### 4. 手机端连接系统后显示空白，无法上传语音
- **原因**：当前使用的是不安全的 HTTP 连接，手机浏览器安全限制禁用了 Web Audio API 和录音权限。
- **解决**：配置有效的二级域名解析并开启 HTTPS SSL 证书。

### 5. 硅基流动等第三方转写接口调用失败
- **原因**：使用了非标准的 `audio` 多模态 chat 大模型，其接口对于 Base64 编码的音频支持不稳定（甚至限制只能传公网 URL），或者音频格式不支持。
- **解决**：专职转写配置中，`TRANSCRIPTION_MODEL` 应选择标准的 ASR 专属转写模型（如 `SenseVoiceSmall`），由后台 FFmpeg 压缩为轻量 `mp3` 后，使用标准的文件流表单发送到 API 的转录端点 `/audio/transcriptions`。
