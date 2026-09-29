import { espaco, juntar, texto } from "@/components/sistema/estilos";
import { CabecalhoDaEtapa, useProjetoDaMesa } from "./Comuns";
import EstudioDeNomes from "./EstudioDeNomes";

/**
 * Etapa 4, Naming (marca do zero, ou rebranding com troca de nome): o
 * criador de nomes com os critérios do briefing. O nome escolhido vira o nome
 * do projeto e segue para o conceito e o brandbook.
 */
export default function EtapaNaming() {
  const { projeto } = useProjetoDaMesa();
  const briefing = (projeto.dados.briefing || {}) as Record<string, unknown>;
  const naming = (projeto.dados.naming || {}) as Record<string, unknown>;
  const criterios = Array.isArray(briefing.criterios_do_nome) ? (briefing.criterios_do_nome as string[]) : undefined;
  const palavras = Array.isArray(briefing.palavras_do_nome) ? `Palavras ou raízes desejadas: ${(briefing.palavras_do_nome as string[]).join(", ")}` : "";
  return (
    <div className={espaco.pagina} data-etapa-naming="">
      <CabecalhoDaEtapa
        etapa="naming"
        ajuda="Gere por técnica, confira domínio, @ e INPI, e marque de 3 a 5 finalistas. O cliente aprova pelo painel ou no grupo; o nome escolhido fecha a etapa. Criar o nome não garante o registro da marca no INPI."
      />
      {typeof naming.nome === "string" && naming.nome && (
        <p className={juntar(texto.corpo)}>
          Nome escolhido: <strong className="font-semibold">{naming.nome}</strong>
        </p>
      )}
      <EstudioDeNomes alvo="marca" projetoId={projeto.id} criteriosIniciais={criterios} pedidoInicial={palavras} />
    </div>
  );
}
