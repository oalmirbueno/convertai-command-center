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

createRoot(document.getElementById("root")!).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>,
);
