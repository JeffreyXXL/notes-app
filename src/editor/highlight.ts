/**
 * 一个够用的代码高亮器。
 *
 * 为什么不引 prism / shiki：
 *   - shiki 要带一堆语法文件，打包体积翻几倍；
 *   - prism 的 CSS 主题得按 6 套配色改一遍，还得跟着明暗切换重算。
 * 这里只做「词法着色」：注释、字符串、数字、关键字、类型、函数名、标点，
 * 颜色全部走 CSS 变量，明暗和色系切换零成本。
 */

import { esc } from '../core/text';

interface Spec {
  /** 关键字 */
  kw: string[];
  /** 类型 / 内置名，颜色和关键字区分开 */
  types?: string[];
  /** 行注释前缀 */
  line: string[];
  /** 块注释的起止 */
  block?: [string, string];
  /** 字符串引号 */
  str?: string[];
  /** 三引号（python 的 docstring） */
  triple?: string[];
  /** html 这类：`<div` 里的 div 当关键字上色 */
  tag?: boolean;
}

const JS_KW = ['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do',
  'break', 'continue', 'switch', 'case', 'default', 'new', 'class', 'extends', 'super', 'this',
  'import', 'export', 'from', 'as', 'await', 'async', 'try', 'catch', 'finally', 'throw',
  'typeof', 'instanceof', 'in', 'of', 'delete', 'void', 'yield', 'static', 'get', 'set'];

const JS_TYPES = ['true', 'false', 'null', 'undefined', 'NaN', 'Infinity',
  'string', 'number', 'boolean', 'any', 'unknown', 'never', 'object', 'symbol', 'bigint',
  'interface', 'type', 'enum', 'implements', 'readonly', 'public', 'private', 'protected',
  'declare', 'namespace', 'Array', 'Object', 'String', 'Number', 'Boolean', 'Promise',
  'Map', 'Set', 'Date', 'JSON', 'Math', 'console', 'window', 'document'];

const PY_KW = ['def', 'class', 'return', 'if', 'elif', 'else', 'for', 'while', 'break', 'continue',
  'import', 'from', 'as', 'with', 'try', 'except', 'finally', 'raise', 'lambda', 'yield',
  'global', 'nonlocal', 'assert', 'del', 'pass', 'async', 'await', 'in', 'is', 'not', 'and', 'or'];

const PY_TYPES = ['True', 'False', 'None', 'self', 'cls', 'int', 'float', 'str', 'bool', 'list',
  'dict', 'set', 'tuple', 'bytes', 'len', 'range', 'print', 'open', 'enumerate', 'zip', 'super'];

const GO_KW = ['package', 'import', 'func', 'return', 'if', 'else', 'for', 'range', 'switch',
  'case', 'default', 'break', 'continue', 'go', 'defer', 'select', 'chan', 'var', 'const',
  'type', 'struct', 'interface', 'map', 'make', 'new', 'fallthrough', 'goto'];

const GO_TYPES = ['true', 'false', 'nil', 'string', 'int', 'int64', 'int32', 'float64', 'float32',
  'bool', 'byte', 'rune', 'error', 'uint', 'any', 'append', 'cap', 'close', 'copy', 'delete',
  'len', 'panic', 'recover'];

const RUST_KW = ['fn', 'let', 'mut', 'const', 'static', 'struct', 'enum', 'impl', 'trait', 'for',
  'while', 'loop', 'if', 'else', 'match', 'return', 'break', 'continue', 'use', 'mod', 'pub',
  'crate', 'super', 'self', 'as', 'where', 'move', 'async', 'await', 'dyn', 'ref', 'unsafe'];

const RUST_TYPES = ['true', 'false', 'None', 'Some', 'Ok', 'Err', 'String', 'str', 'Vec', 'Option',
  'Result', 'Box', 'Rc', 'Arc', 'i8', 'i16', 'i32', 'i64', 'u8', 'u16', 'u32', 'u64', 'f32',
  'f64', 'usize', 'isize', 'bool', 'char', 'HashMap'];

const JAVA_KW = ['public', 'private', 'protected', 'class', 'interface', 'enum', 'extends',
  'implements', 'new', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default',
  'break', 'continue', 'try', 'catch', 'finally', 'throw', 'throws', 'import', 'package',
  'static', 'final', 'void', 'abstract', 'synchronized', 'instanceof', 'this', 'super'];

const JAVA_TYPES = ['true', 'false', 'null', 'int', 'long', 'short', 'byte', 'char', 'float',
  'double', 'boolean', 'String', 'Object', 'List', 'Map', 'Set', 'Integer', 'Double', 'Boolean',
  'var', 'record', 'sealed'];

const SQL_KW = ['select', 'from', 'where', 'insert', 'into', 'values', 'update', 'set', 'delete',
  'create', 'table', 'alter', 'drop', 'index', 'view', 'join', 'left', 'right', 'inner', 'outer',
  'on', 'group', 'by', 'order', 'having', 'limit', 'offset', 'as', 'and', 'or', 'not', 'null',
  'distinct', 'union', 'all', 'case', 'when', 'then', 'else', 'end', 'asc', 'desc', 'with'];

const SQL_TYPES = ['int', 'integer', 'bigint', 'smallint', 'varchar', 'text', 'char', 'boolean',
  'date', 'datetime', 'timestamp', 'decimal', 'numeric', 'float', 'double', 'json', 'jsonb',
  'count', 'sum', 'avg', 'min', 'max', 'coalesce'];

const SH_KW = ['if', 'then', 'else', 'elif', 'fi', 'for', 'in', 'do', 'done', 'while', 'until',
  'case', 'esac', 'function', 'return', 'exit', 'local', 'export', 'source', 'set', 'unset',
  'echo', 'cd', 'test', 'read'];

const SH_TYPES = ['true', 'false'];

const CSS_KW = ['important', 'media', 'import', 'keyframes', 'supports', 'from', 'to', 'and', 'not'];

const SPECS: Record<string, Spec> = {
  js: { kw: JS_KW, types: JS_TYPES, line: ['//'], block: ['/*', '*/'], str: ['"', "'", '`'] },
  json: { kw: [], types: ['true', 'false', 'null'], line: ['//'], str: ['"'] },
  py: {
    kw: PY_KW, types: PY_TYPES, line: ['#'], str: ['"', "'"], triple: ['"""', "'''"]
  },
  go: { kw: GO_KW, types: GO_TYPES, line: ['//'], block: ['/*', '*/'], str: ['"', "'", '`'] },
  rust: { kw: RUST_KW, types: RUST_TYPES, line: ['//'], block: ['/*', '*/'], str: ['"'] },
  java: { kw: JAVA_KW, types: JAVA_TYPES, line: ['//'], block: ['/*', '*/'], str: ['"', "'"] },
  sql: { kw: SQL_KW, types: SQL_TYPES, line: ['--'], block: ['/*', '*/'], str: ["'", '"'] },
  sh: { kw: SH_KW, types: SH_TYPES, line: ['#'], str: ['"', "'"] },
  css: { kw: CSS_KW, types: [], line: [], block: ['/*', '*/'], str: ['"', "'"] },
  html: { kw: [], types: [], line: [], block: ['<!--', '-->'], str: ['"', "'"], tag: true },
  yaml: { kw: [], types: ['true', 'false', 'null'], line: ['#'], str: ['"', "'"] },
  toml: { kw: [], types: ['true', 'false'], line: ['#'], str: ['"', "'"] }
};

/** 语言别名 → 规格名 */
const ALIAS: Record<string, string> = {
  javascript: 'js', jsx: 'js', mjs: 'js', cjs: 'js', node: 'js',
  typescript: 'js', ts: 'js', tsx: 'js',
  python: 'py', py3: 'py', python3: 'py',
  golang: 'go', rs: 'rust',
  shell: 'sh', bash: 'sh', zsh: 'sh', console: 'sh', terminal: 'sh', cmd: 'sh', powershell: 'sh', ps1: 'sh',
  c: 'java', cpp: 'java', 'c++': 'java', cs: 'java', csharp: 'java', kotlin: 'java', kt: 'java',
  swift: 'java', scala: 'java', php: 'java',
  scss: 'css', less: 'css', sass: 'css',
  xml: 'html', svg: 'html', vue: 'html', htm: 'html',
  yml: 'yaml', mysql: 'sql', postgres: 'sql', postgresql: 'sql', sqlite: 'sql', psql: 'sql',
  ini: 'toml', conf: 'toml', dotenv: 'toml', env: 'toml'
};

/**
 * 围栏上的语言标记：` ```ts title="a" ` 只取第一个词。
 * 返回的是「用户写的那一个词」（ts / python / sh），显示在代码块头上；
 * 具体用哪套词法由 specOf 里的别名表决定。
 */
export function langOf(info: string): string {
  const raw = (info || '').trim().split(/[\s,{:]+/)[0].replace(/^\./, '').toLowerCase();
  if (!raw) return '';
  return specOf(raw) ? raw : '';
}

function specOf(lang: string): Spec | null {
  const key = ALIAS[lang] || lang;
  return SPECS[key] || null;
}

const ID_START = /[A-Za-z_$]/;
const ID_PART = /[\w$]/;
const NUM_PART = /[0-9a-fA-FxXoObB._]/;
const PUNCT = /[{}()[\].,;:+\-*/%=<>!&|^~?]/;

/** 把代码切成带 class 的 span。认不出语言就原样转义返回 */
export function highlight(code: string, lang: string): string {
  const spec = specOf(lang);
  if (!spec) return esc(code);

  const kw = new Set(spec.kw);
  const types = new Set(spec.types || []);
  const strs = spec.str || [];
  const n = code.length;
  let out = '';
  let i = 0;
  let last = '';   // 上一个非空白字符，html 判断标签名要用

  const push = (cls: string, s: string): void => {
    out += cls ? `<span class="${cls}">${esc(s)}</span>` : esc(s);
  };

  while (i < n) {
    const c = code[i];

    // 行注释
    const lc = spec.line.find(p => code.startsWith(p, i));
    if (lc) {
      let j = code.indexOf('\n', i);
      if (j < 0) j = n;
      push('hl-com', code.slice(i, j));
      i = j;
      continue;
    }

    // 块注释
    if (spec.block && code.startsWith(spec.block[0], i)) {
      const j = code.indexOf(spec.block[1], i + spec.block[0].length);
      const end = j < 0 ? n : j + spec.block[1].length;
      push('hl-com', code.slice(i, end));
      i = end;
      last = '/';
      continue;
    }

    // 三引号字符串（python docstring 常跨行）
    const tq = spec.triple?.find(q => code.startsWith(q, i));
    if (tq) {
      const j = code.indexOf(tq, i + tq.length);
      const end = j < 0 ? n : j + tq.length;
      push('hl-str', code.slice(i, end));
      i = end;
      last = '"';
      continue;
    }

    // 普通字符串
    if (strs.includes(c)) {
      let j = i + 1;
      while (j < n && code[j] !== c) {
        if (code[j] === '\\') { j += 2; continue; }
        if (code[j] === '\n' && c !== '`') break;
        j++;
      }
      if (j < n && code[j] === c) j++;
      push('hl-str', code.slice(i, Math.min(j, n)));
      i = Math.min(j, n);
      last = c;
      continue;
    }

    // 数字（前面是字母的算标识符的一部分，比如 utf8）
    if (/[0-9]/.test(c) && !ID_PART.test(code[i - 1] ?? '')) {
      let j = i;
      while (j < n && NUM_PART.test(code[j])) j++;
      push('hl-num', code.slice(i, j));
      i = j;
      last = '0';
      continue;
    }

    // 标识符 / 关键字
    if (ID_START.test(c)) {
      let j = i;
      while (j < n && ID_PART.test(code[j])) j++;
      const word = code.slice(i, j);
      let k = j;
      while (k < n && (code[k] === ' ' || code[k] === '\t')) k++;
      const lower = word.toLowerCase();
      let cls = '';
      if (kw.has(lower) || kw.has(word)) cls = 'hl-kw';
      else if (types.has(word) || types.has(lower)) cls = 'hl-type';
      else if (spec.tag && last === '<') cls = 'hl-kw';
      else if (code[k] === '(') cls = 'hl-fn';
      push(cls, word);
      i = j;
      last = 'a';
      continue;
    }

    if (PUNCT.test(c)) {
      push('hl-punc', c);
      i++;
      last = c;
      continue;
    }

    push('', c);
    if (c.trim()) last = c;
    i++;
  }

  return out;
}
