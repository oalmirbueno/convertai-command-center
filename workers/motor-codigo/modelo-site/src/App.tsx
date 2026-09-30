import type { ComponentType } from "react";
import { SECOES } from "./secoes";
import { useRolagemSuave } from "./lib/rolagem";
import { pacote, paginaPeloCaminho } from "./lib/pacote";
import { CamadaDeIntegracoes } from "./lib/integracoes";

/**
 * Monta a página do endereço: o topo e o rodapé (globais) em volta das seções
 * da página, na ordem do mapa (pacote.paginas). Pacote antigo, sem páginas:
 * todas as seções de SECOES, na ordem. Casca da casa: não mexa sem precisar.
 */
export default function App({ caminho = "/" }: { caminho?: string }) {
  useRolagemSuave();
  const porId: Record<string, ComponentType> = {};
  SECOES.forEach((s) => (porId[s.id] = s.Componente));
  const pagina = paginaPeloCaminho(caminho);
  const globais = pacote.globais || ["topo", "rodape"];
  const Topo = pagina && globais.indexOf("topo") >= 0 ? porId.topo : null;
  const Rodape = pagina && globais.indexOf("rodape") >= 0 ? porId.rodape : null;
  const ids = pagina ? pagina.secoes : SECOES.map((s) => s.id);
  return (
    <div className="min-h-screen bg-fundo font-texto text-texto antialiased">
      {Topo ? <Topo /> : null}
      <main>
        {ids.map((id) => {
          const C = porId[id];
          return C ? <C key={id} /> : null;
        })}
      </main>
      {Rodape ? <Rodape /> : null}
      <CamadaDeIntegracoes />
    </div>
  );
}
