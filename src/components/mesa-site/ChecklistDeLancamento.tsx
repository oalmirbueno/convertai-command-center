import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Circle, CircleAlert } from "lucide-react";
import Secao from "@/components/sistema/Secao";
import { useKitDaMesa } from "@/components/mesa/kitDaMesa";
import { botao, etiqueta, juntar, lista, texto } from "@/components/sistema/estilos";
import { checklistDeLancamento, type ItemDoChecklist, pendentesObrigatorios } from "../../../supabase/functions/_shared/site-lancamento";
import type { AvisoDeQa } from "../../../supabase/functions/_shared/site-metodo";
import type { TrabalhoDoMotor } from "../../../supabase/functions/_shared/motor-codigo";
import { CHAVES, chamarSite, type LinhaDoSite, montadoDepoisDasMudancas, secoesConstruidas } from "./siteApi";
import { estadoDaLinha } from "./estadoDoSite";

const ROTULO_DA_ETAPA: Record<string, string> = { briefing: "Briefing", direcao: "Direção", conteudo: "Conteúdo", imagens: "Imagens", integracoes: "Integrações e SEO", construcao: "Construção", revisao: "Revisão", publicacao: "Publicação" };

/** O checklist do site (puro sobre o que a tela já tem; a montagem da linha é a mesma da barra das etapas). UXM: `pendenciasDeUx` (críticas e altas) vira um item não obrigatório. */
export function useChecklistDoSite(site: LinhaDoSite, trabalhos: TrabalhoDoMotor[], pendenciasDeUx?: number | null): ItemDoChecklist[] {
  const kit = useKitDaMesa();
  const publicacao = useQuery({ queryKey: CHAVES.publicacao(site.id), queryFn: () => chamarSite<{ dominio: string | null; estado: string }>("publicacao_estado", { site_id: site.id }) });
  return useMemo(() => {
    const ultimo = trabalhos.find((t) => t.estado === "feito" && (Array.isArray(t.resultado.qa) || !!t.resultado.build)) || null;
    const qa = ultimo && Array.isArray(ultimo.resultado.qa) ? (ultimo.resultado.qa as AvisoDeQa[]) : [];
    const build = ultimo ? (ultimo.resultado.build as { ok?: boolean } | undefined) : undefined;
    return checklistDeLancamento(
      estadoDaLinha(site, {
        construidas: secoesConstruidas(trabalhos),
        buildOk: build ? build.ok !== false : null,
        avisosDeQa: qa.length,
        temLogo: !!(kit.data && (kit.data.logo_path || kit.data.logo_file_id)),
        dominio: publicacao.data ? publicacao.data.dominio : null,
        dominioVerificado: !!publicacao.data && publicacao.data.estado === "verificado",
        construidoDepoisDasMudancas: montadoDepoisDasMudancas(site, trabalhos),
        pendenciasDeUx: pendenciasDeUx === undefined ? null : pendenciasDeUx,
      }),
    );
  }, [site, trabalhos, publicacao.data, kit.data, pendenciasDeUx]);
}

/**
 * Checklist de lançamento (SIT2): o que falta para o site ir ao ar, com a
 * etapa de cada item. Obrigatório aparece primeiro; é aviso, nunca trava (a
 * Publicação mostra os obrigatórios no Confirmar).
 */
export default function ChecklistDeLancamento({ itens, onIrPara }: { itens: ItemDoChecklist[]; onIrPara: (etapa: string) => void }) {
  const feitos = itens.filter((i) => i.ok).length;
  const obrigatorios = pendentesObrigatorios(itens);
  const ordenados = itens.slice().sort((a, b) => Number(a.ok) - Number(b.ok) || Number(b.obrigatorio) - Number(a.obrigatorio));
  return (
    <Secao
      titulo="Checklist de lançamento"
      descricao={`${feitos} de ${itens.length}${obrigatorios.length ? ` · ${obrigatorios.length} obrigatório(s)` : ""}`}
      ajuda="Tudo o que um site premium precisa antes de ir ao ar: mapa e copy, seções construídas, build e revisão, SEO e schema, um jeito de falar com o cliente, LGPD quando há rastreio, domínio e DNS. Obrigatório é o mínimo; o resto é recomendação. Nada trava: a publicação pede Confirmar com a lista."
      recolher="mesa-site:revisao:checklist"
    >
      <ul className={juntar(lista.aberta, lista.divisoria)} data-checklist-de-lancamento="">
        {ordenados.map((i) => (
          <li key={i.id} className={lista.linha} data-item-do-checklist={i.id} data-ok={i.ok ? "sim" : "nao"}>
            {i.ok ? <CheckCircle2 className="mr-2 h-4 w-4 shrink-0 text-primary" aria-label="Pronto" /> : i.obrigatorio ? <CircleAlert className="mr-2 h-4 w-4 shrink-0 text-amber-600" aria-label="Falta (obrigatório)" /> : <Circle className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" aria-label="Falta" />}
            <span className="mr-2 min-w-0 flex-1">
              <span className={juntar(texto.corpo, "block truncate")}>{i.rotulo}</span>
              {i.detalhe && !i.ok && <span className={juntar(texto.auxiliar, "block truncate")}>{i.detalhe}</span>}
            </span>
            {i.obrigatorio && !i.ok && <span className={juntar(etiqueta, "mr-1 bg-amber-500/15 text-amber-700 dark:text-amber-400")}>obrigatório</span>}
            {!i.ok && (
              <button type="button" className={botao.discreto} onClick={() => onIrPara(i.etapa)}>
                {ROTULO_DA_ETAPA[i.etapa] || i.etapa}
              </button>
            )}
          </li>
        ))}
      </ul>
    </Secao>
  );
}
