import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, MessageSquarePlus, ScanSearch } from "lucide-react";
import { useMesa } from "@/components/mesa/MesaContexto";
import { useAvisarErro } from "@/components/mesa/Custo";
import Secao from "@/components/sistema/Secao";
import { EstadoVazio } from "@/components/sistema/Estados";
import { botao, juntar, lista, texto } from "@/components/sistema/estilos";
import { dataEHora } from "@/lib/mesa/api";
import { ehAberto, type TrabalhoDoMotor } from "../../../supabase/functions/_shared/motor-codigo";
import type { AvisoDeQa } from "../../../supabase/functions/_shared/site-metodo";
import { pendentesObrigatorios } from "../../../supabase/functions/_shared/site-lancamento";
import { chamarMotor, CHAVES, comAEdicaoDaPrevia, type LinhaDoSite, previaAtual, trabalhosDeCodigo, useTrabalhos } from "./siteApi";
import ChecklistDeLancamento, { useChecklistDoSite } from "./ChecklistDeLancamento";
import ChecklistDeUx, { useChecklistDeUx } from "./ChecklistDeUx";
import PreviaNosAparelhos from "./PreviaNosAparelhos";
import { useBarraDaEtapa } from "./BarraDaEtapa";

const AREAS: Array<{ id: AvisoDeQa["area"]; rotulo: string }> = [
  { id: "acessibilidade", rotulo: "Acessibilidade" },
  { id: "celular", rotulo: "Celular" },
  { id: "seo", rotulo: "SEO" },
];

/** O pedido de correção do build: um pedido curto e o fim do log (de 300 a 600 caracteres). */
export function pedidoDoBuild(log: string): string {
  const fim = String(log || "").trim().slice(-600);
  return `O build do site falhou. Corrija o erro e construa de novo.${fim ? `\nFim do log:\n${fim}` : ""}`;
}

/** O pedido de ajuste de uma área da revisão, com os avisos em lista. */
export function pedidoDaArea(area: string, avisos: string[]): string {
  return `Ajuste o site para resolver os avisos de ${area.toLowerCase()} da revisão:\n${avisos.map((a) => `- ${a}`).join("\n")}`;
}

/**
 * Etapa 7: revisão de acessibilidade, celular e SEO no HTML pré-renderizado.
 * É aviso, nunca trava: a equipe decide se pede ajuste ao diretor de site.
 * SIT2: o checklist de lançamento vem antes (o que falta e em que etapa).
 * UXS 30/09: todo erro tem um próximo clique. "Pedir correção ao diretor"
 * (build com erro) e "Pedir ajuste" (por área) só preenchem o campo do
 * diretor de site e abrem a lateral; enviar e o custo continuam com a pessoa.
 * A prévia também fica aqui (recolhida, o iframe só carrega aberto).
 */
export default function EtapaRevisao({ site, onIrPara, onPedirAoDiretor }: { site: LinhaDoSite; onIrPara: (etapa: string) => void; onPedirAoDiretor?: (texto: string) => void }) {
  const { clientId } = useMesa();
  const qc = useQueryClient();
  const avisarErro = useAvisarErro();
  const trabalhosQ = useTrabalhos(clientId, site.id);
  // SPV: só os trabalhos de código (a edição da prévia esperando não é montagem na fila).
  const trabalhos = trabalhosQ.data ? trabalhosDeCodigo(trabalhosQ.data.trabalhos) : [];
  const ultimo: TrabalhoDoMotor | null = trabalhos.find((t) => t.estado === "feito" && (Array.isArray(t.resultado.qa) || !!t.resultado.build)) || null;
  const revisando = trabalhos.some((t) => t.tipo === "revisar" && ehAberto(t.estado));
  // Motor desligado: a revisão espera na fila; a tela diz isso em vez de "Revisando" para sempre (QA 30/09).
  const naFilaParada = revisando && !!trabalhosQ.data && !trabalhosQ.data.vivo;
  const [pedindo, setPedindo] = useState(false);
  const qa = ultimo && Array.isArray(ultimo.resultado.qa) ? (ultimo.resultado.qa as AvisoDeQa[]) : [];
  const build = ultimo ? (ultimo.resultado.build as { ok?: boolean; log?: string } | undefined) : undefined;
  // UXM: as regras de UX da base (sob demanda); as críticas e altas pendentes pesam no checklist como item não obrigatório.
  const ux = useChecklistDeUx(site, trabalhos);
  const checklist = useChecklistDoSite(site, trabalhos, ux.graves);
  const obrigatorios = pendentesObrigatorios(checklist);
  const previa = previaAtual(comAEdicaoDaPrevia(trabalhosQ.data ? { trabalhos, conteudo: trabalhosQ.data.conteudo } : null));

  const revisar = async () => {
    setPedindo(true);
    try {
      await chamarMotor("pedir", { client_id: clientId, site_id: site.id, tipo: "revisar", instrucao: "Revisar acessibilidade, celular e SEO" });
      void qc.invalidateQueries({ queryKey: CHAVES.trabalhos(site.id) });
    } catch (e) {
      avisarErro(e, "A revisão não entrou na fila");
    } finally {
      setPedindo(false);
    }
  };

  useBarraDaEtapa({ estado: obrigatorios.length ? `${obrigatorios.length} ${obrigatorios.length === 1 ? "obrigatório faltando" : "obrigatórios faltando"}` : "Checklist obrigatório completo" });

  return (
    <div className="min-w-0 space-y-6" data-etapa-revisao="">
      <ChecklistDeLancamento itens={checklist} onIrPara={onIrPara} />
      <Secao
        titulo="Revisão"
        descricao={ultimo ? `${qa.length} aviso(s) · ${dataEHora(ultimo.terminado_em || ultimo.criado_em)}` : "Ainda não revisado"}
        ajuda="Regras fixas no HTML pronto: idioma, viewport, título e descrição no tamanho, og para compartilhar, um h1, texto alternativo, largura e altura das imagens, botões e links com nome e o conteúdo pré-renderizado. É aviso: para corrigir, Pedir ajuste leva os avisos para o diretor de site (você revisa e envia)."
        acao={
          <button type="button" className={botao.secundario} disabled={pedindo || revisando} onClick={() => void revisar()} data-revisar="">
            {pedindo || (revisando && !naFilaParada) ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <ScanSearch className="mr-1 h-3.5 w-3.5" />}
            {naFilaParada ? "Na fila: motor desligado" : revisando ? "Revisando" : "Revisar de novo"}
          </button>
        }
      >
        {!ultimo && (
          <EstadoVazio
            compacto
            titulo="A revisão roda sozinha ao fim de cada construção."
            acao={
              <button type="button" className={botao.discreto} onClick={() => onIrPara("construcao")} data-ir-para-construcao="">
                Ir para Construção
              </button>
            }
          />
        )}
        {build && build.ok === false && (
          <div className="flex min-w-0 flex-wrap items-start" data-build-com-erro="">
            <p className={juntar(texto.auxiliar, "mb-1 mr-2 min-w-0 flex-1 whitespace-normal text-destructive")}>O build falhou. {String(build.log || "").slice(-300)}</p>
            {onPedirAoDiretor && (
              <button type="button" className={juntar(botao.discreto, "shrink-0")} onClick={() => onPedirAoDiretor(pedidoDoBuild(String(build.log || "")))} data-pedir-correcao="">
                <MessageSquarePlus className="mr-1 h-3.5 w-3.5" />
                Pedir correção ao diretor
              </button>
            )}
          </div>
        )}
        {ultimo && build && build.ok !== false && !qa.length && (
          <p className={juntar(texto.corpo, "flex items-center text-primary")}>
            <CheckCircle2 className="mr-1.5 h-4 w-4" />
            Sem avisos
          </p>
        )}
        {qa.length > 0 &&
          AREAS.map((a) => {
            const itens = qa.filter((q) => q.area === a.id);
            if (!itens.length) return null;
            return (
              <div key={a.id} className="min-w-0">
                <div className="flex min-w-0 items-center">
                  <span className={juntar(texto.rotulo, "min-w-0 flex-1 truncate")}>
                    {a.rotulo} · {itens.length}
                  </span>
                  {onPedirAoDiretor && (
                    <button type="button" className={juntar(botao.discreto, "h-7 shrink-0 px-1.5 text-[12px]")} onClick={() => onPedirAoDiretor(pedidoDaArea(a.rotulo, itens.map((q) => q.texto)))} data-pedir-ajuste={a.id}>
                      Pedir ajuste
                    </button>
                  )}
                </div>
                <ul className={juntar(lista.aberta, lista.divisoria)}>
                  {itens.map((q, i) => (
                    <li key={i} className={juntar(lista.linha, texto.corpo, "whitespace-normal")}>
                      {q.texto}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
      </Secao>
      <ChecklistDeUx site={site} itens={ux.itens} onIrPara={onIrPara} />

      {/* A prévia a um toque daqui: recolhida de início, o iframe só carrega quando pedem. */}
      <Secao
        titulo="Prévia"
        descricao={previa ? (previa.preview_url && /trycloudflare|https:/.test(previa.preview_url) ? "Ao vivo" : "Só na máquina da agência") : "Sem prévia ainda"}
        recolher="mesa-site:revisao:previa"
        recolhidaDeInicio
      >
        {previa && previa.preview_url ? <PreviaNosAparelhos url={previa.preview_url} titulo={site.nome} /> : <EstadoVazio compacto titulo="A prévia aparece quando o motor começa a construir." />}
      </Secao>
    </div>
  );
}
