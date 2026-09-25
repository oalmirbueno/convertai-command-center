import { useMemo, useRef, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Library, Link2, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMesa } from "@/components/mesa/MesaContexto";
import ReferenciasDoEstudio, { type AlvoDasReferencias } from "@/components/mesa/ReferenciasDoEstudio";
import type { Trabalho } from "@/components/mesa/useItensDoMes";
import { adicionarPin, ehLinkDePin } from "@/lib/mesa/referencias";
import { chamarFuncao, textoDoErro } from "@/lib/mesa/api";
import {
  capaDaReferencia,
  chavesAds,
  estiloDaReferencia,
  lerReferencias,
  levarReferenciaAoEstudio,
  linkValido,
  nomeDoNicho,
  ordenarReferencias,
  rotuloDaOrigem,
  type ReferenciaAds,
} from "./adsApi";
import { Foto, pilula } from "./Comuns";

/**
 * Referências do criativo no Estúdio Ads (pedido do dono, 25/09): mandar uma
 * referência ali mesmo (enviar imagem ou colar link, Pinterest inclusive) e
 * escolher do banco de anúncios da Mesa Ads (biblioteca da agência, padrões
 * do nicho, anúncios próprios, links), além das abas de sempre do Estúdio
 * (cliente, Workspace, banco da agência e Pinterest). A escolhida entra nas
 * referências do criativo pelo "configurar" do estudio-arte e o gerador a
 * segue de perto ("referência ESCOLHIDA PELA EQUIPE"). Sem IA, sem custo.
 * Com "Também nos formatos irmãos" ligado, vale para o 4:5, o 1:1 e o
 * Stories do mesmo ângulo.
 */

/** configurar guarda no máximo 4 referências por alvo. */
export const MAX_REFERENCIAS_DO_CRIATIVO = 4;
const IMAGENS = ["png", "jpg", "jpeg", "webp"];

type FiltroDoBanco = "todas" | "cliente" | "agencia";

/** A escolhida nova entra primeiro; passa de 4, sai a mais antiga. */
export function juntarReferencia(atuais: string[], nova: string): string[] {
  return [nova].concat(atuais.filter((x) => x !== nova)).slice(0, MAX_REFERENCIAS_DO_CRIATIVO);
}

export default function ReferenciasDoCriativo({
  trabalho,
  cardSelecionado,
  irmaos,
  valerParaIrmaos,
  onAtualizar,
}: {
  trabalho: Trabalho;
  cardSelecionado: Parameters<typeof ReferenciasDoEstudio>[0]["cardSelecionado"];
  /** Trabalhos dos formatos irmãos (mesmo ângulo e variação). */
  irmaos: Trabalho[];
  valerParaIrmaos: boolean;
  onAtualizar: () => void;
}) {
  const { clientId } = useMesa();
  const [alvo, setAlvo] = useState<AlvoDasReferencias>("conjunto");
  const [aba, setAba] = useState<"cliente" | "banco">("cliente");
  const [link, setLink] = useState("");
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<FiltroDoBanco>("todas");
  const [bancoAberto, setBancoAberto] = useState(true);
  const entrada = useRef<HTMLInputElement>(null);
  const referencias = useQuery({ queryKey: chavesAds.referencias(clientId), queryFn: () => lerReferencias(clientId) });
  const doConjunto = (trabalho.direcao && trabalho.direcao.referencias_ids) || [];

  const banco = useMemo(() => {
    const todas = ordenarReferencias(referencias.data || []);
    return todas.filter((r) => (filtro === "cliente" ? r.client_id !== null : filtro === "agencia" ? r.client_id === null : true)).slice(0, 60);
  }, [referencias.data, filtro]);

  /** Grava a referência no criativo (e nos irmãos, se ligado). */
  const usarNoCriativo = async (estudioId: string, titulo: string) => {
    const alvos = [trabalho].concat(valerParaIrmaos ? irmaos : []);
    let feitos = 0;
    const falhas: unknown[] = [];
    for (const t of alvos) {
      const atuais = (t.direcao && t.direcao.referencias_ids) || [];
      try {
        await chamarFuncao("estudio-arte", { acao: "configurar", trabalho_id: t.id, conjunto: { referencias_ids: juntarReferencia(atuais, estudioId) } });
        feitos += 1;
      } catch (e) {
        falhas.push(e);
      }
    }
    onAtualizar();
    if (feitos) {
      toast.success("Referência escolhida para o criativo", {
        description: `${titulo ? `${titulo}. ` : ""}${feitos > 1 ? `Vale para ${feitos} formatos deste ângulo. ` : ""}O gerador segue de perto na próxima arte ou ajuste.`,
      });
    }
    if (falhas.length) toast.error("Referência não salva em algum formato", { description: textoDoErro(falhas[0]) });
  };

  const enviarArquivos = async (arquivos: FileList | null) => {
    if (!arquivos || !arquivos.length) return;
    setOcupado("upload");
    try {
      for (let i = 0; i < arquivos.length && i < 2; i++) {
        const f = arquivos[i];
        const ext = (f.name.split(".").pop() || "").toLowerCase();
        if (IMAGENS.indexOf(ext) < 0) {
          toast.error(`${f.name}: envie PNG, JPG ou WEBP.`);
          continue;
        }
        const id = crypto.randomUUID();
        const caminho = `${clientId}/referencias/${id}.${ext}`;
        const { error } = await supabase.storage.from("mesa").upload(caminho, f, { contentType: f.type || `image/${ext}`, upsert: false });
        if (error) throw error;
        const { error: erroLinha } = await (supabase as any)
          .from("cliente_referencias")
          .insert({ id, client_id: clientId, origem: "upload", papel: "tecnica", storage_path: caminho, tags: ["mesa-ads"] });
        if (erroLinha) throw erroLinha;
        await usarNoCriativo(id, f.name);
      }
    } catch (e) {
      toast.error("Referência não enviada", { description: textoDoErro(e) });
    } finally {
      if (entrada.current) entrada.current.value = "";
      setOcupado(null);
    }
  };

  const colarLink = async (e: FormEvent) => {
    e.preventDefault();
    const url = link.trim();
    if (!linkValido(url)) {
      toast.error("Cole um link completo (https://...).");
      return;
    }
    setOcupado("link");
    try {
      if (ehLinkDePin(url)) {
        const r = await adicionarPin(clientId, url);
        await usarNoCriativo(r.id, "Pin do Pinterest");
      } else {
        const r = await levarReferenciaAoEstudio(clientId, { url });
        if (r.aviso) toast.info("Aviso do link", { description: r.aviso });
        await usarNoCriativo(r.id, r.titulo);
      }
      setLink("");
    } catch (erro) {
      toast.error("O link não virou referência", { description: textoDoErro(erro) });
    } finally {
      setOcupado(null);
    }
  };

  const usarDoBanco = async (r: ReferenciaAds) => {
    setOcupado(r.id);
    try {
      const ligada = await levarReferenciaAoEstudio(clientId, { referencia_id: r.id });
      if (ligada.aviso) toast.info("Aviso da referência", { description: ligada.aviso });
      await usarNoCriativo(ligada.id, r.titulo);
    } catch (e) {
      toast.error("Referência não levada ao criativo", { description: textoDoErro(e) });
    } finally {
      setOcupado(null);
    }
  };

  return (
    <div className="min-w-0 space-y-4">
      <section className="min-w-0 space-y-2 rounded-lg border border-border bg-background p-3" aria-label="Mandar uma referência">
        <p className="text-[12px] font-medium">Mandar uma referência para este criativo</p>
        <p className="text-[11.5px] leading-snug text-muted-foreground">
          Envie a imagem ou cole o link (Pinterest, Instagram, Behance, imagem ou página). Ela entra nas escolhidas e o gerador segue de perto.
          {valerParaIrmaos && irmaos.length ? ` Vale também para ${irmaos.length} formato(s) irmão(s).` : ""}
        </p>
        <div className="flex min-w-0 flex-wrap items-center">
          <input ref={entrada} type="file" accept="image/png,image/jpeg,image/webp" multiple className="hidden" onChange={(e) => void enviarArquivos(e.target.files)} aria-label="Enviar imagem de referência" />
          <Button type="button" size="sm" variant="outline" className="mb-1 mr-2 h-8 text-[12px]" disabled={ocupado !== null} onClick={() => entrada.current && entrada.current.click()}>
            {ocupado === "upload" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1 h-3.5 w-3.5" />}
            Enviar imagem
          </Button>
        </div>
        <form onSubmit={(e) => void colarLink(e)} className="flex min-w-0 items-center">
          <Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Cole o link da referência" aria-label="Link da referência" className="mr-2 h-8 min-w-0 flex-1 text-[12px]" />
          <Button type="submit" size="sm" className="h-8 shrink-0 text-[12px]" disabled={ocupado !== null || !link.trim()}>
            {ocupado === "link" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Link2 className="mr-1 h-3.5 w-3.5" />}
            Usar
          </Button>
        </form>
      </section>

      <section className="min-w-0 rounded-lg border border-border bg-background" aria-label="Banco de anúncios">
        <button type="button" onClick={() => setBancoAberto((v) => !v)} aria-expanded={bancoAberto} className="flex w-full items-center px-3 py-2 text-left">
          <Library className="mr-1.5 h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="min-w-0 flex-1 text-[12px] font-medium">Banco de anúncios da Mesa Ads</span>
          <span className="text-[11px] text-muted-foreground">{(referencias.data || []).length}</span>
        </button>
        {bancoAberto && (
          <div className="border-t border-border p-2">
            <div className="mb-2 flex flex-wrap" role="group" aria-label="Filtrar o banco de anúncios">
              {(["todas", "cliente", "agencia"] as FiltroDoBanco[]).map((f) => (
                <button key={f} type="button" className={pilula(filtro === f)} onClick={() => setFiltro(f)} aria-pressed={filtro === f}>
                  {f === "todas" ? "Todas" : f === "cliente" ? "Do cliente" : "Agência e nicho"}
                </button>
              ))}
            </div>
            {referencias.isLoading && <p className="px-1 text-[11.5px] text-muted-foreground">Carregando o banco…</p>}
            {!referencias.isLoading && !banco.length && <p className="px-1 text-[11.5px] text-muted-foreground">Nada aqui ainda. Traga referências na etapa Referências ou cole um link acima.</p>}
            <ul className="grid max-h-[360px] grid-cols-2 gap-2 overflow-y-auto overscroll-contain">
              {banco.map((r) => {
                const capa = capaDaReferencia(r);
                const estilo = estiloDaReferencia(r);
                return (
                  <li key={r.id} className="min-w-0 overflow-hidden rounded-md border border-border bg-card">
                    <div className="relative w-full" style={{ paddingTop: "100%" }}>
                      <div className="absolute inset-0">
                        {capa ? (
                          <Foto src={capa} alt={r.titulo} className="h-full w-full" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center bg-secondary/60 p-2 text-center text-[11px] leading-snug text-foreground/80">
                            {r.ficha.gancho_verbal ? `“${String(r.ficha.gancho_verbal)}”` : rotuloDaOrigem(r.origem)}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="p-1.5">
                      <p className="truncate text-[11.5px] font-medium" title={r.titulo}>{r.titulo}</p>
                      <p className="truncate text-[10.5px] text-muted-foreground">
                        {r.client_id ? rotuloDaOrigem(r.origem) : nomeDoNicho(r) || "Agência"}
                        {estilo ? ` · ${estilo}` : ""}
                      </p>
                      <Button type="button" size="sm" variant="outline" className="mt-1 h-7 w-full px-1 text-[11px]" disabled={ocupado !== null} onClick={() => void usarDoBanco(r)}>
                        {ocupado === r.id ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Check className="mr-1 h-3 w-3" />}
                        Usar neste criativo
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </section>

      <p className="text-[11px] text-muted-foreground">
        Escolhidas agora: {doConjunto.length} de {MAX_REFERENCIAS_DO_CRIATIVO}. Abaixo, as do cliente, do Workspace, do banco da agência e do Pinterest.
      </p>
      <ReferenciasDoEstudio
        trabalho={trabalho}
        cardSelecionado={cardSelecionado}
        alvo={alvo}
        onAlvo={setAlvo}
        aba={aba}
        onAba={setAba}
        onAtualizar={onAtualizar}
      />
    </div>
  );
}
