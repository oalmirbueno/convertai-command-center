import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { AjudaRecolhida } from "@/components/sistema";
import { chamarFuncao, textoDoErro } from "@/lib/mesa/api";
import { gravarCopiasSemEsperar, urlLeve } from "@/lib/miniaturas";
import { novoId } from "./estudioUtil";

/**
 * Rosto na referência (frente R, acréscimo do dono, 26/09). Quando a
 * referência tem uma pessoa, a equipe escolhe de quem é o rosto: do cliente
 * (rostos autorizados do Contexto e clones da Mesa Foto), do dono ou da
 * equipe (os mesmos, das empresas internas) ou fotos escolhidas na hora. A
 * pessoa sai muito fiel; pose, ângulo e enquadramento seguem a arte.
 * Nenhum (o padrão) deixa a geração como hoje. Lembrado por trabalho
 * (direcao.rosto), grava pelo configurar, sem custo. Miniaturas próprias
 * (nunca a transformação do Storage).
 */

export type FonteDoRosto = "nenhum" | "cliente" | "equipe" | "fotos";
export type RostoEscolhido = { fonte: "cliente" | "equipe" | "fotos"; id?: string; fotos?: string[]; destacar?: boolean };
export type RostoDisponivel = { id: string; nome: string; url: string | null };

export const OPCOES_DO_ROSTO: { valor: FonteDoRosto; rotulo: string; dica: string }[] = [
  { valor: "nenhum", rotulo: "Nenhum", dica: "A pessoa da arte é genérica, como hoje." },
  { valor: "cliente", rotulo: "Cliente", dica: "Rosto autorizado do cliente (Contexto ou clone da Mesa Foto)." },
  { valor: "equipe", rotulo: "Equipe", dica: "Rosto do dono ou da equipe (empresas internas)." },
  { valor: "fotos", rotulo: "Fotos", dica: "Até 2 fotos escolhidas agora, com autorização de uso." },
];

export const AJUDA_DO_ROSTO =
  "Escolha de quem é o rosto da pessoa da arte. A geração mantém a identidade muito fiel (rosto, traços, pele, cabelo) e adapta pose, ângulo, expressão e enquadramento à referência. Só entram rostos com autorização registrada. Nenhum deixa a arte como hoje.";

/** O rosto do trabalho lido com cuidado (igual ao servidor, sem a checagem de pasta). */
export function rostoDoTrabalho(direcao: unknown): RostoEscolhido | null {
  const r = direcao && typeof direcao === "object" ? (direcao as Record<string, unknown>).rosto : null;
  if (!r || typeof r !== "object") return null;
  const o = r as Record<string, unknown>;
  if (o.fonte === "fotos") {
    const fotos = (Array.isArray(o.fotos) ? o.fotos : []).filter((x): x is string => typeof x === "string" && !!x).slice(0, 2);
    return fotos.length ? { fonte: "fotos", fotos, destacar: o.destacar === true } : null;
  }
  if ((o.fonte === "cliente" || o.fonte === "equipe") && typeof o.id === "string" && /^[rc]:[0-9a-f-]{36}$/i.test(o.id)) {
    return { fonte: o.fonte, id: o.id, destacar: o.destacar === true };
  }
  return null;
}

/** Corpo do configurar: null tira o rosto (Nenhum). */
export function corpoDoRosto(rosto: RostoEscolhido | null): Record<string, unknown> {
  return { conjunto: { rosto } };
}

function Miniatura({ bucket, caminho, url, alt }: { bucket?: string; caminho?: string; url?: string | null; alt: string }) {
  const leve = useQuery({
    queryKey: ["mesa", "url-leve", bucket, caminho],
    enabled: !url && !!bucket && !!caminho,
    staleTime: 45 * 60_000,
    queryFn: async () => (await urlLeve(bucket!, caminho!)).url,
  });
  const src = url || leve.data || null;
  if (!src) return <div className="h-12 w-10 shrink-0 animate-pulse rounded bg-secondary/60" />;
  return <img src={src} alt={alt} loading="lazy" className="h-12 w-10 shrink-0 rounded object-cover" />;
}

const EXTENSOES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export default function EstudioRostoDaReferencia({
  trabalhoId,
  clientId,
  direcao,
  bloqueado = false,
  onSalvar,
}: {
  trabalhoId: string;
  clientId: string;
  direcao: unknown;
  bloqueado?: boolean;
  onSalvar: (corpo: Record<string, unknown>) => Promise<void>;
}) {
  const salvo = rostoDoTrabalho(direcao);
  const [fonte, setFonte] = useState<FonteDoRosto>(salvo ? salvo.fonte : "nenhum");
  const [salvando, setSalvando] = useState(false);
  const [autorizado, setAutorizado] = useState(false);
  const entrada = useRef<HTMLInputElement>(null);
  const chaveDoSalvo = salvo ? `${salvo.fonte}:${salvo.id || (salvo.fotos || []).join(",")}` : "nenhum";
  useEffect(() => setFonte(salvo ? salvo.fonte : "nenhum"), [chaveDoSalvo]); // eslint-disable-line react-hooks/exhaustive-deps

  const lista = useQuery({
    queryKey: ["estudio", "rostos", trabalhoId],
    enabled: fonte === "cliente" || fonte === "equipe",
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const d = await chamarFuncao<{ cliente?: RostoDisponivel[]; equipe?: RostoDisponivel[] }>("estudio-arte", { acao: "rostos", trabalho_id: trabalhoId });
      return { cliente: (d && d.cliente) || [], equipe: (d && d.equipe) || [] };
    },
  });

  const gravar = async (r: RostoEscolhido | null) => {
    if (bloqueado || salvando) return;
    setSalvando(true);
    try {
      await onSalvar(corpoDoRosto(r));
    } catch (e) {
      toast.error("Rosto não salvo", { description: textoDoErro(e) });
    } finally {
      setSalvando(false);
    }
  };

  const escolherFonte = (f: FonteDoRosto) => {
    if (bloqueado || salvando) return;
    setFonte(f);
    if (f === "nenhum" && salvo) void gravar(null);
  };

  const subir = async (arquivos: FileList | null) => {
    const lista2 = Array.from(arquivos || []).slice(0, 2);
    if (!lista2.length) return;
    if (!autorizado) {
      toast.error("Confirme a autorização de uso da imagem antes.");
      return;
    }
    setSalvando(true);
    try {
      const caminhos: string[] = [];
      for (const a of lista2) {
        const ext = EXTENSOES[a.type];
        if (!ext) throw new Error("Envie a foto em PNG, JPG ou WEBP.");
        const caminho = `${clientId}/estudio/rostos/${novoId()}.${ext}`;
        const { error } = await supabase.storage.from("mesa").upload(caminho, a, { contentType: a.type, upsert: false });
        if (error) throw error;
        gravarCopiasSemEsperar("mesa", caminho, a, { nome: a.name, mime: a.type });
        caminhos.push(caminho);
      }
      await onSalvar(corpoDoRosto({ fonte: "fotos", fotos: caminhos, destacar: !!(salvo && salvo.destacar) }));
    } catch (e) {
      toast.error("Fotos não salvas", { description: textoDoErro(e) });
    } finally {
      setSalvando(false);
      if (entrada.current) entrada.current.value = "";
    }
  };

  const disponiveis = fonte === "cliente" ? (lista.data ? lista.data.cliente : []) : fonte === "equipe" ? (lista.data ? lista.data.equipe : []) : [];

  return (
    <div className="min-w-0" data-controle="rosto-da-referencia">
      <div className="mb-1 flex min-w-0 items-center">
        <p className="min-w-0 flex-1 truncate text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Rosto</p>
        <AjudaRecolhida rotulo="O que faz o Rosto">{AJUDA_DO_ROSTO}</AjudaRecolhida>
        {salvando && <Loader2 className="ml-1 h-3 w-3 shrink-0 animate-spin" aria-label="Salvando o rosto" />}
      </div>
      <div role="radiogroup" aria-label="Rosto da pessoa da arte" className="grid grid-cols-4 gap-0.5 rounded-md border border-border bg-background p-0.5">
        {OPCOES_DO_ROSTO.map((o) => {
          const marcada = o.valor === fonte;
          return (
            <button
              key={o.valor}
              type="button"
              role="radio"
              aria-checked={marcada}
              title={o.dica}
              disabled={bloqueado || salvando}
              onClick={() => escolherFonte(o.valor)}
              className={`h-6 min-w-0 truncate rounded px-1 text-[11px] transition-colors disabled:opacity-50 ${marcada ? "bg-primary font-medium text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {o.rotulo}
            </button>
          );
        })}
      </div>

      {(fonte === "cliente" || fonte === "equipe") && (
        <div className="mt-1.5 min-w-0">
          {lista.isLoading && <p className="text-[10.5px] text-muted-foreground">Carregando rostos...</p>}
          {lista.isError && <p className="text-[10.5px] text-destructive">Não foi possível ler os rostos.</p>}
          {lista.data && disponiveis.length === 0 && (
            <p className="text-[10.5px] leading-snug text-muted-foreground">
              Nenhum rosto autorizado. Registre em Contexto, Rosto, ou crie um clone na Mesa Foto.
            </p>
          )}
          {disponiveis.length > 0 && (
            <ul className="flex min-w-0 flex-wrap gap-1.5">
              {disponiveis.map((r) => {
                const escolhido = !!salvo && salvo.fonte === fonte && salvo.id === r.id;
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      aria-pressed={escolhido}
                      title={r.nome}
                      disabled={bloqueado || salvando}
                      onClick={() => void gravar({ fonte: fonte as "cliente" | "equipe", id: r.id, destacar: !!(salvo && salvo.destacar) })}
                      className={`flex max-w-[88px] flex-col items-center rounded-md border p-0.5 disabled:opacity-50 ${escolhido ? "border-primary ring-1 ring-primary" : "border-border"}`}
                    >
                      <Miniatura url={r.url} alt={r.nome} />
                      <span className="mt-0.5 w-full truncate text-[10px] text-muted-foreground">{r.nome}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {fonte === "fotos" && (
        <div className="mt-1.5 min-w-0 space-y-1">
          {salvo && salvo.fonte === "fotos" && (
            <div className="flex min-w-0 gap-1.5">
              {(salvo.fotos || []).map((c) => <Miniatura key={c} bucket="mesa" caminho={c} alt="Foto do rosto" />)}
            </div>
          )}
          <label className="flex items-start gap-1.5 text-[10.5px] leading-snug text-muted-foreground">
            <Checkbox checked={autorizado} onCheckedChange={(v) => setAutorizado(v === true)} className="mt-px h-3.5 w-3.5" />
            <span>Tenho a autorização de uso da imagem desta pessoa.</span>
          </label>
          <input
            ref={entrada}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            className="hidden"
            onChange={(e) => void subir(e.target.files)}
          />
          <button
            type="button"
            disabled={bloqueado || salvando || !autorizado}
            onClick={() => entrada.current && entrada.current.click()}
            className="inline-flex h-7 items-center rounded-md border border-border px-2 text-[11.5px] text-foreground hover:bg-secondary disabled:opacity-50"
          >
            <Upload className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            {salvo && salvo.fonte === "fotos" ? "Trocar fotos" : "Escolher até 2 fotos"}
          </button>
        </div>
      )}

      {salvo && fonte !== "nenhum" && (
        <label className="mt-1.5 flex min-w-0 items-center text-[11.5px] text-foreground">
          <Switch
            checked={!!salvo.destacar}
            disabled={bloqueado || salvando}
            onCheckedChange={(v) => void gravar({ ...salvo, destacar: v === true })}
            aria-label="Destacar o rosto"
          />
          <span className="ml-2 truncate">Destacar o rosto</span>
        </label>
      )}
    </div>
  );
}
