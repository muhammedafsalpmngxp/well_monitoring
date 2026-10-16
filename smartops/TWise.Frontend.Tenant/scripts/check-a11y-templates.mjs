// Template accessibility check (no dependencies): fails when a template adds
//  - a (click) on a non-interactive element without keyboard access (appKeyClick, or its own role + tabindex),
//  - a role="dialog" panel without appDialog (focus trap, Escape, focus return),
//  - an <img> without alt text.
// Usage: node scripts/check-a11y-templates.mjs   (run from TWise.Frontend.Tenant)
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(process.cwd(), 'src', 'app');
const TAG = /<([a-zA-Z][\w-]*)\b([^<>]*)>/gs;
const CLICK = /\(click\)\s*=\s*"([^"]*)"/;
const STOP_ONLY = /^\s*\$event\.(stopPropagation|preventDefault)\(\)\s*;?\s*$/;
// Clicks on these containers are delegated from their items, which are the controls.
const CONTAINER_ROLE = /\brole\s*=\s*"(presentation|none|menu|listbox|toolbar|group)"/;
const BACKDROP =/class\s*=\s*"[^"]*(backdrop|overlay)\b/;
const NON_INTERACTIVE = new Set(['span', 'div', 'i', 'li', 'td', 'th', 'tr', 'img', 'svg', 'p', 'h1', 'h2', 'h3',
  'h4', 'h5', 'h6', 'strong', 'small', 'em', 'section', 'article', 'header', 'ul', 'b']);

function* templates(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* templates(path);
    else if (entry.name.endsWith('.html')) yield path;
  }
}

const problems = [];
for (const file of templates(ROOT)) {
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(TAG)) {
    const [, name, attrs] = m;
    const where = `${relative(process.cwd(), file)}:${text.slice(0, m.index).split('\n').length}`;
    const click = attrs.match(CLICK);
    if (NON_INTERACTIVE.has(name.toLowerCase()) && click && !STOP_ONLY.test(click[1]) && !BACKDROP.test(attrs)
        && !/\bappKeyClick\b/.test(attrs) && !CONTAINER_ROLE.test(attrs)
        && !(/\btabindex\s*=/.test(attrs) && (/\brole\s*=/.test(attrs) || /\(keydown[.)]/.test(attrs)))) {
      problems.push(`${where}  <${name} (click)> is not keyboard accessible: add appKeyClick or use a <button>`);
    }
    if (/\brole\s*=\s*"(alert)?dialog"/.test(attrs) && !/\bappDialog\b/.test(attrs)) {
      problems.push(`${where}  role="dialog" without appDialog (focus trap, Escape, focus return)`);
    }
    if (name.toLowerCase() === 'img' && !/\s(\[?alt\]?|\[attr\.alt\])\s*=/.test(attrs)) {
      problems.push(`${where}  <img> has no alt text (use alt="" for decorative images)`);
    }
  }
}

if (problems.length) {
  console.error(problems.join('\n'));
  console.error(`\n${problems.length} accessibility problem(s) in templates.`);
  process.exit(1);
}
console.log('Template accessibility check passed.');
