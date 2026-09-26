import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { gravarCopiasSemEsperar } from "@/lib/miniaturas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { extensao, textoDoErro } from "@/lib/mesa/api";
import { chaveDasMarcas, type MarcaDoCliente } from "@/lib/mesa/marcas";
import { ImagemDaMesa, useMesa } from "./MesaContexto";
import { PaletaDaMarca } from "./ContextoPaleta";
import { Campo, TituloDeSecao } from "./Seletores";
import { useFontesDoCliente, useInvalidarContexto, useReferenciasDoCliente } from "./contextoDoCliente";
import { gravarTomDaLogo, reduzirArquivoDeLogo } from "./ContextoLogos";
import { useConferenciaDaLogo } from "./ConferenciaDaLogo";
import { estiloDoFundoDaLogo, fundoDeConferencia, useTomDaLogo } from "./logoAnalise";

/**
 * Kit de uma marca que não é a principal (ex.: CME dentro da Acerbi; pedido
 * do dono em 25/09: "só muda isso: a logo correta, as referências corretas").
 * Grava em cliente_marcas (docs/marcas/01_cliente_marcas.sql). Logo e cores
 * da marca nunca vêm do cliente; estilo, regras e tom vazios usam os do
 * cliente. Referências e fontes do cliente podem ser marcadas como desta
 * marca (cliente_referencias.marca_id, cliente_fontes.marca_id).
 */

interface Cor {
  nome: string;
  hex: string;
  papel: string;
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const IMAGENS = ["png", "jpg", "jpeg", "webp"];
const MAX_BYTES_LOGO = 10 * 1024 * 1024;

/** Vínculo de referências e fontes com a marca (id e marca_id). */
function useVinculosDaMarca(clientId: string) {
  return useQuery({
    queryKey: ["mesa", "marca-vinculos", clientId],
    enabled: !!clientId,
    staleTime: 30_000,
    queryFn: async (): Promise<{ referencias: Record<string, string | null>; fontes: Record<string, string | null> }> => {
      const [r, f] = await Promise.all([
        (supabase as any).from("cliente_referencias").select("id, marca_id").eq("client_id", clientId).limit(1000),
        (supabase as any).from("cliente_fontes").select("id, marca_id").eq("client_id", clientId),
      ]);
      if (r.error) throw r.error;
      if (f.error) throw f.error;
      const referencias: Record<string, string | null> = {};
      const fontes: Record<string, string | null> = {};
      for (const x of (r.data || []) as { id: string; marca_id: string | null }[]) referencias[x.id] = x.marca_id || null;
      for (const x of (f.data || []) as { id: string; marca_id: string | null }[]) fontes[x.id] = x.marca_id || null;
      return { referencias, fontes };
    },
  });
}

/** Caminho da logo da marca no bucket mesa, sempre sob a pasta do cliente. */
export function caminhoDaLogoDaMarca(clientId: string, marcaId: string, alternativa: boolean, ext: string, agora = Date.now()): string {
  return `${clientId}/marcas/${marcaId}/${alternativa ? "logo-alternativa" : "logo"}-${agora}.${ext === "jpeg" ? "jpg" : ext}`;
}

/** Prévia da logo da marca sobre um fundo que contrasta com ela (logo branca em cinza-escuro, escura em claro). */
function PreviaDaLogoDaMarca({ caminho, alt }: { caminho: string; alt: string }) {
  const lida = useTomDaLogo({ bucket: "mesa", caminho }, null);
  const fundo = fundoDeConferencia(lida.data ? lida.data.tom : null);
  return (
    <div className="mt-2 flex h-24 items-center justify-center overflow-hidden rounded-md border border-border p-1.5" style={estiloDoFundoDaLogo(fundo)} data-fundo-da-logo={fundo}>
      <ImagemDaMesa caminho={caminho} alt={alt} className="h-full w-full !object-contain" />
    </div>
  );
}

export default function ContextoKitDaMarca({ marca }: { marca: MarcaDoCliente }) {
  const { clientId, userId } = useMesa();
  const queryClient = useQueryClient();
  const invalidar = useInvalidarContexto();
  const [paleta, setPaletaBruta] = useState<Cor[]>([]);
  const [estilo, setEstilo] = useState("");
  const [regras, setRegras] = useState("");
  const [tom, setTom] = useState("");
  const [extra, setExtra] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [enviando, setEnviando] = useState<"logo" | "alt" | null>(null);
  const [mudando, setMudando] = useState<string | null>(null);
  const entradaLogo = useRef<HTMLInputElement>(null);
  const entradaAlt = useRef<HTMLInputElement>(null);
  const { conferir, dialogo: conferencia } = useConferenciaDaLogo();
  const sujo = useRef(false);

  const vinculos = useVinculosDaMarca(clientId);
  const referencias = useReferenciasDoCliente(clientId);
  const fontes = useFontesDoCliente(clientId);

  // A marca relida (depois de salvar ou de outra pessoa editar) não apaga o que está sendo digitado.
  useEffect(() => {
    if (sujo.current) return;
    setPaletaBruta(Array.isArray(marca.paleta) ? (marca.paleta as Cor[]).map((c) => ({ nome: c.nome || "", hex: c.hex || "", papel: c.papel || "principal" })) : []);
    setEstilo(marca.estilo || "");
    setRegras(marca.regras || "");
    setTom(marca.tom || "");
    setExtra(marca.contexto_extra || "");
  }, [marca]);

  const editar = <T,>(fn: (v: T) => void) => (v: T) => {
    sujo.current = true;
    fn(v);
  };
  const setPaleta = (fn: (p: Cor[]) => Cor[]) => {
    sujo.current = true;
    setPaletaBruta(fn);
  };
  const mudarCor = (i: number, campo: keyof Cor, valor: string) => setPaleta((p) => p.map((c, j) => (j === i ? { ...c, [campo]: valor } : c)));

  const reler = () => {
    void queryClient.invalidateQueries({ queryKey: chaveDasMarcas(clientId) });
    void queryClient.invalidateQueries({ queryKey: ["mesa", "marca-vinculos", clientId] });
    invalidar(clientId);
  };

  const salvar = async () => {
    const invalida = paleta.find((c) => !HEX.test(c.hex));
    if (invalida) {
      toast.error(`A cor "${invalida.nome || invalida.hex}" precisa estar no formato #RRGGBB.`);
      return;
    }
    setSalvando(true);
    try {
      const { error } = await (supabase as any)
        .from("cliente_marcas")
        .update({
          paleta: paleta.map((c) => ({ nome: c.nome.trim(), hex: c.hex.toUpperCase(), papel: c.papel })),
          estilo: estilo.trim() || null,
          regras: regras.trim() || null,
          tom: tom.trim() || null,
          contexto_extra: extra.trim().slice(0, 8000) || null,
          atualizado_por: userId,
        })
        .eq("id", marca.id)
        .eq("client_id", clientId);
      if (error) throw error;
      sujo.current = false;
      toast.success(`Kit da ${marca.nome} salvo`);
      reler();
    } catch (e) {
      toast.error("Kit não salvo", { description: textoDoErro(e) });
    } finally {
      setSalvando(false);
    }
  };

  const enviarLogo = async (arquivo: File | null | undefined, alternativa: boolean) => {
    if (!arquivo) return;
    const ext = extensao(arquivo.name);
    if (IMAGENS.indexOf(ext) < 0) {
      toast.error("Envie a logo em PNG, JPG ou WEBP.");
      return;
    }
    if (arquivo.size > MAX_BYTES_LOGO) {
      toast.error("Logo acima de 10 MB.");
      return;
    }
    setEnviando(alternativa ? "alt" : "logo");
    try {
      // Lida antes de subir (25/09): fundo liso vira pergunta; branco sobre branco pede a versão certa.
      const conferida = await conferir(arquivo, arquivo.name);
      if (conferida.acao === "cancelar") return;
      if (conferida.acao === "outra") {
        toast.message("Envie a logo em PNG transparente ou a versão para fundo escuro.");
        return;
      }
      // Logo gigante (26/09: 7813 px derrubou o Estúdio por memória): reduz para 2048 px antes de subir.
      const pronta = conferida.semFundo
        ? { blob: conferida.blob, reduziu: true }
        : await reduzirArquivoDeLogo(arquivo).catch(() => ({ blob: arquivo as Blob, reduziu: false }));
      const extFinal = pronta.reduziu ? "png" : ext;
      const caminho = caminhoDaLogoDaMarca(clientId, marca.id, alternativa, extFinal);
      const tipo = extFinal === "jpg" || extFinal === "jpeg" ? "image/jpeg" : `image/${extFinal}`;
      const { error: erroEnvio } = await supabase.storage.from("mesa").upload(caminho, pronta.blob, { contentType: tipo, upsert: false });
      if (erroEnvio) throw erroEnvio;
      gravarCopiasSemEsperar("mesa", caminho, pronta.blob, { mime: tipo });
      const campos = alternativa ? { logo_alt_path: caminho, logo_alt_file_id: null } : { logo_path: caminho, logo_file_id: null };
      const { error } = await (supabase as any)
        .from("cliente_marcas")
        .update({ ...campos, atualizado_por: userId })
        .eq("id", marca.id)
        .eq("client_id", clientId);
      if (error) {
        await supabase.storage.from("mesa").remove([caminho]).catch(() => undefined);
        throw error;
      }
      await gravarTomDaLogo("cliente_marcas", { client_id: clientId, id: marca.id }, alternativa, conferida.tom);
      toast.success(alternativa ? `Logo alternativa da ${marca.nome} salva` : `Logo da ${marca.nome} salva`, conferida.semFundo ? { description: "Sem o fundo." } : undefined);
      reler();
    } catch (e) {
      toast.error("Logo não salva", { description: textoDoErro(e) });
    } finally {
      setEnviando(null);
      if (entradaLogo.current) entradaLogo.current.value = "";
      if (entradaAlt.current) entradaAlt.current.value = "";
    }
  };

  const tirarLogo = async (alternativa: boolean) => {
    setEnviando(alternativa ? "alt" : "logo");
    try {
      const campos = alternativa ? { logo_alt_path: null, logo_alt_file_id: null } : { logo_path: null, logo_file_id: null };
      const { error } = await (supabase as any).from("cliente_marcas").update(campos).eq("id", marca.id).eq("client_id", clientId);
      if (error) throw error;
      await gravarTomDaLogo("cliente_marcas", { client_id: clientId, id: marca.id }, alternativa, null);
      reler();
    } catch (e) {
      toast.error("Não foi possível tirar a logo", { description: textoDoErro(e) });
    } finally {
      setEnviando(null);
    }
  };

  /** Marca ou desmarca uma referência ou fonte do cliente como desta marca. */
  const vincular = async (tabela: "cliente_referencias" | "cliente_fontes", id: string, daMarca: boolean) => {
    setMudando(id);
    try {
      const { error } = await (supabase as any)
        .from(tabela)
        .update({ marca_id: daMarca ? marca.id : null })
        .eq("id", id)
        .eq("client_id", clientId);
      if (error) throw error;
      reler();
    } catch (e) {
      toast.error("Não foi possível mudar", { description: textoDoErro(e) });
    } finally {
      setMudando(null);
    }
  };

  const mapaRefs = (vinculos.data && vinculos.data.referencias) || {};
  const mapaFontes = (vinculos.data && vinculos.data.fontes) || {};
  const refs = (referencias.data || []).filter((r) => r.ativa && r.imagem && (!mapaRefs[r.id] || mapaRefs[r.id] === marca.id)).slice(0, 60);
  const listaFontes = (fontes.data || []).filter((f) => !mapaFontes[f.id] || mapaFontes[f.id] === marca.id);
  const refsDaMarca = refs.filter((r) => mapaRefs[r.id] === marca.id).length;

  const blocoLogo = (alternativa: boolean) => {
    const caminho = alternativa ? marca.logo_alt_path : marca.logo_path;
    const entrada = alternativa ? entradaAlt : entradaLogo;
    const ocupado = enviando === (alternativa ? "alt" : "logo");
    return (
      <div className="min-w-0 rounded-lg border border-border bg-card p-2.5">
        <p className="text-[11.5px] font-medium text-foreground">{alternativa ? "Logo alternativa (fundo oposto)" : `Logo da ${marca.nome}`}</p>
        {caminho ? (
          <PreviaDaLogoDaMarca caminho={caminho} alt={alternativa ? "Logo alternativa" : "Logo"} />
        ) : (
          <div className="mt-2 flex h-24 items-center justify-center overflow-hidden rounded-md bg-secondary/60">
            <span className="px-2 text-center text-[11.5px] text-muted-foreground">Sem logo. A arte sai sem logo até enviar (nunca usa a do cliente).</span>
          </div>
        )}
        <input
          ref={entrada}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          aria-label={alternativa ? "Enviar logo alternativa" : "Enviar logo"}
          onChange={(e) => void enviarLogo(e.target.files && e.target.files[0], alternativa)}
        />
        <div className="mt-2 flex flex-wrap items-center">
          <Button type="button" size="sm" variant="outline" className="mr-1.5" disabled={!!enviando} onClick={() => entrada.current && entrada.current.click()}>
            {ocupado ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1 h-3.5 w-3.5" />}
            {caminho ? "Trocar" : "Enviar"}
          </Button>
          {caminho && (
            <Button type="button" size="sm" variant="ghost" disabled={!!enviando} onClick={() => void tirarLogo(alternativa)}>
              Tirar
            </Button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6" data-kit-da-marca={marca.id}>
      {conferencia}
      <p className="rounded-lg bg-muted px-3 py-2 text-[12px] text-muted-foreground [overflow-wrap:anywhere]">
        Kit próprio da marca <strong className="text-foreground">{marca.nome}</strong>. Logo e cores vêm só daqui; estilo, regras e tom vazios usam os do cliente.
        As artes, o mês e os agentes usam este kit enquanto a {marca.nome} estiver escolhida no topo.
      </p>

      <section className="space-y-3">
        <TituloDeSecao>Logo</TituloDeSecao>
        <div className="grid max-w-xl grid-cols-1 gap-2 sm:grid-cols-2">
          {blocoLogo(false)}
          {blocoLogo(true)}
        </div>
      </section>

      <section className="space-y-3">
        <TituloDeSecao
          acao={
            <Button type="button" size="sm" variant="ghost" onClick={() => setPaleta((p) => p.concat([{ nome: "", hex: "#E91E63", papel: "principal" }]))}>
              <Plus className="mr-1 h-3.5 w-3.5" /> Cor
            </Button>
          }
        >
          Paleta
        </TituloDeSecao>
        {paleta.length === 0 && <p className="text-[12.5px] text-muted-foreground">Nenhuma cor ainda. Comece pela cor principal da {marca.nome}.</p>}
        {paleta.length > 0 && <PaletaDaMarca paleta={paleta.filter((c) => HEX.test(c.hex))} />}
        <ul className="space-y-2">
          {paleta.map((cor, i) => (
            <li key={i} className="grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-2 rounded-lg border border-border bg-card p-2 sm:grid-cols-[40px_minmax(0,1fr)_120px_auto]">
              <input
                type="color"
                value={HEX.test(cor.hex) ? cor.hex : "#000000"}
                onChange={(e) => mudarCor(i, "hex", e.target.value.toUpperCase())}
                className="h-9 w-10 cursor-pointer rounded border border-border bg-card p-0.5"
                aria-label="Cor"
              />
              <Input value={cor.nome} onChange={(e) => mudarCor(i, "nome", e.target.value)} placeholder="Nome (ex.: Rosa CME)" className="h-9 min-w-0" />
              <Button type="button" size="icon" variant="ghost" className="h-9 w-9 sm:order-last" onClick={() => setPaleta((p) => p.filter((_, j) => j !== i))} aria-label="Remover cor">
                <Trash2 className="h-4 w-4" />
              </Button>
              <Input value={cor.hex} onChange={(e) => mudarCor(i, "hex", e.target.value)} className="col-span-3 h-9 font-mono text-xs sm:col-span-1" aria-label="Hex" />
            </li>
          ))}
        </ul>
      </section>

      <section className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Campo rotulo={`Estilo da ${marca.nome}`}>
          <Textarea value={estilo} onChange={(e) => editar(setEstilo)(e.target.value)} rows={4} placeholder="Vazio: usa o estilo do cliente." />
        </Campo>
        <Campo rotulo="Regras (faça e não faça)">
          <Textarea value={regras} onChange={(e) => editar(setRegras)(e.target.value)} rows={4} placeholder="Vazio: usa as regras do cliente." />
        </Campo>
        <Campo rotulo="Tom de voz">
          <Textarea value={tom} onChange={(e) => editar(setTom)(e.target.value)} rows={3} placeholder="Vazio: usa o tom do cliente." />
        </Campo>
        <Campo rotulo={`Sobre a ${marca.nome} (contexto curto)`}>
          <Textarea value={extra} onChange={(e) => editar(setExtra)(e.target.value)} rows={3} placeholder="Público, proposta e o que a diferencia da marca principal." />
        </Campo>
      </section>

      <div className="flex justify-end">
        <Button type="button" onClick={() => void salvar()} disabled={salvando}>
          {salvando && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
          Salvar kit da {marca.nome}
        </Button>
      </div>

      <section className="space-y-2">
        <TituloDeSecao>
          Referências da {marca.nome} ({refsDaMarca})
        </TituloDeSecao>
        <p className="text-[12px] text-muted-foreground">
          Marque as do cliente que valem para a {marca.nome}: elas saem da marca principal. As enviadas com a {marca.nome} escolhida já entram como dela.
        </p>
        {(referencias.isLoading || vinculos.isLoading) && <p className="text-[12px] text-muted-foreground">Lendo referências...</p>}
        {vinculos.isError && <p className="text-[12px] text-destructive">Não foi possível ler as marcas das referências.</p>}
        {!referencias.isLoading && refs.length === 0 && <p className="text-[12px] text-muted-foreground">O cliente ainda não tem referência com imagem.</p>}
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {refs.map((r) => {
            const daMarca = mapaRefs[r.id] === marca.id;
            return (
              <li key={r.id} className={`min-w-0 overflow-hidden rounded-lg border bg-card ${daMarca ? "border-primary" : "border-border"}`}>
                <ImagemDaMesa caminho={r.imagem ? r.imagem.caminho : null} bucket={r.imagem ? r.imagem.bucket : "mesa"} alt={r.nome} className="h-20 w-full" />
                <label className="flex cursor-pointer items-center px-1.5 py-1 text-[11px]">
                  <input
                    type="checkbox"
                    className="mr-1.5 h-3.5 w-3.5 shrink-0"
                    checked={daMarca}
                    disabled={mudando === r.id || !vinculos.data}
                    onChange={(e) => void vincular("cliente_referencias", r.id, e.target.checked)}
                  />
                  <span className="min-w-0 truncate">{daMarca ? `Da ${marca.nome}` : "Do cliente"}</span>
                </label>
              </li>
            );
          })}
        </ul>
      </section>

      {listaFontes.length > 0 && (
        <section className="space-y-2">
          <TituloDeSecao>Fontes da {marca.nome}</TituloDeSecao>
          <p className="text-[12px] text-muted-foreground">Sem nenhuma marcada, a {marca.nome} usa as fontes do cliente.</p>
          <ul className="space-y-1">
            {listaFontes.map((f) => {
              const daMarca = mapaFontes[f.id] === marca.id;
              return (
                <li key={f.id}>
                  <label className="flex cursor-pointer items-center text-[12.5px]">
                    <input
                      type="checkbox"
                      className="mr-2 h-3.5 w-3.5 shrink-0"
                      checked={daMarca}
                      disabled={mudando === f.id || !vinculos.data}
                      onChange={(e) => void vincular("cliente_fontes", f.id, e.target.checked)}
                    />
                    <span className="min-w-0 truncate">
                      {f.nome} <span className="text-muted-foreground">· {f.papel}</span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
