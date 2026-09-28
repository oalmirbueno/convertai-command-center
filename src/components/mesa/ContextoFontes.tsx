import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Library, Loader2, Maximize2, Trash2, Type, Upload } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useConfirm } from "@/components/shared/confirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FORMATOS_DE_FONTE, TIPO_DA_FONTE } from "@/lib/mesa/amostraFonte";
import { arquivoDoProprioCliente, caminhoDaAmostraDaTipografia, ehAmostraDaTipografia, gerarAmostraDaTipografia, gerarAmostrasDaTipografia } from "@/lib/mesa/amostraDaFonte";
import { depsDaAmostraNoSupabase, marcaParaGravarNaTela, useTipografiaDaMarca, type FonteDaTipografia } from "@/lib/mesa/tipografiaDoCliente";
import { extensao, textoDoErro } from "@/lib/mesa/api";
import { Ampliar } from "./Ampliar";
import BibliotecaDeFontes from "./ContextoBibliotecaDeFontes";
import { ImagemDaMesa, useMarcaDaMesa, useMesa } from "./MesaContexto";
import { Campo } from "./Seletores";
import Secao from "@/components/sistema/Secao";
import { chaveDasFontes, useInvalidarContexto } from "./contextoDoCliente";

const PAPEIS_DA_FONTE = [
  { valor: "titulo", rotulo: "Título" },
  { valor: "texto", rotulo: "Texto" },
  { valor: "destaque", rotulo: "Destaque" },
];

type Fonte = FonteDaTipografia;

const ROTULO_DA_ORIGEM: Record<string, string> = { biblioteca: "Biblioteca da agência", upload: "Arquivo enviado", documento: "Citada nos documentos" };

/**
 * Kit de fontes: o arquivo vai para `mesa/<cliente>/fontes/`, e o navegador
 * desenha uma amostra PNG com a fonte (FontFace + canvas) que o gerador de
 * imagem usa como referência de tipografia. Também dá para escolher na
 * biblioteca da agência (galeria com amostra), que grava a família sem
 * copiar arquivo: tirar uma fonte da biblioteca nunca apaga o arquivo dela.
 *
 * Frente T2 (26/09): a amostra é a da TIPOGRAFIA DO CLIENTE
 * (src/lib/mesa/amostraDaFonte.ts: 1600 x 900, no peso usado, na pasta do
 * cliente), feita sozinha quando a fonte entra ou muda de papel, e pelo botão
 * "Gerar amostra da tipografia". A lista é a da marca aberta (outra marca,
 * como a CME, grava e vê as dela).
 */
export default function ContextoFontes() {
  const { clientId } = useMesa();
  const { marca } = useMarcaDaMesa();
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
  const [gerandoTodas, setGerandoTodas] = useState(false);
  const invalidar = useInvalidarContexto();

  const tipografia = useTipografiaDaMarca(clientId, marca);
  const lista: Fonte[] = tipografia.data ? tipografia.data.daMarca : [];

  const atualizar = () => {
    void queryClient.invalidateQueries({ queryKey: chaveDasFontes(clientId) });
    invalidar(clientId);
  };

  /** Desenha e grava a amostra da tipografia (pasta do cliente, peso do papel); devolve o caminho salvo. */
  const fazerAmostra = async (f: Pick<Fonte, "id" | "nome" | "papel" | "storage_path" | "amostra_path" | "marca_id">) => {
    const { caminho } = await gerarAmostraDaTipografia(clientId, f, depsDaAmostraNoSupabase(clientId));
    void queryClient.invalidateQueries({ queryKey: ["mesa", "url", "mesa", caminho] });
    return caminho;
  };

  /** Botão "Gerar amostra da tipografia": todas as fontes do kit desta marca, uma de cada vez. */
  const gerarTodas = async () => {
    if (!lista.length) return;
    setGerandoTodas(true);
    try {
      const r = await gerarAmostrasDaTipografia(clientId, lista, depsDaAmostraNoSupabase(clientId));
      if (r.falhas.length) {
        toast.warning(r.feitas ? `${r.feitas} amostra(s) pronta(s), ${r.falhas.length} com erro` : "Amostra não gerada", { description: r.falhas.map((x) => `${x.nome}: ${x.erro}`).join(" ") });
      } else {
        toast.success(r.feitas === 1 ? "Amostra da tipografia pronta" : `${r.feitas} amostras da tipografia prontas`);
      }
      // Mesmo caminho regravado: a imagem da tela relê o endereço assinado.
      lista.forEach((f) => void queryClient.invalidateQueries({ queryKey: ["mesa", "url", "mesa", caminhoDaAmostraDaTipografia(clientId, f.marca_id, f.papel, f.id)] }));
      atualizar();
    } finally {
      setGerandoTodas(false);
    }
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
      const daMarca = marcaParaGravarNaTela(marca);
      const { error: erroLinha } = await (supabase as any)
        .from("cliente_fontes")
        .insert({ id, client_id: clientId, nome: nomeFinal, papel, storage_path: caminho, origem: "upload", ...daMarca });
      if (erroLinha) throw erroLinha;
      try {
        await fazerAmostra({ id, nome: nomeFinal, papel, storage_path: caminho, amostra_path: null, marca_id: marca && !marca.principal ? marca.id : null });
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
      await fazerAmostra(f);
      toast.success("Amostra da tipografia pronta");
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
      } else if (arquivoDoProprioCliente(f.amostra_path, clientId)) {
        // Frente T2: a amostra da tipografia desenhada para este cliente sai junto (a da biblioteca fica).
        await supabase.storage.from("mesa").remove([f.amostra_path as string]).catch(() => null);
      }
      atualizar();
    } catch (e) {
      toast.error("Não foi possível tirar a fonte", { description: textoDoErro(e) });
    }
  };

  const mudarPapel = async (f: Fonte, novo: string) => {
    const { error } = await (supabase as any).from("cliente_fontes").update({ papel: novo }).eq("id", f.id).eq("client_id", clientId);
    if (error) toast.error("Papel não salvo", { description: textoDoErro(error) });
    atualizar();
    if (error) return;
    // Frente T2: papel novo, amostra nova (o peso desenhado acompanha o papel).
    setRefazendo(f.id);
    try {
      await fazerAmostra({ ...f, papel: novo });
      atualizar();
    } catch (e) {
      toast.warning("Papel salvo, mas a amostra não foi refeita", { description: textoDoErro(e) });
    } finally {
      setRefazendo(null);
    }
  };

  const comAmostra = lista.filter((f) => !!f.amostra_path);
  // Outra marca (CME) sem fonte própria vê as do cliente só para consulta: mexer nelas mudaria a marca principal.
  const soConsulta = !!(tipografia.data && tipografia.data.usaDoCliente);

  return (
    <div className="space-y-6">
      <Secao
        titulo={marca && !marca.principal ? `Fontes da ${marca.nome}` : "Fontes do cliente"}
        recolher={`mesa:contexto:fontes:lista:${clientId}`}
        resumo={tipografia.data ? `${lista.length} ${lista.length === 1 ? "fonte" : "fontes"}` : undefined}
        corpoClassName="space-y-3"
        ajuda={
          <>
            <span className="block">Escolher da biblioteca abre a galeria da agência com a amostra de cada família. Escolha a fonte de título e a de texto; a antiga do mesmo papel sai.</span>
            <span className="mt-1.5 block">O Estúdio anexa a amostra de cada fonte na geração para o gerador copiar o desenho, o peso e a proporção das letras. Ela se refaz sozinha quando a fonte entra ou muda de papel.</span>
          </>
        }
        acao={
          <>
            <Button type="button" size="sm" variant="outline" className="h-8 text-[12px]" onClick={() => setGaleria(true)}>
              <Library className="mr-1 h-3.5 w-3.5" />
              Escolher da biblioteca
            </Button>
            {lista.length > 0 ? (
              <Button type="button" size="sm" variant="outline" className="h-8 text-[12px]" onClick={() => void gerarTodas()} disabled={gerandoTodas || !!refazendo}>
                {gerandoTodas ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Type className="mr-1 h-3.5 w-3.5" />}
                Gerar amostra da tipografia
              </Button>
            ) : null}
          </>
        }
      >
        {tipografia.isLoading && <p className="text-[12.5px] text-muted-foreground">Lendo fontes…</p>}
        {tipografia.data && tipografia.data.usaDoCliente && marca && (
          <p className="text-[12px] text-muted-foreground">A {marca.nome} não tem fonte própria: usa as do cliente. Envie ou escolha para ter as dela.</p>
        )}
        {tipografia.data && lista.length === 0 && <p className="text-[12.5px] text-muted-foreground">Nenhuma fonte ainda. Sem fonte, o Estúdio não gera a arte.</p>}
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {lista.map((f) => (
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
              <div className="flex flex-wrap items-center p-2 [&>*]:m-1">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium">{f.nome}</p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {ROTULO_DA_ORIGEM[f.origem] || f.origem}
                    {f.amostra_path && !ehAmostraDaTipografia(f.amostra_path, clientId) ? " · amostra genérica" : ""}
                  </p>
                </div>
                <Select value={f.papel} onValueChange={(v) => void mudarPapel(f, v)} disabled={soConsulta}>
                  <SelectTrigger className="h-8 w-[120px] text-[12px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PAPEIS_DA_FONTE.map((p) => <SelectItem key={p.valor} value={p.valor}>{p.rotulo}</SelectItem>)}
                  </SelectContent>
                </Select>
                {!ehAmostraDaTipografia(f.amostra_path, clientId) && (
                  <Button type="button" size="sm" variant="outline" className="h-8 text-[12px]" onClick={() => void refazerAmostra(f)} disabled={refazendo === f.id || gerandoTodas}>
                    {refazendo === f.id && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                    Gerar amostra
                  </Button>
                )}
                <Button type="button" size="icon" variant="ghost" className="h-8 w-8" onClick={() => void apagar(f)} disabled={soConsulta} aria-label="Tirar fonte">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </Secao>

      <Secao titulo="Enviar arquivo de fonte" recolher={`mesa:contexto:fontes:enviar:${clientId}`} resumo=".ttf, .otf, .woff, .woff2">
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
      </Secao>

      <BibliotecaDeFontes aberto={galeria} onOpenChange={setGaleria} />
      <Ampliar
        imagens={comAmostra.map((f) => ({ caminho: f.amostra_path!, bucket: "mesa", titulo: f.nome, legenda: ROTULO_DA_ORIGEM[f.origem] || undefined }))}
        indice={ampliada}
        onFechar={() => setAmpliada(null)}
      />
    </div>
  );
}
