const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const vault = require('./vault.cjs');

function tmpVault() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-vault-'));
  return dir;
}

test('写入后能读回，mtime 有效', () => {
  const root = tmpVault();
  const mtime = vault.write(root, '工作/产品/方向.md', '# 方向\n\n正文');
  assert.ok(mtime > 0, 'mtime 应该大于 0');

  const got = vault.read(root, '工作/产品/方向.md');
  assert.equal(got.raw, '# 方向\n\n正文');
  assert.equal(got.relPath, '工作/产品/方向.md');
  assert.equal(got.mtime, mtime);
});

test('覆盖写入不会留下 .tmp 残留', () => {
  const root = tmpVault();
  vault.write(root, 'a.md', 'v1');
  vault.write(root, 'a.md', 'v2');

  assert.equal(vault.read(root, 'a.md').raw, 'v2');
  const leftovers = fs.readdirSync(root).filter(n => n.endsWith('.tmp'));
  assert.deepEqual(leftovers, []);
});

test('list 只收 .md，跳过隐藏目录与隐藏文件', () => {
  const root = tmpVault();
  vault.write(root, 'b.md', 'b');
  vault.write(root, 'sub/a.md', 'a');
  vault.write(root, 'sub/deep/c.md', 'c');
  fs.writeFileSync(path.join(root, 'notes.txt'), 'txt');
  fs.mkdirSync(path.join(root, '.git'));
  fs.writeFileSync(path.join(root, '.git', 'x.md'), 'hidden');
  fs.writeFileSync(path.join(root, '.hidden.md'), 'hidden');

  const names = vault.list(root).map(f => f.relPath);
  assert.deepEqual(names, ['b.md', 'sub/a.md', 'sub/deep/c.md']);
});

test('rename 会移动文件并保留内容', () => {
  const root = tmpVault();
  vault.write(root, '收集箱/无标题.md', '# 标题');
  vault.rename(root, '收集箱/无标题.md', '工作/无标题.md');

  assert.equal(vault.read(root, '收集箱/无标题.md'), null);
  assert.equal(vault.read(root, '工作/无标题.md').raw, '# 标题');
});

test('rename 目标已存在时拒绝，不覆盖', () => {
  const root = tmpVault();
  vault.write(root, 'a.md', 'A');
  vault.write(root, 'b.md', 'B');

  assert.throws(() => vault.rename(root, 'a.md', 'b.md'), /目标已存在/);
  assert.equal(vault.read(root, 'a.md').raw, 'A');
  assert.equal(vault.read(root, 'b.md').raw, 'B');
});

test('remove 删文件并回收空目录', () => {
  const root = tmpVault();
  vault.write(root, 'x/y/z.md', 'z');
  vault.remove(root, 'x/y/z.md');

  assert.equal(vault.read(root, 'x/y/z.md'), null);
  assert.equal(fs.existsSync(path.join(root, 'x')), false, '空目录应该被收走');
});

test('remove 遇到不存在的文件不报错', () => {
  const root = tmpVault();
  assert.doesNotThrow(() => vault.remove(root, 'nope.md'));
});

test('safeJoin 挡掉路径穿越', () => {
  const root = tmpVault();
  assert.throws(() => vault.safeJoin(root, '../etc/passwd'), /非法路径|路径越界/);
  assert.throws(() => vault.safeJoin(root, 'a/../../b'), /非法路径|路径越界/);
  assert.throws(() => vault.safeJoin(root, 'C:/Windows/system32'), /非法路径|路径越界/);
  assert.doesNotThrow(() => vault.safeJoin(root, '工作/产品/a.md'));
});

test('反斜杠分隔的路径也能正确落盘', () => {
  const root = tmpVault();
  vault.write(root, '工作\\产品\\a.md', 'a');
  assert.ok(fs.existsSync(path.join(root, '工作', '产品', 'a.md')));
});

test('writeBinary 把 base64 还原成二进制文件', () => {
  const root = tmpVault();
  // 1x1 PNG
  const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const res = vault.writeBinary(root, '_assets/pic.png', b64);

  const file = path.join(root, '_assets', 'pic.png');
  assert.ok(fs.existsSync(file));
  const buf = fs.readFileSync(file);
  assert.equal(buf.length, 70);
  // PNG 魔数
  assert.deepEqual([...buf.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  assert.equal(res.size, 70);

  // 不能留 .tmp
  assert.deepEqual(fs.readdirSync(path.join(root, '_assets')).filter(n => n.endsWith('.tmp')), []);
});

test('writeBinary 拒绝空内容，也挡路径穿越', () => {
  const root = tmpVault();
  assert.throws(() => vault.writeBinary(root, '_assets/e.png', ''), /空文件/);
  assert.throws(() => vault.writeBinary(root, '../escape.png', 'AAAA'), /非法路径|路径越界/);
});

test('exists 只看文件，不看目录', () => {
  const root = tmpVault();
  vault.write(root, 'sub/a.md', 'a');
  assert.equal(vault.exists(root, 'sub/a.md'), true);
  assert.equal(vault.exists(root, 'sub'), false);
  assert.equal(vault.exists(root, 'nope.png'), false);
});

test('prune 收走空目录，连里面的空子目录一起收', () => {
  const root = tmpVault();
  vault.write(root, '技术/子目录/深层.md', 'x');
  // 改名 = 搬文件，搬完原地只剩空壳
  vault.rename(root, '技术/子目录/深层.md', '技术TMP/子目录/深层.md');
  assert.ok(fs.existsSync(path.join(root, '技术', '子目录')), '搬完原地应该还有空子目录');

  vault.prune(root, '技术');
  assert.equal(fs.existsSync(path.join(root, '技术')), false, '旧目录应该被收走');
  assert.ok(fs.existsSync(path.join(root, '技术TMP', '子目录', '深层.md')), '新目录里的文件不能动');
});

test('prune 遇到还有文件的目录就停手', () => {
  const root = tmpVault();
  vault.write(root, '技术/a.md', 'a');
  vault.write(root, '技术/b.md', 'b');
  vault.prune(root, '技术');
  assert.equal(fs.existsSync(path.join(root, '技术', 'a.md')), true);
  assert.equal(fs.existsSync(path.join(root, '技术', 'b.md')), true);
});
