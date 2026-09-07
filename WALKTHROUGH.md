# UI 设计系统全面重构与细节打磨成果总结

根据用户要求并参考开源优秀设计规范 [VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md)（特别是 Notion 和 Claude 的现代极简浅色排版哲学与设计令牌），对“乱写”前端进行了彻底的 UI/UX 重构与视觉体验升级。

---

## 解决的核心问题与改动明细

### 1. 知识库卡片无序列表圆点（Bullet）贴近卡片边缘问题彻底修复
- **问题分析**：
  在原样式中，全局 CSS reset `* { margin: 0; padding: 0; }` 将所有 `ul, ol` 的内边距全部清空。当知识库卡片渲染 Markdown 列表时，列表项无序圆点（`•`）直接紧贴在卡片左边缘边框甚至溢出，缺乏视觉缓冲区。
- **重构方案**：
  在 [styles.css](file:///C:/Users/Richard/.gemini/antigravity/brain/f03be4e0-dc42-43fd-9116-00b8bb1d955e/audit_repo/web/src/styles.css) 中对 `.clean-content ul`, `.trajectory-content ul`, `.note-body ul`, `.card ul`, `.sub-card ul`, `.markdown-body ul` 全面确立了设计系统排版缩进：
  ```css
  padding-left: 24px;
  margin: 8px 0;
  list-style-type: disc;
  ```
  列表项 `li` 配置 `margin-bottom: 6px; line-height: 1.7; padding-left: 4px;`，并将 `.sub-card` 容器内边距从 `18px` 拓展为 `18px 20px`。现在圆点距离卡片边界留有非常舒适的留白呼吸感，文本段落层次分明。

---

### 2. 按钮尺寸、高度与文字比例全面标准化
- **规范标准（参考 Notion / Claude Design System）**：
  - **标准按钮 (`.btn`)**：高度 `36px`，内边距 `0 16px`，字号 `13.5px`，字重 `500`，圆角 `8px`。
  - **紧凑操作按钮 (`.btn.small` / `.btn-sm`)**：高度 `28px`，内边距 `0 12px`，字号 `12px`，字重 `500`，圆角 `6px`。
  - **卡片轻量动作按钮 (`.action-btn`)**：高度 `26px`，内边距 `0 10px`，字号 `12px`，字重 `500`，圆角 `6px`，背景为柔和的浅底色，悬浮与点击带有平滑过渡。
  - **危险动作按钮 (`.action-btn.danger` / `.btn.danger`)**：采用红白相衬的警告色彩体系，杜绝旧版“删除”按钮错用蓝色高亮或无样式的现象。

- **各模块细节清理**：
  - **收件箱 ([InboxPage.tsx](file:///C:/Users/Richard/.gemini/antigravity/brain/f03be4e0-dc42-43fd-9116-00b8bb1d955e/audit_repo/web/src/pages/InboxPage.tsx))**：
    - 彻底纠正了旧版将“编辑”和“删除”写成 `.status-badge` 状态胶囊的滥用问题，恢复为规范的 `.action-btn` 与 `.action-btn.danger`。
    - 改派输入行：输入框高度提升至 `28px`，字号 `12.5px`，“确定”与“取消”按钮采用标准 `.btn.small` 规范，杜绝 `11px` 文字挤在逼仄边框里的不协调感。
  - **知识库详情 ([TopicDetail.tsx](file:///C:/Users/Richard/.gemini/antigravity/brain/f03be4e0-dc42-43fd-9116-00b8bb1d955e/audit_repo/web/src/pages/TopicDetail.tsx))**：
    - 标签编辑区的 `✓`、`✗` 与 `✏️` 按钮统一为标准化尺寸，居中对齐。
    - 子卡片头部操作区（“历史(n)”、“编辑”、“删除”）统一采用 `.action-btn`，删除使用危险红提示。
    - 子卡片历史回滚按钮与主题操作底栏（“主题历史”、“编辑主题标题”、“删除此主题”）统一比例和间距。
  - **待确认归类 ([ReviewPage.tsx](file:///C:/Users/Richard/.gemini/antigravity/brain/f03be4e0-dc42-43fd-9116-00b8bb1d955e/audit_repo/web/src/pages/ReviewPage.tsx))**：
    - 重构 AI 建议展示区域为 Callout 风格（柔和浅蓝背景 + 主题名称加粗 + 右侧置信度徽章）。
    - 批准、改派、不归档操作按钮采用主次分明的 `.btn.small` 规范，按钮与文字间距自然均衡。
  - **设置中心 ([SettingsPage.tsx](file:///C:/Users/Richard/.gemini/antigravity/brain/f03be4e0-dc42-43fd-9116-00b8bb1d955e/audit_repo/web/src/pages/SettingsPage.tsx))**：
    - 统一将输入框高亮高度调整为 `36px`，内边距 `0 12px`，字号 `13.5px`。
    - 供应商模型配置中，输入框、向下选择箭头按钮（`36px × 36px`）与“+ 添加模型”按钮高度严格保持水平对齐。
    - 顶部“已配置 ✓ / 未配置 ✗”按钮采用平衡的 `padding: 4px 12px` 与 `12px` 字号。

---

### 3. 状态徽章（Status Badge）动态圆点补全与色彩层级
- 在 [styles.css](file:///C:/Users/Richard/.gemini/antigravity/brain/f03be4e0-dc42-43fd-9116-00b8bb1d955e/audit_repo/web/src/styles.css) 中为 `StatusBadge.tsx` 的 `<span className="dot" />` 补充了原生 `6px × 6px` 圆点样式。
- 为进行中的任务状态（`pending`, `transcribing`, `classifying`, `merging`）增加了 `statusDotPulse` 呼吸脉冲动效。
- 补全了 8 种状态（排队、转写、归类、合并、待确认、已入库、失败、已拒绝）各自的柔和浅底色、边框色与前景色搭配，层次分明且视觉舒适。

---

### 4. 卡片视觉层级与投影设计
- 升级卡片投影系统：弃用原单一硬投影，采用双层平滑柔和阴影：
  - `var(--shadow-sm)`: `0 1px 3px rgba(0, 0, 0, 0.04), 0 4px 12px rgba(0, 0, 0, 0.02)`
  - `var(--shadow-md)`: `0 4px 14px rgba(0, 0, 0, 0.06), 0 1px 3px rgba(0, 0, 0, 0.03)`
- 搜索框（`.search-box`）增加平滑的 Focus ring 科技蓝高亮外环。

---

## 验证与构建结果

1. **前端工程编译 (TypeScript + Vite)**：
   ```bash
   > luanxie-web@0.1.0 build
   > tsc -b && vite build
   ✓ 205 modules transformed.
   dist/assets/index-wU4gvN8o.css   13.93 kB │ gzip:   3.42 kB
   dist/assets/index-DeMk_o-g.js   332.44 kB │ gzip: 102.27 kB
   ✓ built in 2.23s (0 errors)
   ```
2. **后端服务运行状态**：
   ```json
   {"queue_depth":0,"whisper_installed":true,"local_whisper":true,"cloud_whisper":true,"api_key_set":true,"auto_merge_existing_confidence":"medium","auto_merge_new_confidence":"high"}
   ```
   `systemctl status luanxie` 显示状态为 `active (running)`，反向代理头部 `--proxy-headers` 正常接收请求。
3. **版本控制与推送**：
   - 提交哈希：`bd2deb3`
   - 分支：`origin/main`
   - GitHub 仓库：`https://github.com/its-rory/luanxie.git`
