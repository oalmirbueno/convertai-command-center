// Configuração do Remotion para o worker (frente EDT).
// A composição mora em src/ (fora desta pasta): remotion, react e react-dom precisam ser UMA
// cópia só (a desta pasta), senão o contexto do Remotion se divide e o render quebra.
import path from "node:path";
import { Config } from "@remotion/cli/config";

const aqui = process.cwd();
const modulo = (nome: string) => path.join(aqui, "node_modules", nome);

Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
Config.overrideWebpackConfig((c) => ({
  ...c,
  resolve: {
    ...c.resolve,
    alias: {
      ...((c.resolve && c.resolve.alias) || {}),
      remotion: modulo("remotion"),
      react: modulo("react"),
      "react-dom": modulo("react-dom"),
    },
  },
}));
