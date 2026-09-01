# Pi Usage Analytics

追踪你在各 Provider、Model 和工作目录下的 Token 用量与费用。随时输入 `/usage` 打开看板。

![Provider / Model 汇总](assets/each-models.png)
![每日时间线](assets/timeline.png)

## 安装

需要 Pi `0.84.x` 和 Node `>=22.19.0`。

```bash
pi install git:github.com/frostime/pi-usage-analytics
```

也可以本地试装，不永久安装：

```bash
pi -e .
```

## 用法

在 Pi 中输入 `/usage`，看板居中覆盖打开，纯键盘操作：

| 按键 | 功能 |
|---|---|
| `↑/↓` | 选择行 |
| `Enter` | 在时间线中查看该项详情 |
| `←/→` | 在 Summary 和 Timeline 之间切换 |
| `r` | 切换时间范围（今天、7天、30天、本月、自定义等） |
| `g` | 切换分组方式（Provider/Model、Provider、Directory） |
| `m` | 维护菜单（导入、压缩、存储管理） |
| `q` | 关闭 |

高级快捷入口：

```text
/usage import    # 从 Pi 历史会话导入过往用量
/usage compact   # 将旧原始数据压缩为日汇总
/usage storage   # 回收数据库未用空间
/usage help      # 显示所有命令
```

## 功能

**按维度分组。** 随时切换 Provider/Model、仅 Provider 或 Directory，看清 Token 花在了哪里。

![分组菜单](assets/group-by.png)

**Directory 视图** 按工作目录汇总，适合多项目并行时查看。

![Directory 明细](assets/directories.png)

**时间线** 展示每日总量，方便发现趋势或异常峰值。

**时间范围** 支持今天、最近 7/30 天、本月/上月、全部时间以及自定义区间。

![时间范围选择](assets/time-range.png)

**历史导入** 扫描 Pi 的会话文件，补全安装本扩展之前的用量记录。导入会自动去重，重复执行不会重复计费。

**数据压缩** 将旧原始事件转换为永久日汇总。压缩后保留日级总量和分项统计，但丢失单条消息级细节。执行前会展示预览并要求确认。

## 数据与隐私

所有数据存储在本地 SQLite 数据库：

```text
~/.pi/agent/usage-analytics/usage.db
```

若设置了 `PI_CODING_AGENT_DIR`，则使用该路径。

记录只包含用量元数据：Provider、Model、Token 数、估算费用、工作目录和时间戳。**不保存** 提示词文本、助手回复、思考内容、工具参数或工具输出。

## 技术细节

**并发。** 数据库使用 SQLite WAL 模式，多个 Pi 进程可共享同一文件。写操作由 SQLite 串行化，读操作互不阻塞。

**实时采集。** 用量事件先缓存在内存中，在 `agent_settled` 时批量写入。若数据库被其他进程锁定，缓冲会保留待写入批次并在稍后重试。Pi 不会因分析 I/O 而等待。极端情况下进程崩溃可能导致缓冲区内最后几条事件丢失，可通过 `/usage import` 从会话历史恢复。

**时间处理。** 数据库在创建时锁定系统时区，用于所有日历日计算。事件时间戳以 UTC 存储。时区不会在机器迁移后自动变更，因为旧原始事件可能已被压缩为日汇总。

**统计范围。** 顶部总计只包含 Pi 明确归因到具体 Provider 和 Model 的助手回复。工具返回的嵌套用量、压缩开销和分支汇总不计入，以避免重复计算。

## 开发

```bash
npm install
npm run check
npm run pack:dry
```

开发文档见 `.dev/docs/index.md`。模块维护约定在 `src/*/SPEC.md`。根级 Agent 指令见 `AGENTS.md`。

## 许可

MIT
