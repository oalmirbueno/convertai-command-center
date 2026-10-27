import { Check, ExternalLink, Flame, Sparkles, Wand2 } from "lucide-react";
import { chamarFuncao } from "@/lib/mesa/api";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { botao, juntar, texto } from "@/components/sistema/estilos";
import { BotaoComCusto } from "./Custo";
import { useMesa } from "./MesaContexto";
import { partesDaBuscaViral } from "./mesaV4Api";
import { chaveDoEstudioDaPauta } from "./modoDaPauta";
import type { FocoDaBuscaViral, ReferenciaViral } from "../../../supabase/functions/agente-calendario/modulos/referencias-virais-de-video";

/**
 * Buscar referências virais (27/10/2026): vídeos curtos reais feitos com IA e "satisfatórios" do universo do
 * cliente (nicho, assuntos em alta e ganchos que vencem), pela pesquisa na web do servidor (custo antes do
 * clique). Cada cartão: o link conferido na busca, o porquê de funcionar, o gancho e a estrutura; "Usar como
 * referência" vira as cenas da composição com as imagens do próprio cliente (a forma, nunca o conteúdo).
 * Os cartões ficam guardados na tela da pauta.
 */

export interface RespostaDaBuscaViral {
  referencias: ReferenciaViral[];
  foco: FocoDaBuscaViral;
  custo_usd?: number;
  aviso?: string;
}

export const buscarReferenciasVirais = (clientId: string, taskId: string, foco: FocoDaBuscaViral) =>
  chamarFuncao<RespostaDaBuscaViral>("agente-calendario", { acao: "video_referencias_virais", client_id: clientId, task_id: taskId, foco });

const FOCOS: Array<{ valor: FocoDaBuscaViral; rotulo: string }> = [
  { valor: "ambos", rotulo: "Os dois" },
  { valor: "ia", rotulo: "Feitos com IA" },
  { valor: "satisfatorio", rotulo: "Satisfatórios" },
];

const PLATAFORMA: Record<string, string> = { instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube", outro: "Web" };

export default function ReferenciasVirais({ taskId, emUso, onUsar }: { taskId: string; emUso: string | null; onUsar: (r: ReferenciaViral) => void }) {
  const { clientId, catalogo } = useMesa();
  const chave = (parte: string) => chaveDoEstudioDaPauta(clientId, taskId, parte);
  const [foco, setFoco] = useEstadoDaTela<FocoDaBuscaViral>(chave("viral-foco"), "ambos", { validar: (v) => v === "ambos" || v === "ia" || v === "satisfatorio" });
  const [achados, setAchados] = useEstadoDaTela<{ referencias: ReferenciaViral[]; aviso: string | null; em: string } | null>(chave("viral-achados"), null, { validar: (v) => v === null || (!!v && typeof v === "object" && Array.isArray((v as { referencias?: unknown }).referencias)) });
  return (
    <div className="min-w-0" data-referencias-virais={achados ? achados.referencias.length : "nenhuma"}>
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        <SeletorCompacto rotulo="Que tipo de viral" opcoes={FOCOS} valor={foco} onEscolher={(v) => setFoco(v as FocoDaBuscaViral)} />
        <BotaoComCusto
          rotulo={<Flame className="h-4 w-4" aria-label={achados ? "Buscar referências virais de novo" : "Buscar referências virais"} />}
          titulo="Buscar referências virais"
          descricao="Pesquisa na web vídeos curtos reais que viralizaram (feitos com IA ou satisfatórios) no universo deste cliente, com os assuntos em alta e os ganchos que vencem no nicho. Só entra vídeo com link que a busca citou. Nada é gerado."
          partes={() => partesDaBuscaViral(catalogo)}
          executar={async () => {
            const r = await buscarReferenciasVirais(clientId, taskId, foco);
            setAchados({ referencias: r.referencias || [], aviso: r.aviso || null, em: new Date().toISOString() });
            return r;
          }}
          variant="ghost"
          className="ml-auto h-8 px-2"
        />
      </div>
      {achados && achados.aviso && !achados.referencias.length && <p className={juntar(texto.auxiliar, "mt-2")} role="status">{achados.aviso}</p>}
      {achados && achados.referencias.length > 0 && (
        <ul className="mt-2 min-w-0 divide-y divide-border" aria-label="Referências virais">
          {achados.referencias.map((r) => {
            const usando = emUso === r.link;
            return (
              <li key={r.id} className="min-w-0 py-2" data-referencia-viral={r.id}>
                <div className="flex min-w-0 items-center">
                  {r.tipo === "ia" ? <Sparkles className="mr-1 h-3.5 w-3.5 shrink-0 text-primary" aria-label="Feito com IA" /> : <Flame className="mr-1 h-3.5 w-3.5 shrink-0 text-warning" aria-label="Satisfatório" />}
                  <p className="min-w-0 flex-1 truncate text-[13px] font-medium" title={r.titulo}>{r.titulo}</p>
                  <a href={r.link} target="_blank" rel="noreferrer noopener" className={botao.icone} aria-label={`Abrir ${r.titulo}`} title={`Abrir no ${PLATAFORMA[r.plataforma] || "navegador"}`}>
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  </a>
                </div>
                <p className={juntar(texto.auxiliar, "[overflow-wrap:anywhere]")}>
                  {PLATAFORMA[r.plataforma] || "Web"}
                  {r.sinal ? ` · ${r.sinal}` : ""} · {r.estrutura.length} cenas · {r.estrutura.reduce((s, b) => s + b.segundos, 0)} s
                </p>
                {r.porque_funciona && <p className="mt-1 text-[12px] leading-snug [overflow-wrap:anywhere]">{r.porque_funciona}</p>}
                {r.gancho && <p className={juntar(texto.auxiliar, "mt-0.5 [overflow-wrap:anywhere]")}>Gancho: {r.gancho}</p>}
                <div className="mt-1 flex justify-end">
                  <button type="button" className={juntar(botao.icone, usando && "text-primary")} onClick={() => onUsar(r)} aria-pressed={usando} aria-label={usando ? `Em uso: ${r.titulo}` : `Usar como referência: ${r.titulo}`} title={usando ? "Em uso: as cenas seguem esta estrutura (clique para aplicar de novo)" : "Usar como referência: as cenas seguem esta estrutura com as imagens do cliente"} data-usar-referencia-viral={r.id}>
                    {usando ? <Check className="h-4 w-4" aria-hidden="true" /> : <Wand2 className="h-4 w-4" aria-hidden="true" />}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
