const {
  app, BrowserWindow, ipcMain, Tray, Menu, shell, protocol, nativeImage, dialog, screen
} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const vault = require('./vault.cjs');

const APP_ID = 'com.notesapp.desktop';
const DIST = path.join(__dirname, '..', 'dist');
const SMOKE = process.argv.includes('--smoke');
// --demo：笔记库换成一套虚构的演示数据（生成 README 截图用），
// 不会读、也不会写用户的真实笔记
const DEMO = process.argv.includes('--demo');

let win = null;
let tray = null;
let quitting = false;

/* ============================================================
   路径：和 Tauri 版保持一致，两个外壳共用同一份笔记与设置
   ============================================================ */

function appDataRoot() {
  return path.join(app.getPath('appData'), APP_ID);
}

function settingsFile() {
  // 冒烟测试会点设置面板，不能让测试把用户真实的偏好改掉。
  // 这里直接把设置文件重定向到临时目录，比「跑完再写回」可靠：
  // 渲染层的保存是防抖的，写回之后它还会再覆盖一次。
  if (SMOKE || DEMO) return path.join(app.getPath('temp'), 'notes-smoke-settings.json');
  return path.join(appDataRoot(), 'settings.json');
}

/**
 * 冒烟测试专用的笔记库：每次启动从真实库**复制**一份到临时目录。
 *
 * 冒烟会挑真实存在的笔记来点、来拖、来改标题、来置顶，全是写操作。
 * 之前它直接跑在 `appData/vault` 上，一跑就把用户正在写的笔记的
 * mtime / updated 改掉，改错了还没法还原。复制一份过去，断言照样能
 * 对着同样的数据跑，用户那边一个字节都不动。
 */
let smokeVaultDir = null;

/* ------------------------------------------------------------
   演示库：一套纯虚构的笔记，用来生成 README 截图。

   为什么需要它：截图以前是拿用户**真实笔记库**复制一份跑出来的，
   于是每一张图里都带着他的客户目录名、现场照片、HMI 画面。
   截图一旦跟着仓库发出去，等于把客户资料一起发了。

   这里的内容全是编的（产品方向、读书笔记、采购清单），
   任何人看都没有信息量，正好用来当文档配图。
   ------------------------------------------------------------ */

function svgDoc(w, h, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" `
    + `viewBox="0 0 ${w} ${h}">${body}</svg>`;
}

const DEMO_ASSETS = [
  // 柱状图：卡片里当缩略图，正文里当插图
  {
    name: 'demo-chart.svg',
    svg: svgDoc(640, 320, [
      '<rect width="640" height="320" fill="#f7f5f1"/>',
      '<g stroke="#e7e2d9" stroke-width="1">',
      [70, 120, 170, 220, 270].map(y => `<line x1="56" y1="${y}" x2="592" y2="${y}"/>`).join(''),
      '</g>',
      '<g fill="#8d8578">',
      '<rect x="96" y="168" width="64" height="102" rx="6"/>',
      '<rect x="196" y="122" width="64" height="148" rx="6"/>',
      '<rect x="296" y="196" width="64" height="74" rx="6"/>',
      '<rect x="396" y="86" width="64" height="184" rx="6"/>',
      '<rect x="496" y="142" width="64" height="128" rx="6"/>',
      '</g>',
      '<g fill="#6b6459" font-family="Segoe UI, sans-serif" font-size="15" text-anchor="middle">',
      '<text x="128" y="296">记录</text>',
      '<text x="228" y="296">整理</text>',
      '<text x="328" y="296">回顾</text>',
      '<text x="428" y="296">思考</text>',
      '<text x="528" y="296">输出</text>',
      '</g>'
    ].join(''))
  },
  // 流程图：四个节点 + 箭头
  {
    name: 'demo-flow.svg',
    svg: svgDoc(800, 240, [
      '<rect width="800" height="240" fill="#f7f5f1"/>',
      '<g fill="#efeae1" stroke="#d9d2c6" stroke-width="1.5">',
      '<rect x="40" y="72" width="150" height="96" rx="14"/>',
      '<rect x="250" y="72" width="150" height="96" rx="14"/>',
      '<rect x="460" y="72" width="150" height="96" rx="14"/>',
      '<rect x="670" y="72" width="90" height="96" rx="14"/>',
      '</g>',
      '<g stroke="#b3aa9b" stroke-width="2.5" fill="none">',
      '<path d="M196 120 H244"/><path d="M406 120 H454"/><path d="M616 120 H664"/>',
      '</g>',
      '<g fill="#b3aa9b">',
      '<path d="M244 114 l12 6 -12 6 z"/><path d="M454 114 l12 6 -12 6 z"/><path d="M664 114 l12 6 -12 6 z"/>',
      '</g>',
      '<g fill="#5f594f" font-family="Segoe UI, sans-serif" font-size="17" text-anchor="middle">',
      '<text x="115" y="128">随手记</text>',
      '<text x="325" y="128">归到目录</text>',
      '<text x="535" y="128">写成一页</text>',
      '<text x="715" y="128">回顾</text>',
      '</g>'
    ].join(''))
  },
  // 三张「照片」：用渐变代替，纯装饰
  {
    name: 'demo-shot-a.svg',
    svg: svgDoc(320, 320, [
      '<defs><linearGradient id="ga" x1="0" y1="0" x2="1" y2="1">',
      '<stop offset="0" stop-color="#cfc7b8"/><stop offset="1" stop-color="#8a8175"/>',
      '</linearGradient></defs>',
      '<rect width="320" height="320" fill="url(#ga)"/>',
      '<circle cx="112" cy="112" r="52" fill="#f2eee6" opacity=".55"/>',
      '<path d="M0 244 Q80 196 160 232 T320 210 V320 H0 Z" fill="#f2eee6" opacity=".35"/>'
    ].join(''))
  },
  {
    name: 'demo-shot-b.svg',
    svg: svgDoc(200, 360, [
      '<defs><linearGradient id="gb" x1="0" y1="0" x2="0" y2="1">',
      '<stop offset="0" stop-color="#b8c3c8"/><stop offset="1" stop-color="#5f6d74"/>',
      '</linearGradient></defs>',
      '<rect width="200" height="360" fill="url(#gb)"/>',
      '<rect x="36" y="72" width="128" height="128" rx="16" fill="#eef2f4" opacity=".45"/>',
      '<rect x="36" y="228" width="86" height="14" rx="7" fill="#eef2f4" opacity=".5"/>',
      '<rect x="36" y="256" width="120" height="14" rx="7" fill="#eef2f4" opacity=".32"/>'
    ].join(''))
  },
  {
    name: 'demo-shot-c.svg',
    svg: svgDoc(900, 180, [
      '<defs><linearGradient id="gc" x1="0" y1="0" x2="1" y2="0">',
      '<stop offset="0" stop-color="#d8cbb5"/><stop offset=".5" stop-color="#b7a88e"/>',
      '<stop offset="1" stop-color="#8c8069"/>',
      '</linearGradient></defs>',
      '<rect width="900" height="180" fill="url(#gc)"/>',
      '<g fill="#f6f1e7" opacity=".4">',
      '<rect x="72" y="56" width="180" height="16" rx="8"/>',
      '<rect x="72" y="92" width="320" height="16" rx="8"/>',
      '<rect x="72" y="128" width="240" height="16" rx="8"/>',
      '</g>'
    ].join(''))
  },
  {
    name: 'demo-shot-d.svg',
    svg: svgDoc(480, 320, [
      '<defs><linearGradient id="gd" x1="0" y1="0" x2="1" y2="1">',
      '<stop offset="0" stop-color="#c6cbb8"/><stop offset="1" stop-color="#79806a"/>',
      '</linearGradient></defs>',
      '<rect width="480" height="320" fill="url(#gd)"/>',
      '<g fill="#f1f3ea" opacity=".45">',
      '<circle cx="150" cy="140" r="60"/>',
      '<circle cx="300" cy="196" r="38"/>',
      '</g>'
    ].join(''))
  }
];

/**
 * 演示笔记。rel 是相对库根的路径，body 是正文（front matter 由下面的函数拼）。
 * 内容刻意写得像「普通人的笔记」：工作、技术、阅读、生活，
 * 一个真实客户名、公司名、项目名都没有。
 */
const DEMO_NOTES = [
  {
    rel: '工作/产品/产品方向思考.md', tags: ['产品', '战略'], pinned: true, ago: 1,
    body: `# 产品方向思考

核心问题：用户到底是在「记录」还是在「思考」？

## 两种产品形态

- **记录型**：随手记、剪藏、速记。比的是输入摩擦有多低。
- **思考型**：结构化整理、双链、回顾。比的是能不能帮人产生新连接。

我倾向于后者，但后者的用户规模小一个量级。需要想清楚先做哪一端。

> 判断标准：如果用户打开应用之后不知道写什么，那就是记录型产品；
> 如果用户是带着问题来的，那就是思考型。

## 五个环节的投入分布

![环节分布](_assets/demo-chart.svg)

## 一条笔记的流转

![流转](_assets/demo-flow.svg)

## 下一步

1. 找 5 个真实用户聊一次
2. 把「打开即写」的路径压到 1 步以内
3. 验证双链到底有没有人用

- [x] 整理竞品清单
- [ ] 写访谈提纲
- [ ] 数据埋点方案
`
  },
  {
    rel: '工作/产品/竞品分析.md', tags: ['产品'], ago: 5,
    body: `# 竞品分析

挑了三个方向不同的产品，重点看它们的「第一步」是怎么设计的。

| 产品 | 定位 | 打开后第一步 | 值得抄的地方 |
| --- | --- | --- | --- |
| 甲 | 速记 | 直接光标在正文 | 零点击开始写 |
| 乙 | 双链 | 今日日记 | 默认有一个落点 |
| 丙 | 大纲 | 上次未完成 | 帮你接着上次 |

## 结论

「默认给一个落点」比「给你一个空白框」的留存高，但会削弱主动整理的动力。

折中方案：空白框 + 一行很轻的提示，不预填内容。
`
  },
  {
    rel: '工作/本周待办.md', tags: ['待办'], pinned: true, ago: 2,
    body: `# 本周待办

## 周一

- [x] 周会同步进度
- [x] 评审搜索模块设计稿
- [ ] 补充索引重建的异常分支 → 先补单元测试，见 [[数据库索引设计]]

## 周三

- [ ] 和设计确认空状态文案
- [ ] 压测：10 万条笔记下的全文搜索耗时 → 压测脚本写在 [[产品方向思考]] 的附录里

## 待定

- [ ] 决定是否接入拼音搜索
- [ ] 评估移动端文件访问的可行性
`
  },
  {
    rel: '工作/产品/需求评审记录.md', tags: ['产品'], ago: 8,
    body: `# 需求评审记录

## 参会

产品、设计、前端、测试各一人。

## 讨论过的点

1. **卡片要不要显示摘要**：要。没有摘要的卡片只能靠标题猜内容。
2. **摘要几行**：两行。三行会让一屏的卡片数量掉太多。
3. **图片放哪**：另起一行，固定高度。贴在右边会把摘要挤成很窄的一条。

## 结论

先按上面三条做，两周后看真实使用数据再调整。

![评审现场白板](_assets/demo-shot-d.svg)
`
  },
  {
    rel: '技术/笔记/Markdown 语法速查.md', tags: ['参考'], ago: 12,
    body: `# Markdown 语法速查

## 基础

**加粗**、*斜体*、~~删除线~~、\`行内代码\`

## 列表与任务

- 无序列表
- 支持嵌套
  - 第二层

- [ ] 未完成的任务
- [x] 已完成的任务

## 代码块

\`\`\`ts
interface Note {
  path: string;
  tags: string[];
}

export function isPinned(note: Note): boolean {
  return note.tags.includes('置顶');
}
\`\`\`

## 表格

| 方案 | 体积 | 成熟度 |
| --- | --- | --- |
| 方案 A | 8MB | 中 |
| 方案 B | 120MB | 高 |
`
  },
  {
    rel: '技术/后端/数据库索引设计.md', tags: ['技术'], ago: 40,
    body: `# 数据库索引设计

## 表结构

元信息与全文索引分开存放，索引表可以随时删除重建。

\`\`\`sql
CREATE TABLE notes (
  id      INTEGER PRIMARY KEY,
  path    TEXT UNIQUE NOT NULL,
  hash    TEXT NOT NULL,
  content TEXT NOT NULL
);
\`\`\`

## 为什么用 hash 判重

文件监听会重复触发事件，用内容指纹可以避免无意义的重复索引。

同时要防止回环：自己保存文件时先登记 hash，否则监听器会把自己的写入当成外部改动。

## 中文搜索

默认分词器对中文无效，必须用三元组或预分词。

| 分词器 | 中文 | 索引体积 |
| --- | --- | --- |
| 默认 | 不可用 | 小 |
| 三元组 | 可用 | 大 |
| 预分词 | 最好 | 中 |
`
  },
  {
    rel: '阅读/深度工作.md', tags: ['阅读', '方法论'], ago: 14,
    body: `# 阅读笔记：深度工作

作者把工作分成两类：**深度工作**与**浮浅工作**。

> 深度工作：在无干扰的状态下专注进行职业活动，
> 使个人的认知能力达到极限。

## 三个可落地的做法

1. **固定时段**：每天划出 90 分钟不可打断的区块
2. **仪式感**：同一个位置、同一杯咖啡、同一个开始动作
3. **增加关机成本**：把手机放到另一个房间，而不是调成静音

## 我的问题

总是用「先处理一下消息」来逃避真正难的思考。这本质上是一种拖延。

- [ ] 试一周 90 分钟区块
- [ ] 记录每天被打断的次数
`
  },
  {
    rel: '生活/采购清单.md', tags: ['生活'], ago: 16,
    body: `# 家庭采购清单

## 厨房

- [x] 抽纸
- [ ] 洗碗块
- [ ] 保鲜膜
- [ ] 咖啡豆（浅烘）

## 清洁

- [ ] 洗衣液
- [ ] 浴室除霉喷雾

## 备注

周末去一趟超市，顺便把车洗了。
`
  },
  {
    rel: '生活/旅行计划.md', tags: ['生活', '旅行'], ago: 20,
    body: `# 旅行计划

## 时间

11 月中，避开人最多的那一周。

## 想去的地方

- 伏见稻荷（清晨 6 点去，人少）
- 哲学之道
- 国立博物馆

## 存下来的几张图

![街景](_assets/demo-shot-a.svg)

![巷子](_assets/demo-shot-b.svg)

![全景](_assets/demo-shot-c.svg)

![窗边](_assets/demo-shot-d.svg)

## 待办

- [x] 订机票
- [ ] 订民宿（优先选河边）
- [ ] 买交通卡
- [ ] 查一下博物馆的休馆日
`
  },
  {
    rel: '收集箱/随手记.md', tags: ['灵感'], ago: 24,
    body: `# 收集箱

随手记一些还没成形的东西。

- 「回顾」功能可以做成每天随机推三条旧笔记
- 想试试把周报写成更新日志的形式
- 读到一个说法：整理不是为了记住，是为了以后能扔掉
`
  },
  {
    rel: '归档/面试问题整理.md', tags: ['工作'], archived: true, ago: 52,
    body: `# 面试问题整理

## 技术判断力

- 你怎么决定一个功能值不值得做？
- 讲一次你推翻自己方案的经历

## 协作

- 和产品意见不一致时，你怎么推进？
- 有没有主动砍掉过需求？

## 我的评分维度

1. 能不能把问题拆小
2. 有没有边界意识
3. 遇到不确定时是猜还是问
`
  },
  {
    rel: '废纸篓/十月复盘.md', tags: ['复盘'], trashed: true, ago: 60,
    body: `# 十月复盘

## 做成的

- 技术选型定下来了
- 读完了两本书
- 保持了每周三次跑步

## 没做成的

- 说好的日语学习，一次都没开始
- 周末几乎都在补觉

## 一个观察

计划失败通常不是时间不够，而是那件事在心里没有变成「具体的第一步」。

「学日语」不是一个可执行的动作，「打开应用背 10 个单词」才是。

- [ ] 十一月只定三件事
`
  }
];

function demoFrontMatter(n, now) {
  const ts = now - n.ago * 3600_000;
  const iso = new Date(ts).toISOString();
  const lines = [
    '---',
    `tags: [${(n.tags || []).join(', ')}]`,
    `pinned: ${!!n.pinned}`,
    `archived: ${!!n.archived}`,
    `trashed: ${!!n.trashed}`,
    `created: ${iso}`,
    `updated: ${iso}`
  ];
  if (n.hidden) lines.push('hidden: true');
  lines.push('---', '');
  return lines.join('\n');
}

/** 把演示库整个重写一遍（先删干净，保证每次跑出来一模一样） */
function seedDemoVault(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, '_assets'), { recursive: true });

  for (const a of DEMO_ASSETS) {
    fs.writeFileSync(path.join(dir, '_assets', a.name), a.svg, 'utf8');
  }

  const now = Date.now();
  for (const n of DEMO_NOTES) {
    const p = path.join(dir, n.rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, demoFrontMatter(n, now) + n.body, 'utf8');
  }
}

function smokeVault() {
  if (smokeVaultDir) return smokeVaultDir;

  // --demo：用虚构的演示库，不碰用户的真实笔记
  if (DEMO) {
    const dir = path.join(app.getPath('temp'), 'notes-demo-vault');
    seedDemoVault(dir);
    smokeVaultDir = dir;
    return dir;
  }

  const dir = path.join(app.getPath('temp'), 'notes-smoke-vault');
  fs.rmSync(dir, { recursive: true, force: true });

  const real = path.join(appDataRoot(), 'vault');
  try {
    if (fs.existsSync(real)) fs.cpSync(real, dir, { recursive: true });
    else fs.mkdirSync(dir, { recursive: true });
  } catch {
    fs.mkdirSync(dir, { recursive: true });
  }

  smokeVaultDir = dir;
  return dir;
}

function vaultRoot() {
  const custom = process.env.NOTES_APP_VAULT;
  if (custom && custom.trim()) {
    fs.mkdirSync(custom, { recursive: true });
    return custom;
  }
  if (SMOKE || DEMO) return smokeVault();

  const root = path.join(appDataRoot(), 'vault');
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function readSettings() {
  try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch { return null; }
}

function shouldQuitOnClose() {
  const s = readSettings();
  return !!s && s.closeAction === 'quit';
}

/* ============================================================
   自定义协议 app://
   为什么不用 loadFile：file:// 下 ES module 会被 CORS 拦掉，
   走注册过的标准协议就没有这个问题，也等价于 Tauri 的 tauri://
   ============================================================ */

protocol.registerSchemesAsPrivileged([{
  scheme: 'app',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
}, {
  // 笔记库里的图片走这个协议加载。
  // 不能直接用 file://：页面本身跑在 app:// 下，跨协议读本地文件会被拦。
  scheme: 'vault',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, bypassCSP: true }
}]);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
};

/** 只有这些类型允许通过 vault:// 读出来，别把 .md / .js 之类的当资源发给页面 */
const IMAGE_MIME = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp',
  'image/avif', 'image/bmp', 'image/svg+xml'
]);

function mimeOf(file) {
  return MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

function registerProtocol() {
  protocol.handle('app', request => {
    const url = new URL(request.url);
    let rel = decodeURIComponent(url.pathname);
    if (!rel || rel === '/') rel = '/index.html';

    const file = path.join(DIST, rel);
    if (!file.startsWith(DIST)) return new Response('forbidden', { status: 403 });

    try {
      const data = fs.readFileSync(file);
      return new Response(data, { headers: { 'content-type': mimeOf(file) } });
    } catch {
      return new Response('not found', { status: 404 });
    }
  });

  /* 笔记库里的图片。
   *
   * 为什么不用 file://：页面跑在 app:// 下，跨协议读本地文件会被当成跨源请求拦掉。
   *
   * URL 形如 vault://local/_assets/a.png?b=收集箱
   *  - 路径是「相对笔记库根」的
   *  - b 是这篇笔记所在的目录，用来兼容用户手写的相对路径 `./img.png`
   *
   * 解析顺序：先按「笔记目录 + 路径」找，再按「库根 + 路径」找。
   * 这样我们自己插入的 `_assets/xxx.png`（库根相对）和用户手写的
   * 同名相对路径都能显示，而移动笔记不会让前一种失效。 */
  protocol.handle('vault', request => {
    const url = new URL(request.url);
    let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const base = (url.searchParams.get('b') || '').replace(/^\/+|\/+$/g, '');

    if (!rel) return new Response('not found', { status: 404 });

    const candidates = base ? [`${base}/${rel}`, rel] : [rel];
    for (const c of candidates) {
      let file;
      try {
        file = vault.safeJoin(vaultRoot(), c);
      } catch {
        continue; // 越权路径直接跳过
      }
      const type = mimeOf(file);
      if (!IMAGE_MIME.has(type)) return new Response('forbidden', { status: 403 });
      try {
        const data = fs.readFileSync(file);
        return new Response(data, {
          headers: {
            'content-type': type,
            // 图片内容不会变（文件名带随机串），可以让页面放心缓存
            'cache-control': 'public, max-age=31536000, immutable'
          }
        });
      } catch { /* 换下一个候选 */ }
    }
    return new Response('not found', { status: 404 });
  });
}

/* ============================================================
   IPC：命令名 / 参数与 Rust 版完全一致
   ============================================================ */

function registerIpc() {
  const root = () => vaultRoot();

  ipcMain.handle('vault_info', () => {
    const r = root();
    return { root: r, label: r, kind: 'fs' };
  });

  ipcMain.handle('vault_list', () => vault.list(root()));

  ipcMain.handle('note_read', (_e, { rel_path }) => vault.read(root(), rel_path));

  ipcMain.handle('note_write', (_e, { rel_path, raw }) => vault.write(root(), rel_path, raw));

  ipcMain.handle('note_remove', (_e, { rel_path }) => { vault.remove(root(), rel_path); });

  ipcMain.handle('note_move', (_e, { from_rel, to_rel }) => { vault.rename(root(), from_rel, to_rel); });

  // 改名 / 移走笔记之后收走空目录，别在磁盘上留空壳
  ipcMain.handle('vault_prune', (_e, { rel_path }) => { vault.prune(root(), rel_path); });

  // 图片：渲染进程把文件读成 base64 传过来，落到笔记库的 _assets/ 下
  ipcMain.handle('asset_write', (_e, { rel_path, base64 }) =>
    vault.writeBinary(root(), rel_path, base64));

  ipcMain.handle('asset_exists', (_e, { rel_path }) => vault.exists(root(), rel_path));

  ipcMain.handle('settings_load', () => {
    try { return fs.readFileSync(settingsFile(), 'utf8'); } catch { return null; }
  });

  ipcMain.handle('settings_save', (_e, { json }) => {
    fs.mkdirSync(appDataRoot(), { recursive: true });
    fs.writeFileSync(settingsFile(), json, 'utf8');
  });

  ipcMain.handle('vault_reveal', async () => { await shell.openPath(root()); });

  // 正文里的 http 链接：用系统浏览器打开，别在应用里新开窗口
  ipcMain.handle('open_external', async (_e, { url }) => {
    const u = String(url || '');
    if (!/^(https?:|mailto:)/i.test(u)) return false;
    await shell.openExternal(u);
    return true;
  });

  ipcMain.handle('set_autostart', (_e, { on }) => {
    app.setLoginItemSettings({ openAtLogin: !!on, path: process.execPath });
  });

  /* 无边框窗口的自绘按钮 */
  ipcMain.handle('win_minimize', () => { if (win && !win.isDestroyed()) win.minimize(); });

  ipcMain.handle('win_toggle_max', () => {
    if (!win || win.isDestroyed()) return false;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
    return win.isMaximized();
  });

  // 走 win.close()，这样「点关闭是收进托盘还是退出」的设置依然生效
  ipcMain.handle('win_close', () => { if (win && !win.isDestroyed()) win.close(); });

  ipcMain.handle('win_is_max', () => !!win && !win.isDestroyed() && win.isMaximized());
}

/* ============================================================
   窗口 / 托盘
   ============================================================ */

/**
 * 默认窗口尺寸。
 *
 * 1570×960 是三栏铺开刚刚好、又不显得空的那个大小（在 2560×1440 上试出来的）。
 * 但不能直接写死：1366×768 的笔记本上，这个尺寸会顶出屏幕外面去，右下角永远够不着。
 * 所以拿它当上限，小屏幕上按可用区域的比例收。
 *
 * 用 workAreaSize 而不是 size，是为了把任务栏的高度扣掉。
 */
const PREFERRED_W = 1570;
const PREFERRED_H = 960;

function defaultWindowSize() {
  try {
    const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
    return {
      width: Math.min(PREFERRED_W, Math.round(sw * 0.86)),
      height: Math.min(PREFERRED_H, Math.round(sh * 0.9))
    };
  } catch {
    // 极早期取不到显示器信息时退回首选值，总比崩掉好
    return { width: PREFERRED_W, height: PREFERRED_H };
  }
}

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createWindow() {
  const isMac = process.platform === 'darwin';
  const size = defaultWindowSize();
  win = new BrowserWindow({
    width: size.width,
    height: size.height,
    minWidth: 760,
    minHeight: 480,
    title: '笔记',
    backgroundColor: '#ffffff',
    show: !SMOKE,
    autoHideMenuBar: true,
    // 去掉系统标题栏：Windows/Linux 完全无边框，按钮由界面自绘；
    // macOS 用 hiddenInset 保留左上角红绿灯（那套按钮用户改不了也不该改）
    ...(isMac ? { titleBarStyle: 'hiddenInset' } : { frame: false }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadURL('app://notes/index.html');

  // 最大化状态变化时通知界面换图标
  const pushState = () => {
    if (win && !win.isDestroyed()) win.webContents.send('win_state', win.isMaximized());
  };
  win.on('maximize', pushState);
  win.on('unmaximize', pushState);

  win.on('close', e => {
    if (quitting) return;
    if (shouldQuitOnClose()) { quitting = true; return; }
    // 默认行为：收进托盘，不退出
    e.preventDefault();
    win.hide();
  });

  if (SMOKE) runSmoke();
}

function createTray() {
  const iconPath = path.join(__dirname, 'tray.png');
  const img = nativeImage.createFromPath(iconPath);
  tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img);
  tray.setToolTip('笔记');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示主窗口', click: showWindow },
    { type: 'separator' },
    { label: '退出', click: () => { quitting = true; app.quit(); } }
  ]));
  tray.on('click', showWindow);
}

/* ============================================================
   冒烟测试：不开窗口，加载页面后检查 DOM 与文件写入
   ============================================================ */

const SMOKE_ASSET = '_assets/smoke-card.svg';
const SMOKE_NOTE = '图片测试.md';
const SMOKE_CRLF_NOTE = '换行符测试.md';
const SMOKE_CODE_NOTE = '代码块测试.md';
const SMOKE_LINK_NOTE = '链接与待办.md';
const SMOKE_DEEP_NOTE = '技术/子目录/深层测试.md';
// 多图卡片：四张长宽比差很多的图，专门用来验证「一排最多露 3 张、多出来的标 +N」
const SMOKE_MULTI_NOTE = '多图测试.md';
const SMOKE_MULTI_ASSETS = [
  { path: '_assets/smoke-m-wide.svg', w: 600, h: 200 },
  { path: '_assets/smoke-m-square.svg', w: 300, h: 300 },
  { path: '_assets/smoke-m-tall.svg', w: 190, h: 360 },
  { path: '_assets/smoke-m-super.svg', w: 900, h: 160 }
];
// 占位符文件名：正文有 `# 占位符改名测试`，文件名却是「无标题.md」
const SMOKE_PH_NOTE = '占位符/无标题.md';

/**
 * 造四篇测试笔记：
 * ① 引用一张图的，用来验证「图片能真的画出来」
 * ② 用 CRLF 换行写的，用来守住「CRLF 笔记卡片摘要空白」那个 bug
 * ③ 带围栏代码块的，用来验证语法高亮 + 代码里的表格不被误认
 * ④ 带笔记链接和待办解决方式的
 *
 * 必须在窗口加载之前落盘，因为笔记列表是启动时扫出来的。
 * updated 故意写成很小的值，让这几篇排到最后，不影响其它用例对「第一篇」的假设。
 */
function prepareSmokeFixtures() {
  if (!SMOKE) return;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="220" viewBox="0 0 600 220">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="#7ea37e"/><stop offset="1" stop-color="#d9a34a"/>
</linearGradient></defs>
<rect width="600" height="220" rx="14" fill="url(#g)"/>
<text x="300" y="120" font-size="30" font-family="sans-serif" fill="#ffffff"
 text-anchor="middle">图片渲染正常</text>
</svg>`;
  const body = [
    '---', 'created: 1', 'updated: 1', '---', '',
    '# 图片测试', '',
    '下面这张图应该直接显示出来，而不是一行 `![]()` 源码：', '',
    `![示意图](${SMOKE_ASSET})`, '',
    '图片上下都应该是正常段落。', ''
  ].join('\n');

  // CRLF 版：正文有好几段，卡片摘要必须显示出来（以前这里是空白的）
  const crlfBody = [
    '---', 'created: 2', 'updated: 2', '---', '',
    '# 换行符测试', '',
    '这一行是正文，必须出现在卡片摘要里。', '',
    '第二段也要能认出来。', ''
  ].join('\r\n');

  // 代码块：第一段有语言标记（要高亮），第二段里放一个「假表格」——
  // 代码块里的 `| a | b |` 绝不能被 tableField 认成表格，否则两个块级 replace 会重叠报错
  const codeBody = [
    '---', 'created: 3', 'updated: 3', '---', '',
    '# 代码块测试', '',
    '下面这段应该带语法高亮：', '',
    '```ts',
    '// 注释要被染色',
    "const greeting: string = 'hello';",
    'function greet(name: string): string {',
    '  return greeting + name;',
    '}',
    '```', '',
    '代码里的表格不该被当成表格：', '',
    '```',
    '| a | b |',
    '| --- | --- |',
    '| 1 | 2 |',
    '```', ''
  ].join('\n');

  // 链接 + 待办解决方式
  const linkBody = [
    '---', 'created: 4', 'updated: 4', '---', '',
    '# 链接与待办', '',
    '点这里跳到 [[图片测试]]。', '',
    '- [ ] 还没写解决方式的任务',
    '- [x] 已经写了的任务 → 换成新方案，见 [[换行符测试]]', ''
  ].join('\n');

  try {
    vault.writeBinary(vaultRoot(), SMOKE_ASSET, Buffer.from(svg, 'utf8').toString('base64'));
    vault.write(vaultRoot(), SMOKE_NOTE, body);
    vault.write(vaultRoot(), SMOKE_CRLF_NOTE, crlfBody);
    vault.write(vaultRoot(), SMOKE_CODE_NOTE, codeBody);
    vault.write(vaultRoot(), SMOKE_LINK_NOTE, linkBody);
    // 三级目录：用来验证卡片上那行路径「钻进哪一级就显示剩下的哪几级」
    vault.write(vaultRoot(), SMOKE_DEEP_NOTE, [
      '---', 'created: 5', 'updated: 5', '---', '',
      '# 深层测试', '',
      '这篇在三级目录里，卡片上应该能看到路径。', ''
    ].join('\n'));

    // 多图卡片：四张比例差异很大的图，卡片预览里并排摆开，第 4 张收进 +1
    const multiLines = [
      '---', 'created: 6', 'updated: 6', '---', '',
      '# 多图测试', '',
      '这篇有四张图，卡片上一排最多露三张，剩下的收进右下角的 +1。', ''
    ];
    for (const a of SMOKE_MULTI_ASSETS) {
      const pic = `<svg xmlns="http://www.w3.org/2000/svg" width="${a.w}" height="${a.h}">` +
        `<rect width="${a.w}" height="${a.h}" rx="12" fill="#8aa2c8"/>` +
        `<text x="${a.w / 2}" y="${a.h / 2}" font-size="26" font-family="sans-serif" ` +
        `fill="#ffffff" text-anchor="middle">${a.w}x${a.h}</text></svg>`;
      vault.writeBinary(vaultRoot(), a.path, Buffer.from(pic, 'utf8').toString('base64'));
      multiLines.push(`![${a.w}x${a.h}](${a.path})`, '');
    }
    vault.write(vaultRoot(), SMOKE_MULTI_NOTE, multiLines.join('\n'));

    // 占位符文件名：启动时应该被 syncPlaceholderNames() 改成正文标题
    vault.write(vaultRoot(), SMOKE_PH_NOTE, [
      '---', 'created: 7', 'updated: 7', '---', '',
      '# 占位符改名测试', '',
      '这篇的文件名本来是「无标题.md」，启动时应该按这个标题改过来。', ''
    ].join('\n'));
  } catch (err) {
    console.log('SMOKE fixtureFailed=' + err.message);
  }
}

function clearSmokeFixtures() {
  // 按「文件名开头」清，而不是按固定路径：
  // 「标题改名」用例会把文件名改掉（可能是 代码块Z测试.md 这种），
  // 老版本还可能把它们搬到「收集箱」里，逐个列路径容易漏
  const stems = ['图片测试', '换行符测试', '码块测试', '链接与待办', '深层测试', '多图测试', '占位符改名测试'];
  let files = [];
  try { files = vault.list(vaultRoot()); } catch { files = []; }

  for (const f of files) {
    const base = (f.relPath.split('/').pop() || '');
    if (!stems.some(s => base.includes(s))) continue;
    try { vault.remove(vaultRoot(), f.relPath); } catch { /* 清不掉就算了 */ }
  }
  try { vault.remove(vaultRoot(), SMOKE_ASSET); } catch { /* 没造出来 */ }
  for (const a of SMOKE_MULTI_ASSETS) {
    try { vault.remove(vaultRoot(), a.path); } catch { /* 没造出来 */ }
  }
  // 改名没成功时它还在原处，一并收走，别在副本里留个假的「无标题」
  try { vault.remove(vaultRoot(), SMOKE_PH_NOTE); } catch { /* 已经改过名了 */ }
}

function runSmoke() {
  // 每次冒烟都从默认设置开始，截图才稳定，也不会被上一次跑的结果影响
  try { fs.unlinkSync(settingsFile()); } catch { /* 本来就没有 */ }

  const logs = [];
  win.webContents.on('console-message', (...args) => {
    const first = args[0];
    const msg = first && typeof first === 'object' && typeof first.message === 'string'
      ? first.message
      : args[2];
    if (typeof msg === 'string') logs.push(msg);
  });

  win.webContents.on('did-fail-load', (_e, code, desc) => {
    console.log('SMOKE_FAIL_LOAD', code, desc);
    app.exit(1);
  });

  win.webContents.on('did-finish-load', () => {
    setTimeout(async () => {
      try {
        const js = s => win.webContents.executeJavaScript(s);
        const wait = ms => new Promise(r => setTimeout(r, ms));

        const cards = await js("document.querySelectorAll('.swipe').length");
        const title = await js("document.getElementById('mid-title').textContent");
        const bridge = await js("typeof window.notesBridge");
        const errs = logs.filter(l => l.includes('Error') || l.includes('失败'));
        // 未选中笔记时右栏占位元素不能是窗口拖动区，否则会吃掉弹层的点击
        let blankOk = true;
        // 图片：渲染出来的尺寸对不对 / 单击只选中 / 双击退回源码 / 改宽度 / 粘贴能不能落盘
        let imgOk = false;
        let imgPickOk = false;
        let imgBoxOk = false;
        let imgResizeOk = false;
        let imgEditOk = false;
        let imgPasteOk = false;
        // 本轮新增四项的断言
        let tagOk = false;
        let renameOk = false;
        let pinOk = false;
        let orderOk = false;
        // 卡片预览：不能有空白卡片，CRLF 笔记的摘要要显示出来
        let previewOk = false;
        // 第 32 轮：隐藏 / 密码锁定 / 自定义名字 / 卡片图独占一行
        let hideOk = false;
        let lockOk = false;
        let appNameOk = false;
        let railOk = false;
        let thumbRowOk = false;
        let figsOk = false;
        // 第 35 轮：启动时把「无标题.md」这类占位符文件名对齐成正文标题
        let placeholderOk = false;

        // 设置面板：必须在「什么都没选中」的状态下用真鼠标点。
        // 这个状态下右栏是铺满整列的 .blank 占位元素。它一旦被标成
        // -webkit-app-region:drag，窗口级命中区域就会把盖在它上面的弹层
        // 整个右半边（含右上角关闭按钮）吃掉 —— 就是这个 bug。
        // 另外 JS 的 el.click() 不经过命中测试，所以以前的 smoke 测不出来。
        try {
          win.show();
          win.focus();
          await wait(400);

          const blank = await js(`(()=>{
            const b = document.querySelector('.blank');
            if (!b) return 'absent';
            const r = b.getBoundingClientRect();
            const reg = getComputedStyle(b).webkitAppRegion;
            return 'present ' + Math.round(r.width) + 'x' + Math.round(r.height) + ' drag=' + reg;
          })()`);
          console.log('SMOKE blank=' + blank);
          // 这条是硬性要求：铺满整列的占位元素绝不能是窗口拖动区
          blankOk = !/drag=drag/.test(String(blank));

          await js("document.getElementById('open-settings').click()");
          await wait(450);

          // 关闭按钮：先看它上面盖着谁，再真点一下
          const closePt = await js(`(()=>{
            const e = document.getElementById('close-settings');
            const r = e.getBoundingClientRect();
            const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
            const top = document.elementFromPoint(x, y);
            return { x, y, top: top ? (top.id || top.className || top.tagName) : 'null' };
          })()`);
          win.webContents.sendInputEvent({ type: 'mouseDown', x: closePt.x, y: closePt.y, button: 'left', clickCount: 1 });
          win.webContents.sendInputEvent({ type: 'mouseUp', x: closePt.x, y: closePt.y, button: 'left', clickCount: 1 });
          await wait(450);
          const stillOpen = await js("document.querySelectorAll('.backdrop.open').length");
          console.log('SMOKE setClose at=' + closePt.x + ',' + closePt.y + ' top=' + closePt.top +
            ' openAfter=' + stillOpen);

          // 右半栏的开关：真点一次看有没有反应。上一步已经关掉了就重新打开
          if (!stillOpen) {
            await js("document.getElementById('open-settings').click()");
            await wait(400);
          }
          const swBefore = await js("document.getElementById('sw-swipe').classList.contains('on')");
          const swPt = await js(`(()=>{
            const e = document.getElementById('sw-swipe');
            const r = e.getBoundingClientRect();
            const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
            const top = document.elementFromPoint(x, y);
            return { x, y, top: top ? (top.id || top.className || top.tagName) : 'null' };
          })()`);
          win.webContents.sendInputEvent({ type: 'mouseDown', x: swPt.x, y: swPt.y, button: 'left', clickCount: 1 });
          win.webContents.sendInputEvent({ type: 'mouseUp', x: swPt.x, y: swPt.y, button: 'left', clickCount: 1 });
          await wait(450);
          const swAfter = await js("document.getElementById('sw-swipe').classList.contains('on')");
          console.log('SMOKE setSwitch at=' + swPt.x + ',' + swPt.y + ' top=' + swPt.top +
            ' before=' + swBefore + ' after=' + swAfter);

          // 点回来，别把用户设置改掉
          if (swBefore !== swAfter) {
            win.webContents.sendInputEvent({ type: 'mouseDown', x: swPt.x, y: swPt.y, button: 'left', clickCount: 1 });
            win.webContents.sendInputEvent({ type: 'mouseUp', x: swPt.x, y: swPt.y, button: 'left', clickCount: 1 });
            await wait(450);
          }
          // 再用真实点击关一次，确认关闭按钮真的能用
          win.webContents.sendInputEvent({ type: 'mouseDown', x: closePt.x, y: closePt.y, button: 'left', clickCount: 1 });
          win.webContents.sendInputEvent({ type: 'mouseUp', x: closePt.x, y: closePt.y, button: 'left', clickCount: 1 });
          await wait(400);
          console.log('SMOKE setClosed=' + (await js("document.querySelectorAll('.backdrop.open').length")));
          win.hide();
        } catch (err) {
          console.log('SMOKE setPanelFailed=' + err.message);
        }

        // 点开第一篇，确认编辑器在真实窗口里能挂上
        await js("document.querySelector('.swipe .card').click()");
        await wait(800);
        const lines = await js("document.querySelectorAll('#editor-host .cm-line').length");
        const crumb = await js("(document.querySelector('.doc-head .crumb')||{}).textContent || ''");

        console.log('SMOKE cards=' + cards);
        // 默认窗口尺寸：本机 2560x1440 上应该是 1570x960
        console.log('SMOKE window=' + win.getSize().join('x'));

        // 卡片预览：每张卡都要有摘要或缩略图，不能空一片；
        // CRLF 那篇的摘要必须显示出来（以前 split(/\n{2,}/) 切不开，整篇被扔掉 → 空白）
        const prev = await js(`(()=>{
          const cards = [...document.querySelectorAll('.card')];
          const blank = cards.filter(c => {
            const p = c.querySelector('.card-body p');
            const th = c.querySelector('.card-thumb');
            return !(p && p.textContent.trim()) && !th;
          });
          const crlf = cards.find(c => {
            const h = c.querySelector('h4');
            return h && h.textContent.indexOf('换行符测试') >= 0;
          });
          const p = crlf ? crlf.querySelector('.card-body p') : null;
          return {
            total: cards.length,
            blank: blank.length,
            thumbs: document.querySelectorAll('.card-thumb').length,
            crlf: p ? p.textContent.trim() : 'missing'
          };
        })()`);
        console.log('SMOKE preview=cards' + prev.total + ' blank' + prev.blank
          + ' thumbs' + prev.thumbs + ' crlf=' + JSON.stringify(prev.crlf));
        previewOk = prev.blank === 0 && prev.thumbs >= 1
          && String(prev.crlf).indexOf('必须出现在卡片摘要里') >= 0;
        console.log('SMOKE title=' + title);
        console.log('SMOKE bridge=' + bridge);
        console.log('SMOKE editorLines=' + lines);
        console.log('SMOKE crumb=' + crumb.trim());
        console.log('SMOKE errors=' + (errs.length ? errs.join(' | ') : 'none'));


        const files = vault.list(vaultRoot());
        console.log('SMOKE files=' + files.length);

        // 启动时应该已经把「占位符/无标题.md」按正文标题改成「占位符/占位符改名测试.md」
        const phOld = files.some(f => f.relPath === SMOKE_PH_NOTE);
        const phNew = files.some(f => f.relPath === '占位符/占位符改名测试.md');
        console.log('SMOKE placeholderRename old=' + phOld + ' new=' + phNew);
        placeholderOk = !phOld && phNew;

        // 截图工具：隐藏窗口的合成器不重绘，capturePage 会拿到旧帧，所以先让它真的画一次。
        // 源码运行时写进项目 docs/；打包成 asar 后 asar 内部只读，writeFileSync 会 ENOTDIR，退到临时目录。
        const saveShot = async name => {
          try {
            win.showInactive();
            await wait(600);
            const img = await win.webContents.capturePage();
            const png = img.toPNG();
            for (const target of [
              path.join(__dirname, '..', 'docs', name),
              path.join(app.getPath('temp'), 'notes-app', name)
            ]) {
              try {
                fs.mkdirSync(path.dirname(target), { recursive: true });
                fs.writeFileSync(target, png);
                return target;
              } catch { /* 换下一个位置 */ }
            }
            return 'none';
          } catch (err) {
            return 'failed:' + err.message;
          }
        };

        const shot = await saveShot('desktop-window.png');
        console.log('SMOKE shot=' + shot);
        win.hide();

        // 局部放大截图：13px 的小字在 1x 截图里根本看不清，
        // 裁一块出来再放大，用来核对几像素宽的细节（选中色条、表格分隔线之类）
        const saveZoom = async (name, rect, scale) => {
          try {
            win.showInactive();
            await wait(500);
            const img = await win.webContents.capturePage(rect);
            const big = img.resize({
              width: Math.round(rect.width * (scale || 3)),
              height: Math.round(rect.height * (scale || 3)),
              quality: 'best'
            });
            const target = path.join(app.getPath('temp'), 'notes-app', name);
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, big.toPNG());
            return target;
          } catch (err) {
            return 'failed:' + err.message;
          }
        };

        try {
          const cardBox = await js(`(()=>{
            const c = document.querySelector('.card.active');
            if (!c) return null;
            const r = c.getBoundingClientRect();
            return { x: Math.round(r.left) - 4, y: Math.round(r.top) - 4,
                     width: Math.round(r.width) + 8, height: Math.round(r.height) + 8 };
          })()`);
          if (cardBox) {
            console.log('SMOKE zoomCard=' + (await saveZoom('zoom-card.png', cardBox, 3)));
            const bar = await js(`(()=>{
              const c = document.querySelector('.card.active');
              const s = getComputedStyle(c, '::before');
              return s.content + ' w=' + s.width + ' left=' + s.left + ' bg=' + s.backgroundColor;
            })()`);
            console.log('SMOKE cardBar=' + bar);
            win.hide();
          }
          const tblBox = await js(`(()=>{
            const t = document.querySelector('.cm-table table');
            if (!t) return null;
            const r = t.getBoundingClientRect();
            return { x: Math.round(r.left) - 6, y: Math.round(r.top) - 6,
                     width: Math.round(r.width) + 12, height: Math.round(r.height) + 12 };
          })()`);
          if (tblBox) {
            console.log('SMOKE zoomTable=' + (await saveZoom('zoom-table.png', tblBox, 2)));
            win.hide();
          }
          const headBox = await js(`(()=>{
            const h = document.querySelector('.mid-head');
            if (!h) return null;
            const r = h.getBoundingClientRect();
            return { x: Math.round(r.left), y: Math.round(r.top),
                     width: Math.round(r.width), height: Math.round(r.height) };
          })()`);
          if (headBox) {
            console.log('SMOKE zoomHead=' + (await saveZoom('zoom-midhead.png', headBox, 2)));
            win.hide();
          }
        } catch (err) {
          console.log('SMOKE zoomCardFailed=' + err.message);
        }

        // 表格：真鼠标点一下，确认能露出源码继续编辑（没有表格就跳过）
        try {
          const box = await js(`(()=>{
            const t = document.querySelector('.cm-table');
            if (!t) return null;
            const r = t.getBoundingClientRect();
            return { x: Math.round(r.left + 24), y: Math.round(r.top + 18) };
          })()`);
          if (!box) {
            console.log('SMOKE tableEdit=none');
          } else {
            // 必须让窗口真的在前台，sendInputEvent 才会送到渲染进程
            win.show();
            win.focus();
            await wait(400);
            win.webContents.sendInputEvent({ type: 'mouseDown', x: box.x, y: box.y, button: 'left', clickCount: 1 });
            win.webContents.sendInputEvent({ type: 'mouseUp', x: box.x, y: box.y, button: 'left', clickCount: 1 });
            await wait(600);
            const src = await js("document.querySelectorAll('#editor-host .cm-line.cm-tbl,#editor-host .cm-line.cm-tblsep').length");
            const left = await js("document.querySelectorAll('.cm-table').length");
            const caret = await js("(()=>{const s=getSelection(); return s&&s.anchorNode?String(s.anchorNode.parentElement&&s.anchorNode.parentElement.className||''):'';})()");
            console.log('SMOKE tableEdit=src' + src + ' widget' + left + ' caret=' + caret);

            // 再把光标挪到普通段落，确认表格能变回来
            const plain = await js(`(()=>{
              const l = [...document.querySelectorAll('#editor-host .cm-line')].find(e => !e.className.includes('cm-tbl'));
              if (!l) return null;
              const r = l.getBoundingClientRect();
              return { x: Math.round(r.left + 8), y: Math.round(r.top + r.height / 2) };
            })()`);
            if (plain) {
              win.webContents.sendInputEvent({ type: 'mouseDown', x: plain.x, y: plain.y, button: 'left', clickCount: 1 });
              win.webContents.sendInputEvent({ type: 'mouseUp', x: plain.x, y: plain.y, button: 'left', clickCount: 1 });
              await wait(500);
              const back = await js("document.querySelectorAll('.cm-table').length");
              console.log('SMOKE tableBack=widget' + back);
            }
          }
        } catch (err) {
          console.log('SMOKE tableEditFailed=' + err.message);
        }

        // 快捷栏：点一下粗体，确认真的改到了正文
        try {
          const hasBtn = await js("!!document.querySelector('[data-qb=\"bold\"]')");
          if (!hasBtn) {
            console.log('SMOKE quickbar=missing');
          } else {
            await js("document.querySelector('[data-qb=\"bold\"]').click()");
            await wait(400);
            const changed = await js("document.querySelector('#editor-host .cm-content').textContent.indexOf('粗体') >= 0");
            const btnCount = await js("document.querySelectorAll('.quickbar .qb-btn').length");
            console.log('SMOKE quickbar=' + (changed ? 'ok' : 'nochange') + ' buttons=' + btnCount);

            // 撤销掉刚才插入的内容，免得把测试笔记写脏。
            // Ctrl+Z 走的是编辑器自己的 keymap，必须先把焦点还给正文，
            // 否则按键落在 window 上没人接，测试文件就被永久写脏了。
            if (changed) {
              await js("(()=>{const c=document.querySelector('#editor-host .cm-content'); if(c) c.focus();})()");
              await wait(200);
              win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Z', modifiers: ['control'] });
              win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Z', modifiers: ['control'] });
              await wait(500);
              const stillDirty = await js("document.querySelector('#editor-host .cm-content').textContent.indexOf('粗体') >= 0");
              console.log('SMOKE quickbarUndo=' + (stillDirty ? 'dirty' : 'clean'));
            }
          }
        } catch (err) {
          console.log('SMOKE quickbarFailed=' + err.message);
        }

        // 标签配色：切到标签栏再截一张，顺便确认每个标签的颜色真的不一样
        try {
          const hasTagTab = await js("!!document.querySelector('.tab[data-mode=\"tag\"]')");
          if (hasTagTab) {
            await js("document.querySelector('.tab[data-mode=\"tag\"]').click()");
            await wait(600);
            const tint = await js(`(()=>{
              const rows = [...document.querySelectorAll('.row[data-tag] .ic')].slice(0, 8);
              return rows.map(r => getComputedStyle(r).color).join('|');
            })()`);
            const parts = String(tint).split('|').filter(Boolean);
            const uniq = new Set(parts).size;
            // 同一批标签必须拿到不同颜色，否则就退化成"一片同色"
            console.log('SMOKE tagTints=' + uniq + '/' + parts.length);
            const shot2 = await saveShot('tag-colors.png');
            console.log('SMOKE tagShot=' + shot2);
            win.hide();
          }
        } catch (err) {
          console.log('SMOKE tagShotFailed=' + err.message);
        }

        // ··· 单击展开操作条（以前是双击）
        try {
          const grip = await js("!!document.querySelector('.card .grip')");
          if (!grip) {
            console.log('SMOKE grip=missing');
          } else {
            await js("document.querySelector('.card .grip').click()");
            await wait(350);
            const opened = await js("document.querySelectorAll('.swipe.open').length");
            await js("document.querySelector('.card .grip').click()");
            await wait(350);
            const closed = await js("document.querySelectorAll('.swipe.open').length");
            console.log('SMOKE grip=open' + opened + ' close' + closed);
          }
        } catch (err) {
          console.log('SMOKE gripFailed=' + err.message);
        }

        // 三套色系 × 明暗：真的点设置里的分段控件，读回左栏 / 正文的实际底色，
        // 每一套都截一张图，6 种组合逐个过眼
        try {
          const probe = async v => {
            await js(`document.querySelector('#seg-scheme span[data-v="${v}"]').click()`);
            await wait(320);
            return js(`(()=>{
              const s = getComputedStyle(document.querySelector('.col-left'));
              const m = getComputedStyle(document.querySelector('.col-mid'));
              return document.documentElement.dataset.scheme + '/' + document.documentElement.dataset.theme +
                ' side=' + s.backgroundColor + ' mid=' + m.backgroundColor;
            })()`);
          };
          await js("document.getElementById('close-settings').click()");
          await wait(250);
          for (const v of ['cream', 'graphite', 'paper']) {
            for (const t of ['light', 'dark']) {
              await js(`document.querySelector('#seg-scheme span[data-v="${v}"]').click()`);
              await js(`document.querySelector('#seg-theme span[data-v="${t}"]').click()`);
              await wait(420);
              console.log('SMOKE scheme ' + (await probe(v)));
              const s = await saveShot(`scheme-${v}-${t}.png`);
              console.log('SMOKE schemeShot=' + s);
              win.hide();
            }
          }
          // 设置面板本身也截一张，确认「色系 / 明暗」两行和圆点都渲染对了
          await js("document.querySelector('#seg-scheme span[data-v=\"cream\"]').click()");
          await js("document.querySelector('#seg-theme span[data-v=\"light\"]').click()");
          await wait(300);
          await js("document.getElementById('open-settings').click()");
          await wait(450);
          console.log('SMOKE settingsShot=' + (await saveShot('settings-appearance.png')));
          win.hide();
          await js("document.getElementById('close-settings').click()");
          await wait(200);
        } catch (err) {
          console.log('SMOKE schemeFailed=' + err.message);
        }

        /* ============================================================
           本轮新增的四项：标签多选 / 目录重命名 / 置顶标志 / 拖拽排序
           ============================================================ */

        // 先切回目录视图，后面的检查都在这个视图下做
        try {
          await js("document.querySelector('.tab[data-mode=\"folder\"]').click()");
          await wait(450);
        } catch (err) {
          console.log('SMOKE backToFolder=' + err.message);
        }

        // ① 整理弹层里的标签是多选：连着加两个，chips 应该变成 +2
        try {
          await js("document.querySelector('.card .grip').click()");
          await wait(300);
          await js("document.querySelector('.swipe.open [data-act=\"tag\"]').click()");
          await wait(450);

          const tagRes = await js(`(async () => {
            const box = document.getElementById('meta-tags-box');
            const input = document.getElementById('meta-tags');
            if (!box || !input) return 'missing';
            const before = box.querySelectorAll('.te-chip').length;

            const type = async v => {
              input.focus();
              input.value = v;
              input.dispatchEvent(new Event('input', { bubbles: true }));
              input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
              await new Promise(r => setTimeout(r, 120));
            };
            await type('测试标签A');
            await type('测试标签B');

            const after = box.querySelectorAll('.te-chip').length;
            // 两个 chip 的颜色应该不一样（走的是同一套标签配色）
            const tints = [...box.querySelectorAll('.te-chip')]
              .map(c => getComputedStyle(c).backgroundColor).join('|');
            const uniq = new Set(tints.split('|').filter(Boolean)).size;
            return before + '->' + after + ' chips=' + tints.split('|').length
              + ' uniqColor=' + uniq;
          })()`);
          console.log('SMOKE tagEditor=' + tagRes);
          const m = /^(\d+)->(\d+)/.exec(String(tagRes));
          tagOk = !!m && Number(m[2]) === Number(m[1]) + 2;

          // 截一张图给眼睛过一遍，然后取消掉（不落盘，别把测试笔记写脏）
          win.showInactive();
          await wait(500);
          console.log('SMOKE tagEditorShot=' + (await saveShot('meta-tags.png')));
          win.hide();
          await js("document.getElementById('meta-cancel').click()");
          await wait(300);
        } catch (err) {
          console.log('SMOKE tagEditorFailed=' + err.message);
        }

        // ② 左栏目录重命名：点铅笔 → 就地输入 → 回车，文件真的搬过去
        try {
          const renameRes = await js(`(async () => {
            const row = [...document.querySelectorAll('.row[data-folder]')]
              .find(e => e.dataset.folder && e.dataset.folder !== '收集箱');
            if (!row) return 'norow';
            const oldName = row.dataset.folder;

            row.querySelector('[data-edit]').click();
            await new Promise(r => setTimeout(r, 220));
            const input = row.querySelector('.row-rename');
            if (!input) return 'noinput';

            input.value = oldName + '-改';
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
            await new Promise(r => setTimeout(r, 900));

            const names = [...document.querySelectorAll('.row[data-folder]')]
              .map(e => e.dataset.folder).join(',');
            return oldName + ' -> ' + names;
          })()`);
          console.log('SMOKE rename=' + renameRes);

          // 再改回去，别把测试库的目录名留成「技术-改」
          const backRes = await js(`(async () => {
            const row = [...document.querySelectorAll('.row[data-folder]')]
              .find(e => (e.dataset.folder || '').endsWith('-改'));
            if (!row) return 'notfound';
            const oldName = row.dataset.folder;
            row.querySelector('[data-edit]').click();
            await new Promise(r => setTimeout(r, 220));
            const input = row.querySelector('.row-rename');
            if (!input) return 'noinput';
            input.value = oldName.replace(/-改$/, '');
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
            await new Promise(r => setTimeout(r, 900));
            return [...document.querySelectorAll('.row[data-folder]')]
              .map(e => e.dataset.folder).join(',');
          })()`);
          console.log('SMOKE renameBack=' + backRes);

          const rm = /^(\S+) -> (.*)$/.exec(String(renameRes));
          renameOk = !!rm && rm[2].split(',').some(x => x === rm[1] + '-改')
            && !String(backRes).includes('-改');

          // 顺手截一张「就地输入框」的样子。
          // 注意不能在截完图后 win.hide()：输入框失焦会立刻触发 blur 提交，
          // 编辑态就被收掉了（第一版就是这么把这一步搞挂的）。
          win.showInactive();
          await wait(600);
          await js(`(()=>{
            const row = [...document.querySelectorAll('.row[data-folder]')][0];
            if (row) row.querySelector('[data-edit]').click();
          })()`);
          await wait(450);
          try {
            const p = path.join(__dirname, '..', 'docs', 'left-rename.png');
            fs.mkdirSync(path.dirname(p), { recursive: true });
            fs.writeFileSync(p, (await win.webContents.capturePage()).toPNG());
            console.log('SMOKE renameShot=' + p);
          } catch (e) {
            console.log('SMOKE renameShotFailed=' + e.message);
          }
          await js(`(()=>{
            const i = document.querySelector('.row-rename');
            if (i) i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          })()`);
          await wait(350);
          win.hide();
        } catch (err) {
          console.log('SMOKE renameFailed=' + err.message);
        }

        // ③ 置顶的笔记右上角要有明显标志
        try {
          const pin = await js(`(()=>{
            const first = document.querySelector('.swipe');
            return {
              flags: document.querySelectorAll('.pin-flag').length,
              pinnedCards: document.querySelectorAll('.swipe[data-pinned="1"]').length,
              firstPinned: first ? first.dataset.pinned : '-'
            };
          })()`);
          console.log('SMOKE pinFlag=flags' + pin.flags + ' cards' + pin.pinnedCards
            + ' firstPinned=' + pin.firstPinned);
          // 有置顶笔记就必须有标志，而且置顶的排在最前
          pinOk = pin.pinnedCards > 0 && pin.flags === pin.pinnedCards && pin.firstPinned === '1';
        } catch (err) {
          console.log('SMOKE pinFlagFailed=' + err.message);
        }

        // ④ 拖拽调整顺序：把第二张卡往下拖过第三张，顺序要变；再拖回来要复原
        try {
          win.show();
          win.focus();
          await wait(400);

          const readOrder = () =>
            js("[...document.querySelectorAll('.swipe')].map(e => e.dataset.id).join(',')");

          // 拖一张卡到另一张卡的上方 / 下方。
          // 用 id 定位而不是下标 —— 拖完一次顺序就变了，下标全错位。
          const dragCard = async (fromId, toId, where) => {
            win.show();
            win.focus();
            await wait(500);

            const box = await js(`(()=>{
              const l = [...document.querySelectorAll('.swipe')];
              const a = l.find(e => e.dataset.id === ${JSON.stringify(fromId)});
              const b = l.find(e => e.dataset.id === ${JSON.stringify(toId)});
              if (!a || !b) return null;
              const ra = a.getBoundingClientRect();
              const rb = b.getBoundingClientRect();
              return { ax: Math.round(ra.left + ra.width / 2),
                       ay: Math.round(ra.top + ra.height / 2),
                       by: Math.round(${JSON.stringify(where)} === 'after' ? rb.bottom - 6 : rb.top + 6) };
            })()`);
            if (!box) return false;

            win.webContents.sendInputEvent({ type: 'mouseDown', x: box.ax, y: box.ay, button: 'left', clickCount: 1 });
            // 分几步走，让 pointermove 真的触发方向锁定
            for (let i = 1; i <= 6; i++) {
              win.webContents.sendInputEvent({
                type: 'mouseMove', x: box.ax, button: 'left',
                y: Math.round(box.ay + (box.by - box.ay) * i / 6)
              });
              await wait(70);
            }
            win.webContents.sendInputEvent({ type: 'mouseUp', x: box.ax, y: box.by, button: 'left', clickCount: 1 });
            await wait(800);
            return true;
          };

          const before = await readOrder();

          // 必须挑一对「置顶状态相同」的相邻卡：置顶的永远排在最前，
          // 把一张普通卡往上拖到置顶卡前面会被 clampToGroup 按设计挡回去 ——
          // 那不是 bug，拿它当失败信号只会误报。
          const cards = await js(
            "[...document.querySelectorAll('.swipe')].map(e => ({ id: e.dataset.id, p: e.dataset.pinned }))"
          );
          let pair = null;
          if (Array.isArray(cards)) {
            for (let k = 0; k + 1 < cards.length; k++) {
              if (cards[k].p === cards[k + 1].p) { pair = [cards[k].id, cards[k + 1].id]; break; }
            }
          }
          console.log('SMOKE orderPair=' + JSON.stringify(pair));

          let moved = before;
          if (pair) {
            for (let i = 0; i < 2 && moved === before; i++) {
              if (!(await dragCard(pair[0], pair[1], 'after'))) break;
              moved = await readOrder();
            }
          }

          if (moved !== before) {
            console.log('SMOKE orderDrag=changed');
            console.log('SMOKE order=' + before + ' -> ' + moved);

            // 拖回原位：同一张卡，目标改成「放到另一张上面」
            let back = moved;
            for (let i = 0; i < 2 && back !== before; i++) {
              if (!(await dragCard(pair[0], pair[1], 'before'))) break;
              back = await readOrder();
            }
            console.log('SMOKE orderBack=' + (back === before ? 'restored' : back));
            orderOk = before !== moved && back === before;
          } else {
            console.log('SMOKE orderDrag=unchanged');
          }
        } catch (err) {
          console.log('SMOKE orderDragFailed=' + err.message);
        }

        // 图片：点开那篇引用测试图的笔记。
        // 走的是真的 vault:// 协议 + 真的 <img> 加载，能验到「文件读得到、类型对、
        // 整行替换成功、点一下能退回源码、粘贴能落盘」这一整条链路。
        try {
          const found = await js(`(()=>{
            const c = [...document.querySelectorAll('.swipe')].find(el => {
              const h = el.querySelector('h4');
              return h && h.textContent.trim() === '图片测试';
            });
            if (!c) return false;
            c.querySelector('.card').click();
            return true;
          })()`);
          await wait(700);

          const info = await js(`(()=>{
            const im = document.querySelector('.cm-img img');
            return {
              fig: document.querySelectorAll('.cm-img').length,
              img: document.querySelectorAll('.cm-img img').length,
              size: im ? im.naturalWidth + 'x' + im.naturalHeight : '-',
              src: im ? im.getAttribute('src') : '-',
              broken: document.querySelectorAll('.cm-img.broken').length
            };
          })()`);
          console.log('SMOKE img=' + info.fig + '/' + info.img + '/' + info.size
            + ' broken=' + info.broken);
          console.log('SMOKE imgSrc=' + String(info.src).slice(0, 90));
          // 600x220 是 SVG 自带的尺寸，对得上说明像素真的解码出来了，
          // 不是只挂了一个空 <img>
          imgOk = found === true && info.img === 1 && info.size === '600x220' && info.broken === 0;

          // 放大截一张，肉眼核对圆角 / 描边 / 居中
          const figBox = await js(`(()=>{
            const f = document.querySelector('.cm-img');
            if (!f) return null;
            const r = f.getBoundingClientRect();
            return { x: Math.round(r.left) - 8, y: Math.round(r.top) - 8,
                     width: Math.round(r.width) + 16, height: Math.round(r.height) + 16 };
          })()`);
          if (figBox) console.log('SMOKE zoomImg=' + (await saveZoom('zoom-image.png', figBox, 2)));
          console.log('SMOKE imageShot=' + (await saveShot('desktop-image.png')));
          win.hide();

          // 单击图片：只选中，不能变源码（用户明确要求的）。
          // 窗口刚 hide 完再 show，焦点不一定立刻回来，点空了就重试。
          for (let attempt = 0; attempt < 3 && !imgPickOk; attempt++) {
            win.show();
            win.focus();
            await wait(500 + attempt * 400);

            const pt = await js(`(()=>{
              const f = document.querySelector('.cm-img');
              if (!f) return null;
              const r = f.getBoundingClientRect();
              return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
            })()`);
            if (!pt) break;

            win.webContents.sendInputEvent({ type: 'mouseDown', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
            win.webContents.sendInputEvent({ type: 'mouseUp', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
            await wait(500);

            const st = await js(`(()=>{
              const f = document.querySelector('.cm-img');
              return {
                figs: document.querySelectorAll('.cm-img').length,
                src: document.querySelectorAll('#editor-host .cm-imgline').length,
                sel: document.querySelectorAll('.cm-img.selected').length,
                tools: document.querySelectorAll('.cm-img .img-tools').length,
                grip: document.querySelectorAll('.cm-img .img-grip').length
              };
            })()`);
            console.log('SMOKE imgPick=' + st.figs + '/' + st.src
              + ' selected=' + st.sel + ' tools=' + st.tools + ' grip=' + st.grip
              + (attempt ? ' retry' + attempt : ''));
            // 图还在（figs=1）、没退成源码（src=0）、选中了并且工具条 + 把手都在
            imgPickOk = st.figs === 1 && st.src === 0 && st.sel === 1
              && st.tools === 1 && st.grip === 1;
          }

          // 工具条得贴住图片的右边，不能飘到整列右边去（frame 和 figure 差 130px 时最容易看出来）
          const box = await js(`(()=>{
            const f = document.querySelector('.cm-img');
            const fr = f && f.querySelector('.img-frame');
            const tb = f && f.querySelector('.img-tools');
            if (!f || !fr || !tb) return null;
            const r = el => Math.round(el.getBoundingClientRect().right);
            return {
              tools: r(tb), frame: r(fr), fig: r(f),
              // 工具条里的按钮有没有撑破工具条（上一版「编辑」被压成 1px 就是这么看出来的）
              overflow: tb.scrollWidth - tb.clientWidth
            };
          })()`);
          console.log('SMOKE imgBox=' + JSON.stringify(box));
          imgBoxOk = !!box && box.frame - box.tools >= 4 && box.frame - box.tools <= 16
            && box.overflow <= 1;

          // 选中态的截图：工具条 + 把手 + 描边，肉眼核对
          const selBox = await js(`(()=>{
            const f = document.querySelector('.cm-img .img-frame') || document.querySelector('.cm-img');
            if (!f) return null;
            const r = f.getBoundingClientRect();
            return { x: Math.round(r.left) - 12, y: Math.round(r.top) - 12,
                     width: Math.round(r.width) + 24, height: Math.round(r.height) + 24 };
          })()`);
          if (selBox) console.log('SMOKE zoomResize=' + (await saveZoom('zoom-resize.png', selBox, 2)));
          console.log('SMOKE resizeShot=' + (await saveShot('image-resize.png')));

          // 点「50%」预设：图变窄，markdown 里落下 {width=50%}
          const half = await js(`(async () => {
            const btn = [...document.querySelectorAll('.cm-img .img-tool')]
              .find(b => b.textContent === '50%');
            if (!btn) return 'nobtn';
            btn.click();
            await new Promise(r => setTimeout(r, 400));
            const f = document.querySelector('.cm-img');
            const fr = f ? f.querySelector('.img-frame') : null;
            const im = f ? f.querySelector('img') : null;
            return {
              w: im ? Math.round(im.getBoundingClientRect().width) : -1,
              box: f ? Math.round(f.getBoundingClientRect().width) : -1,
              styled: fr ? fr.style.width : '-'
            };
          })()`);
          console.log('SMOKE imgHalf=' + JSON.stringify(half));

          // 等自动保存（450ms 防抖）落盘，读回来验 markdown 里真的写了 50%
          const readNote = () => {
            try { return (vault.read(vaultRoot(), SMOKE_NOTE) || {}).raw || ''; }
            catch { return ''; }
          };
          await wait(900);
          const mdHalf = readNote().indexOf('{width=50%}') >= 0;

          // 拖右下角把手加宽 100px：验证拖拽换算 + 松手才写文档
          const drag = await js(`(async () => {
            const g = document.querySelector('.cm-img .img-grip');
            const im = document.querySelector('.cm-img img');
            if (!g || !im) return 'nohandle';
            const before = Math.round(im.getBoundingClientRect().width);
            const r = g.getBoundingClientRect();
            const x = Math.round(r.left + r.width / 2);
            const y = Math.round(r.top + r.height / 2);
            const opt = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 };
            g.dispatchEvent(new MouseEvent('mousedown', opt));
            window.dispatchEvent(new MouseEvent('mousemove',
              { bubbles: true, clientX: x + 100, clientY: y }));
            window.dispatchEvent(new MouseEvent('mouseup',
              { bubbles: true, clientX: x + 100, clientY: y }));
            await new Promise(r2 => setTimeout(r2, 400));
            const im2 = document.querySelector('.cm-img img');
            const fr2 = document.querySelector('.cm-img .img-frame');
            return {
              before,
              after: im2 ? Math.round(im2.getBoundingClientRect().width) : -1,
              styled: fr2 ? fr2.style.width : '-'
            };
          })()`);
          console.log('SMOKE imgDrag=' + JSON.stringify(drag));

          await wait(900);
          const mdDrag = /\{width=\d+\}/.test(readNote());

          // 缩到 25%：图比工具条还窄，工具条要居中溢出，不能整条甩到左边
          const narrow = await js(`(async () => {
            const b = [...document.querySelectorAll('.cm-img .img-tool')]
              .find(x => x.textContent === '25%');
            if (!b) return 'nobtn';
            b.click();
            await new Promise(r => setTimeout(r, 500));
            const f = document.querySelector('.cm-img .img-frame');
            const tb = document.querySelector('.cm-img .img-tools');
            if (!f || !tb) return 'noframe';
            const fr = f.getBoundingClientRect();
            const tr = tb.getBoundingClientRect();
            return {
              fw: Math.round(fr.width),
              tw: Math.round(tr.width),
              over: Math.round(fr.left - tr.left)
            };
          })()`);
          console.log('SMOKE imgNarrow=' + JSON.stringify(narrow));
          const narrowOk = typeof narrow === 'object'
            && narrow.tw > narrow.fw
            && Math.abs(narrow.over - (narrow.tw - narrow.fw) / 2) <= 8;

          const halfOk = typeof half === 'object' && half.w > 0 && half.w < half.box * 0.75;
          const dragOk = typeof drag === 'object'
            && drag.after > drag.before + 60 && /^\d+px$/.test(String(drag.styled));
          console.log('SMOKE imgResize=' + JSON.stringify({
            half: halfOk, drag: dragOk, mdHalf, mdDrag, narrow: narrowOk
          }));
          imgResizeOk = halfOk && dragOk && mdHalf && mdDrag && narrowOk;

          // 双击图片：光标进到这一行，退回源码好改路径
          const dbl = await js(`(()=>{
            const im = document.querySelector('.cm-img img');
            if (!im) return 'noimg';
            im.dispatchEvent(new MouseEvent('dblclick',
              { bubbles: true, cancelable: true, button: 0 }));
            return 'sent';
          })()`);
          await wait(500);

          const after = await js("document.querySelectorAll('.cm-img').length + '/' +"
            + " document.querySelectorAll('#editor-host .cm-imgline').length");
          console.log('SMOKE imgEdit=' + after + ' dbl=' + dbl);
          // 光标在图片那行时应变成 0/1（源码态）
          imgEditOk = String(after) === '0/1';

          // 粘贴图片：合成一个带图片文件的 paste 事件，走完整的「落盘 + 插入」链路。
          // 这是没法用真鼠标点的部分（系统文件选择框脚本点不了），只能这么验。
          const pasted = await js(`(async () => {
            const host = document.querySelector('#editor-host .cm-content');
            if (!host) return 'noeditor';
            host.focus();
            const bin = atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==');
            const buf = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
            const dt = new DataTransfer();
            dt.items.add(new File([buf], 'smoke-paste.png', { type: 'image/png' }));
            host.dispatchEvent(new ClipboardEvent('paste',
              { clipboardData: dt, bubbles: true, cancelable: true }));
            await new Promise(r => setTimeout(r, 1400));
            const imgs = [...document.querySelectorAll('.cm-img img')];
            const src = imgs.length ? imgs[imgs.length - 1].getAttribute('src') : '';
            const m = /_assets\\/[A-Za-z0-9._-]+/.exec(src || '');
            return imgs.length + '|' + (m ? m[0] : 'none');
          })()`);
          console.log('SMOKE imgPaste=' + pasted);

          const [cnt, pastedRel] = String(pasted).split('|');
          if (pastedRel && pastedRel !== 'none') {
            // 确认 base64 真的变成了磁盘上的文件，而不只是内存里插了一行字
            const file = vault.safeJoin(vaultRoot(), pastedRel);
            const size = fs.existsSync(file) ? fs.statSync(file).size : -1;
            console.log('SMOKE imgPasteFile=' + pastedRel + ' size=' + size);
            imgPasteOk = Number(cnt) === 2 && size > 0;
            try { fs.unlinkSync(file); } catch { /* 清不掉就算了 */ }
          }
        } catch (err) {
          console.log('SMOKE imgFailed=' + err.message);
        }

        /* ============================================================
           本轮新增：代码块高亮 / 笔记链接 / 待办解决方式 / 卡片路径 /
                     左栏排序 / 空目录清理 / 标题同步文件名
           ============================================================ */

        let codeOk = false;
        let linkOk = false;
        let cardPathOk = false;
        let leftOrderOk = false;
        let pruneOk = false;
        let titleRenameOk = false;

        // 按标题找卡片：不能用 textContent 模糊匹配，
        // 「链接与待办」正文里也有「图片测试」，会抢在前面被选中
        const openNote = name => js(`(()=>{
          const c = [...document.querySelectorAll('.swipe')].find(el => {
            const h = el.querySelector('h4');
            return h && h.textContent.trim() === ${JSON.stringify(name)};
          });
          if (!c) return false;
          c.querySelector('.card').click();
          return true;
        })()`);

        // 真鼠标点一下（先确保窗口有焦点，否则第一下经常点空）
        const clickAt = async pt => {
          if (!pt) return false;
          win.show();
          win.focus();
          await wait(450);
          win.webContents.sendInputEvent({ type: 'mouseDown', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
          win.webContents.sendInputEvent({ type: 'mouseUp', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
          await wait(500);
          return true;
        };

        // 真鼠标双击：第二下要带 clickCount: 2，浏览器才会派发 dblclick
        const dblAt = async pt => {
          if (!pt) return false;
          win.show();
          win.focus();
          await wait(450);
          const { x, y } = pt;
          for (const count of [1, 2]) {
            win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: count });
            win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: count });
          }
          await wait(500);
          return true;
        };

        // ① 代码块：整块渲染 + 语法高亮 + 代码里的表格不能被认成表格
        try {
          await js("document.querySelector('.row[data-clear]').click()");
          await wait(350);
          await openNote('代码块测试');
          await wait(800);

          const cb = await js(`(()=>{
            const q = s => document.querySelectorAll(s).length;
            return {
              blocks: q('.cm-codeblock'),
              lang: (document.querySelector('.cm-codeblock .cb-lang') || {}).textContent || '',
              kw: q('.cm-codeblock .hl-kw'),
              str: q('.cm-codeblock .hl-str'),
              com: q('.cm-codeblock .hl-com'),
              fn: q('.cm-codeblock .hl-fn'),
              tables: q('.cm-table'),
              fences: q('#editor-host .cm-fence'),
              copy: q('.cb-copy')
            };
          })()`);
          console.log('SMOKE code=' + JSON.stringify(cb));
          codeOk = cb.blocks === 2 && cb.lang === 'ts' && cb.kw > 0 && cb.str > 0
            && cb.com > 0 && cb.fn > 0 && cb.tables === 0 && cb.fences === 0 && cb.copy === 2;

          win.showInactive();
          await wait(600);
          console.log('SMOKE codeShot=' + (await saveShot('code-block.png')));
          win.hide();

          // 单击代码块 → 什么都不该发生（以前一碰就散成源码，滚一下都得小心翼翼）
          const pt = await js(`(()=>{
            const w = document.querySelector('.cm-codeblock');
            if (!w) return null;
            const r = w.getBoundingClientRect();
            return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height - 10) };
          })()`);
          await clickAt(pt);
          const clickState = await js("document.querySelectorAll('.cm-codeblock').length + '/' +"
            + " document.querySelectorAll('#editor-host .cm-fence').length");
          console.log('SMOKE codeClick=' + clickState);

          // 双击才退回源码
          await wait(300);
          await dblAt(pt);
          const srcState = await js("document.querySelectorAll('.cm-codeblock').length + '/' +"
            + " document.querySelectorAll('#editor-host .cm-fence').length");
          console.log('SMOKE codeEdit=' + srcState);
          // 单击后原样（两个块、没有围栏）；双击后少一个块、围栏行出现两行
          codeOk = codeOk && clickState === '2/0' && String(srcState) === '1/2';
        } catch (err) {
          console.log('SMOKE codeFailed=' + err.message);
        }

        // ② 笔记链接 + 待办解决方式
        try {
          await openNote('链接与待办');
          await wait(800);

          const li = await js(`(()=>{
            const q = s => document.querySelectorAll(s).length;
            return {
              wiki: q('.cm-wikilink'),
              note: q('.cm-todo-note'),
              noteText: (document.querySelector('.cm-todo-note') || {}).textContent || '',
              add: q('.cm-todonote-add')
            };
          })()`);
          console.log('SMOKE link=' + JSON.stringify(li));

          // 截图：待办的「→ 解决方式」和行尾的「＋」
          win.showInactive();
          await wait(600);
          console.log('SMOKE linkShot=' + (await saveShot('note-links.png')));
          win.hide();

          // 真点一下 `[[图片测试]]`，应该跳到那篇
          const lp = await js(`(()=>{
            const a = document.querySelector('.cm-wikilink');
            if (!a) return null;
            const r = a.getBoundingClientRect();
            return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
          })()`);
          await clickAt(lp);
          const activeTitle = await js("(document.querySelector('.card.active h4') || {}).textContent || ''");
          console.log('SMOKE linkJump=' + JSON.stringify(activeTitle));

          linkOk = li.wiki === 2 && li.note === 1 && li.add === 1
            && String(li.noteText).indexOf('换成新方案') >= 0
            && String(activeTitle).trim() === '图片测试';
        } catch (err) {
          console.log('SMOKE linkFailed=' + err.message);
        }

        // ③ 卡片上的目录路径：全部笔记里是完整路径，进到某一级目录后只显示剩下的层级
        try {
          // 按标题精确匹配：正文里提到「图片测试」的笔记不能算进来
          const pathOf = t => js(`(()=>{
            const c = [...document.querySelectorAll('.card')]
              .find(x => ((x.querySelector('h4') || {}).textContent || '').trim() === ${JSON.stringify(t)});
            if (!c) return 'noc';
            const p = c.querySelector('.card-path');
            return p ? p.textContent.trim() : '';
          })()`);

          const clickFolder = f => js(`(()=>{
            const r = [...document.querySelectorAll('.row[data-folder]')]
              .find(e => e.dataset.folder === ${JSON.stringify(f)});
            if (!r) return false;
            r.click();
            return true;
          })()`);

          await js("document.querySelector('.row[data-clear]').click()");
          await wait(400);
          const lv0 = await pathOf('深层测试');

          await clickFolder('技术');
          await wait(450);
          const lv1 = await pathOf('深层测试');

          await clickFolder('技术/子目录');
          await wait(450);
          const lv2 = await pathOf('深层测试');
          const deepCards = await js("document.querySelectorAll('.card').length");

          console.log('SMOKE cardPath all=' + JSON.stringify(lv0)
            + ' lv1=' + JSON.stringify(lv1) + ' lv2=' + JSON.stringify(lv2)
            + ' deepCards=' + deepCards);
          // 全部笔记 → 完整路径；一级目录 → 只剩二级；二级目录 → 没有三级，整行不显示
          cardPathOk = lv0 === '技术 / 子目录' && lv1 === '子目录' && lv2 === '' && deepCards === 1;

          await js("document.querySelector('.row[data-clear]').click()");
          await wait(300);
        } catch (err) {
          console.log('SMOKE cardPathFailed=' + err.message);
        }

        // ④ 左栏目录拖拽排序：把第二个顶层目录拖到第一个上面
        try {
          const box = await js(`(()=>{
            const rs = [...document.querySelectorAll('.row[data-folder]')].filter(r => r.dataset.depth === '0');
            if (rs.length < 2) return null;
            const a = rs[1].getBoundingClientRect(), b = rs[0].getBoundingClientRect();
            return { ax: Math.round(a.left + 60), ay: Math.round(a.top + a.height / 2),
                     by: Math.round(b.top + 3),
                     first: rs[0].dataset.folder, second: rs[1].dataset.folder };
          })()`);

          if (box) {
            win.show();
            win.focus();
            await wait(450);
            win.webContents.sendInputEvent({ type: 'mouseDown', x: box.ax, y: box.ay, button: 'left', clickCount: 1 });
            for (let i = 1; i <= 5; i++) {
              win.webContents.sendInputEvent({
                type: 'mouseMove', x: box.ax, button: 'left',
                y: Math.round(box.ay + (box.by - box.ay) * i / 5)
              });
              await wait(80);
            }
            win.webContents.sendInputEvent({ type: 'mouseUp', x: box.ax, y: box.by, button: 'left', clickCount: 1 });
            await wait(700);

            const after = await js("[...document.querySelectorAll('.row[data-folder]')]"
              + ".filter(r => r.dataset.depth === '0').map(r => r.dataset.folder).join(',')");
            let saved = [];
            try {
              saved = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')).folderOrder || [];
            } catch { /* 没落盘 */ }

            console.log('SMOKE leftOrder=' + box.first + ',' + box.second
              + ' -> ' + after + ' saved=' + JSON.stringify(saved.slice(0, 3)));
            // 渲染顺序变了，而且顺序真的写进了设置
            leftOrderOk = String(after).startsWith(box.second) && saved[0] === box.second;
          } else {
            console.log('SMOKE leftOrder=notenough');
          }
        } catch (err) {
          console.log('SMOKE leftOrderFailed=' + err.message);
        }

        // ⑤ 目录改名后旧目录要真的消失（以前只在磁盘上留个空壳）
        try {
          // 必须挑一个磁盘上真的存在的目录：库根上的笔记 folder 会退化成「收集箱」，
          // 那个名字在磁盘上可能根本没有对应目录，拿它测等于测了个空
          const pick = await js(`(()=>{
            const rs = [...document.querySelectorAll('.row[data-folder]')].filter(e => e.dataset.depth === '0');
            return rs.map(e => e.dataset.folder);
          })()`);
          const real = (Array.isArray(pick) ? pick : [])
            .find(f => fs.existsSync(vault.safeJoin(vaultRoot(), f)));
          console.log('SMOKE prunePick=' + JSON.stringify(real || null));

          const renamed = real ? await js(`(async () => {
            const row = [...document.querySelectorAll('.row[data-folder]')]
              .find(e => e.dataset.folder === ${JSON.stringify(real || '')});
            if (!row) return 'norow';
            const oldName = row.dataset.folder;
            row.querySelector('[data-edit]').click();
            await new Promise(r => setTimeout(r, 240));
            const input = row.querySelector('.row-rename');
            if (!input) return 'noinput';
            input.value = oldName + 'TMP';
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
            await new Promise(r => setTimeout(r, 1200));
            return oldName;
          })()`) : '';

          if (renamed && renamed !== 'norow' && renamed !== 'noinput') {
            const oldDir = vault.safeJoin(vaultRoot(), renamed);
            const newDir = vault.safeJoin(vaultRoot(), renamed + 'TMP');
            const oldGone = !fs.existsSync(oldDir);
            const newThere = fs.existsSync(newDir);
            console.log('SMOKE prune oldGone=' + oldGone + ' newThere=' + newThere);
            pruneOk = oldGone && newThere;

            // 改回去，别把测试库的目录名留成 xxxTMP
            await js(`(async () => {
              const row = [...document.querySelectorAll('.row[data-folder]')]
                .find(e => (e.dataset.folder || '').endsWith('TMP'));
              if (!row) return;
              row.querySelector('[data-edit]').click();
              await new Promise(r => setTimeout(r, 240));
              const input = row.querySelector('.row-rename');
              if (!input) return;
              input.value = input.value.replace(/TMP$/, '');
              input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
              await new Promise(r => setTimeout(r, 1200));
            })()`);
          }
        } catch (err) {
          console.log('SMOKE pruneFailed=' + err.message);
        }

        // ⑥ 改标题 → 文件名跟着改（真的落到磁盘上）
        try {
          await js("document.querySelector('.row[data-clear]').click()");
          await wait(300);
          await openNote('代码块测试');
          await wait(700);

          // 点到 H1 文字中间（点行尾容易落在行框右侧空白上，光标不一定进去）
          const hp = await js(`(()=>{
            const l = document.querySelector('#editor-host .cm-line.cm-h1')
              || document.querySelector('#editor-host .cm-line');
            if (!l) return null;
            const r = l.getBoundingClientRect();
            return { x: Math.round(r.left + 24), y: Math.round(r.top + r.height / 2) };
          })()`);
          await clickAt(hp);

          // execCommand 走的是真实的 contenteditable 输入，CodeMirror 的 DOMObserver 会收下
          const typed = await js(`(()=>{
            const host = document.querySelector('#editor-host .cm-content');
            if (!host) return 'nohost';
            host.focus();
            let ok = false;
            try { ok = document.execCommand('insertText', false, 'Z'); } catch { ok = false; }
            return ok ? 'ok' : 'fail';
          })()`);
          // 防抖 1400ms，多等一会儿
          await wait(2400);

          const r2 = vaultRoot();
          // 点的是 H1 文字中间，插入位置不一定是行尾（可能变成「代Z码块测试」），
          // 所以不猜位置，直接拿卡片标题去对文件名
          const list2 = vault.list(r2).map(f => f.relPath);
          const t2 = String(await js("(document.querySelector('.card.active h4') || {}).textContent || ''")).trim();
          const hasZ = list2.includes(t2 + '.md');
          const oldGone = !list2.includes('代码块测试.md');
          console.log('SMOKE titleRename title=' + JSON.stringify(t2) + ' hasZ=' + hasZ
            + ' oldGone=' + oldGone);
          titleRenameOk = t2.includes('Z') && hasZ && oldGone;
        } catch (err) {
          console.log('SMOKE titleRenameFailed=' + err.message);
        }

        // ⑦ 隐藏：右键菜单藏一篇 → 列表少一条 → 「已隐藏」里能看到 → 取消隐藏回来
        try {
          await js("document.querySelector('.row[data-clear]').click()");
          await wait(700);

          const hideBefore = await js("document.querySelectorAll('.swipe').length");
          const hideTitle = await js(
            "((document.querySelector('.swipe .card h4') || {}).textContent || '').trim()"
          );

          await js(`(() => {
            const c = document.querySelector('.swipe .card');
            if (c) c.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
          })()`);
          await wait(400);
          const hasRow = await js(
            `!!document.querySelector('#mini-acts .mini-row[data-a="hide"]')`
          );
          await js(`document.querySelector('#mini-acts .mini-row[data-a="hide"]').click()`);
          await wait(900);

          const hideAfter = await js("document.querySelectorAll('.swipe').length");
          const hiddenCnt = await js(
            `(document.querySelector('.row[data-view="hidden"] .cnt') || {}).textContent`
          );

          // 进「已隐藏」确认还在，再点取消隐藏
          await js(`document.querySelector('.row[data-view="hidden"]').click()`);
          await wait(800);
          const inHidden = await js("document.querySelectorAll('.swipe').length");
          const inHiddenTitle = await js(
            "((document.querySelector('.swipe .card h4') || {}).textContent || '').trim()"
          );

          await js(`document.querySelector('.swipe .act[data-act="unhide"]').click()`);
          await wait(900);
          const hiddenAfter = await js(
            `(document.querySelector('.row[data-view="hidden"] .cnt') || {}).textContent`
          );

          console.log('SMOKE hide=' + JSON.stringify({
            hasRow, hideBefore, hideAfter, hiddenCnt, inHidden, inHiddenTitle, hiddenAfter
          }));
          hideOk = hasRow
            && hideAfter === hideBefore - 1
            && Number(hiddenCnt) >= 1
            && inHidden >= 1 && inHiddenTitle === hideTitle
            && Number(hiddenAfter) === 0;
        } catch (err) {
          console.log('SMOKE hideFailed=' + err.message);
        }

        // ⑧ 左上角名字可改：改完品牌区和窗口标题一起变
        try {
          await js("document.querySelector('.row[data-clear]').click()");
          await wait(500);
          await js("document.getElementById('open-settings').click()");
          await wait(500);

          await js(`(() => {
            const i = document.getElementById('inp-appname');
            i.value = '我的笔记';
            i.dispatchEvent(new Event('input', { bubbles: true }));
          })()`);
          await wait(400);

          const brand = await js("document.getElementById('brand-name').textContent");
          const docTitle = await js("document.title");
          console.log('SMOKE appName brand=' + JSON.stringify(brand) + ' docTitle=' + JSON.stringify(docTitle));
          appNameOk = brand === '我的笔记' && docTitle === '我的笔记';

          // 折叠后浮出的 rail 按钮必须从窗口拖动区里挖出来（no-drag）。
          // 折叠状态下 .brand（0-238 × 0-58）和 .mh-top 的矩形还在，它们挂着
          // -webkit-app-region:drag；而拖动区是「窗口级命中区域」，不认 z-index，
          // rail 少了 no-drag 的话真实鼠标根本点不进去 —— 更坑的是 CDP 注入的
          // 鼠标事件会绕过命中测试，所以只有断言 computed style 才测得出来。
          const railRegion = await js("getComputedStyle(document.querySelector('.rail')).webkitAppRegion");
          const railCover = await js(`(() => {
            const rail = document.querySelector('.rail');
            const r = rail.getBoundingClientRect();
            return [...document.querySelectorAll('*')]
              .filter(el => {
                if (rail.contains(el)) return false;
                if (getComputedStyle(el).webkitAppRegion !== 'drag') return false;
                const b = el.getBoundingClientRect();
                return b.left < r.right && b.right > r.left && b.top < r.bottom && b.bottom > r.top;
              })
              .map(el => el.className || el.tagName).join(',');
          })()`);
          console.log('SMOKE railRegion=' + railRegion + ' coveredBy=' + JSON.stringify(railCover));
          railOk = railRegion === 'no-drag';

          // 改回默认，后面截图别带着测试名字
          await js(`(() => {
            const i = document.getElementById('inp-appname');
            i.value = '笔记';
            i.dispatchEvent(new Event('input', { bubbles: true }));
          })()`);
          await wait(400);
          await js("document.getElementById('close-settings').click()");
          await wait(400);
        } catch (err) {
          console.log('SMOKE appNameFailed=' + err.message);
        }

        // ⑨ 卡片预览里的图必须独占一行：display 是 block、宽度接近卡片、且在摘要下面
        try {
          const box = await js(`(() => {
            const img = document.querySelector('.card-thumb');
            if (!img) return null;
            const card = img.closest('.card');
            const p = img.closest('.card-body').querySelector('p');
            if (!card) return null;
            const r = img.getBoundingClientRect();
            const cr = card.getBoundingClientRect();
            const pr = p ? p.getBoundingClientRect() : null;
            return {
              disp: getComputedStyle(img).display,
              w: Math.round(r.width),
              cardW: Math.round(cr.width),
              below: pr ? Math.round(r.top - pr.bottom) : -1
            };
          })()`);
          console.log('SMOKE thumbRow=' + JSON.stringify(box));
          // 图要在摘要下面单独一行、高度固定。
          // 宽度不再要求撑满卡片：现在宽度跟着图片比例走，方形图本来就窄。
          thumbRowOk = !!box && box.disp === 'block' && box.below >= 0;

          // 每张卡片的缩略图必须一样高，不能因为原图长宽比不同就高矮不齐。
          // 单图按自己的比例（contain），多图均分一行（cover），所以分开检查。
          const all = await js(`(() => {
            return [...document.querySelectorAll('.card-figs')].map(f => {
              const mode = f.classList.contains('multi') ? 'multi' : 'solo';
              const imgs = [...f.querySelectorAll('img.card-thumb')]
                .filter(i => i.style.display !== 'none');
              return {
                mode,
                total: f.querySelectorAll('img.card-thumb').length,
                imgs: imgs.map(i => {
                  const r = i.getBoundingClientRect();
                  return {
                    w: Math.round(r.width),
                    h: Math.round(r.height),
                    fit: getComputedStyle(i).objectFit,
                    natural: i.naturalWidth + 'x' + i.naturalHeight
                  };
                })
              };
            });
          })()`);
          console.log('SMOKE thumbSizes=' + JSON.stringify(all));

          const flat = Array.isArray(all) ? all.flatMap(f => f.imgs) : [];
          const hs = flat.map(x => x.h);
          const sameH = hs.length > 0 && hs.every(h => h === 96);
          // 单图不许裁；多图必须裁成同一块，且同一张卡片里的宽度一致
          const fitOk = Array.isArray(all) && all.every(f =>
            f.mode === 'solo'
              ? f.imgs.length === 1 && f.imgs[0].fit === 'contain'
              : f.imgs.length >= 2 && f.imgs.every(i => i.fit === 'cover')
                && f.imgs.every(i => i.w === f.imgs[0].w));
          console.log('SMOKE thumbUniform sameH=' + sameH + ' h=' + JSON.stringify([...new Set(hs)])
            + ' fitOk=' + fitOk
            + ' modes=' + (Array.isArray(all) ? all.map(f => f.mode + ':' + f.imgs.length).join(',') : '-'));
          thumbRowOk = thumbRowOk && sameH && fitOk;

          // 多图卡片：一排里能放几张就露几张（最多 3 张），且不能溢出卡片
          const figs = await js(`(() => {
            return [...document.querySelectorAll('.card-figs')].map(f => {
              const fr = f.getBoundingClientRect();
              const imgs = [...f.querySelectorAll('img.card-thumb')];
              const shown = imgs.filter(i => i.style.display !== 'none');
              const more = f.querySelector('.fig-more');
              const over = shown.some(i => i.getBoundingClientRect().right > fr.right + 1);
              const gap = shown.length > 1
                ? Math.round(shown[1].getBoundingClientRect().left - shown[0].getBoundingClientRect().right)
                : -1;
              return {
                total: imgs.length,
                shown: shown.length,
                more: more && more.style.display !== 'none' ? more.textContent : '',
                over,
                gap
              };
            });
          })()`);
          console.log('SMOKE figs=' + JSON.stringify(figs));
          const multi = Array.isArray(figs) ? figs.filter(f => f.total >= 2) : [];
          figsOk = multi.length > 0
            // 两张以上的卡片都要真的并排显示出来，不能只剩一张
            && multi.every(f => f.shown >= 2)
            // 最多露 3 张，多出来的必须标 +N（总张数减 3）
            && multi.every(f => f.shown === Math.min(f.total, 3)
              && (f.total > 3 ? f.more === '+' + (f.total - 3) : f.more === ''))
            // 图之间要留出 6px 的间距（取整可能差 1px），且都不许溢出卡片
            && multi.every(f => f.gap >= 5 && f.gap <= 7 && !f.over)
            && (Array.isArray(figs) && figs.every(f => !f.over));

          // 顺手拍一张「三张图并排」的卡片，方便肉眼确认
          await js("document.querySelector('.row[data-clear]').click()");
          await wait(350);
          const scrolled = await js(`(() => {
            // 优先拍演示库里那篇（四张「照片」，看着像正常笔记）；
            // 跑真实库的时候没有它，退回夹具卡片，断言不依赖这张图
            const heads = [...document.querySelectorAll('.card h4')];
            const h = heads.find(e => (e.textContent || '').includes('旅行计划'))
              || heads.find(e => (e.textContent || '').includes('多图测试'));
            if (!h) return false;
            h.closest('.card').scrollIntoView({ block: 'center' });
            return true;
          })()`);
          if (scrolled) {
            console.log('SMOKE multiShot=' + (await saveShot('card-multi.png')));
            win.hide();
          }
        } catch (err) {
          console.log('SMOKE thumbRowFailed=' + err.message);
        }

        // ⑩ 密码锁定：设密码 → 立即锁定 → 错密码被挡 → 对密码放行
        try {
          await js("document.getElementById('open-settings').click()");
          await wait(500);
          await js("document.getElementById('btn-setpw').click()");
          await wait(500);

          await js(`(() => {
            document.getElementById('pw1').value = 'smoke1234';
            document.getElementById('pw2').value = 'smoke1234';
            document.getElementById('pw-ok').click();
          })()`);
          await wait(900);

          const enabled = await js("document.getElementById('sw-lock').classList.contains('on')");

          await js("document.getElementById('btn-locknow').click()");
          await wait(600);
          const shown = await js(
            "!!document.querySelector('#lock-screen.show')"
          );
          await saveShot('lock-screen.png');

          // 错密码：要留住锁屏，并且给出提示
          await js(`(() => {
            const i = document.getElementById('lock-input');
            i.value = 'nope';
            document.getElementById('lock-go').click();
          })()`);
          await wait(700);
          const errText = await js("(document.getElementById('lock-err') || {}).textContent || ''");
          const stillLocked = await js("!!document.querySelector('#lock-screen.show')");

          // 对密码：放行
          await js(`(() => {
            const i = document.getElementById('lock-input');
            i.value = 'smoke1234';
            document.getElementById('lock-go').click();
          })()`);
          await wait(900);
          const unlocked = await js("!document.querySelector('#lock-screen.show')");

          console.log('SMOKE lock=' + JSON.stringify({
            enabled, shown, stillLocked, errText, unlocked
          }));
          lockOk = enabled && shown && stillLocked
            && /不对/.test(String(errText)) && unlocked;

          // 关掉锁定，别让下一轮一启动就卡在锁屏上
          await js("document.getElementById('open-settings').click()");
          await wait(400);
          await js("document.getElementById('sw-lock').click()");
          await wait(400);
          await js("document.getElementById('close-settings').click()");
          await wait(400);
        } catch (err) {
          console.log('SMOKE lockFailed=' + err.message);
        }

        // 收尾：把测试用的图和笔记清掉，别在用户库里留垃圾
        clearSmokeFixtures();
        const ok = cards > 0 && lines > 0 && bridge === 'object' && errs.length === 0
          && blankOk && imgOk && imgPickOk && imgBoxOk && imgResizeOk && imgEditOk && imgPasteOk
          && tagOk && renameOk && pinOk && orderOk && previewOk
          && codeOk && linkOk && cardPathOk && leftOrderOk && pruneOk && titleRenameOk
          && hideOk && lockOk && appNameOk && thumbRowOk && figsOk && placeholderOk
          && railOk;
        console.log('SMOKE verdict=' + JSON.stringify({
          blankOk, imgOk, imgPickOk, imgBoxOk, imgResizeOk, imgEditOk, imgPasteOk,
          tagOk, renameOk, pinOk, orderOk, previewOk,
          codeOk, linkOk, cardPathOk, leftOrderOk, pruneOk, titleRenameOk,
          hideOk, lockOk, appNameOk, thumbRowOk, figsOk, placeholderOk, railOk
        }));
        app.exit(ok ? 0 : 1);
      } catch (err) {
        console.log('SMOKE_ERROR', err.message);
        app.exit(1);
      }
    }, 2000);
  });
}

/* ============================================================
   启动
   ============================================================ */

if (!app.requestSingleInstanceLock()) {
  // 单实例锁是有意义的：两个进程同时写同一个 .md 文件会互相覆盖。
  // 但「双击新版没反应、反而跳出旧窗口」太容易让人以为打包没生效，
  // 所以这里明说一句。
  if (!SMOKE) {
    dialog.showErrorBox(
      '笔记已经在运行',
      '检测到一个正在运行的「笔记」窗口，这次启动已取消。\n\n' +
      '如果那个窗口是旧版本（界面还有系统标题栏），请先退出它：\n' +
      '右键任务栏右下角的托盘图标 → 退出，然后再双击新的 Notes.exe。\n\n' +
      '注意：新版可能在另一个文件夹里，两边不能同时打开。'
    );
  }
  app.quit();
} else {
  app.on('second-instance', showWindow);

  app.whenReady().then(() => {
    prepareSmokeFixtures();
    registerProtocol();
    registerIpc();
    createWindow();
    if (!SMOKE) createTray();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
      else showWindow();
    });
  });

  app.on('before-quit', () => { quitting = true; });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
