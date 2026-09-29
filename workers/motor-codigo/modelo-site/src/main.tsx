import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import App from "./App";
import "./tema.css";

const raiz = document.getElementById("root")!;
const arvore = (
  <StrictMode>
    <App />
  </StrictMode>
);
// Pré-renderizado (build): hidrata; na prévia (dev), monta do zero.
if (raiz.firstElementChild) hydrateRoot(raiz, arvore);
else createRoot(raiz).render(arvore);
