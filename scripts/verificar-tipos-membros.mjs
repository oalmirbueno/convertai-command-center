import ts from "typescript";
import { resolve } from "node:path";
const config = ts.getParsedCommandLineOfConfigFile(
  resolve("tsconfig.test.json"),
  {},
  {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (d) => {
      throw Error(ts.flattenDiagnosticMessageText(d.messageText, "\n"));
    },
  },
);
const arquivos = [
  "src/test/membros-ferramentas.test.tsx",
  "src/test/membros-arquivos.test.ts",
  "src/test/membros-foco.test.tsx",
  "src/test/membros-pdf-tela-cheia.test.tsx",
  "src/test/membros-biblioteca.test.tsx",
  "src/test/membros-identidade.test.tsx",
  "src/lib/membros/modelo.test.ts",
  "src/test/crm-scroll-salvar-mcp-1-44.test.ts",
  "src/test/crm-empresas-ficha-rica-apagar.test.ts",
].map((p) => resolve(p));
const programa = ts.createProgram(
  [
    ...arquivos,
    resolve("src/test/setup.ts"),
    resolve("src/test/deno-env.d.ts"),
    resolve("src/vite-env.d.ts"),
  ],
  config.options,
);
const erros = [
  ...programa.getOptionsDiagnostics(),
  ...arquivos.flatMap((p) => {
    const f = programa.getSourceFile(p);
    if (!f) throw Error("Arquivo não carregado: " + p);
    return [
      ...programa.getSyntacticDiagnostics(f),
      ...programa.getSemanticDiagnostics(f),
    ];
  }),
];
if (erros.length) {
  process.stderr.write(
    ts.formatDiagnosticsWithColorAndContext(erros, {
      getCurrentDirectory: () => process.cwd(),
      getCanonicalFileName: (p) => p,
      getNewLine: () => "\n",
    }),
  );
  process.exitCode = 1;
} else
  process.stdout.write(
    `Tipos dos ${arquivos.length} arquivos de teste de membros/CRM conferidos: sem erros.\n`,
  );
