import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import App from "./App";

/** Pré-render para SEO: o HTML de cada página sai pronto no build (scripts/prerender.mjs). */
export function render(caminho = "/"): string {
  return renderToString(
    <StrictMode>
      <App caminho={caminho} />
    </StrictMode>,
  );
}
