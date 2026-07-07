"""用真实结构填充演示数据,供 README 截图使用(不调用任何 AI)。"""
import json

from server import db

conn = db.get_conn()
# 清空,保证可重复运行
for t in ("captures", "topics", "topic_versions", "processing_log"):
    conn.execute(f"DELETE FROM {t}")
conn.execute("DELETE FROM topics_fts")
conn.commit()


def backdate(table, id_col, id_val, **cols):
    sets = ", ".join(f"{k}=?" for k in cols)
    conn.execute(f"UPDATE {table} SET {sets} WHERE {id_col}=?", (*cols.values(), id_val))
    conn.commit()


def make_topic(title, summary, body_versions, tags, created, updated, exported_version):
    """body_versions: 依次写入的正文列表,最后一个是当前版本;前面的进版本历史。"""
    t = db.create_topic(title, summary=summary)
    tid = t["id"]
    for i, body in enumerate(body_versions):
        db.update_topic(tid, f"cap-{tid[:6]}{i}", title=title, summary=summary,
                        body_md=body, tags=tags)
    backdate("topics", "id", tid, created_at=created, updated_at=updated,
             exported_version=exported_version, summary=summary)
    return tid


# ---------------- 主题 ----------------
A_BODY_V0 = (
    "提示缓存让重复的长前缀只算一次全价,之后命中按约十分之一计费,还更快。\n\n"
    "- 适合 system prompt、长文档、工具定义这类每次请求都重复的内容\n"
    "- 在要缓存的内容块上加 `cache_control: {\"type\": \"ephemeral\"}`\n\n"
    "## 记录轨迹\n"
    "- 2026-06-28 收录:提示缓存基本用法与 ephemeral 标记 ^cap-a1b2c3\n"
)
A_BODY_V1 = (
    "提示缓存让重复的长前缀只算一次全价,之后命中按约十分之一计费,还更快。\n\n"
    "## 用法\n"
    "- 适合 system prompt、长文档、工具定义这类每次请求都重复的内容\n"
    "- 在要缓存的内容块上加 `cache_control: {\"type\": \"ephemeral\"}`,标记到哪块为止都进缓存\n"
    "- 缓存有最短长度门槛,太短的内容加了也不会缓存\n\n"
    "## 计费与收益\n"
    "- 写入缓存比普通输入略贵(约 1.25×),命中读取便宜很多(约 0.1×)\n"
    "- 门槛:同一前缀在 5 分钟内被复用两次以上才划算\n\n"
    "## 记录轨迹\n"
    "- 2026-06-28 收录:提示缓存基本用法与 ephemeral 标记 ^cap-a1b2c3\n"
    "- 2026-07-02 收录:补充计费比例与 5 分钟 TTL ^cap-d4e5f6\n"
)
A_BODY_V2 = (
    "提示缓存让重复的长前缀只算一次全价,之后命中按约十分之一计费,还更快。适合 "
    "system prompt、长文档、工具定义这类每次请求都重复的内容。\n\n"
    "## 用法\n"
    "- 在要缓存的内容块上加 `cache_control: {\"type\": \"ephemeral\"}`,标记到哪块为止都进缓存\n"
    "- 缓存有最短长度门槛,太短的内容加了也不会缓存\n"
    "- TTL 约 5 分钟,每次命中会刷新;需要的话用定时空请求保活\n\n"
    "## 计费与收益\n"
    "- 写入缓存比普通输入略贵(约 1.25×),命中读取便宜很多(约 0.1×)\n"
    "- 门槛:同一前缀在 5 分钟内被复用两次以上才划算\n"
    "- [[乱写 App 的产品决策]] 里 merge 的 system prompt 就走了 ephemeral 缓存\n\n"
    "## 踩过的坑\n"
    "- system 数组里 `cache_control` 的位置决定缓存边界;往里插时间戳会让缓存整段失效——所以 prompt 别放动态内容\n"
    "- 第三方兼容端点不一定支持,要留一条无缓存的回退路径\n\n"
    "## 记录轨迹\n"
    "- 2026-06-28 收录:提示缓存基本用法与 ephemeral 标记 ^cap-a1b2c3\n"
    "- 2026-07-02 收录:补充计费比例与 5 分钟 TTL ^cap-d4e5f6\n"
    "- 2026-07-05 收录:踩坑——system 里放时间戳导致缓存失效 ^cap-7a8b9c\n"
)
A = make_topic(
    "Claude 提示缓存实战",
    "Anthropic 提示缓存的用法、计费门槛与踩坑,用于降低重复长前缀的成本。",
    [A_BODY_V0, A_BODY_V1, A_BODY_V2],
    ["AI 工程", "提示缓存", "成本优化", "Claude"],
    created="2026-06-28T09:12:00+00:00", updated="2026-07-05T21:40:00+00:00",
    exported_version=2,
)

B_BODY_V0 = (
    "把随手记的碎片(语音/文字/图片)自动长成结构化知识库,再导出到 Obsidian。"
    "核心是原文永不丢、合并可回滚。\n\n"
    "## 记录轨迹\n"
    "- 2026-06-20 收录:产品定位与三条铁律 ^cap-11aa22\n"
)
B_BODY_V1 = (
    "把随手记的碎片(语音/文字/图片)自动长成结构化知识库,再导出到 Obsidian。"
    "核心是原文永不丢、合并可回滚。\n\n"
    "## 关键取舍\n"
    "- **原样存底**:每条乱写先进收件箱,原文 / 原音频 / 原图永久保留,任何 AI 结果都能重放\n"
    "- **净化不改写**:转写只去语气词、纠错别字,不润色不添意(AudioPen 的差评教训)\n"
    "- **合并不丢信息**:旧笔记的每条事实都要保留,靠 [[Claude 提示缓存实战]] 里的长上下文 + 防缩水兜底\n"
    "- **高置信才自动**:AI 拿不准的进待确认,宁可让用户点一下,也不自信地猜错\n\n"
    "## 记录轨迹\n"
    "- 2026-06-20 收录:产品定位与三条铁律 ^cap-11aa22\n"
    "- 2026-07-01 收录:补充待确认队列的置信度门槛设计 ^cap-33bb44\n"
)
B = make_topic(
    "乱写 App 的产品决策",
    "乱写这款知识库工具的定位与核心取舍:原样存底、净化不改写、合并不丢信息、高置信才自动。",
    [B_BODY_V0, B_BODY_V1],
    ["产品设计", "笔记工具", "AI 产品"],
    created="2026-06-20T14:00:00+00:00", updated="2026-07-01T10:20:00+00:00",
    exported_version=1,
)

C_BODY = (
    "Tailscale 用 WireGuard 组一张私有子网,让 iPhone 在外网也能直连家里的 Mac。\n\n"
    "- Mac 和 iPhone 登录同一账号即自动组网,靠 MagicDNS 拿到 `xxx.ts.net` 主机名\n"
    "- `tailscale cert` 能签受信任证书,配合 HTTPS 满足浏览器录音的 secure context\n"
    "- 出门在外走 DERP 中继,同一局域网内自动直连\n\n"
    "## 记录轨迹\n"
    "- 2026-06-25 收录:组网原理与 MagicDNS ^cap-55cc66\n"
    "- 2026-07-03 收录:证书签发满足 HTTPS 录音 ^cap-77dd88\n"
)
C = make_topic(
    "Tailscale 内网组网",
    "用 Tailscale + MagicDNS 让手机在外网直连家里 Mac,并签发证书满足 HTTPS 录音需求。",
    [C_BODY], ["网络", "自建服务", "远程访问"],
    created="2026-06-25T08:00:00+00:00", updated="2026-07-03T19:05:00+00:00",
    exported_version=1,
)

D_BODY = (
    "手冲和意式的萃取都是在跟「过萃 / 欠萃」拉扯,记下每次能出好杯的参数。\n\n"
    "- 粉水比 1:2 左右,18 克粉打 36~40 克液\n"
    "- 时间 28~32 秒;偏酸就磨细一点或加粉,偏苦发涩就磨粗\n"
    "- 水温 92~94℃,浅烘可再高一点\n\n"
    "## 记录轨迹\n"
    "- 2026-06-30 收录:基础粉水比与时间区间 ^cap-99ee00\n"
)
D = make_topic(
    "意式浓缩萃取参数",
    "意式浓缩的粉水比、萃取时间与水温区间,以及酸苦失衡时的调整方向。",
    [D_BODY], ["咖啡", "冲煮"],
    created="2026-06-30T07:30:00+00:00", updated="2026-06-30T07:30:00+00:00",
    exported_version=0,
)

E_BODY = (
    "ESP32 跑电池项目,重点是把深睡电流压下去。\n\n"
    "- 进 deep sleep 前关掉外设电源域,悬空 GPIO 拉定,别让漏电流吃电\n"
    "- RTC 内存能在睡眠中保留少量状态,唤醒后接着跑\n"
    "- 用外部定时器 / GPIO 唤醒,比常开 WiFi 省一个数量级\n\n"
    "## 记录轨迹\n"
    "- 2026-07-04 收录:白板上的低功耗要点(拍照提取) ^cap-aabbcc\n"
)
E = make_topic(
    "ESP32 低功耗调试",
    "ESP32 电池项目压低深睡电流的几个要点:关外设域、拉定 GPIO、RTC 保状态、外部唤醒。",
    [E_BODY], ["嵌入式", "ESP32", "功耗"],
    created="2026-07-04T22:10:00+00:00", updated="2026-07-04T22:10:00+00:00",
    exported_version=0,
)


# ---------------- 收件箱 / 待确认 ----------------
def make_capture(type_, status, *, raw_text=None, transcript=None, clean_text=None,
                 topic_id=None, confidence=None, suggestion=None, error=None,
                 media_path=None, created=None):
    cap = db.create_capture(type_, raw_text=raw_text, media_path=media_path)
    fields = {"status": status}
    if transcript is not None: fields["transcript"] = transcript
    if clean_text is not None: fields["clean_text"] = clean_text
    if topic_id is not None: fields["topic_id"] = topic_id
    if confidence is not None: fields["confidence"] = confidence
    if suggestion is not None: fields["suggestion"] = json.dumps(suggestion, ensure_ascii=False)
    if error is not None: fields["error"] = error
    db.update_capture(cap["id"], **fields)
    if created:
        backdate("captures", "id", cap["id"], created_at=created)
    return cap["id"]


# 已入库
make_capture("text", "done",
             raw_text="试了下 system prompt 加 cache_control ephemeral,第二次请求快了一截,账单也降了。",
             clean_text="试了下 system prompt 加 cache_control ephemeral,第二次请求快了一截,账单也降了。",
             topic_id=A, confidence="high", created="2026-07-05T21:39:00+00:00")
make_capture("audio", "done",
             media_path="media/demo1.m4a",
             transcript="就是那个证书,tailscale cert 能直接签一个受信任的,手机 Safari 就不报警告了,录音也能用了。",
             clean_text="Tailscale cert 能签发受信任证书,手机 Safari 不再报警告,录音功能可用。",
             topic_id=C, confidence="high", created="2026-07-03T19:04:00+00:00")
make_capture("image", "done",
             media_path="media/demo2.jpg",
             transcript="白板:深睡前关外设电源域;悬空 GPIO 拉定;RTC 内存保状态;外部定时器唤醒。",
             clean_text="白板:深睡前关外设电源域;悬空 GPIO 拉定;RTC 内存保状态;外部定时器唤醒。",
             topic_id=E, confidence="high", created="2026-07-04T22:09:00+00:00")

# 待确认(badge = 2)
make_capture("text", "awaiting_review",
             raw_text="今天把粉量加到18克,萃32秒出40克,酸味淡了后段更甜,下次再细半格",
             clean_text="今天把粉量加到 18 克,萃取 32 秒出 40 克液,酸味明显淡了,后段更甜。下次试试再细半格。",
             confidence="medium",
             suggestion={
                 "clean_text": "今天把粉量加到 18 克,萃取 32 秒出 40 克液,酸味明显淡了,后段更甜。下次试试再细半格。",
                 "action": "existing", "topic_id": D, "new_topic_title": None,
                 "confidence": "medium",
                 "reason": "是浓缩萃取的参数记录,与「意式浓缩萃取参数」高度相关;也可能你想单独存今天这杯",
             },
             created="2026-07-06T08:15:00+00:00")
make_capture("text", "awaiting_review",
             raw_text="提醒自己周四前把导出冲突那块补个文档,还有回滚的截图也补一下",
             clean_text="提醒自己:周四前补一版导出冲突处理的文档,并补上回滚部分的截图。",
             confidence="low",
             suggestion={
                 "clean_text": "提醒自己:周四前补一版导出冲突处理的文档,并补上回滚部分的截图。",
                 "action": "new", "topic_id": None, "new_topic_title": "待办与提醒",
                 "confidence": "low",
                 "reason": "更像一次性待办,指代不明(『那块』),不确定是否值得单独建主题,请你定夺",
             },
             created="2026-07-06T08:02:00+00:00")

# 失败
make_capture("audio", "failed",
             media_path="media/demo3.m4a",
             error="转写结果为空(可能是无声音频)",
             created="2026-07-06T07:50:00+00:00")

print("seeded topics:", db.list_topics().__len__(), "captures:", len(db.list_captures(limit=100)))
