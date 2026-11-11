# Omega Harness

这是一组智能体技能，用于在 Omega（AienOS 的 `.om` 语言）以及 AIEN 各仓库中开展工作。加载了这些技能的智能体会在动手之前先找到实际的源码，编写种子自举编译器能够接受的 `.om` 代码，运行自己构建出来的东西，并如实报告状态，绝不夸大。

技能无法让智能体完美无缺。这些技能的作用，是把智能体反复犯的错误变成它们在提出任何主张之前必须执行的检查：过时的语法、靠猜测得出的编译器限制、只编译不运行、把仅在主机上的运行标记为已通过鉴定，以及选错仓库。

| 技能 | 用途 |
|---|---|
| [`omega-harness`](skills/omega-harness/SKILL.md) | 整体工作流程：摸清情况、用 `.om` 实现、编译、运行、质疑检验、处理副作用、从反复出现的错误中吸取教训 |
| [`writing-omega`](skills/writing-omega/SKILL.md) | 一份可移植的指南，帮助你在任何机器上写出正确的 `.om` 程序：程序结构、类型、词、陷阱、错误码 1..30、常见错误及其确切的拒绝信息、已知的编译器缺陷及规避办法 |
| [`omega-encoding`](skills/omega-encoding/SKILL.md) | 种子自举编译器所接受的语言：前缀词、类型、陷阱、边界、寄存器、主机 I/O、字节布局、错误码，另附两个可运行的示例 |
| [`omega-communication`](skills/omega-communication/SKILL.md) | 状态标签、报告、PR 文本、智能体交接、凭证、传输格式、更正 |
| [`aien-repositories`](skills/aien-repositories/SKILL.md) | AIEN 在构建什么、谁决定什么，以及哪个仓库负责某项任务 |
| [`crumb-protocol`](skills/crumb-protocol/SKILL.md) | 已于 2026-11-07 退役（DRA-97）：只剩一个存根。碎屑已成为历史；认领改为通过 flock 保护下的 CLAIMS.md、BOARD 的 CLAIM 行、kanban、spark-window 以及池锁进行 |
| [`wolfram-math`](skills/wolfram-math/SKILL.md) | 每一次计算都必须使用 Wolfram：智能体可以独立完成的 MCP 配置、验证调用、失败处理 |
| [`lean-verify`](skills/lean-verify/SKILL.md) | 通过 `lean` MCP，用机器检查的 Lean 4 + Mathlib 证明来确立显式模型上的安全不变量：何时用 Lean、何时用 Wolfram，模型与系统之间的对应关系，不允许出现 `sorry` 或额外公理 |

这些技能采用 Agent Skills 布局（`skills/<name>/SKILL.md`，带有 `name` 和 `description` 前置元数据），因此任何能读取这种布局的智能体都能直接识别它们。

## 人类主导的智能体工程

开发遵循人类主导的智能体工程（HDAE）：由人类确定目标、架构、约束、验收标准和停止点；智能体在这些边界之内实现功能、执行检查、诊断故障并进行修改。对主张、验收和发布决策的责任仍由人工评审承担。这些技能让智能体的内部循环变得明确，但不会把人的权限转交给模型。

关于这一方法的成文说明和系统软件案例研究，请参阅 Gregory M. Kurtzer，*Ginux: Building an Independent Kernel That Runs Linux Userspace through Human-Directed Agentic Engineering*（2026），[doi:10.5281/zenodo.23682548](https://doi.org/10.5281/zenodo.23682548)。项目署名、编译器固定版本和历史证据均保持不变。

## 安装

克隆本仓库，然后把各个技能目录放到你的智能体查找技能的位置：

```sh
git clone rad://z39gvwWsnkRZsAConQLjaKiNVLHfW omega-harness
```

Radicle 是本仓库的正式托管地（2026-11-07）。`aien-dev` GitHub 组织已冻结；下文中的 `github.com/aien-dev/...` 链接是对其所指提交的历史引用，而不是仍然有效的目标地址。

| 智能体 | 技能目录 |
|---|---|
| oh-my-pi（`omp`） | `~/.omp/agent/skills/` 或项目中的 `.omp/skills/` |
| Claude Code | `~/.claude/skills/` 或项目中的 `.claude/skills/` |
| Codex 及其他能读取 Agent Skills 的智能体 | `~/.agents/skills/` 或项目中的 `.agents/skills/` |

```sh
cp -R omega-harness/skills/* ~/.agents/skills/   # pick the directory for your agent
```

`omp` 也可以直接在原位置读取它们：把克隆下来的 `skills` 目录添加到 `~/.omp/agent/config.yml` 中的 `skills.customDirectories`。安装完成后，当任务与某个技能的描述相符时，智能体会自动加载该技能。在 `omp` 中，你也可以用 `/skill:omega-harness` 直接调用某个技能。

## 转换

11 月 6 日在本地 Mac 上进行的模型实验，有明确的[运行时凭证，以及一个尚未关闭的宿主语言迁移边界](skills/omega-harness/SKILL.md#2-implement-in-the-actual-language)。在 Aienux 固件客户机中运行 Omega 推理，并不会让临时的 C++ 浏览器适配器变成 Omega；在固件托管环境中进行仿真，也不能证明支持独立内核或原生 Apple Silicon。这些都是尚未合并的实验分支，不会改变编译器的固定版本，也不会改变所支持的语言。

这些技能涵盖的是在 Omega 本身之中的工作。Omega 与其他语言之间的转换属于 [`omega-bridge`](https://github.com/aien-dev/omega-bridge) 的范围。它只转换一个已声明并经过检查的子集，并且拒绝尝试通用转换。如果你需要自动化转换，可以在它前面运行一个 MCP 服务器，但这层包装并不能让它转换该子集之外的任何内容。

已合并的 [omega-bridge #32](https://github.com/aien-dev/omega-bridge/pull/32) 将私有的 ABI1/ABI2 运行时符号本地化，使各自独立生成的翻译单元在链接时不会发生冲突。[#33](https://github.com/aien-dev/omega-bridge/pull/33) 新增了保守的、仅限整数标量的独立环境输出，不使用 pthread、mmap、堆或 TLS；[#35](https://github.com/aien-dev/omega-bridge/pull/35) 为有限的聚合帧/输出池加入了带检查的拒绝机制。第 2 节固定了 main 分支 `2efdd48cd0c7c232064d5870e77660a5a75966e1`，并记录了主机证据和负向对照。已合并、并在主机上运行检验过的源码，既不等于已部署，也不等于通过了 GPU 鉴定。

已合并的 [omega-bridge #36](https://github.com/aien-dev/omega-bridge/pull/36)（合并提交 `2ed42c3818e72da321c3218d22d7662be607633c`，2026-11-01）新增了一个显式固定的 `bridge-seeded` 前端，用于可移植且经过检查的 C/Python 代码以及 C 声明。第 2 节记录了头部提交 `3dc4a00e9966770cce58bdedb401c3b3932c35ee`、编译器和转换器的哈希、规范组合与 binary32 限制、无导入的标量配置，以及实际运行过的差分/拒绝对照。使用方的主机验收另有单独记录。这既不取代基线门禁，也不依赖原生的 x86 Omega 编译器。

已合并的 [omega-mv WebAssembly 后端（#787）](https://github.com/aien-dev/omega-mv/pull/787) 是面向现有标量 OSC IR v1 传输格式的编译器后端，而不是外来源码转换器。它的种子自举 Omega 写入器以及只读 Node 参照基准的边界，记录在 `omega-encoding` 第 0 节和 `omega-harness` 第 2 至 3 节中。后端合并提交：`3364a1dfd0ca50c1b82bf19ba34932d8bc10a7a9`；布尔 IR 前置条件 #786：`87489da90a1a7a750fd4a7f9eeb005b1221721f6`。

[SPIR-V 后端（#804）](https://github.com/aien-dev/omega-mv/pull/804) 已合并为 `3a10bd29fb7debdcf2c8f5cb58680cc74cb5b1f3`：包括一个用 Omega 编写的 OpenCL 核函数生成器、一个 PoCL CPU 一致性门禁，以及一个最小的 OpenCL IL 演示。`omega-harness` 第 3 节记录了实际运行过的确切源码、工具链、ABI、拒绝边界和证据。在 CPU 上执行并不等于通过了 GPU 或 DPC++ 鉴定。

Neuralese 补充提案（[#919](https://github.com/aien-dev/omega-mv/pull/919)，由 train r1 #971 以 `f56a372a` 合并）保留了 Omega 这个名称，并提出了受模型/解码器约束的表示形式，这些表示会被解码为普通检查路径上的显式 Omega 操作。`omega-harness` 第 2 节和 `omega-communication` 记录了它的固定版本、原生主机码本证据和信任边界。其中的学习型实验状态为 PROPOSED / NOT_RUN；有界参考实现为 MERGED，并在主机上达到 IMPLEMENTED / EXERCISED，但尚未达到硬件鉴定的 QUALIFIED 状态，也没有部署。

## 仅限主机的 NL1R 诊断

`omega-harness` 记录了 [aien-train #39](https://github.com/aien-dev/aien-train/issues/39) 下彼此独立的容量实验和任务条件实验，包括冻结的确切源码/编译器固定版本、评判器的独立保管、实际的载体/上下文预算，以及保留下来的负面结果。构造性容量、学习得到的恢复能力、留出集上的表现以及生产环境中的执行权限，是彼此独立的主张。这些主机实验并不构成对设备执行或部署的鉴定。

## 自行检查示例

这些示例只能在 Linux AArch64 主机上运行。[`examples/`](examples/) 中有 121 个程序，每个程序都是一个 `NAME.om` 加一个 `NAME.expect`（如果程序有打印输出，还有 `NAME.stdout`）：涵盖每一种陷阱、每个错误码各一个拒绝示例、常见错误、已知缺陷，以及 `execenv`。`examples/gate.sh` 会拒绝除示例门禁固定版本以外的任何编译器，然后编译并运行这里以及 `skills/*/examples/` 中的每一个程序（后者另有 5 个，总共 126 个）。

示例门禁要求使用 omega-mv `c106bae04231f47912f4b90b49f426a44a1f4238`（Radicle omega-mv main，2026-11-10），且 `seed/out/omc` 的 sha256 为 `f4fa7951816bbd09c5eaaae6692852a70c3c305164b365027c5b683dec7d63e9`（674,212 字节；它是 `ham/omc-perf-mem-4` `83b230bf` 的 omc，以 `887311bb` 合并，直到 `c106bae0` 都没有变化）。在 `c106bae0` 处用 `sh seed/omega-from-seed.sh` 从 seed0 重新构建，得到的字节完全相同（2026-11-10T20:31Z，Linux AArch64）。此前的门禁固定版本是 omega-mv `7d9ed10f` / omc `cfd96b48…`（即 omega-mv#1074 中为 execenv 重新生成的种子）；现在门禁会像拒绝其他任何哈希一样拒绝它。MCP 固定版本 `f4df8239` / omc `3ad9f10f…` 会拒绝 `examples/execenv.om`（`omc: line 63: error 3`）。

```sh
git clone rad://z6do9WDBhuSnvopDkgFdFr1yWA62 omega-src
git -C omega-src checkout c106bae04231f47912f4b90b49f426a44a1f4238
sha256sum omega-src/seed/out/omc   # f4fa7951816bbd09c5eaaae6692852a70c3c305164b365027c5b683dec7d63e9
examples/gate.sh omega-src/seed/out/omc
```

它会为每个程序输出 `PASS name` 或 `FAIL name: reason`，最后输出 `GATE PASS examples=126 pass=126 fail=0 omc=f4fa7951...`（退出码 0）、`GATE FAIL ...`（退出码 1），或者因哈希不符而拒绝（退出码 2）。当门禁固定为 `f4fa7951…` 时，omc `564c5835…`（main `0158ce88`）以退出码 2 退出（2026-11-10T20:31Z）。在此前的 `cfd96b48…` 固定版本下，把门禁指向 omc `5f90edea…` 或 omc `3ad9f10f…` 都会以退出码 2 退出（2026-11-08 复查），Radicle main 的 omc `0f2de851…`（2026-11-09）、`6d1b1cf5…`（2026-11-10）和 `564c5835…`（main `0158ce88`，2026-11-10T15:44Z）也是如此，以上均在 Linux AArch64 上测得。`omega-encoding` 技能（第 0 节和第 13 节）记录了观察到的结果和负向对照；[`examples/WOLFRAM.md`](examples/WOLFRAM.md) 记录了用 Wolfram 对算术预期值所做的检查。

## 保持更新

**由做出更改的智能体负责更新指南。** 如果你的工作改变了 Omega 语言、编译器或其固定版本、构建或门禁命令、编码器或桥接器、仓库归属或状态，或者本框架本身，请在同一项工作中更新对应的技能。然后以 Radicle 补丁的形式贡献出来：向合并台提交一个附带证据（基准提交、头部提交、打包文件、门禁日志、负向对照）的 READY 文件；由 Radicle 发布通道创建补丁，再由合并台合并。切勿推送到 github.com。如果你做不到，就给合并台留一条说明，写明现在哪些内容已经过时。`omega-harness` 第 6 节给出了完整的对应关系，说明哪类更改应写入哪个技能。

每个技能都注明了它所核对的 omega-mv 提交，并列出已知的不一致之处。历史章节保留各自带日期的固定版本。`omega-encoding` 第 0 节为 IR/wasm 后端、已合并的 Omega 1.0 路线图以及 main `91b3c932`（编译器 `189ada82…3b54`）补充了限定范围的固定版本：可执行契约、扩展后的容量以及 f32 返回值修复。这一批改动只有主机证据，没有 GPU 鉴定。编译器发生变化时，先复查所引用的行，重新运行示例，然后再更新固定版本。不要编辑旧的证据。贡献须遵循[共享的 AIEN 智能体规则](https://www.aienos.com/agents/RULES.md)。

[原生 GPU 实现指南](skills/omega-communication/SKILL.md#native-gpu-realization-records-2026-10-28)区分了量化索引、规范制品身份、会话驻留和独立鉴定。它跟踪 CUDApp #26 的相关工作，但不会把主机测试夹具或尚未合并的组件当作生产准入。

由 Drake Stapleton 与 AIEN 智能体共同编写。采用 Apache 许可证 2.0 版。
