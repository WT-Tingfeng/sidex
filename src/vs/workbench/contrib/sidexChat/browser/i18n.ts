/*---------------------------------------------------------------------------------------------
 *  SideX Chat UI — Simplified Chinese (zh-CN) localization
 *
 *  VS Code's own UI is translated by the Chinese language pack, but the UI
 *  shipped under contrib/sidexChat is hardcoded English. This module provides:
 *
 *    t(text)              — translate a single UI string (safe fallback: input)
 *    translateDom(root)   — rewrite text nodes plus placeholder/title/aria-label
 *                           attributes inside a container (idempotent: Chinese text
 *                           never matches a dictionary key, so re-runs are no-ops)
 *    observeI18n(root)    — translate a container now and keep translating dynamic
 *                           content through a scoped, rAF-debounced MutationObserver
 *
 *  Rules:
 *    - Only exact dictionary/pattern matches are rewritten; prose, code, file paths,
 *      URLs, product names and model names are untouched.
 *    - Markdown/code/user-content subtrees are skipped entirely.
 *    - Mutation records produced by our own writes are harmless: the second pass
 *      finds nothing to translate and schedules no further work.
 *--------------------------------------------------------------------------------------------*/

export interface II18nHandle {
	dispose(): void;
}

/** User-visible English → Simplified Chinese. Keep model/brand names as-is. */
const ZH_CN: Record<string, string> = {
	// ─── Chat header, history panel, plus menu ───────────────────────────────
	'New Chat': '新建对话',
	'Search chats...': '搜索对话...',
	'No past chats': '暂无历史对话',
	'Untitled': '未命名',
	'More': '更多',
	'Pin': '置顶',
	'Archive': '归档',
	'Rename': '重命名',
	'Delete': '删除',
	'Open Browser': '打开浏览器',
	'New MCP Server': '新建 MCP 服务器',
	'Usage': '用量',
	'Configure Rules': '配置规则',
	'Configure Skills': '配置技能',
	'Edit Memories': '编辑记忆',
	'Configure MCP Servers': '配置 MCP 服务器',
	'0 MCPs': '0 个 MCP',
	'Rename Chat': '重命名对话',
	'Are you sure you want to delete this chat session?': '确定要删除此对话吗？',
	'Redo checkpoint': '重做检查点',
	'Show': '显示',
	'Hide': '隐藏',

	// ─── Composer / mode labels / context usage ──────────────────────────────
	'Plan, Build, / for commands, @ for context': '规划、构建，/ 命令，@ 上下文',
	'Agent': '智能体',
	'Plan': '计划',
	'Ask': '询问',
	'Local': '本地',
	'Worktree': '工作树',
	'Cloud': '云端',
	'soon': '即将推出',
	'ULTRA Mode': 'ULTRA 模式',
	'Effort': '推理力度',
	'None': '无',
	'Low': '低',
	'Med': '中',
	'High': '高',
	'View detailed context usage': '查看上下文用量详情',
	'Attach': '附加文件',
	'Send': '发送',
	'Stop': '停止',
	'No models enabled — enable models in Settings': '未启用模型 — 请在设置中启用',
	'Context Usage': '上下文用量',
	'SideX Environment Connection Mode': 'SideX 环境连接模式',
	'Worktree Mode — Coming Soon': '工作树模式 — 即将推出',
	'Cloud Mode — Coming Soon': '云端模式 — 即将推出',
	'Attached image': '已附加图片',
	'Drop files to attach': '拖放文件以附加',
	'Conversation': '对话',
	'Subagent': '子智能体',
	'Subagents': '子智能体',
	'Subagent definitions': '子智能体定义',
	'Tool definitions': '工具定义',
	'System prompt': '系统提示词',
	'Skills': '技能',
	'MCP': 'MCP',
	'Model Context Protocol': '模型上下文协议 (MCP)',
	'Files': '文件',
	'Arguments': '参数',
	'Files and folders': '文件和文件夹',
	'Search the entire indexed codebase': '搜索整个已索引的代码库',

	// ─── Errors / notices / toasts ───────────────────────────────────────────
	'Unable to reach model': '无法连接模型',
	'Claude usage limit': 'Claude 用量已达上限',
	'Anthropic blocked this login': 'Anthropic 已拦截此登录',
	'Try again': '重试',
	'The local AI server is not running. Chat cannot send until sidex-server is built and the app is restarted.': '本地 AI 服务器未运行。需先构建 sidex-server 并重启应用后才能发送消息。',
	'Unable to reach the server. Please check your connection and try again.': '无法连接服务器。请检查网络连接后重试。',
	'An unexpected error occurred.': '发生意外错误。',
	'Failed to connect': '连接失败',
	'Unknown error': '未知错误',
	'Unknown server error': '未知服务器错误',
	'WebSocket error': 'WebSocket 错误',
	'No response body': '响应内容为空',
	'Failed to parse subagent task arguments': '解析子智能体任务参数失败',
	'No tasks provided for subagents': '未向子智能体提供任务',
	'User cancelled': '用户已取消',
	'User cancelled from UI': '用户已在界面中取消',
	'Tauri IPC not available': 'Tauri IPC 不可用',
	'Tauri not available.': 'Tauri 不可用。',
	'BRIEF:': '简报：',
	'Unable to resolve selection': '无法解析当前选择',
	'No selection': '未选择内容',

	// ─── Permission / question / plan approval ───────────────────────────────
	'Cancel': '取消',
	'Confirm': '确认',
	'Continue': '继续',
	'Allow': '允许',
	'Run command': '运行命令',
	'Run background process': '运行后台进程',
	'Kill process': '终止进程',
	'Write to': '写入',
	'Edit': '编辑',
	'Patch': '应用补丁',
	'Replace in': '替换',
	'Edit notebook': '编辑 Notebook',
	'Commit': '提交',
	'Run REPL': '运行 REPL',
	'Run PowerShell': '运行 PowerShell',
	'Plan ready for review': '计划已准备就绪，等待审阅',
	'The agent wants to start implementing (see its plan in the conversation above).': '智能体希望开始实施（请查看上方对话中的计划）。',
	'Keep planning': '继续规划',
	'Approve plan': '批准计划',
	'Discard changes after this point?': '要丢弃此节点之后的更改吗？',
	'Thought': '思考',
	'Copy': '复制',
	'Copy code': '复制代码',
	'Accept': '接受',
	'Reject': '拒绝',
	'Accept edit (Enter)': '接受编辑 (Enter)',
	'Reject edit (Escape)': '拒绝编辑 (Esc)',
	'Collapse diff': '折叠差异',
	'Expand diff': '展开差异',
	'No changes': '无更改',
	'Enter': 'Enter',
	'Generating edit...': '正在生成编辑...',
	'Describe the change...': '描述要做的修改...',
	'Revert unavailable: local tool bridge not found': '无法还原：未找到本地工具桥接',
	'Cannot revert: the original file content is not known in this session': '无法还原：当前会话中不知道文件的原始内容',
	'Read multiple files': '读取多个文件',
	'Read': '读取',
	'Wrote': '写入',
	'Edited': '已编辑',
	'Created': '已创建',
	'Deleted': '已删除',
	'Ran': '运行',
	'Searched for': '搜索',
	'Found files matching': '找到匹配的文件',
	'Searched files for': '在文件中搜索',
	'Diffed': '比较差异',
	'Committed:': '已提交：',
	'Listed': '列出',
	'Listed tree of': '列出目录树',
	'Inspected symbol in': '检查符号',
	'Found definition in': '找到定义',
	'Found references in': '找到引用',
	'Checked git status': '已检查 Git 状态',
	'Viewed git log': '已查看 Git 日志',

	// ─── Settings shell / navigation ─────────────────────────────────────────
	'Settings': '设置',
	'Search settings': '搜索设置',
	'Toggle Sidebar': '切换侧边栏',
	'Settings Table of Contents': '设置目录',
	'Next': '下一个',
	'Previous': '上一个',
	'Maximize Modal Editor': '最大化编辑器',
	'Restore Modal Editor': '还原编辑器',
	'Close Modal Editor (Escape)': '关闭编辑器 (Esc)',
	'General': '通用',
	'Models': '模型',
	'Customizations': '自定义',
	'Tools & MCPs': '工具与 MCP',
	'Server Name': '服务器名称',
	'Remove server': '移除服务器',
	'Configuration': '配置',
	'Preferences': '偏好设置',
	'Notifications': '通知',
	'Indexing & Stats': '索引与统计',
	'Codebase Indexing': '代码库索引',
	'Tab': 'Tab',
	'Gutter': '边栏',
	'Escape': 'Esc',
	'Open': '打开',
	'File': '文件',
	'Folder': '文件夹',
	'Privacy': '隐私',
	'Rules': '规则',
	'Hooks': '钩子',
	'Plugins': '插件',
	'Agents': '智能体',
	'Network': '网络',
	'Beta': '测试版',
	'Cloud Agents': '云端智能体',
	'Beta features may be unstable.': '测试版功能可能不稳定。',
	'Early Access': '抢先体验',
	'Update Access': '更新通道',
	'Extension RPC Tracer': '扩展 RPC 跟踪器',
	'By default, get notifications for stable updates. In Early Access, pre-release builds may be unstable for production work.': '默认接收稳定版更新通知。抢先体验版为预发布构建，用于生产工作可能不稳定。',
	'Log extension host RPC messages to JSON files viewable in Perfetto for performance analysis. Requires a restart to take effect.': '将扩展宿主 RPC 消息记录到 JSON 文件，可在 Perfetto 中查看以进行性能分析。需要重启后生效。',

	// ─── Settings: General / Layout / Editor ─────────────────────────────────
	'Layout': '布局',
	'Window Layout': '窗口布局',
	'Choose default window arrangement': '选择默认窗口布局',
	'Editor': '编辑器',
	'Title Bar': '标题栏',
	'Show the window title bar': '显示窗口标题栏',
	'Status Bar': '状态栏',
	'Show the status bar at the bottom': '在底部显示状态栏',
	'Menu Bar Icon': '菜单栏图标',
	'Show icon in the system tray/menu bar': '在系统托盘/菜单栏中显示图标',
	'Toolbar': '工具栏',
	'Review Control Location': '审查控件位置',
	'Where to show review controls': '审查控件显示的位置',
	'Conversation Density': '对话密度',
	'Adjust chat message spacing': '调整聊天消息间距',
	'Compact': '紧凑',
	'Comfortable': '舒适',
	'Spacious': '宽松',
	'Auto scroll on message': '收到消息时自动滚动',
	'Automatically scroll the conversation viewport down when a new message is received.': '收到新消息时自动将对话视图滚动到底部。',
	'Open chat as editor tabs': '以编辑器标签页打开对话',
	'Auto-hide editor when empty': '编辑器为空时自动隐藏',
	'Collapse editor panel if no tabs are open': '没有打开的标签页时折叠编辑区',
	'Completion Sound': '完成提示音',
	'Play a sound when operations complete': '操作完成时播放提示音',
	'System Notifications': '系统通知',
	'Show OS-level notifications': '显示操作系统通知',
	'Default AI Model': '默认 AI 模型',
	'Select which AI model new conversations will start with by default.': '选择新对话默认使用的 AI 模型。',
	'Default Agent Mode': '默认智能体模式',
	'Set the default agent capability when starting a new workspace task.': '设置启动新工作区任务时默认的智能体能力。',
	'Ask each time': '每次询问',
	'Data Sharing': '数据共享',
	'Help improve SideX by sharing anonymous usage data. No code or personal information is ever collected.': '共享匿名使用数据以帮助改进 SideX。绝不会收集代码或个人身份信息。',
	'Customize editor appearance and behavior': '自定义编辑器的外观和行为',
	'Customize keybindings': '自定义键盘快捷方式',
	'Keyboard Shortcuts': '键盘快捷方式',
	'Editor Settings': '编辑器设置',
	'Import Settings from VS Code': '从 VS Code 导入设置',
	'Import your existing configuration': '导入你现有的配置',
	'Import': '导入',
	'Show previously dismissed dialogs': '显示先前已关闭的对话框',
	'All dialogs have been reset.': '所有对话框均已重置。',
	'Add a model in the Models section to set a default for new conversations.': '在“模型”部分添加模型，以便为新对话设置默认模型。',
	'NEW': '新功能',

	// ─── Settings: Models / providers ────────────────────────────────────────
	'Add the model IDs your providers serve. Nothing is enabled until you add it here.': '添加你的提供方所服务的模型 ID。在添加之前不会启用任何模型。',
	'Search your models': '搜索你的模型',
	'No models added yet. Add a model ID below to enable it.': '尚未添加模型。在下方添加模型 ID 即可启用。',
	'+ Add Model': '+ 添加模型',
	'Model ID (e.g. anthropic/claude-opus-4.6)': '模型 ID（例如 anthropic/claude-opus-4.6）',
	'Loading models…': '正在加载模型…',
	'No models reported yet — enter an ID manually below.': '尚未获取到模型 — 可在下方手动输入 ID。',
	'Couldn\'t reach this provider to list its models — enter an ID manually below.': '无法连接该提供方获取模型列表 — 可在下方手动输入 ID。',
	'Add': '添加',
	'API Keys': 'API 密钥',
	'Configure provider API keys to use models at cost through your own accounts.': '配置提供方 API 密钥，以便通过自己的账户付费使用模型。',
	'Configured': '已配置',
	'Import models': '导入模型',
	'Importing…': '正在导入…',
	'Detected on this machine': '在此设备上检测到',
	'Credentials and model servers SideX can use without any setup. No account required.': '无需任何配置即可使用的凭据和模型服务器，无需账户。',
	'Disconnect': '断开连接',
	'Connect': '连接',
	'Subscription login, not a billed API key.': '订阅登录，而非计费 API 密钥。',
	'No local model server found': '未找到本地模型服务器',
	'Start Ollama or LM Studio and reopen this panel to use local models with no key.': '启动 Ollama 或 LM Studio 并重新打开此面板，即可免密钥使用本地模型。',
	'No new models found.': '未找到新模型。',
	'Picked up from your shell. A key entered above overrides it.': '已从 shell 读取。在上方输入的密钥将覆盖它。',
	'Failed to add custom model:': '添加自定义模型失败：',
	'Failed to remove custom model:': '删除自定义模型失败：',
	'Failed to save enabled models:': '保存已启用模型失败：',
	'OpenAI-compatible': 'OpenAI 兼容',
	'Base URL (required, e.g. https://your-host/v1)': 'Base URL（必填，例如 https://your-host/v1）',
	'No default (use first available)': '无默认（使用第一个可用项）',
	'Both': '两者',
	'Custom': '自定义',
	'Custom (any provider)': '自定义（任意提供方）',
	'All providers': '所有提供方',
	'Providers': '提供方',
	'Connected providers': '已连接的提供方',
	'Connected account': '已连接的账户',
	'Configure Providers': '配置提供方',
	'No providers connected yet. Add an API key below to start chatting.': '尚未连接任何提供方。在下方添加 API 密钥即可开始聊天。',
	'API key': 'API 密钥',
	'Environment': '环境变量',
	'CLI login': 'CLI 登录',
	'Local server': '本地服务器',
	'Your login itself is untouched — this only stops SideX reading it.': '你的登录本身不受影响 — 只是不再让 SideX 读取它。',
	'This is a subscription login, not a billed API key.': '这是订阅登录，而不是计费 API 密钥。',
	'Monthly': '月度',
	'Usage Summary': '用量摘要',
	'Tokens in SideX': 'SideX 中的 Token',
	'Recorded in SideX': '已在 SideX 中记录',
	'Session bars come from the connected Claude Code or Codex account.': '会话条来自已连接的 Claude Code 或 Codex 账户。',
	'Plan limits will show here after this account answers a usage request.': '此账户响应一次用量请求后，将在此显示套餐限额。',
	'Usage data is unavailable.': '用量数据不可用。',
	'Not enabled on this plan': '当前套餐未启用',
	'Enabled': '已启用',
	'Extra usage': '额外用量',
	'Loading…': '正在加载…',
	'Configure Models': '配置模型',
	'SideX has no hosted infrastructure to run agents on — there\'s no remote environment, timeout, or queue to configure here. Every agent runs on this machine, using whichever providers and models you\'ve set up under Models.': 'SideX 没有可用于运行智能体的托管基础设施 — 这里没有可配置的远程环境、超时或队列。所有智能体都在本机运行，使用你在“模型”中配置的提供方和模型。',
	'Customize': '自定义',
	'Customizations & Integrations': '自定义与集成',

	// ─── Settings: Custom providers / API key actions ────────────────────────
	'Custom Providers': '自定义提供方',
	'Use any OpenAI-compatible or Anthropic-compatible endpoint with its own base URL, auth style and key.': '使用任何 OpenAI 兼容或 Anthropic 兼容的端点，并为其单独配置基础 URL、鉴权方式和密钥。',
	'No custom providers yet. Add an endpoint to use an API that does not ship with SideX.': '尚无自定义提供方。添加一个端点，即可使用 SideX 未内置的 API。',
	'+ Add Provider': '+ 添加提供方',
	'Test connection': '测试连接',
	'Testing…': '正在测试…',
	'Connection failed': '连接失败',
	'Connected': '已连接',
	'Replace': '更换',
	'Clear': '清除',
	'Stored API key': '已保存的 API 密钥',
	'Endpoint from Custom Providers': '来自“自定义提供方”的端点',
	'Edit this endpoint under Custom Providers.': '请在“自定义提供方”中编辑此端点。',
	'Model count unknown': '模型数量未知',
	'No key needed': '无需密钥',
	'Key set': '已设置密钥',
	'Key required': '需要密钥',
	'Configured via environment': '已通过环境变量配置',
	'Anthropic-compatible': 'Anthropic 兼容',
	'Bearer token': 'Bearer 令牌',
	'x-api-key header': 'x-api-key 请求头',
	'api-key header': 'api-key 请求头',
	'No key': '无需密钥',
	'Display name': '显示名称',
	'Provider ID': '提供方 ID',
	'Protocol': '协议',
	'Base URL': '基础 URL',
	'Auth': '鉴权方式',
	'Models (comma separated, optional)': '模型（逗号分隔，可选）',
	'My provider': '我的提供方',
	'lowercase-id': '小写 ID',
	'e.g. gpt-4.1, claude-sonnet-4.6': '例如 gpt-4.1, claude-sonnet-4.6',
	'Save changes': '保存更改',
	'Add provider': '添加提供方',
	'A display name is required.': '请填写显示名称。',
	'A provider ID is required.': '请填写提供方 ID。',
	'Provider ID may only contain lowercase letters, digits, dots, dashes and underscores.': '提供方 ID 只能包含小写字母、数字、点、短横线和下划线。',
	'Provider ID is too long (max 64 characters).': '提供方 ID 过长（最多 64 个字符）。',
	'A base URL starting with http:// or https:// is required.': '请填写以 http:// 或 https:// 开头的基础 URL。',
	'Settings are unavailable.': '设置不可用。',

	// ─── Settings: Rules / Skills / Hooks / Memories ─────────────────────────
	'Rules, Skills & Hooks': '规则、技能与钩子',
	'Rules scope': '规则范围',
	'Filter rules and skills by user or project scope': '按用户或项目范围筛选规则和技能',
	'User': '用户',
	'You': '你',
	'Project': '项目',
	'All': '全部',
	'New Rule': '新建规则',
	'New Skill': '新建技能',
	'No Rules Yet': '暂无规则',
	'No Skills Yet': '暂无技能',
	'Auto import from other tools': '从其他工具自动导入',
	'Guide agent behavior (coding standards, practices, conventions)': '引导智能体行为（编码规范、实践、约定）',
	'Provide domain-specific knowledge and workflows for the agent': '为智能体提供领域知识和流程',
	'Specialized capabilities that help the agent accomplish specific tasks': '帮助智能体完成特定任务的专业能力',
	'Lifecycle hooks that trigger on agent events': '在智能体事件触发时执行的生命周期钩子',
	'Include third-party Plugins, Skills, and other configs': '包含第三方插件、技能和其他配置',
	'No hooks configured. Manage hooks in the Hooks settings section.': '尚未配置钩子。可在“钩子”设置部分管理钩子。',
	'No hooks configured yet.': '尚未配置钩子。',
	'New Hook': '新建钩子',
	'+ Add Hook': '+ 添加钩子',
	'Automate actions triggered by agent lifecycle events': '自动执行由智能体生命周期事件触发的操作',
	'On Agent Start': '智能体启动时',
	'On Agent End': '智能体结束时',
	'On File Save': '文件保存时',
	'On Commit': '提交时',
	'Before Tool Call': '工具调用前',
	'Event Trigger': '事件触发器',
	'Action Type': '操作类型',
	'Shell Command': 'Shell 命令',
	'Script': '脚本',
	'Shell': 'Shell',
	'Command': '命令',
	'Save Hook': '保存钩子',
	'Remove hook': '移除钩子',
	'my-server': 'my-server',

	// ─── Settings: Tools / permissions ───────────────────────────────────────
	'Context': '上下文',
	'Auto-Approve Mode Transitions': '自动批准模式切换',
	'Ask for approval': '请求批准',
	'Auto-Run': '自动运行',
	'Auto-Run Mode': '自动运行模式',
	'Auto-Accept Web Search': '自动接受网页搜索',
	'Web Search Tool': '网页搜索工具',
	'Web Fetch Tool': '网页抓取工具',
	'Sandboxed': '沙箱运行',
	'Run Everything (Unsandboxed)': '全部运行（无沙箱）',
	'Enabled by Run Everything Auto-Run Mode': '已由“全部运行”自动运行模式启用',

	// ─── Settings: Configuration / Browser / Network ─────────────────────────
	'HTTP Compatibility Mode': 'HTTP 兼容模式',
	'HTTP/2 provides low-latency streaming. Switch to HTTP/1.1 if your proxy or firewall does not support HTTP/2.': 'HTTP/2 提供低延迟流式传输。如果你的代理或防火墙不支持 HTTP/2，请切换到 HTTP/1.1。',
	'Required Domains': '必需域名',
	'Copy Domains': '复制域名',
	'Copied!': '已复制！',
	'Network Diagnostics': '网络诊断',
	'Run Diagnostic': '运行诊断',
	'Check connectivity to the local agent server and to the domains above.': '检查与本地智能体服务器及上述域名的连通性。',
	'The agent server itself runs on loopback (127.0.0.1) and never leaves this machine, so it does not need a firewall entry.': '智能体服务器运行在环回地址 (127.0.0.1)，不会离开本机，因此无需为其添加防火墙规则。',
	'These domains must be accessible for SideX to function: your configured AI provider(s), the extension marketplace, and update checks. Add them to your firewall or proxy allowlist.': 'SideX 需要能够访问以下域名：你配置的 AI 提供方、扩展市场和更新检查。请将它们加入防火墙或代理白名单。',
	'Local agent server (loopback)': '本地智能体服务器（环回）',
	'Allowed origins': '允许的来源',
	'Origins Sidex auto-fetches URLs from': 'Sidex 自动抓取 URL 的来源',
	'Origins must include the scheme and port if non-default (e.g., "https://github.com" or "http://localhost:3000").': '来源必须包含协议，端口非默认时也需包含（例如 "https://github.com" 或 "http://localhost:3000"）。',
	'Add Server': '添加服务器',
	'Installed MCP Servers': '已安装的 MCP 服务器',
	'+ New MCP Server': '+ 新建 MCP 服务器',
	'No MCP servers installed. Click "New MCP Server" to add one.': '尚未安装 MCP 服务器。点击“新建 MCP 服务器”进行添加。',
	'Browser': '浏览器',
	'Browser Automation': '浏览器自动化',
	'Choose browser automation framework': '选择浏览器自动化框架',
	'Off': '关闭',
	'On': '开启',
	'Auto open localhost links detected in output': '自动打开输出中检测到的 localhost 链接',
	'Show Localhost Links in Browser': '在浏览器中显示 localhost 链接',
	'Allow Sidex in background': '允许 Sidex 在后台运行',
	'Allowlist': '白名单',
	'Turbo': '极速',
	'Export': '导出',
	'Exporting allowed origins list as CSV...': '正在将允许的来源列表导出为 CSV...',
	'Import allowed origins CSV/TXT...': '导入允许来源 CSV/TXT...',
	'Reset to defaults': '恢复默认值',
	'Are you sure you want to reset allowed origins back to defaults?': '确定要将允许的来源恢复为默认值吗？',
	'No items': '暂无项目',
	'Disabled': '已禁用',
	'Disabled (manual approval), Allowlist (only approved origins), Turbo (always fetch)': '禁用（手动批准）、白名单（仅批准的来源）、极速（始终抓取）',
	'Auto web requests': '自动网页请求',
	'Auto-open edited files': '自动打开已编辑的文件',
	'Open files in the background if Sidex creates or edits them': '如果 Sidex 创建或编辑了文件，则在后台打开',
	'Respect .gitignore': '遵循 .gitignore',
	'Skip files and directories listed in .gitignore': '跳过 .gitignore 中列出的文件和目录',
	'Gitignore access': 'Gitignore 访问权限',
	'Let Sidex, tab, and supercomplete view and edit files in .gitignore': '允许 Sidex、Tab 和 supercomplete 查看和编辑 .gitignore 中的文件',
	'Edit origin URL:': '编辑来源 URL：',
	'Ignored Files': '忽略的文件',
	'Glob patterns for files where Tab completions should be disabled': '应禁用 Tab 补全的文件 glob 模式',
	'Glob patterns': 'Glob 模式',
	'Customize editor appearance and behavior.': '自定义编辑器的外观和行为。',
	'Sidex preview': 'Sidex 预览',
	'Sidex opens browser previews of dev servers it starts, integrating tightly with your workflow': 'Sidex 会在浏览器中预览其启动的开发服务器，与你的工作流紧密集成',

	// ─── Settings: Indexing ──────────────────────────────────────────────────
	'Indexing': '索引',
	'No Workspace Open': '未打开工作区',
	'Open a folder (File > Open Folder) to index your codebase for fast search.': '打开一个文件夹（文件 > 打开文件夹）即可建立索引，以便快速搜索代码库。',
	'Loading index stats…': '正在加载索引统计…',
	'Deleting…': '正在删除…',
	'Auto-index new folders': '自动索引新文件夹',
	'Automatically re-index when files change': '文件更改时自动重新索引',
	'Use the local index for fast grep across the codebase': '使用本地索引在代码库中快速 grep',
	'Instant grep': '即时 grep',
	'Computing...': '计算中...',
	'Indexing...': '正在索引...',
	'Sync': '同步',
	'Delete Index': '删除索引',
	'Ignored files': '忽略的文件',
	'Indexed': '已索引',
	'Size': '大小',
	'Last updated': '最近更新',

	// ─── Settings: Agents / Tab completion ───────────────────────────────────
	'Agent Review': '智能体审查',
	'Attribution': '署名',
	'Git': 'Git',
	'Start Agent Review on Commit': '提交时启动智能体审查',
	'Automatically start review when committing': '提交时自动启动审查',
	'Include Submodules in Agent Review': '智能体审查包含子模块',
	'Include git submodule changes in review': '审查中包含 git 子模块更改',
	'Include Untracked Files in Agent Review': '智能体审查包含未跟踪文件',
	'Include new untracked files in review': '审查中包含新的未跟踪文件',
	'How thorough agent review should be': '智能体审查的彻底程度',
	'Thorough': '彻底',
	'Quick': '快速',
	'PR Attribution': 'PR 署名',
	'Mark pull requests as made with SideX': '将拉取请求标记为使用 SideX 创建',
	'Commit Attribution': '提交署名',
	'Branch Prefix': '分支前缀',
	'Prefix applied to branches created by the agent': '应用于智能体所创建分支的前缀',
	'Explore subagent model': '探索子智能体模型',
	'Add a model to choose one': '添加模型后可选择',
	'Configure model': '配置模型',
	'Default': '默认',
	'Auto': '自动',
	'Always': '始终',
	'Never': '从不',
	'Unlimited': '无限制',
	'Mode': '模式',
	'Default Approach': '默认方式',
	'Queue Messages': '消息排队',
	'Queue all': '全部排队',
	'Send after current message': '在当前消息后发送',
	'Behavior when sending messages while one is active': '有活动消息时发送新消息的行为',
	'Allow agent to switch modes without asking': '允许智能体无需询问即可切换模式',
	'Contextual suggestions while prompting': '输入提示词时的上下文建议',
	'Usage data': '用量数据',
	'When to show usage summary after responses': '响应后显示用量摘要的时机',
	'Text Size': '文字大小',
	'Controls conversation text size': '控制对话文字大小',
	'Small': '小',
	'Medium': '中',
	'Large': '大',
	'Max Tab Count': '最大标签页数',
	'Maximum number of concurrent tabs': '并发标签页的最大数量',
	'Agent Autocomplete': '智能体自动补全',
	'Sidex Tab': 'Sidex Tab',
	'Imports': '导入',
	'Partial Accepts': '部分接受',
	'Auto Import for Python': 'Python 自动导入',
	'Automatically add import statements for Python files': '自动为 Python 文件添加 import 语句',
	'Automatically import necessary modules for TypeScript': '自动导入 TypeScript 所需的模块',
	'Suggestions While Commenting': '注释时的建议',
	'Allow Tab completions in comment regions': '允许在注释区域进行 Tab 补全',
	'Whitespace-Only Suggestions': '仅空白字符的建议',
	'Allow suggestions that only change whitespace': '允许仅更改空白字符的建议',
	'Context-aware multi-line code suggestions as you type': '输入时提供上下文感知的多行代码建议',
	'BETA': '测试版',
	'Enabled by': '启用方式',
	'Playwright': 'Playwright',
	'Puppeteer': 'Puppeteer',
	'Web search': '网页搜索',
	'Browser automation': '浏览器自动化',
	'Extend SideX with community plugins': '通过社区插件扩展 SideX',

	// ─── Orchestration ───────────────────────────────────────────────────────
	'Orchestration': '编排',
	'Acceptance:': '验收标准：',
	'Running...': '运行中...',
	'Completed': '已完成',
	'Failed': '失败',
	'Cancelled': '已取消',
	'Paused': '已暂停',

	// ─── Titlebar (SideX-owned chrome) / workspace popup / profile menu ──────
	'Search...': '搜索...',
	'Open Folder...': '打开文件夹...',
	'Clone Repository...': '克隆仓库...',
	'Recent Projects...': '最近的项目...',
	'New Window': '新建窗口',
	'Close Folder': '关闭文件夹',
	'SideX Settings': 'SideX 设置',
	'SideX Usage': 'SideX 用量',
	'Command Palette...': '命令面板...',
	'Open Keyboard Shortcuts [⌘K ⌘S]': '打开键盘快捷方式 [⌘K ⌘S]',
	'Open Keyboard Shortcuts [Ctrl+K Ctrl+S]': '打开键盘快捷方式 [Ctrl+K Ctrl+S]',
	'Extensions': '扩展',
	'Configure Snippets': '配置代码片段',
	'Tasks': '任务',
	'Themes': '主题',
	'Check for Updates...': '检查更新...',
	'Docs': '文档',
	'Join the Community': '加入社区',
	'Filter branches, stashes, tags...': '筛选分支、贮藏、标签...',
	'Loading...': '正在加载...',
	'Tags': '标签',
	'Local Branches': '本地分支',
	'Remote Branches': '远程分支',
	'Stashes': '贮藏',
	'New Branch...': '新建分支...',
	'Rename Branch...': '重命名分支...',
	'Delete Branch...': '删除分支...',
	'Fetch All Remotes': '获取所有远程',
	'Pull': '拉取',
	'Push': '推送',
	'Commit...': '提交...',
	'Merge Branch...': '合并分支...',
	'Rebase...': '变基...',
	'Stash Changes...': '贮藏更改...',
	'Pop Stash...': '弹出贮藏...',
	'Apply Stash...': '应用贮藏...',
	'Switch Branch': '切换分支',
	'No branch': '无分支',
	'Search': '搜索',
	'Account': '账户',
	'Settings and Account': '设置与账户',
	'Sign out': '退出登录',
	'Signed in as': '已登录为',
	'Copy path': '复制路径',
	'Copy relative path': '复制相对路径',
	'Reveal in Explorer': '在资源管理器中显示',
	'Show Sidex': '显示 Sidex',
	'Hide Sidex': '隐藏 Sidex',
	'Toggle Sidex': '切换 Sidex',
	'Move Sidex Views To Panel': '将 Sidex 视图移到面板',
	'Show Secondary Sidebar': '显示辅助侧边栏',
	'Hide Secondary Sidebar': '隐藏辅助侧边栏',
	'Toggle Secondary Sidebar': '切换辅助侧边栏',
	'Secondary Sidebar': '辅助侧边栏',
	'Sidex': 'Sidex',
	'Sidex icon': 'Sidex 图标',
	'Sidex: Inline Edit': 'Sidex: 内联编辑'
};

/** Forms with a variable part (counts, ids, account names, durations). */
const PATTERN_RULES: Array<{ re: RegExp; to: (...groups: string[]) => string }> = [
	{ re: /^(\d+) MCPs$/, to: n => `${n} 个 MCP` },
	{ re: /^Request \(([^)]+)\)$/, to: id => `请求 (${id})` },
	{ re: /^for (\d+)s$/, to: s => `用时 ${s} 秒` },
	{ re: /^(\d+(?:\.\d+)?)% Full$/, to: p => `已用 ${p}%` },
	{ re: /^~([\d.]+)K \/ ([\w.]+) Tokens$/, to: (a, b) => `~${a}K / ${b} 个 Token` },
	{ re: /^Context: ~([\d.]+)K of ([\w.]+) tokens \((\d+(?:\.\d+)?)% full\)$/, to: (a, b, p) => `上下文：~${a}K / ${b} 个 Token（已用 ${p}%）` },
	{ re: /^(\d+) files$/, to: n => `${n} 个文件` },
	{ re: /^([\d,]+) in \/ ([\d,]+) out$/, to: (i, o) => `输入 ${i} / 输出 ${o}` },
	{ re: /^([\d,]+) in \/ ([\d,]+) out · (.+)$/, to: (i, o, cost) => `输入 ${i} / 输出 ${o} · ${cost}` },
	{ re: /^(\d+) tool(?:s)? · (.+)$/, to: (n, status) => `${n} 个工具 · ${status}` },
	{ re: /^(\d+)\/(\d+) tasks • (.+)$/, to: (done, total, elapsed) => `${done}/${total} 个任务 • ${elapsed}` },
	{ re: /^Complete • (.+)$/, to: elapsed => `已完成 • ${elapsed}` },
	{ re: /^Stopped: (.+)$/, to: reason => `已停止：${reason}` },
	{ re: /^Connect (.+) account\?$/, to: name => `连接 ${name} 账户？` },
	{ re: /^Disconnect (.+) account\?$/, to: name => `断开 ${name} 账户？` },
	{ re: /^Connect (.+)\?$/, to: name => `连接 ${name}？` },
	{ re: /^Disconnect (.+)\?$/, to: name => `断开 ${name}？` },
	{ re: /^Connecting your (.+) account…$/, to: name => `正在连接你的 ${name} 账户…` },
	{ re: /^Disconnecting your (.+) account…$/, to: name => `正在断开你的 ${name} 账户…` },
	{ re: /^Not signed in to (.+) on this machine\.$/, to: name => `此设备上未登录 ${name}。` },
	{ re: /^Signed out or expired\. Sign in with (.+) again, then reconnect\.$/, to: name => `已退出登录或登录已过期。请重新登录 ${name}，然后重新连接。` },
	{ re: /^Enter your (.+) API Key$/, to: name => `输入你的 ${name} API 密钥` },
	{ re: /^(\d+) more providers?$/, to: n => `另外还有 ${n} 个提供方` },
	{ re: /^Connected — added (\d+) models?\.$/, to: n => `连接成功 — 已添加 ${n} 个模型。` },
	{ re: /^(.+) available — pick one, or type your own:$/, to: list => `${list} 个可用 — 请选择一个，或自行输入：` },
	{ re: /^This is a subscription login, not a billed API key\. Using it from another app may not be permitted by (.+)'s terms — entering an API key above avoids that entirely\.$/, to: name => `这是订阅登录，而非计费 API 密钥。${name} 的服务条款可能不允许在其他应用中使用它 — 在上方输入 API 密钥即可完全避免此问题。` },
	{ re: /^SideX will stop using your (.+) login for (.+) models\.$/, to: (name, provider) => `SideX 将停止使用你的 ${name} 登录来访问 ${provider} 模型。` },
	{ re: /^SideX will use your (.+) login \((.+)\) to run (.+) models\.$/, to: (name, who, provider) => `SideX 将使用你的 ${name} 登录（${who}）来运行 ${provider} 模型。` },
	{ re: /^The credential is read from (.+) and passed only to the agent server running on your own machine\. It is never sent anywhere else, and never shown in the app\.$/, to: location => `凭据从 ${location} 读取，只会传递给你本机运行的智能体服务器。它绝不会发送到其他地方，也不会在应用中显示。` },
	{ re: /^Open ([/~][^\s]*)$/, to: path => `打开 ${path}` },
	// SCM commit placeholder; the platform modifier (⌘ on macOS, Ctrl+ elsewhere)
	// is part of the string so both variants translate.
	{ re: /^Message \((⌘|Ctrl\+)Enter to commit on "(.+)"\)$/, to: (modifier, name) => `消息（${modifier}Enter 在 "${name}" 上提交）` },
	// Custom providers / API key actions (Settings → Models).
	{ re: /^Will route to (.+)$/, to: target => `将路由到 ${target}` },
	{ re: /^(\d+) models?$/, to: n => `${n} 个模型` },
	{ re: /^Provider ID "(.+)" is already in use\.$/, to: id => `提供方 ID "${id}" 已被使用。` },
	{ re: /^Provider ID "(.+)" is reserved by a built-in provider\.$/, to: id => `提供方 ID "${id}" 已被内置提供方占用。` },
	{ re: /^Delete custom provider (.+)\?$/, to: name => `删除自定义提供方 ${name}？` },
	{ re: /^SideX will stop using the "(.+)" endpoint and forget its API key\.$/, to: name => `SideX 将停止使用 "${name}" 端点，并忘记其 API 密钥。` },
	{ re: /^Models declared by "(.+)" stay in the model list but will stop working until another provider serves them\.$/, to: name => `"${name}" 声明的模型会保留在模型列表中，但在其他提供方服务它们之前将无法使用。` },
	{ re: /^(.+) is a custom endpoint that doesn't require a key\. Edit or remove it under Custom Providers\.$/, to: name => `${name} 是无需密钥的自定义端点。可在“自定义提供方”中编辑或删除。` },
	{ re: /^Custom endpoint defined under Custom Providers\. Enter an API key to use (.+) models\.$/, to: name => `自定义端点已在“自定义提供方”中定义。输入 API 密钥即可使用 ${name} 模型。` },
	{ re: /^(.+) account$/, to: name => `${name} 账户` }
];

const SKIP_SELECTOR = 'pre, code, kbd, samp, script, style, textarea, .markdown-root, .composer-human-message-content, .sc-code-citation, .sc-reverted-msg, .ui-default-diff__line-content, .ui-shell-tool-call__output, .monaco-editor, [contenteditable="true"], [data-no-i18n]';

const ATTRS = ['placeholder', 'title', 'aria-label'] as const;

function applyPatterns(text: string): string | null {
	for (const rule of PATTERN_RULES) {
		const match = rule.re.exec(text);
		if (match) {
			return rule.to(...match.slice(1));
		}
	}
	return null;
}

/** Translate one whole UI string. Returns the input unchanged when unknown. */
export function t(text: string): string {
	if (!text) {
		return text;
	}
	const direct = ZH_CN[text];
	if (direct !== undefined) {
		return direct;
	}
	const pattern = applyPatterns(text);
	return pattern ?? text;
}

/** Translate the trimmed core of a text value, preserving surrounding whitespace. */
function translateValue(raw: string): string | null {
	if (!raw) {
		return null;
	}
	const leading = raw.match(/^\s*/)?.[0] ?? '';
	const trailing = raw.match(/\s*$/)?.[0] ?? '';
	const core = raw.slice(leading.length, raw.length - trailing.length);
	if (!core || !/[A-Za-z]/.test(core)) {
		return null;
	}
	const translated = t(core);
	if (translated === core) {
		return null;
	}
	return leading + translated + trailing;
}

function isSkipped(node: Node): boolean {
	let el: Element | null = node.nodeType === 1 ? node as Element : node.parentElement;
	while (el) {
		if (el.matches(SKIP_SELECTOR)) {
			return true;
		}
		el = el.parentElement;
	}
	return false;
}

function translateTextNode(node: Text): void {
	if (!node.data || !/[A-Za-z]/.test(node.data)) {
		return;
	}
	const translated = translateValue(node.data);
	if (translated !== null && translated !== node.data) {
		node.data = translated;
	}
}

function translateAttributes(el: Element): void {
	for (const attr of ATTRS) {
		const value = el.getAttribute(attr);
		if (!value || !/[A-Za-z]/.test(value)) {
			continue;
		}
		const translated = translateValue(value);
		if (translated !== null && translated !== value) {
			el.setAttribute(attr, translated);
		}
	}
}

/**
 * Translate an already-built DOM subtree (or a single node). Cheap and idempotent:
 * strings that are already Chinese, or unknown to the dictionary, are left alone.
 */
export function translateDom(root: Node): void {
	if (!root) {
		return;
	}
	if (root.nodeType === 3 /* TEXT_NODE */) {
		translateTextNode(root as Text);
		return;
	}
	if (root.nodeType !== 1 /* ELEMENT_NODE */ && root.nodeType !== 9 /* DOCUMENT_NODE */ && root.nodeType !== 11 /* FRAGMENT */) {
		return;
	}
	if (root.nodeType === 1) {
		const el = root as Element;
		if (isSkipped(el)) {
			return;
		}
		translateAttributes(el);
	}
	const children = root.childNodes;
	for (let i = 0; i < children.length; i++) {
		const child = children.item(i);
		if (!child) {
			continue;
		}
		if (child.nodeType === 3) {
			if (!isSkipped(child)) {
				translateTextNode(child as Text);
			}
		} else if (child.nodeType === 1) {
			translateDom(child);
		}
	}
}

/**
 * Translate a container now and keep translating content added later.
 * Mutations caused by our own writes are debounced into a single rAF pass and
 * become no-ops, so the observer cannot loop.
 */
export function observeI18n(root: HTMLElement): II18nHandle {
	translateDom(root);

	let scheduled = false;
	let pending: Node[] = [];

	const flush = () => {
		scheduled = false;
		const nodes = pending;
		pending = [];
		for (const node of nodes) {
			if (node.isConnected) {
				translateDom(node);
			}
		}
	};

	const schedule = () => {
		if (scheduled) {
			return;
		}
		scheduled = true;
		if (typeof requestAnimationFrame === 'function') {
			requestAnimationFrame(flush);
		} else {
			setTimeout(flush, 16);
		}
	};

	const observer = new MutationObserver(records => {
		let dirty = false;
		for (const record of records) {
			if (record.type === 'attributes' || record.type === 'characterData') {
				pending.push(record.target);
				dirty = true;
			} else if (record.type === 'childList') {
				record.addedNodes.forEach(node => {
					if (node.isConnected) {
						pending.push(node);
						dirty = true;
					}
				});
			}
		}
		if (!dirty) {
			return;
		}
		// Streaming markdown can produce many records per frame. Collapse large
		// batches into a single full-container pass instead of unbounded queues.
		if (pending.length > 400) {
			pending = [root];
		}
		schedule();
	});

	observer.observe(root, {
		childList: true,
		subtree: true,
		characterData: true,
		attributes: true,
		attributeFilter: [...ATTRS]
	});

	return {
		dispose(): void {
			observer.disconnect();
			pending = [];
		}
	};
}
