// Grafo de chamadas dos worklets: uma função com 'worklet' que chama outra SEM a diretiva derruba a thread de UI
// ("Tried to synchronously call a non-worklet function"). O mock do Reanimated roda tudo no JS e não pega isso;
// este teste lê o fonte com o compilador do TypeScript e falha se algum worklet do avatar chamar função sem a diretiva.

declare const require: (m: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
declare const __dirname: string;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ts = require('typescript');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const fs = require('fs');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const path = require('path');

const SRC = path.resolve(__dirname, '../../../..');
const DIRS = ['avatar', 'avatar/emotes', 'components/avatar/stage'];
const EXTRA = ['screens/map/native/images/anim.ts'];

function roots(): string[] {
  const out: string[] = EXTRA.map((f) => path.join(SRC, f));
  for (const d of DIRS) {
    for (const f of fs.readdirSync(path.join(SRC, d)) as string[]) {
      if (/\.tsx?$/.test(f) && !f.endsWith('.d.ts')) out.push(path.join(SRC, d, f));
    }
  }
  return out;
}

type Node = any; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('worklets do avatar', () => {
  it('nenhum worklet chama função sem a diretiva', () => {
    const program = ts.createProgram(roots(), {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      jsx: ts.JsxEmit.ReactJSX,
      allowJs: false,
      noEmit: true,
      skipLibCheck: true,
      types: [],
    });
    const checker = program.getTypeChecker();
    const isFn = (n: Node) => ts.isFunctionDeclaration(n) || ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isMethodDeclaration(n);
    const hasDirective = (n: Node) => {
      const b = n.body;
      if (!b || !ts.isBlock(b)) return false;
      const s = b.statements[0];
      return !!s && ts.isExpressionStatement(s) && ts.isStringLiteral(s.expression) && s.expression.text === 'worklet';
    };
    const insideWorklet = (n: Node) => {
      for (let p = n.parent; p; p = p.parent) if (isFn(p) && hasDirective(p)) return true;
      return false;
    };
    const ours = (f: string) => f.replace(/\\/g, '/').includes('/src/') && !f.includes('node_modules') && !f.includes('__tests__');
    const bad: string[] = [];
    for (const sf of program.getSourceFiles()) {
      if (sf.isDeclarationFile || !ours(sf.fileName)) continue;
      const visit = (n: Node, inW: boolean) => {
        const w = inW || (isFn(n) && hasDirective(n));
        if (w && ts.isCallExpression(n)) {
          let sym = checker.getSymbolAtLocation(ts.isPropertyAccessExpression(n.expression) ? n.expression.name : n.expression);
          if (sym && sym.flags & ts.SymbolFlags.Alias) sym = checker.getAliasedSymbol(sym);
          const d = sym?.declarations?.[0];
          if (d && ours(d.getSourceFile().fileName)) {
            let fnNode: Node = null;
            if (isFn(d)) fnNode = d;
            else if (ts.isVariableDeclaration(d) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) fnNode = d.initializer;
            if (fnNode && !hasDirective(fnNode) && !insideWorklet(fnNode)) {
              const at = (x: Node) => `${path.relative(SRC, x.getSourceFile().fileName)}:${x.getSourceFile().getLineAndCharacterOfPosition(x.getStart()).line + 1}`;
              bad.push(`${at(n)} -> ${sym.name} (${at(d)})`);
            }
          }
        }
        ts.forEachChild(n, (c: Node) => visit(c, w));
      };
      visit(sf, false);
    }
    expect(bad).toEqual([]);
  }, 120000);
});

export {};
