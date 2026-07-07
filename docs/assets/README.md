# 界面截图的重新生成

这里的截图是「截图即代码」:先用演示数据填库,再用 Playwright 以手机视口批量截取。项目界面改动后,按下面两步即可重新生成。

## 依赖

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install fastapi 'uvicorn[standard]' anthropic pydantic python-dotenv python-multipart playwright
playwright install chromium
```

## 步骤

在仓库根目录执行:

```bash
# 1. 填入演示数据(不调用任何 AI,只写 SQLite)
python docs/assets/seed_demo.py

# 2. 启动后端(需先构建过前端:cd web && npm install && npm run build)
uvicorn server.main:app --host 127.0.0.1 --port 8791 &

# 3. 截图 → docs/assets/shot-*.png
python docs/assets/capture_shots.py
```

- `seed_demo.py` 只写入演示用的主题与碎片,并清空后重填,可反复运行。
- 演示数据会写进 `data/luanxie.db`;正式使用前把 `data/` 删掉即可恢复空库。
- `.env` 里请把 `VAULT_EXPORT_DIR` 指向一个临时目录,避免演示导出误写真实 Obsidian 仓库。

## 截图清单

| 文件 | 界面 |
|---|---|
| `shot-capture.png` | 乱写 · 随手丢(语音 / 文字 / 照片) |
| `shot-inbox.png` | 收件箱 · 原样存底与处理状态 |
| `shot-review.png` | 待确认 · AI 拿不准时人工定夺 |
| `shot-topics.png` | 知识库 · 主题列表 |
| `shot-detail.png` | 主题详情 · 合并后的笔记 |
| `shot-detail-full.png` | 主题详情整页 · 版本历史 + diff + 回滚 |
| `shot-settings.png` | 设置 · 健康检查与手动导出 |
