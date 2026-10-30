import { excerpt } from '../src/core/text.ts';

const lf = '# 周会纪要\n\n今天讨论了三个方向，第一个是图片能力。\n';
const crlf = lf.replace(/\n/g, '\r\n');
const onlyHeading = '# 标题\n';
const headingAndImage = '# 标题\n\n![图](_assets/a.png)\n';
const headingAndTable = '# 标题\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n';
const headingAndCode = '# 标题\n\n```ts\nconst a = 1;\n```\n';
const todoOnly = '# 标题\n\n- [ ] 买咖啡\n- [x] 写周报\n';

const cases = { lf, crlf, onlyHeading, headingAndImage, headingAndTable, headingAndCode, todoOnly };
for (const [name, s] of Object.entries(cases)) {
  console.log(name.padEnd(18), JSON.stringify(excerpt(s, 68)));
}
