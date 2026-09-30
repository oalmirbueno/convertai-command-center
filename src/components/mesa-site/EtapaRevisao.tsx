import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CheckCircle2, Loader2, ScanSearch } from "lucide-react";
import { useMesa } from "@/components/mesa/MesaContexto";
import { useAvisarErro } from "@/components/mesa/Custo";
import Secao from "@/components/sistema/Secao";
import { EstadoVazio } from "@/components/sistema/Estados";
import { botao, juntar, lista, texto } from "@/components/sistema/estilos";
import { dataEHora } from "@/lib/mesa/api";
import { ehAberto, type TrabalhoDoMotor } from "../../../supabase/functions/_shared/motor-codigo";
import type { AvisoDeQa } from "../../../supabase/functions/_shared/site-metodo";
import { CHAVES, chamarMotor, type LinhaDoSite, useTrabalhos } from "./siteApi";
import ChecklistDeLancamento, { useChecklistDoSite } from "./ChecklistDeLancamento";

const AREAS: Array<{ id: AvisoDeQa["area"]; rotulo: string }> = [
  { id: "acessibilidade", rotulo: "Acessibilidade" },
  { id: "celular", rotulo: "Celular" },
  { id: "seo", rotulo: "SEO" },
];

/**
 * Etapa 7: revisão de acessibilidade, celular e SEO no HTML pré-renderizado.
 * É aviso, nunca trava: a equipe decide se pede ajuste ao diretor de site.
 * SIT2: o checklist de lançamento vem antes (o que falta e em que etapa).
 */
export default function EtapaRevisao({ site, onIrPara }: { site: LinhaDoSite; onIrPara: (etapa: string) => void }) {
  const { clientId } = useMesa();
  const qc = useQueryClient();
  const avisarErro = useAvisarErro();
  const trabalhosQ = useTrabalhos(clientId, site.id);
  const trabalhos = trabalhosQ.data ? trabalhosQ.data.trabalhos : [];
  const ultimo: TrabalhoDoMotor | null = trabalhos.find((t) => t.estado === "feito" && (Array.isArray(t.resultado.qa) || !!t.resultado.build)) || null;
  const revisando = trabalhos.some((t) => t.tipo === "revisar" && ehAberto(t.estado));
  // Motor desligado: a revisão espera na fila; a tela diz isso em vez de "Revisando" para sempre (QA 30/09).
  const naFilaParada = revisando && !!trabalhosQ.data && !trabalhosQ.data.vivo;
  const [pedindo, setPedindo] = useState(false);
  const qa = ultimo && Array.isArray(ultimo.resultado.qa) ? (ultimo.resultado.qa as AvisoDeQa[]) : [];
  const build = ultimo ? (ultimo.resultado.build as { ok?: boolean; log?: string } | undefined) : undefined;
  const checklist = useChecklistDoSite(site, trabalhos);

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

  return (
    <div className="min-w-0 space-y-6" data-etapa-revisao="">
      <ChecklistDeLancamento itens={checklist} onIrPara={onIrPara} />
      <Secao
        titulo="Revisão"
        descricao={ultimo ? `${qa.length} aviso(s) · ${dataEHora(ultimo.terminado_em || ultimo.criado_em)}` : "Ainda não revisado"}
        ajuda="Regras fixas no HTML pronto: idioma, viewport, título e descrição no tamanho, og para compartilhar, um h1, texto alternativo, largura e altura das imagens, botões e links com nome e o conteúdo pré-renderizado. É aviso: para corrigir, peça ao diretor de site."
        acao={
          <>
            <button type="button" className={juntar(botao.secundario, "mr-2")} disabled={pedindo || revisando} onClick={() => void revisar()} data-revisar="">
              {pedindo || (revisando && !naFilaParada) ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <ScanSearch className="mr-1 h-3.5 w-3.5" />}
              {naFilaParada ? "Na fila: motor desligado" : revisando ? "Revisando" : "Revisar de novo"}
            </button>
            <button type="button" className={botao.primario} onClick={() => onIrPara("publicacao")}>
              Seguir
              <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </button>
          </>
        }
      >
        {!ultimo && <EstadoVazio compacto titulo="A revisão roda sozinha ao fim de cada construção." />}
        {build && build.ok === false && <p className={juntar(texto.auxiliar, "whitespace-normal text-destructive")}>O build falhou; peça ao diretor de site para corrigir. {String(build.log || "").slice(-300)}</p>}
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
                <span className={juntar(texto.rotulo, "block")}>
                  {a.rotulo} · {itens.length}
                </span>
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
    </div>
  );
}
