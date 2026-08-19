import fs from "node:fs";
import path from "node:path";

const root = path.resolve("src");

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

function fixClass(cls) {
  let c = cls;
  if (!/\bborder\b/.test(c)) return cls;
  c = c.replace(/border-white\/\d+/g, "border-ink/20");
  c = c.replace(/\bborder-white\b/g, "border-ink/20");
  const hasBorderColor =
    /border-ink\/|border-accent|border-danger|border-success|border-amber|border-blue|border-cool|border-muted|border-warm/.test(
      c,
    );
  if (!hasBorderColor) {
    c = c.replace(/\bborder\b/, "border border-ink/20");
    c = c.replace(/border border border-ink\/20/g, "border border-ink/20");
  }
  if (!/focus:|focus-visible:/.test(c)) {
    c += " focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/20";
  }
  return c;
}

/** Find end of JSX opening tag; ignore `>` inside quotes or `{...}` expressions. */
function findTagEnd(src, start) {
  let i = start;
  let quote = null;
  let brace = 0;
  while (i < src.length) {
    const ch = src[i];
    if (quote) {
      if (ch === "\\" && (quote === '"' || quote === "'")) {
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      i += 1;
      continue;
    }
    if (ch === "{") {
      brace += 1;
      i += 1;
      continue;
    }
    if (ch === "}" && brace > 0) {
      brace -= 1;
      i += 1;
      continue;
    }
    if (brace === 0 && ch === ">") return i + 1;
    i += 1;
  }
  return -1;
}

function fixFile(src) {
  const tagOpen = /<(input|textarea|select)\b/g;
  let out = "";
  let last = 0;
  let m;
  while ((m = tagOpen.exec(src))) {
    const start = m.index;
    const end = findTagEnd(src, start + m[0].length);
    if (end < 0) break;
    const full = src.slice(start, end);
    const fixed = full.replace(/className="([^"]*)"/g, (mm, cls) => {
      const next = fixClass(cls);
      return next === cls ? mm : `className="${next}"`;
    });
    out += src.slice(last, start) + fixed;
    last = end;
    tagOpen.lastIndex = end;
  }
  out += src.slice(last);
  return out;
}

const files = walk(root);
let changed = 0;
for (const file of files) {
  const src = fs.readFileSync(file, "utf8");
  const next = fixFile(src);
  if (next !== src) {
    fs.writeFileSync(file, next);
    changed += 1;
    console.log("updated", path.relative(root, file));
  }
}
console.log("files changed", changed);
