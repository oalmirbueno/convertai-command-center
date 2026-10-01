import scriptDoInstalador from "../../../workers/instalador/instalar-motores.ps1?raw";
import { type Instalador, montarInstaladorDe, type OpcoesDoInstalador } from "./montarInstalador";

/**
 * O instalador único dos motores (frente SUP, 01/10/2026): um .cmd que leva o
 * instalar-motores.ps1 dentro, conferido por hash antes de rodar (montarInstalador.ts).
 * Módulo carregado só no clique (o script fica fora do pedaço da tela).
 */

export * from "./montarInstalador";

export function montarInstalador(o: OpcoesDoInstalador): Promise<Instalador> {
  return montarInstaladorDe(scriptDoInstalador, o);
}
/** Baixa o instalador no navegador (Blob + link temporário). */
export function baixarArquivo(nome: string, conteudo: string): void {
  const blob = new Blob([conteudo], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
