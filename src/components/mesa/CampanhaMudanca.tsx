import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { padraoPara, TAMANHOS, textoDoErro, usd } from "@/lib/mesa/api";
import { botao, juntar, texto } from "@/components/sistema";
import { useEstimativa } from "./Custo";
import { useMesa } from "./MesaContexto";
import type { Campanha } from "./mesaV4Api";
import { aplicarRespostaDaCampanha, chavesDaCampanha, chavesDaCampanhaCompleta, confirmarMudanca, descartarMudanca, desfazerMudanca } from "./campanhasApi";
import type { AcaoDoAgente, ItemDaAcaoDoAgente } from "@/lib/agentes/acoesDoAgente";

/**
 * A mudança planejada pelo agente da campanha (22/10/2026): a lista organizada (antes → depois, por peça), com
 * caixa por item (peças protegidas vêm desmarcadas), o custo do que precisaria gerar de novo e Confirmar (tudo
 * ou só o marcado), Cancelar e, depois, Desfazer (volta à versão de antes).
 */

const GRUPOS: { rotulo: string; operacoes: string[] }[] = [
  { rotulo: "Campanha", operacoes: ["nome", "briefing", "conducao"] },
  { rotulo: "Peças que mudam", operacoes: ["alterar_peca", "alterar_peca_protegida"] },
  { rotulo: "Peças que entram", operacoes: ["nova_peca"] },
  { rotulo: "Peças que saem", operacoes: ["tirar_peca", "tirar_peca_protegida"] },
];

const protegido = (i: ItemDaAcaoDoAgente) => i.operacao.indexOf("_protegida") >= 0;

export default function CampanhaMudanca({ campanha, mensagemId, acao }: { campanha: Campanha; mensagemId: string; acao: AcaoDoAgente }) {
  const { clientId, catalogo } = useMesa();
  const qc = useQueryClient();
  const [marcados, setMarcados] = useState<string[]>(() => acao.itens.filter((i) => !protegido(i)).map((i) => i.ref));
  const [ocupado, setOcupado] = useState(false);
  const aberta = !acao.executada_em && !acao.descartada_em;
  const feita = !!acao.executada_em && !acao.desfeita_em;

  // O que precisaria gerar de novo: as peças com arte que mudam e as que entram (direção e lâminas).
  const refazer = acao.itens.filter((i) => marcados.indexOf(i.ref) >= 0 && ((i.operacao.indexOf("alterar_peca") === 0 && String(i.detalhe || "").indexOf("a arte será refeita") >= 0) || i.operacao === "nova_peca")).length;
  const diretor = padraoPara(catalogo, "diretor_arte");
  const imagem = padraoPara(catalogo, "imagem");
  const estimativa = useEstimativa(refazer ? [
    { modeloId: diretor ? diretor.id : null, tipo: "texto", tokensEntrada: TAMANHOS.preparar.entrada, tokensSaida: TAMANHOS.preparar.saida, vezes: refazer },
    { modeloId: imagem ? imagem.id : null, tipo: "imagem", imagens: 1, qualidade: "media", tokensEntrada: TAMANHOS.imagemAnexos.entrada, vezes: refazer * 3 },
  ] : null);

  const reler = (data: unknown) => {
    aplicarRespostaDaCampanha(qc, clientId, data);
    void qc.invalidateQueries({ queryKey: chavesDaCampanha.conversa(clientId, campanha.id) });
    void qc.invalidateQueries({ queryKey: chavesDaCampanhaCompleta.pecas(clientId, campanha.id) });
    if (campanha.proposta_id) void qc.invalidateQueries({ queryKey: ["mesa", "proposta-v4", campanha.proposta_id] });
  };

  const fazer = async (o: "confirmar" | "cancelar" | "desfazer") => {
    setOcupado(true);
    try {
      const data = o === "confirmar" ? await confirmarMudanca(mensagemId, acao.id, marcados) : o === "cancelar" ? await descartarMudanca(mensagemId, acao.id) : await desfazerMudanca(mensagemId, acao.id);
      reler(data);
      if (o === "confirmar") toast.success("Mudança aplicada", { description: `${marcados.length} item(ns). A versão de antes ficou guardada.` });
      if (o === "desfazer") toast.success("Mudança desfeita", { description: "A campanha voltou à versão de antes." });
    } catch (e) {
      toast.error("Não deu certo", { description: textoDoErro(e) });
    } finally {
      setOcupado(false);
    }
  };

  return (
    <div className="min-w-0 rounded-md bg-muted/50 p-3" data-mudanca-da-campanha={aberta ? "aberta" : feita ? "feita" : "fechada"}>
      <p className="text-[12px] font-medium">{aberta ? "Mudança planejada: confira e confirme" : feita ? "Mudança aplicada" : acao.desfeita_em ? "Mudança desfeita" : "Mudança cancelada"}</p>
      {GRUPOS.map((g) => {
        const itens = acao.itens.filter((i) => g.operacoes.indexOf(i.operacao) >= 0);
        if (!itens.length) return null;
        return (
          <div key={g.rotulo} className="mt-2 min-w-0">
            <p className={texto.rotulo}>{g.rotulo}</p>
            <ul className="mt-1 space-y-1" aria-label={g.rotulo}>
              {itens.map((i) => (
                <li key={i.ref} className="flex min-w-0 items-start text-[12px]" data-item-da-mudanca={i.ref} data-protegido={protegido(i) ? "" : undefined}>
                  {aberta ? (
                    <input
                      type="checkbox"
                      className="mr-2 mt-0.5 h-4 w-4 shrink-0 accent-[hsl(var(--primary))]"
                      checked={marcados.indexOf(i.ref) >= 0}
                      onChange={(e) => setMarcados((l) => (e.target.checked ? l.concat([i.ref]) : l.filter((x) => x !== i.ref)))}
                      aria-label={`Incluir ${i.titulo}`}
                    />
                  ) : (
                    <Check className={juntar("mr-2 mt-0.5 h-3.5 w-3.5 shrink-0", marcados.indexOf(i.ref) >= 0 ? "text-success" : "text-muted-foreground")} aria-hidden="true" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="font-medium [overflow-wrap:anywhere]">{i.titulo}</span>
                    {i.detalhe && <span className={juntar("block [overflow-wrap:anywhere]", protegido(i) ? "text-warning" : "text-muted-foreground")}>{i.detalhe}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      {aberta && (
        <div className="mt-2.5 flex min-w-0 items-center">
          <span className={juntar(texto.auxiliar, "min-w-0 flex-1 truncate")}>
            {refazer ? `${refazer} peça(s) a gerar de novo${estimativa.data !== undefined ? ` · ~${usd(estimativa.data)}` : ""}` : "Sem peça a gerar de novo"}
          </span>
          <button type="button" className={botao.icone} onClick={() => void fazer("cancelar")} disabled={ocupado} aria-label="Cancelar a mudança" title="Cancelar a mudança">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
          <button type="button" className={juntar(botao.icone, "text-primary hover:text-primary")} onClick={() => void fazer("confirmar")} disabled={ocupado || !marcados.length} aria-label={`Confirmar ${marcados.length} item(ns)`} title={`Confirmar ${marcados.length} item(ns) (aplicar não gera nada; as artes que mudam ficam "a refazer")`}>
            {ocupado ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}
          </button>
        </div>
      )}
      {feita && (
        <div className="mt-2 flex justify-end">
          <button type="button" className={botao.icone} onClick={() => void fazer("desfazer")} disabled={ocupado} aria-label="Desfazer a mudança" title="Desfazer: voltar à versão de antes">
            {ocupado ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Undo2 className="h-4 w-4" aria-hidden="true" />}
          </button>
        </div>
      )}
    </div>
  );
}
