import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Library, Loader2, Maximize2, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useConfirm } from "@/components/shared/confirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FORMATOS_DE_FONTE, gerarAmostraDaFonte, TIPO_DA_FONTE } from "@/lib/mesa/amostraFonte";
import { extensao, textoDoErro } from "@/lib/mesa/api";
import { Ampliar } from "./Ampliar";
import BibliotecaDeFontes from "./ContextoBibliotecaDeFontes";
import { ImagemDaMesa, useMesa } from "./MesaContexto";
import { Campo, TituloDeSecao } from "./Seletores";
import { chaveDasFontes, useFontesDoCliente, useInvalidarContexto, type FonteDoClienteLinha } from "./contextoDoCliente";

const PAPEIS_DA_FONTE = [
  { valor: "titulo", rotulo: "Título" },
  { valor: "texto", rotulo: "Texto" },
  { valor: "destaque", rotulo: "Destaque" },
];

type Fonte = FonteDoClienteLinha;

const ROTULO_DA_ORIGEM: Record<string, string> = { biblioteca: "Biblioteca da agência", upload: "Arquivo enviado", documento: "Citada nos documentos" };

/**
 * Kit de fontes: o arquivo vai para `mesa/<cliente>/fontes/`, e o navegador
 * desenha uma amostra PNG com a fonte (FontFace + canvas) que o gerador de
 * imagem usa como referência de tipografia. Também dá para escolher na
 * biblioteca da agência (galeria com amostra), que grava a família sem
 * copiar arquivo: tirar uma fonte da biblioteca nunca apaga o arquivo dela.
 */
export default function ContextoFontes() {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const confirmar = useConfirm();
  const entrada = useRef<HTMLInputElement>(null);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [nome, setNome] = useState("");
  const [papel, setPapel] = useState("titulo");
  const [enviando, setEnviando] = useState(false);
  const [refazendo, setRefazendo] = useState<string | null>(null);
  const [galeria, setGaleria] = useState(false);
  const [ampliada, setAmpliada] = useState<number | null>(null);
  const invalidar = useInvalidarContexto();

  const fontes = useFontesDoCliente(clientId);

  const atualizar = () => {
    void queryClient.invalidateQueries({ queryKey: chaveDasFontes(clientId) });
    invalidar(clientId);
  };

  /** Desenha e envia a amostra; devolve o caminho salvo. */
  const fazerAmostra = async (id: string, fonte: Blob, nomeDaFonte: string) => {
    const png = await gerarAmostraDaFonte(fonte, nomeDaFonte);
    const caminho = `${clientId}/fontes/amostra-${id}.png`;
    const { error } = await supabase.storage.from("mesa").upload(caminho, png, { contentType: "image/png", upsert: true });
    if (error) throw error;
    const { error: erroLinha } = await (supabase as any).from("cliente_fontes").update({ amostra_path: caminho }).eq("id", id);
    if (erroLinha) throw erroLinha;
    void queryClient.invalidateQueries({ queryKey: ["mesa", "url", "mesa", caminho] });
    return caminho;
  };

  const enviar = async () => {
    if (!arquivo) return;
    const ext = extensao(arquivo.name);
    if (FORMATOS_DE_FONTE.indexOf(ext) < 0) {
      toast.error("Envie a fonte em .ttf, .otf, .woff ou .woff2.");
      return;
    }
    const nomeFinal = nome.trim() || arquivo.name.slice(0, arquivo.name.length - ext.length - 1);
    setEnviando(true);
    const id = crypto.randomUUID();
    const caminho = `${clientId}/fontes/${id}.${ext}`;
    try {
      const { error: erroUpload } = await supabase.storage.from("mesa").upload(caminho, arquivo, {
        contentType: TIPO_DA_FONTE[ext] || "application/octet-stream",
        upsert: false,
      });
      if (erroUpload) throw erroUpload;
      const { error: erroLinha } = await (supabase as any)
        .from("cliente_fontes")
        .insert({ id, client_id: clientId, nome: nomeFinal, papel, storage_path: caminho, origem: "upload" });
      if (erroLinha) throw erroLinha;
      try {
        await fazerAmostra(id, arquivo, nomeFinal);
        toast.success("Fonte salva com amostra");
      } catch (e) {
        toast.warning("Fonte salva, mas a amostra não foi gerada", { description: textoDoErro(e) });
      }
      setArquivo(null);
      setNome("");
      if (entrada.current) entrada.current.value = "";
      atualizar();
    } catch (e) {
      toast.error("Fonte não enviada", { description: textoDoErro(e) });
    } finally {
      setEnviando(false);
    }
  };

  const refazerAmostra = async (f: Fonte) => {
    setRefazendo(f.id);
    try {
      const { data, error } = await supabase.storage.from("mesa").download(f.storage_path);
      if (error || !data) throw error || new Error("Arquivo da fonte indisponível");
      await fazerAmostra(f.id, data, f.nome);
      toast.success("Amostra refeita");
      atualizar();
    } catch (e) {
      toast.error("Amostra não gerada", { description: textoDoErro(e) });
    } finally {
      setRefazendo(null);
    }
  };

  const apagar = async (f: Fonte) => {
    const daBiblioteca = f.origem !== "upload";
    const ok = await confirmar({
      title: `Tirar a fonte ${f.nome}?`,
      description: daBiblioteca ? "A família sai do kit deste cliente. A biblioteca da agência continua com ela." : "O arquivo e a amostra saem do kit deste cliente.",
      confirmLabel: "Tirar",
    });
    if (!ok) return;
    try {
      const { error } = await (supabase as any).from("cliente_fontes").delete().eq("id", f.id);
      if (error) throw error;
      // Fonte da biblioteca aponta para o arquivo e a amostra da própria
      // biblioteca (compartilhados): só o arquivo enviado pelo cliente sai do Storage.
      if (!daBiblioteca) {
        await supabase.storage.from("mesa").remove([f.storage_path].concat(f.amostra_path ? [f.amostra_path] : []));
      }
      atualizar();
    } catch (e) {
      toast.error("Não foi possível tirar a fonte", { description: textoDoErro(e) });
    }
  };

  const mudarPapel = async (f: Fonte, novo: string) => {
    const { error } = await (supabase as any).from("cliente_fontes").update({ papel: novo }).eq("id", f.id);
    if (error) toast.error("Papel não salvo", { description: textoDoErro(error) });
    atualizar();
  };

  const comAmostra = (fontes.data || []).filter((f) => !!f.amostra_path);

  return (
    <div className="space-y-6">
      <section className="flex min-w-0 flex-col rounded-xl border border-border bg-card p-3.5 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1 sm:mr-3">
          <p className="text-[13px] font-medium">Biblioteca da agência</p>
          <p className="text-[12px] leading-relaxed text-muted-foreground">Galeria com a amostra de cada família. Escolha a fonte de título e a de texto; a antiga do mesmo papel sai.</p>
        </div>
        <Button type="button" variant="outline" className="mt-2 h-9 shrink-0 sm:mt-0" onClick={() => setGaleria(true)}>
          <Library className="mr-1.5 h-4 w-4" />
          Escolher da biblioteca
        </Button>
      </section>

      <section className="space-y-3 rounded-xl border border-border bg-card p-3.5">
        <TituloDeSecao>Enviar arquivo de fonte</TituloDeSecao>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_150px_auto] sm:items-end">
          <Campo rotulo="Arquivo (.ttf, .otf, .woff, .woff2)">
            <Input
              ref={entrada}
              type="file"
              accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2"
              onChange={(e) => setArquivo(e.target.files?.[0] || null)}
              className="h-9 text-[12px]"
            />
          </Campo>
          <Campo rotulo="Nome">
            <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Playfair Display" className="h-9" />
          </Campo>
          <Campo rotulo="Papel">
            <Select value={papel} onValueChange={setPapel}>
              <SelectTrigger className="h-9 text-[12.5px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PAPEIS_DA_FONTE.map((p) => <SelectItem key={p.valor} value={p.valor}>{p.rotulo}</SelectItem>)}
              </SelectContent>
            </Select>
          </Campo>
          <Button type="button" onClick={() => void enviar()} disabled={!arquivo || enviando}>
            {enviando ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Upload className="mr-1.5 h-4 w-4" />}
            Enviar
          </Button>
        </div>
      </section>

      <section className="space-y-3">
        <TituloDeSecao>Fontes do cliente</TituloDeSecao>
        {fontes.isLoading && <p className="text-[12.5px] text-muted-foreground">Lendo fontes…</p>}
        {fontes.data && fontes.data.length === 0 && <p className="text-[12.5px] text-muted-foreground">Nenhuma fonte ainda. Sem fonte, o gerador escolhe uma parecida com as referências.</p>}
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {(fontes.data || []).map((f) => (
            <li key={f.id} className="min-w-0 overflow-hidden rounded-xl border border-border bg-card">
              <button
                type="button"
                onClick={() => {
                  const i = comAmostra.indexOf(f);
                  if (i >= 0) setAmpliada(i);
                }}
                disabled={!f.amostra_path}
                aria-label={`Ver a amostra de ${f.nome} maior`}
                className="group relative block h-40 w-full overflow-hidden border-b border-border bg-white"
              >
                <ImagemDaMesa caminho={f.amostra_path} alt={`Amostra da fonte ${f.nome}`} className="h-full w-full !object-contain" />
                {f.amostra_path && (
                  <span className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-md bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                    <Maximize2 className="h-3.5 w-3.5" />
                  </span>
                )}
              </button>
              <div className="flex flex-wrap items-center gap-2 p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium">{f.nome}</p>
                  <p className="truncate text-[11px] text-muted-foreground">{ROTULO_DA_ORIGEM[f.origem] || f.origem}</p>
                </div>
                <Select value={f.papel} onValueChange={(v) => void mudarPapel(f, v)}>
                  <SelectTrigger className="h-8 w-[120px] text-[12px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PAPEIS_DA_FONTE.map((p) => <SelectItem key={p.valor} value={p.valor}>{p.rotulo}</SelectItem>)}
                  </SelectContent>
                </Select>
                {!f.amostra_path && f.origem === "upload" && (
                  <Button type="button" size="sm" variant="outline" className="h-8 text-[12px]" onClick={() => void refazerAmostra(f)} disabled={refazendo === f.id}>
                    {refazendo === f.id && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                    Gerar amostra
                  </Button>
                )}
                <Button type="button" size="icon" variant="ghost" className="h-8 w-8" onClick={() => void apagar(f)} aria-label="Tirar fonte">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <BibliotecaDeFontes aberto={galeria} onOpenChange={setGaleria} />
      <Ampliar
        imagens={comAmostra.map((f) => ({ caminho: f.amostra_path!, bucket: "mesa", titulo: f.nome, legenda: ROTULO_DA_ORIGEM[f.origem] || undefined }))}
        indice={ampliada}
        onFechar={() => setAmpliada(null)}
      />
    </div>
  );
}
