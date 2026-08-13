import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import "./styles/responsive.css";

// Depois de cada publicacao, os pedacos antigos do app deixam de existir.
// Quem estava com o painel aberto (ou com o index em cache no PWA) tentava
// carregar um pedaco que sumiu e via tela branca. Aqui o app se recarrega
// sozinho UMA vez para buscar a versao nova - sem precisar reinstalar nada.
const reloadForNewVersion = () => {
  const key = "aceleriq-chunk-reload";
  const last = Number(sessionStorage.getItem(key) || 0);
  if (Date.now() - last < 15_000) return;
  sessionStorage.setItem(key, String(Date.now()));
  window.location.reload();
};

window.addEventListener("vite:preloadError", (event) => {
  event.preventDefault();
  reloadForNewVersion();
});

window.addEventListener("error", (event) => {
  const message = String(event?.message || "");
  if (/Loading chunk|Failed to fetch dynamically imported module|Importing a module script failed/i.test(message)) {
    reloadForNewVersion();
  }
});

createRoot(document.getElementById("root")!).render(<App />);
