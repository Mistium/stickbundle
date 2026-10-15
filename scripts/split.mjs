// Split a webcrack-deobfuscated Vite bundle into modules with generated imports/exports.
import fs from "node:fs";
import path from "node:path";
import { parse } from "@babel/parser";
import _traverse from "@babel/traverse";
import _generate from "@babel/generator";
const traverse = _traverse.default ?? _traverse;
const generate = _generate.default ?? _generate;

const [,, file, outDir] = process.argv;
const code = fs.readFileSync(file, "utf8");
const ast = parse(code, { sourceType: "module", plugins: ["jsx"] });

// Vendor regions by start line (from license headers in the bundle).
const VENDOR = [
  [1, "vendor/runtime-helpers.js"],
  [94, "vendor/react.js"],
  [559, "vendor/react-jsx-runtime.js"],
  [628, "vendor/scheduler.js"],
  [996, "vendor/react-dom.js"],
  [11691, "vendor/remix-run-router.js"],
  [12279, "vendor/react-router.js"],
  [12868, "vendor/react-router-dom.js"],
  [12930, "vendor/lucide-react.js"],
];
const APP_START = 16237;
const ROUTES = { PC: "HomePage", C3: "MePage", U3: "AdminPage", _Component179: "ChatPage" };

const body = ast.program.body;
const hasJSX = st => { let j = false; traverse(st, { noScope: true, JSXElement(p) { j = true; p.stop(); } }, null, {}); return j; };
const rootClass = st => {
  let cls = null;
  traverse(st, { noScope: true, JSXAttribute(p) {
    if (p.node.name.name !== "className") return;
    const v = p.node.value;
    if (v?.type === "StringLiteral") cls = v.value;
    else if (v?.expression?.type === "TemplateLiteral") cls = v.expression.quasis[0].value.raw;
    if (cls != null) { cls = cls.trim().split(/\s+/)[0]; if (cls) p.stop(); else cls = null; }
  } }, null, {});
  return cls;
};
const declNames = st =>
  st.type === "FunctionDeclaration" || st.type === "ClassDeclaration" ? [st.id.name]
  : st.type === "VariableDeclaration" ? st.declarations.flatMap(d => d.id.type === "Identifier" ? [d.id.name] : [])
  : [];
const pascal = s => s.replace(/(^|[-_])([a-z0-9])/gi, (_, __, c) => c.toUpperCase()).replace(/^[0-9]/, "_$&");
const minified = n => /^_Component\d+$/.test(n) || n.length <= 3;

// 1. Rename route + minified app components using route table / root CSS class.
const used = new Set();
traverse(ast, { Program(p) { for (const n of Object.keys(p.scope.bindings)) used.add(n); } });
const progPath = (() => { let pp; traverse(ast, { Program(p) { pp = p; p.stop(); } }); return pp; })();
const renames = {};
for (const st of body) {
  if (st.loc.start.line < APP_START || !hasJSX(st)) continue;
  for (const n of declNames(st)) {
    let target = ROUTES[n];
    if (!target && minified(n)) { const c = rootClass(st); if (c) target = pascal(c); }
    if (!target || target === n) continue;
    let t = target, k = 2; while (used.has(t)) t = target + k++;
    used.add(t); renames[n] = t;
    progPath.scope.rename(n, t);
  }
}

// 2. Assign each top-level statement to a chunk (output file).
const chunkOf = new Map(); const chunks = new Map(); // name -> [stmts]
let cur = null, pending = [];
const put = (st, f) => { chunkOf.set(st, f); if (!chunks.has(f)) chunks.set(f, []); chunks.get(f).push(st); };
const appFile = st => {
  const name = declNames(st)[0];
  const cls = rootClass(st) ?? "";
  const pre = (cls.match(/^([a-z]+)-/) ?? [, "misc"])[1];
  const dir = Object.values(ROUTES).includes(name) ? "pages" : `components/${pre}`;
  return `${dir}/${name}.jsx`;
};
for (const [i, st] of body.entries()) {
  const line = st.loc.start.line;
  if (line < APP_START) {
    const v = VENDOR.filter(([l]) => l <= line).at(-1)[1];
    put(st, v); continue;
  }
  if (i >= body.length - 3) { pending.push(st); continue; }
  pending.push(st);
  const size = st.loc.end.line - st.loc.start.line + 1;
  if (hasJSX(st) && size >= 25 && declNames(st).length) {
    let f = appFile(st); let k = 2; while (chunks.has(f)) f = f.replace(/(\d*)\.jsx$/, `${k++}.jsx`);
    for (const p of pending) put(p, f); pending = [];
  }
}
for (const p of pending) put(p, "main.jsx");

// 3. Cross-chunk references -> imports/exports.
const imports = new Map(); const exports = new Map();
const topStmt = p => (p.parentPath?.isProgram() ? p : p.findParent(q => q.parentPath?.isProgram()))?.node ?? null;
traverse(ast, {
  Identifier(p) {
    if (!p.isReferencedIdentifier() && !(p.parentPath.isAssignmentExpression() && p.key === "left") && !p.parentPath.isUpdateExpression()) return;
    const b = p.scope.getBinding(p.node.name);
    if (!b || b.scope.path.type !== "Program") return;
    const from = chunkOf.get(topStmt(b.path));
    const to = chunkOf.get(topStmt(p));
    if (!from || !to || from === to) return;
    if (!imports.has(to)) imports.set(to, new Map());
    if (!imports.get(to).has(from)) imports.get(to).set(from, new Set());
    imports.get(to).get(from).add(p.node.name);
    if (!exports.has(from)) exports.set(from, new Set());
    exports.get(from).add(p.node.name);
  },
  JSXIdentifier(p) {
    if (p.parentPath.isJSXAttribute() || p.parentPath.isJSXMemberExpression() && p.key !== "object") return;
    if (!p.parentPath.isJSXMemberExpression() && /^[a-z][a-z0-9-]*$/.test(p.node.name)) return; // intrinsic tag
    const b = p.scope.getBinding(p.node.name);
    if (!b || b.scope.path.type !== "Program") return;
    const from = chunkOf.get(topStmt(b.path));
    const to = chunkOf.get(topStmt(p));
    if (!from || !to || from === to) return;
    if (!imports.has(to)) imports.set(to, new Map());
    if (!imports.get(to).has(from)) imports.get(to).set(from, new Set());
    imports.get(to).get(from).add(p.node.name);
    if (!exports.has(from)) exports.set(from, new Set());
    exports.get(from).add(p.node.name);
  },
});

// 4. Emit.
const rel = (a, b) => { let r = path.relative(path.dirname(a), b); return r.startsWith(".") ? r : "./" + r; };
for (const [f, stmts] of chunks) {
  const out = [];
  for (const [src, names] of imports.get(f) ?? []) out.push(`import { ${[...names].sort().join(", ")} } from "${rel(f, src)}";`);
  if (out.length) out.push("");
  out.push(generate({ type: "Program", body: stmts, directives: [], sourceType: "module" }, { comments: true, jsescOption: { minimal: true } }).code);
  const ex = exports.get(f);
  if (ex?.size) out.push("", `export { ${[...ex].sort().join(", ")} };`);
  const dest = path.join(outDir, f);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, out.join("\n") + "\n");
}
fs.writeFileSync(path.join(outDir, "_renames.json"), JSON.stringify(renames, null, 2));
console.log(`${chunks.size} files, ${Object.keys(renames).length} renames`);
