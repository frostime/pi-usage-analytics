---
status: accepted
---

# 改动预测：让 /usage 保留当前 session 的视图，并显式保存默认值

这份文件预测改动的位置、规模和责任边界。它不是实现清单，局部代码细节以实现为准。

## 要解决的问题

现在每次执行 `/usage` 都在 `src/commands/usage.ts` 中重新创建“今天 + 按模型分组”的状态。用户退出面板后再次打开，刚才选的范围和分组随局部变量一起消失。

改动后把视图分成三层：

```text
数据库中的默认选择
        │ 新的扩展 session 第一次打开 /usage
        ▼
当前 session 的选择       ← 面板中的 r / g 只改这里
        │ 每次打开面板时按当天重新解析
        ▼
本次查询使用的具体日期
```

- 面板中的调整默认是临时的，不写数据库。
- 同一 Pi session 中再次打开 `/usage`，沿用刚才的临时选择。
- `/usage save-default` 把当前 session 的选择显式保存为以后 session 的默认值。
- 新 session 读取默认值时，保存的是“最近 7 天”这种选择，不是上次解析出的死日期。

## Pi session 的明确边界

Pi `0.84.x` 在 `/new`、`/resume`、`/fork` 和 `/reload` 时会关闭旧扩展实例并创建新实例。因此当前 session 的视图可以直接放在命令处理器的闭包中，不需要按 session ID 建表或维护映射。

| 操作 | 结果 |
|---|---|
| 关闭后再次打开 `/usage` | 保留当前 session 的临时选择 |
| `/usage save-default` | 当前选择不变；数据库默认值更新 |
| `/new` | 新扩展实例，从数据库默认值开始 |
| `/resume` | 新扩展实例，从数据库默认值开始，不恢复该历史 session 以前的临时选择 |
| `/fork` / `/clone` | 新扩展实例，从数据库默认值开始 |
| `/reload` | 新扩展实例，从数据库默认值开始 |
| 退出 Pi 后重新进入 | 从数据库默认值开始 |

本次不调用 `pi.appendEntry()`。临时视图不会写进 Pi session JSONL，也不参与分支、恢复或克隆。

非 TUI 模式继续固定使用“今天 + 按模型分组”，不读取当前 session 视图或数据库默认值，也不能执行 `/usage save-default`。脚本化输出不受交互操作影响。

## 表结构版本与设置格式版本

这是两个不同的版本号：

| | SQLite 表结构 | 默认视图记录的文字格式 |
|---|---|---|
| 版本位置 | `PRAGMA user_version` | JSON 中的 `schema` |
| 何时变化 | 增删表、字段或索引 | 默认视图字段或含义发生不兼容变化 |
| 读到未知新版本 | 拒绝打开数据库 | 使用内建默认值，面板仍可打开 |

默认视图继续写入现有 `settings(key, value)` 表，不改变表结构，因此 `user_version` 保持 1。数据库迁移整理是独立修复现有开发契约，不是保存默认值所需的 DDL。

## 三次提交

### commit 0 — 整理 configuration 目录，不改变行为

```text
src/
├── config.ts                          delete
└── configuration/
    └── config-home.ts                 create   原 31 行整体移动

src/index.ts                           modify   +1/-1
src/maintenance/manage.ts              modify   +1/-1
.dev/docs/architecture.md              modify   +4–8
```

`config-home.ts` 继续只回答本机文件放在哪里：Pi agent 目录、数据目录、数据库文件和默认 session 根目录。内容不改，只调整路径和文件名。

`configuration/` 不建 `index.ts` 转手导出。调用方直接 import `config-home.ts` 或 `user-settings.ts`，避免把本机路径和耐久用户设置伪装成一个共同接口。

### commit 1 — 把数据库迁移改成按版本逐步执行

```text
src/storage/
├── schema.ts                          create   +70–90
└── usage-database.ts                  modify   +15–25/-70–90

test/schema-migration.test.ts          create   +45–65
.dev/docs/development.md               modify   +3–6
src/storage/SPEC.md                    modify   +8–14
```

`schema.ts` 成为表结构和升级步骤的唯一位置：

- 第 1 步包含现有建表、建索引 DDL；
- 已发布步骤不得回改；
- 将来变更表结构时在末尾追加下一整数版本；
- 当前版本由最后一个步骤派生，不再另写一份容易失配的常量。

现有 DDL 搬出时不改变表、列或索引，但 `PRAGMA user_version = 1` 不留在 DDL 字符串里。迁移执行器在每一步的事务中执行该步 DDL，然后设置该步目标版本，使结构变化和版本记录一起提交或回滚。若后续步骤失败，已经完成的较早步骤保留，下次启动从已提交版本继续。

测试不通过“同一份步骤表执行两遍再互相比较”自证。它直接验证：

1. 从版本 0 新建后，版本、表、关键列和索引符合明确的 v1 结构；
2. 带既有数据的 v1 数据库重新打开后结构和数据不变；
3. 数据库版本比代码新时仍拒绝打开。

真正出现 v2 后，再增加“固定 v1 样本升级到 v2”和“全新 v2”结构等价测试。

### commit 2 — session 临时视图与显式默认值

```text
src/usage/
└── calendar.ts                        modify   +55–80

src/configuration/
├── user-settings.ts                   create   +55–80
└── SPEC.md                            create   +18–28

src/commands/
└── usage.ts                           modify   +45–70/-25–40

src/storage/
└── usage-database.ts                  modify   +10–18/-4–8

src/index.ts                           modify   +4–10/-2–5

test/
├── calendar.test.ts                   modify   +25–40
├── user-settings.test.ts              create   +40–60
└── usage-command-session.test.ts      create   +55–85

.dev/docs/architecture.md              modify   +2–5
.dev/docs/compatibility.md             modify   +3–6
src/usage/SPEC.md                      modify   +3–6
src/ui/SPEC.md                         modify   +3–6

src/ui/dashboard.ts                    no change
```

#### `usage/calendar.ts`

新增范围“选择”类型和解析函数。相对范围每次按当前时间与数据库报告时区解析；自定义范围保留绝对日期。

`All time` 还需要可用数据边界，因此解析函数显式接收：

```text
选择 + 当前时间 + 报告时区 + 可用数据边界 → DayRange
```

`usage/` 只处理这些普通值，不读取数据库。

#### `configuration/user-settings.ts`

拥有数据库默认视图的格式：

- key：`dashboard_default_view`；
- value：带 `schema: 1` 的 JSON；
- 默认：Today + Model；
- JSON 损坏或 schema 不认识：整条使用内建默认值；
- 某个字段非法：只让该字段回到默认值；
- 读取时不回写修复结果；
- 提供具名的 `loadDashboardDefault` / `saveDashboardDefault`，不建立通用设置注册表。

该模块不知道 TUI、session 或 slash command。是否读取和保存由 `commands/` 决定。

#### `commands/usage.ts`

命令模块本来就拥有 `/usage` 的路由和交互状态。它改为导出一个按扩展实例创建的命令处理器，闭包内最多保存一份当前 session 的范围选择和分组方式：

- 第一次在 TUI 打开 `/usage` 时从数据库默认值初始化；
- `r` / `g` 只更新闭包状态；
- 再次打开时复用闭包状态，并重新把范围选择解析成具体日期；
- `/usage save-default` 将当前闭包状态写入数据库；
- 尚未打开过 `/usage` 时执行 `save-default`，提示用户先打开并调整面板，不做无意义写入；
- 保存失败时当前 session 状态不丢失，命令明确报错，旧默认值继续有效；
- 非 TUI 路径不创建、读取或保存这些状态。

`src/index.ts` 在扩展工厂中创建一次命令处理器。Pi 切换 session 或 reload 后会创建新的扩展实例，也就自然得到新的命令处理器和空的临时状态。

#### `storage/usage-database.ts`

只增加按 key 读取和写入字符串值的窄接口。SQL、事务和忙等重试仍由 storage 拥有；storage 不认识 dashboard、范围或 JSON schema。

#### 测试边界

- `calendar.test.ts`：相对范围跨天重新解析；自定义范围不漂移；`All time` 使用传入边界。
- `user-settings.test.ts`：SQLite 往返、缺失值、坏 JSON、未知 schema、字段级回退。
- `usage-command-session.test.ts`：同一处理器多次打开保留临时选择；新处理器重新读取默认；普通调整不写库；`save-default` 才写；保存失败不清掉当前临时选择；非 TUI 不读取默认。

不通过 TUI 文本快照验证这些规则。`dashboard-overlay.test.ts` 应保持不改；若它必须调整，说明“DashboardState 输入契约不变”的预测不成立，需要停下来重新检查边界。

## 责任与依赖变化

1. `commands/` 拥有当前扩展 session 的临时视图；状态随扩展实例结束而消失。
2. `configuration/user-settings.ts` 拥有全局默认视图的持久格式与回退策略。
3. `usage/calendar.ts` 拥有范围选择是否合法以及如何解析成日期。
4. `storage/` 只拥有字符串 KV 的 SQLite 读写，不理解用户设置语义。
5. `ui/` 继续只接收解析后的 `DashboardState`，不持有或保存状态。

依赖方向：

```text
index → commands
commands → { configuration/user-settings, usage, ui, maintenance }
configuration/user-settings → { storage, usage types }
storage → usage
```

没有新增反向依赖或循环。

## reset 与并发

`resetUsageData()` 继续只删除账目、聚合和去重记录，不删除 `settings`。全局默认视图和报告时区都活过 reset；现有确认文案已经说明保留报告时区，实施时应补充默认视图也会保留。

多个 Pi 实例各有自己的临时视图，互不影响。只有显式执行 `/usage save-default` 才竞争数据库写锁。保存的是用户明确确认的完整默认视图，因此采用“最后一次成功保存者胜出”。其他已打开 session 不立即改变；它们进入新 session 后才读取新默认值。

## 已发布格式的规则

已经发布的数据库迁移步骤和设置 schema 不得回改。表结构变化追加新的整数步骤；默认视图格式发生不兼容变化时增加新的 schema，并显式处理已支持的旧格式。

## 有意不做

- 不用 `pi.appendEntry()` 保存临时视图。
- 不按 session ID、session 文件、cwd 或项目分别保存视图。
- 不让普通 `r` / `g` 操作写数据库。
- 不在其他 Pi 实例中实时广播默认值变化。
- 不保存 Summary/Timeline 标签页、行钻取 filter、滚动位置。
- 不新增设置表、JSON 文件、通用迁移引擎或设置注册表。
- 不在读取坏设置时顺手写库修复。
- 不改变 dashboard 的输入契约和渲染责任。
- 本次不更新 README、CHANGELOG；发版时按 release 文档决定。

## 实施时的偏差检查

出现以下任一情况应暂停并说明，而不是把 SHAPE 改成与实现一致：

- 必须修改 `src/ui/dashboard.ts` 或 `DashboardState` 才能保存临时选择；
- Pi session 切换后命令处理器闭包没有按文档创建新实例；
- 设置默认值需要新增表或改变 `user_version`；
- migration runner 无法让单个步骤的 DDL 与版本更新处于同一事务；
- `commands/usage.ts` 从中等重排扩大为接近重写。

## 等你确认

1. session 边界是否接受：`/resume`、`/fork`、`/reload` 和重启都从全局默认值重新开始，不恢复以前的临时视图。
2. 显式保存命令是否使用 `/usage save-default`。
3. 设置 key 从原预测的 `dashboard_view` 改为更准确的 `dashboard_default_view`，是否接受。
