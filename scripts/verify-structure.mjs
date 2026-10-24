import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const required = [
  'README.md','AGENTS.md','package.json','docs/ARCHITECTURE.md',
  'docs/AGENT_PLAN.md','docs/ACCEPTANCE.md','docs/API_CONTRACTS.md',
  'apps/web/package.json','apps/server/package.json','packages/shared/package.json',
  '.gitignore',
];
let failed = false;
for (const item of required) {
  if (!existsSync(resolve(item))) { console.error(`MISSING: ${item}`); failed = true; }
}
try {
  const branch = execFileSync('git',['symbolic-ref','--quiet','--short','HEAD'], {encoding:'utf8'}).trim();
  if (branch !== 'Main') { console.error(`Expected single development branch Main; current HEAD: ${branch}`); failed=true; }
} catch {
  console.warn('Git branch chưa kiểm tra được (có thể đang chạy scaffold ngoài checkout).');
}
const ignored = readFileSync('.gitignore', 'utf8');
for (const pattern of ['node_modules/','profiles/','.tmp/','*.db']) {
  if (!ignored.includes(pattern)) { console.error(`MISSING .gitignore rule: ${pattern}`); failed=true; }
}
if (failed) process.exit(1);
console.log('PASS: structural repository checks completed. Runtime and browser acceptance remain separate gates.');
