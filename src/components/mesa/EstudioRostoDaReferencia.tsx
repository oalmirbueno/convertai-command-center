import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FolderOpen, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { AjudaRecolhida, campo, juntar } from "@/components/sistema";
import { chamarFuncao, textoDoErro } from "@/lib/mesa/api";
import { gravarCopiasSemEsperar, urlLeve } from "@/lib/miniaturas";
import { novoId } from "./estudioUtil";
import EstudioEscolherFotoDoRosto, { MAX_ESCOLHIDAS, useEscolhidasDoRosto } from "./EstudioEscolherFotoDoRosto";

/**
 * Rosto na referência (frente R, acréscimo do dono, 26/09). Quando a
 * referência tem uma pessoa, a equipe escolhe de quem é o rosto: do cliente
 * (rostos autorizados do Contexto e clones da Mesa Foto), do dono ou da
 * equipe (os mesmos, das empresas internas) ou fotos escolhidas na hora. A
 * pessoa sai muito fiel; pose, ângulo e enquadramento seguem a arte.
 * Nenhum (o padrão) deixa a geração como hoje. Lembrado por trabalho
 * (direcao.rosto), grava pelo configurar, sem custo. Miniaturas próprias
 * (nunca a transformação do Storage).
 *
 * Frente R2 (26/09): em Fotos, "Escolher foto" abre as pastas do cliente e os
 * clones (inclusive as fotos geradas), de 1 a 3 fotos (fonte "escolhidas");
 * "Como a pessoa aparece" (texto curto e pílulas) vai ao gerador como pose e
 * expressão, mantendo a identidade.
 */

export type FonteDoRosto = "nenhum" | "cliente" | "equipe" | "fotos";
export type RostoEscolhido = {
  fonte: "cliente" | "equipe" | "fotos" | "escolhidas";
  id?: string;
  fotos?: string[];
  itens?: string[];
  como?: string;
  destacar?: boolean;
};
export type RostoDisponivel = { id: string; nome: string; url: string | null };

export const OPCOES_DO_ROSTO: { valor: FonteDoRosto; rotulo: string; dica: string }[] = [
  { valor: "nenhum", rotulo: "Nenhum", dica: "A pessoa da arte é genérica, como hoje." },
  { valor: "cliente", rotulo: "Cliente", dica: "Rosto autorizado do cliente (Contexto ou clone da Mesa Foto)." },
  { valor: "equipe", rotulo: "Equipe", dica: "Rosto do dono ou da equipe (empresas internas)." },
  { valor: "fotos", rotulo: "Fotos", dica: "Até 3 fotos das pastas ou dos clones, ou até 2 enviadas agora, com autorização de uso." },
];

export const AJUDA_DO_ROSTO =
  "Escolha de quem é o rosto da pessoa da arte. A geração mantém a identidade muito fiel (rosto, traços, pele, cabelo) e recria a pessoa na composição, na luz da arte, com a pose e a expressão que combinam com o layout. Em Fotos, busque em qualquer pasta do cliente ou nos clones. Em Como a pessoa aparece, peça sorrindo, de perfil, apontando para o título. Só entram rostos com autorização registrada. Nenhum deixa a arte como hoje.";

/** Pílulas de "como a pessoa aparece" (as mesmas do servidor, SUGESTOES_DO_COMO). */
export const SUGESTOES_DO_COMO = ["sorrindo", "séria confiante", "apontando para o título", "de perfil", "meio corpo", "rosto em destaque"];
export const MAX_COMO = 160;

const ITEM = /^(?:[iwa]:[0-9a-f-]{36}|k:[0-9a-f-]{36}:[0-9a-f-]{36})$/i;

/** Liga ou desliga uma pílula no texto (lista separada por vírgula), no máximo MAX_COMO. */
export function alternarNoComo(atual: string, sugestao: string): string {
  const partes = (atual || "").split(",").map((p) => p.trim()).filter(Boolean);
  const i = partes.map((p) => p.toLowerCase()).indexOf(sugestao.toLowerCase());
  if (i >= 0) partes.splice(i, 1);
  else partes.push(sugestao);
  return partes.join(", ").slice(0, MAX_COMO);
}

const comoLido = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, MAX_COMO) : "");

/** O rosto do trabalho lido com cuidado (igual ao servidor, sem a checagem de pasta). */
export function rostoDoTrabalho(direcao: unknown): RostoEscolhido | null {
  const r = direcao && typeof direcao === "object" ? (direcao as Record<string, unknown>).rosto : null;
  if (!r || typeof r !== "object") return null;
  const o = r as Record<string, unknown>;
  const como = comoLido(o.como);
  const extra = como ? { como } : {};
  if (o.fonte === "fotos") {
    const fotos = (Array.isArray(o.fotos) ? o.fotos : []).filter((x): x is string => typeof x === "string" && !!x).slice(0, 2);
    return fotos.length ? { fonte: "fotos", fotos, destacar: o.destacar === true, ...extra } : null;
  }
  if (o.fonte === "escolhidas") {
    const itens = (Array.isArray(o.itens) ? o.itens : []).filter((x): x is string => typeof x === "string" && ITEM.test(x)).slice(0, MAX_ESCOLHIDAS);
    return itens.length ? { fonte: "escolhidas", itens, destacar: o.destacar === true, ...extra } : null;
  }
  if ((o.fonte === "cliente" || o.fonte === "equipe") && typeof o.id === "string" && /^[rc]:[0-9a-f-]{36}$/i.test(o.id)) {
    return { fonte: o.fonte, id: o.id, destacar: o.destacar === true, ...extra };
  }
  return null;
}

/** Corpo do configurar: null tira o rosto (Nenhum). */
export function corpoDoRosto(rosto: RostoEscolhido | null): Record<string, unknown> {
  return { conjunto: { rosto } };
}

/** O segmento da tela para o rosto salvo: fotos enviadas e escolhidas ficam em Fotos. */
export const segmentoDoRosto = (r: RostoEscolhido | null): FonteDoRosto => (!r ? "nenhum" : r.fonte === "escolhidas" ? "fotos" : r.fonte);

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
  const [fonte, setFonte] = useState<FonteDoRosto>(segmentoDoRosto(salvo));
  const [salvando, setSalvando] = useState(false);
  const [autorizado, setAutorizado] = useState(false);
  const [navegador, setNavegador] = useState(false);
  const [como, setComo] = useState(salvo && salvo.como ? salvo.como : "");
  const entrada = useRef<HTMLInputElement>(null);
  const chaveDoSalvo = salvo ? `${salvo.fonte}:${salvo.id || (salvo.fotos || salvo.itens || []).join(",")}` : "nenhum";
  useEffect(() => setFonte(segmentoDoRosto(salvo)), [chaveDoSalvo]); // eslint-disable-line react-hooks/exhaustive-deps
  const comoSalvo = salvo && salvo.como ? salvo.como : "";
  useEffect(() => setComo(comoSalvo), [comoSalvo]);

  const itensEscolhidos = salvo && salvo.fonte === "escolhidas" ? salvo.itens || [] : [];
  const escolhidas = useEscolhidasDoRosto(trabalhoId, itensEscolhidos);

  const lista = useQuery({
    queryKey: ["estudio", "rostos", trabalhoId],
    enabled: fonte === "cliente" || fonte === "equipe",
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const d = await chamarFuncao<{ cliente?: RostoDisponivel[]; equipe?: RostoDisponivel[] }>("estudio-arte", { acao: "rostos", trabalho_id: trabalhoId });
      return { cliente: (d && d.cliente) || [], equipe: (d && d.equipe) || [] };
    },
  });

  /** Mantém o "como" e o "destacar" do rosto atual ao trocar de rosto. */
  const comExtras = (r: RostoEscolhido): RostoEscolhido => {
    const saida: RostoEscolhido = { ...r, destacar: r.destacar !== undefined ? r.destacar : !!(salvo && salvo.destacar) };
    const c = r.como !== undefined ? r.como : salvo && salvo.como ? salvo.como : "";
    if (c) saida.como = c;
    else delete saida.como;
    return saida;
  };

  const gravar = async (r: RostoEscolhido | null): Promise<boolean> => {
    if (bloqueado || salvando) return false;
    setSalvando(true);
    try {
      await onSalvar(corpoDoRosto(r));
      return true;
    } catch (e) {
      toast.error("Rosto não salvo", { description: textoDoErro(e) });
      return false;
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
      await onSalvar(corpoDoRosto(comExtras({ fonte: "fotos", fotos: caminhos })));
    } catch (e) {
      toast.error("Fotos não salvas", { description: textoDoErro(e) });
    } finally {
      setSalvando(false);
      if (entrada.current) entrada.current.value = "";
    }
  };

  const usarEscolhidas = async (itens: string[]) => {
    if (await gravar(comExtras({ fonte: "escolhidas", itens: itens.slice(0, MAX_ESCOLHIDAS) }))) setNavegador(false);
  };

  const salvarComo = (novo: string) => {
    if (!salvo) return;
    const limpo = comoLido(novo);
    if (limpo === comoSalvo) return;
    const r: RostoEscolhido = { ...salvo };
    if (limpo) r.como = limpo;
    else delete r.como;
    void gravar(r);
  };

  const disponiveis = fonte === "cliente" ? (lista.data ? lista.data.cliente : []) : fonte === "equipe" ? (lista.data ? lista.data.equipe : []) : [];
  const botaoPequeno = "inline-flex h-7 items-center rounded-md border border-border px-2 text-[11.5px] text-foreground hover:bg-secondary disabled:opacity-50";

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
                      onClick={() => void gravar(comExtras({ fonte: fonte as "cliente" | "equipe", id: r.id }))}
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
            <div className="flex min-w-0" data-escolhidas="enviadas">
              {(salvo.fotos || []).map((c) => (
                <span key={c} className="mr-1.5">
                  <Miniatura bucket="mesa" caminho={c} alt="Foto do rosto" />
                </span>
              ))}
            </div>
          )}
          {itensEscolhidos.length > 0 && (
            <div className="flex min-w-0" data-escolhidas="pastas">
              {itensEscolhidos.map((id) => {
                const e = (escolhidas.data || []).find((x) => x.id === id);
                return (
                  <span key={id} className="mr-1.5" title={e && !e.disponivel ? "Indisponível: apagada ou sem autorização válida" : (e && e.nome) || "Foto do rosto"}>
                    {e && !e.disponivel ? (
                      <span className="block h-12 w-10 rounded border border-dashed border-destructive/60" aria-label="Foto indisponível" />
                    ) : (
                      <Miniatura url={e ? e.url : null} alt={(e && e.nome) || "Foto do rosto"} />
                    )}
                  </span>
                );
              })}
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
          <div className="flex min-w-0 flex-wrap">
            <button type="button" disabled={bloqueado || salvando} onClick={() => setNavegador(true)} className={juntar(botaoPequeno, "mb-1 mr-1.5")}>
              <FolderOpen className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
              {itensEscolhidos.length ? "Trocar foto" : "Escolher foto"}
            </button>
            <button
              type="button"
              disabled={bloqueado || salvando || !autorizado}
              onClick={() => entrada.current && entrada.current.click()}
              className={juntar(botaoPequeno, "mb-1")}
              title="Enviar até 2 fotos do computador"
            >
              <Upload className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
              {salvo && salvo.fonte === "fotos" ? "Trocar fotos" : "Enviar"}
            </button>
          </div>
          <EstudioEscolherFotoDoRosto
            aberto={navegador}
            onFechar={() => setNavegador(false)}
            trabalhoId={trabalhoId}
            clientId={clientId}
            iniciais={itensEscolhidos}
            autorizado={autorizado}
            onAutorizado={setAutorizado}
            onConfirmar={usarEscolhidas}
            salvando={salvando}
          />
        </div>
      )}

      {salvo && fonte !== "nenhum" && (
        <div className="mt-2 min-w-0" data-controle="como-a-pessoa-aparece">
          <label htmlFor={`como-${trabalhoId}`} className="mb-1 block text-[11px] text-muted-foreground">
            Como a pessoa aparece
          </label>
          <input
            id={`como-${trabalhoId}`}
            value={como}
            maxLength={MAX_COMO}
            disabled={bloqueado || salvando}
            placeholder="Ex.: sorrindo, olhando para o título"
            onChange={(e) => setComo(e.target.value)}
            onBlur={() => salvarComo(como)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                salvarComo(como);
              }
            }}
            className={juntar(campo, "h-8 text-[12px]")}
          />
          <div className="mt-1 flex min-w-0 flex-wrap" role="group" aria-label="Sugestões de pose e expressão">
            {SUGESTOES_DO_COMO.map((s) => {
              const ligada = como.toLowerCase().split(",").map((p) => p.trim()).indexOf(s.toLowerCase()) >= 0;
              return (
                <button
                  key={s}
                  type="button"
                  aria-pressed={ligada}
                  disabled={bloqueado || salvando}
                  onClick={() => {
                    const novo = alternarNoComo(como, s);
                    setComo(novo);
                    salvarComo(novo);
                  }}
                  className={`mb-1 mr-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors disabled:opacity-50 ${ligada ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}
                  data-compacto
                >
                  {s}
                </button>
              );
            })}
          </div>
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
