// Primeiro de tudo: preenche o que navegador antigo nao tem (ver polyfills.ts).
import "./polyfills";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import AppErrorBoundary from "./components/AppErrorBoundary.tsx";
import {
  installChunkErrorRecovery,
  startVersionWatch,
  stripRefreshParam,
} from "./lib/appRefresh";
import "./index.css";
import "./styles/responsive.css";

// Ordem importa: primeiro os detectores de versão antiga, depois o app.
installChunkErrorRecovery();
startVersionWatch();
stripRefreshParam();

// Marca da publicação. Trocar este valor muda o nome do arquivo principal e
// tira o painel de uma cópia travada na CDN (25/09: index-aIxjy7UY.js parou de
// ser entregue no endereço exato e o painel ficava em "demorando para abrir").
document.documentElement.setAttribute("data-publicacao", "2026-09-25-2");

// A memória de quedas fatais NÃO é zerada aqui. Zerar aos 20 segundos fazia
// um erro que só aparece depois de um tempo de uso (abrir uma tela pesada,
// por exemplo) recomeçar a contagem a cada recarga automática, e o painel
// entrava em loop de recarga sem nunca chegar à tela manual. A janela agora
// mora no próprio contador (10 minutos por assinatura, em appRefresh.ts).

createRoot(document.getElementById("root")!).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>,
);
