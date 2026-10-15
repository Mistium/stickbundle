import fs from "node:fs";
import { parse } from "@babel/parser";
import _traverse from "@babel/traverse";
const traverse = _traverse.default ?? _traverse;
const [,, file, startLine] = process.argv;
const code = fs.readFileSync(file, "utf8");
const ast = parse(code, { sourceType: "module", plugins: ["jsx"] });
const rows = [];
for (const [i, st] of ast.program.body.entries()) {
  if (st.loc.start.line < +startLine) continue;
  let names = [];
  if (st.type === "FunctionDeclaration" || st.type === "ClassDeclaration") names = [st.id?.name];
  else if (st.type === "VariableDeclaration") names = st.declarations.map(d => d.id.name ?? "<pattern>");
  else names = [st.type];
  let jsx = false, cls = null, strs = [];
  traverse(st, {
    noScope: true,
    JSXElement(p) { jsx = true; },
    JSXAttribute(p) {
      if (!cls && p.node.name.name === "className") {
        const v = p.node.value;
        if (v?.type === "StringLiteral") cls = v.value.split(" ")[0];
        else if (v?.expression?.type === "TemplateLiteral") cls = v.expression.quasis[0].value.raw.trim().split(" ")[0];
      }
    },
  }, null, {});
  rows.push([i, st.loc.start.line, st.loc.end.line - st.loc.start.line + 1, jsx ? "JSX" : "", names.join(","), cls ?? ""].join("\t"));
}
console.log(rows.join("\n"));
