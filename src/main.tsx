import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import AppErrorBoundary from "./components/AppErrorBoundary.tsx";
import {
  clearFatalCrashes,
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

// 20 segundos rodando sem quebrar = sessão saudável: zera a memória de
// quedas para a próxima recuperação automática começar do zero.
window.setTimeout(clearFatalCrashes, 20_000);

createRoot(document.getElementById("root")!).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>,
);
