import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { botao, juntar } from "@/components/sistema/estilos";
import { situacaoDoWorker } from "../../../../supabase/functions/_shared/render-do-editor";

/**
 * Estado da máquina de render (frente EDT, rodada 2). O render roda no worker
 * da máquina da agência (workers/render, Remotion). A tela diz ANTES de pedir
 * se ele está ligado, desligado ou se nunca foi ligado; a prévia do navegador
 * funciona sempre. Lê render_workers (a equipe lê) uma vez ao abrir e quando a
 * pessoa pede: sem laço.
 */

export type SituacaoDaMaquina = "ligado" | "desligado" | "nunca" | "sem_fila" | "lendo" | "erro";

export function useEstadoDaMaquina(): { situacao: SituacaoDaMaquina; vistoEm: string | null; ler: () => void } {
  const [estado, setEstado] = useState<{ situacao: SituacaoDaMaquina; vistoEm: string | null }>({ situacao: "lendo", vistoEm: null });
  const ler = useCallback(() => {
    setEstado((e) => ({ ...e, situacao: "lendo" }));
    void (supabase as any)
      .from("render_workers")
      .select("nome, visto_em")
      .order("visto_em", { ascending: false })
      .limit(1)
      .then((r: { data: { visto_em: string }[] | null; error: { code?: string; message?: string } | null }) => {
        if (r.error) {
          const semTabela = r.error.code === "42P01" || r.error.code === "PGRST205" || /does not exist|schema cache/i.test(String(r.error.message || ""));
          // Rede, permissão ou sessão vencida: não dá para dizer "nunca ligado" (seria falso). Diz que não conferiu.
          if (!semTabela) console.error("[editor] estado da máquina não lido", r.error);
          setEstado({ situacao: semTabela ? "sem_fila" : "erro", vistoEm: null });
          return;
        }
        const visto = r.data && r.data[0] ? r.data[0].visto_em : null;
        setEstado({ situacao: situacaoDoWorker(visto, Date.now()), vistoEm: visto });
      })
      .catch((erro: unknown) => {
        console.error("[editor] estado da máquina não lido", erro);
        setEstado({ situacao: "erro", vistoEm: null });
      });
  }, []);
  useEffect(() => ler(), [ler]);
  return { ...estado, ler };
}

const TEXTO: Record<SituacaoDaMaquina, string> = {
  ligado: "Render ligado",
  desligado: "Render desligado",
  nunca: "Render nunca ligado",
  sem_fila: "Fila de render não ativada",
  lendo: "Conferindo o render",
  erro: "Não deu para conferir o render",
};

const COR: Record<SituacaoDaMaquina, string> = {
  ligado: "bg-emerald-500",
  desligado: "bg-amber-500",
  nunca: "bg-amber-500",
  sem_fila: "bg-muted-foreground",
  lendo: "bg-muted-foreground",
  erro: "bg-destructive",
};

function haQuanto(iso: string | null): string {
  if (!iso) return "";
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (!isFinite(min) || min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  return h < 48 ? `há ${h} h` : `há ${Math.round(h / 24)} dias`;
}

/** Ponto colorido + texto curto; o "?" explica e ensina a ligar. */
export default function EstadoDaMaquina({ compacto = false, estado }: { compacto?: boolean; estado?: ReturnType<typeof useEstadoDaMaquina> }) {
  const proprio = useEstadoDaMaquina();
  const e = estado || proprio;
  return (
    <span className="inline-flex min-w-0 items-center text-[12px] text-muted-foreground" data-estado-da-maquina={e.situacao}>
      <span className={juntar("mr-1.5 inline-block h-2 w-2 shrink-0 rounded-full", COR[e.situacao])} aria-hidden="true" />
      {!compacto && (
        <span className="truncate">
          {TEXTO[e.situacao]}
          {e.situacao === "desligado" && e.vistoEm ? ` (visto ${haQuanto(e.vistoEm)})` : ""}
        </span>
      )}
      <button type="button" className={juntar(botao.icone, "ml-0.5 h-7 w-7")} onClick={e.ler} aria-label="Conferir de novo o render">
        <RefreshCw className="h-3.5 w-3.5" />
      </button>
      <AjudaRecolhida titulo="Render na máquina da agência">
        <span className="block">
          A prévia toca aqui no navegador, sempre. O arquivo final (MP4) sai do worker de render da máquina da agência, com a mesma composição da prévia.
          {e.situacao === "ligado"
            ? " Ele está ligado: o pedido começa em até 15 s."
            : e.situacao === "erro"
              ? " Agora não deu para ler o estado (rede ou sessão). Aperte o botão de reler; se continuar, entre de novo no painel."
              : " Desligado: o pedido espera na fila e roda quando a máquina ligar."}
        </span>
        <span className="mt-2 block font-medium">Como ligar (PowerShell, na pasta do painel)</span>
        <span className="block font-mono text-[11px] leading-5">
          cd workers\render
          <br />
          npm install
          <br />
          npx remotion browser ensure
          <br />
          $env:SUPABASE_URL = "https://jjjtkowvxemvituvywvf.supabase.co"
          <br />
          $env:SUPABASE_SERVICE_ROLE_KEY = "(a chave, só na sessão)"
          <br />
          npm run worker
        </span>
        <span className="mt-2 block">A chave fica só na janela aberta, nunca em arquivo. Detalhes em docs/video/EDITOR.md, seção 12.1.</span>
      </AjudaRecolhida>
    </span>
  );
}
