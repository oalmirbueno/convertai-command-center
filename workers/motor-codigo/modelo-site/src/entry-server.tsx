import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import App from "./App";

/** Pré-render para SEO: o HTML sai pronto no build (scripts/prerender.mjs). */
export function render(): string {
  return renderToString(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
