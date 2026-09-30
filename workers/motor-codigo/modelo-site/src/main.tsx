import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import App from "./App";
import { urlDasFontes } from "./lib/pacote";
import "./tema.css";

// Fontes do pacote na prévia (no site pronto o pré-render já pôs o <link> no HTML).
const fontes = urlDasFontes();
if (fontes && !document.querySelector("link[data-fontes]")) {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = fontes;
  link.setAttribute("data-fontes", "");
  document.head.appendChild(link);
}

const raiz = document.getElementById("root")!;
const arvore = (
  <StrictMode>
    <App caminho={window.location.pathname} />
  </StrictMode>
);
// Pré-renderizado (build): hidrata; na prévia (dev), monta do zero.
if (raiz.firstElementChild) hydrateRoot(raiz, arvore);
else createRoot(raiz).render(arvore);
