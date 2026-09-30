import { useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Circle, Loader2, PackageCheck } from "lucide-react";
import { useMesa } from "@/components/mesa/MesaContexto";
import { useAvisarErro } from "@/components/mesa/Custo";
import CartaoDeAcao from "@/components/agentes/CartaoDeAcao";
import { acaoDoAnexo, chamarAcaoDoAgente, type AcaoDoAgente } from "@/lib/agentes/acoesDoAgente";
import Secao from "@/components/sistema/Secao";
import { botao, espaco, juntar, lista, texto } from "@/components/sistema/estilos";
import { chamarIdentidade, CHAVES, textoDaAprovacao, useBrandbooks, useRodadas, useSituacaoDoArquivo } from "./identidadeApi";
import { CabecalhoDaEtapa, useProjetoDaMesa } from "./Comuns";
import { faltaNaEtapa } from "../../../supabase/functions/_shared/identidade-etapas";
import { prontoParaApresentar, roteiroDaApresentacao } from "../../../supabase/functions/_shared/apresentacao-da-marca";
import VideoDaMarca from "./VideoDaMarca";
import ResultadoDaMarca from "./ResultadoDaMarca";

/**
 * Etapa 9, Entrega: onde cada coisa está (brandbook na aprovação, nome
 * escolhido, página pública) e o que foi aprovado vira kit da marca, como
 * SUGESTÃO num cartão com Confirmar (e Desfazer). Concluir a Entrega marca o
 * projeto como entregue e registra o evento para o documento de entrega.
 */
export default function EtapaEntrega() {
  const { clientId, atualizarCusto } = useMesa();
  const { projeto } = useProjetoDaMesa();
  const qc = useQueryClient();
  const avisarErro = useAvisarErro();
  const versoes = useBrandbooks(projeto.id);
  const rodadas = useRodadas(clientId, { projetoId: projeto.id });
  const guideline = (projeto.dados.guideline || {}) as { brandbook_id?: string };
  const bb = (versoes.data || []).filter((v) => v.id === guideline.brandbook_id)[0] || (versoes.data || [])[0] || null;
  const situacao = useSituacaoDoArquivo(bb ? bb.arquivo_pdf_id : null);
  const naming = (projeto.dados.naming || {}) as { nome?: string };
  const rodada = (rodadas.data || [])[0] || null;
  const [sugestao, setSugestao] = useState<{ mensagemId: string; acao: AcaoDoAgente } | null>(null);
  const [pedindo, setPedindo] = useState(false);

  const itens: Array<{ feito: boolean; rotulo: string; detalhe: string }> = [
    { feito: !!bb, rotulo: "Brandbook montado", detalhe: bb ? `Versão ${bb.versao}, ${bb.modelo === "prancha" ? "prancha" : "24 páginas"}` : "Monte na etapa Guideline" },
    { feito: !!(bb && bb.arquivo_pdf_id), rotulo: "Brandbook na aprovação", detalhe: bb && bb.arquivo_pdf_id ? textoDaAprovacao(situacao.data) : "Envie na etapa Guideline" },
    { feito: !!(bb && bb.token_publico && !bb.revogado_em), rotulo: "Página pública", detalhe: bb && bb.token_publico && !bb.revogado_em ? `/marca/${bb.token_publico.slice(0, 6)}...` : "Opcional" },
  ];
  if (projeto.modo === "zero" || projeto.com_naming) {
    itens.unshift({ feito: !!naming.nome, rotulo: "Nome escolhido", detalhe: naming.nome || (rodada ? "Escolha entre os finalistas" : "Gere na etapa Naming") });
  }
  // IDV2: a estratégia e a apresentação também contam para a entrega.
  const faltaNaEstrategia = faltaNaEtapa("estrategia", projeto.dados);
  itens.unshift({ feito: !faltaNaEstrategia.length, rotulo: "Estratégia da marca", detalhe: faltaNaEstrategia.length ? `Falta: ${faltaNaEstrategia[0].toLowerCase()}` : "Plataforma, arquétipo, posicionamento e tom" });
  const roteiro = roteiroDaApresentacao(projeto.dados, { comNaming: projeto.modo === "zero" || projeto.com_naming, semCaminhos: projeto.modo === "completar" });
  const apresentacao = prontoParaApresentar(roteiro);
  itens.push({ feito: apresentacao.pronto, rotulo: "Apresentação ao cliente", detalhe: apresentacao.pronto ? `${roteiro.filter((x) => x.incluido).length} slides prontos` : `Falta: ${apresentacao.faltas[0]}` });
  // IDV3 (adendo do dono): o vídeo da marca feito na Mesa Motion também entra na entrega.
  const videos = Array.isArray(projeto.dados.videos) ? (projeto.dados.videos as unknown[]) : [];
  itens.push({ feito: videos.length > 0, rotulo: "Vídeo da marca", detalhe: videos.length ? `${videos.length} na Mesa Motion` : "Opcional: crie abaixo" });

  const sugerirKit = async () => {
    setPedindo(true);
    try {
      const r = await chamarIdentidade<{ mensagem_id: string; anexo: unknown }>("kit_sugerir", { projeto_id: projeto.id });
      const acao = acaoDoAnexo(r.anexo);
      if (acao) setSugestao({ mensagemId: r.mensagem_id, acao });
    } catch (e) {
      avisarErro(e, "A sugestão do kit não saiu");
    } finally {
      setPedindo(false);
    }
  };

  return (
    <div className={espaco.pagina} data-etapa-entrega="">
      <CabecalhoDaEtapa etapa="entrega" ajuda="A aprovação acontece em Arquivos (revisão da agência e depois o cliente, no painel ou no grupo). Levar ao kit da marca é uma sugestão: nada muda no kit sem o Confirmar, e o Desfazer volta o que havia." />
      <Secao titulo="Onde está cada coisa" recolher={false}>
        <ul className={juntar(lista.aberta, lista.divisoria)} aria-label="Entregas do projeto">
          {itens.map((i) => (
            <li key={i.rotulo} className={lista.linha}>
              {i.feito ? <CheckCircle2 className="mr-3 h-4 w-4 shrink-0 text-primary" /> : <Circle className="mr-3 h-4 w-4 shrink-0 text-muted-foreground" />}
              <span className="min-w-0 flex-1">
                <span className={juntar(texto.corpo, "block truncate")}>{i.rotulo}</span>
                <span className={juntar(texto.auxiliar, "block truncate")}>{i.detalhe}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className={juntar(texto.auxiliar, "mt-2")}>
          Aprovações do cliente: <Link className="text-primary underline-offset-2 hover:underline" to={`/aprovacoes?client=${clientId}`}>abrir Aprovações</Link>
        </p>
      </Secao>

      <ResultadoDaMarca />

      <VideoDaMarca />

      <Secao titulo="Kit da marca" divisoria recolher={false}>
        {!sugestao && (
          <button type="button" className={botao.secundario} onClick={() => void sugerirKit()} disabled={pedindo} data-sugerir-kit="">
            {pedindo ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <PackageCheck className="mr-1.5 h-4 w-4" />} Levar ao kit da marca
          </button>
        )}
        {sugestao && (
          <CartaoDeAcao
            acao={sugestao.acao}
            titulo="Levar ao kit da marca"
            observacao="Sem custo. O Desfazer volta o kit como estava."
            onPedido={(p) => chamarAcaoDoAgente("mesa-identidade", sugestao.mensagemId, sugestao.acao.id, p)}
            onFeito={() => {
              void qc.invalidateQueries({ queryKey: ["mesa", "kit", clientId] });
              void qc.invalidateQueries({ queryKey: CHAVES.projeto(projeto.id) });
              atualizarCusto();
            }}
          />
        )}
      </Secao>
    </div>
  );
}
