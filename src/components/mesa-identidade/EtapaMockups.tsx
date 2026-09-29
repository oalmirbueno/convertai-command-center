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
  const { projeto } = useProjetoDaMesa();
  const marcaId = projeto.marca_id || (marca ? marca.id : null);
  return (
    <div className={espaco.pagina} data-etapa-mockups="">
      <CabecalhoDaEtapa etapa="mockups" ajuda="Os mockups mostram a marca aplicada (fachada, embalagem, redes, papelaria). A logo entra pelo arquivo real, nunca redesenhada pelo gerador de imagem." />
      <EstudioDeMockups clientId={clientId} marcaId={marcaId} />
    </div>
  );
}
