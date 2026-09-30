import { espaco, juntar, texto } from "@/components/sistema/estilos";
import { normalizarEstrategia } from "../../../supabase/functions/_shared/estrategia-de-marca";
import { CabecalhoDaEtapa, useProjetoDaMesa } from "./Comuns";
import EstudioDeNomes from "./EstudioDeNomes";
import SlogansDaMarca from "./SlogansDaMarca";

/**
 * Etapa Naming (marca do zero, ou rebranding com troca de nome): o criador de
 * nomes com os critérios do briefing e a estratégia (IDV2), o teste de
 * idiomas, a votação da equipe e do cliente, e o slogan/tagline. O nome
 * escolhido vira o nome do projeto e segue para o conceito e o brandbook.
 */
export default function EtapaNaming() {
  const { projeto } = useProjetoDaMesa();
  const briefing = (projeto.dados.briefing || {}) as Record<string, unknown>;
  const naming = (projeto.dados.naming || {}) as Record<string, unknown>;
  const est = normalizarEstrategia(projeto.dados.estrategia);
  const criterios = Array.isArray(briefing.criterios_do_nome) ? (briefing.criterios_do_nome as string[]) : undefined;
  const pistas = [
    Array.isArray(briefing.palavras_do_nome) ? `Palavras ou raízes desejadas: ${(briefing.palavras_do_nome as string[]).join(", ")}` : "",
    est.tom.atributos.length ? `Tom: ${est.tom.atributos.join(", ")}` : "",
  ].filter(Boolean);
  return (
    <div className={espaco.pagina} data-etapa-naming="">
      <CabecalhoDaEtapa
        etapa="naming"
        ajuda="Gere por técnica (agora com 16), confira domínio, @ e INPI, teste a pronúncia e o sentido em outros idiomas e marque de 3 a 5 finalistas. A equipe vota aqui e o cliente pelo link; o nome escolhido fecha a etapa. Criar o nome não garante o registro no INPI."
      />
      {typeof naming.nome === "string" && naming.nome && (
        <p className={juntar(texto.corpo)}>
          Nome escolhido: <strong className="font-semibold">{naming.nome}</strong>
          {typeof naming.slogan === "string" && naming.slogan ? <span className="text-muted-foreground"> · {naming.slogan}</span> : null}
        </p>
      )}
      <EstudioDeNomes alvo="marca" projetoId={projeto.id} criteriosIniciais={criterios} pedidoInicial={pistas.join(". ")} />
      <SlogansDaMarca />
    </div>
  );
}
