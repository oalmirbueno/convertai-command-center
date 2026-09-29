import { toast } from "sonner";
import { useMarcaDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { espaco } from "@/components/sistema/estilos";
import { CabecalhoDaEtapa, useProjetoDaMesa } from "./Comuns";
import EstudioDeMockups from "./EstudioDeMockups";

/**
 * Etapa 7, Mockups: o estúdio de mockups da frente MCK (logo aplicada por
 * código, nunca pelo gerador). Os mockups aprovados voltam para o projeto
 * (dados.mockups) e entram no brandbook.
 */
export default function EtapaMockups() {
  const { clientId } = useMesa();
  const { marca } = useMarcaDaMesa();
  const { projeto, salvarParte } = useProjetoDaMesa();
  const marcaId = projeto.marca_id || (marca ? marca.id : null);
  return (
    <div className={espaco.pagina} data-etapa-mockups="">
      <CabecalhoDaEtapa etapa="mockups" ajuda="Os mockups mostram a marca aplicada (fachada, embalagem, redes, papelaria). A logo entra pelo arquivo real, nunca redesenhada pelo gerador de imagem." />
      <EstudioDeMockups
        clientId={clientId}
        marcaId={marcaId}
        onEnviados={(itens) => {
          salvarParte("mockups", { itens }).then(
            () => toast.success(itens.length === 1 ? "Mockup no brandbook" : `${itens.length} mockups no brandbook`),
            (e) => toast.error(`Os mockups foram para Arquivos, mas não entraram no brandbook: ${e instanceof Error ? e.message : String(e)}`),
          );
        }}
      />
    </div>
  );
}
