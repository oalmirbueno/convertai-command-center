import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { EyeOff, FolderSync, Loader2, Maximize2, Search, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  CATEGORIAS_DO_ACERVO,
  chamarFuncao,
  padraoPara,
  rotuloDaCategoria,
  textoDoErro,
} from "@/lib/mesa/api";
import { Ampliar, type ImagemAmpliavel } from "./Ampliar";
import { AvisoDeErro, BotaoComCusto, avisarCustoReal, useAvisarErro } from "./Custo";
import { legendaDaFoto } from "./ContextoFotos";
import { MiniaturaDoStorage } from "./ContextoMiniatura";
import { ImagemDaMesa, useMesa } from "./MesaContexto";
import { ExploradorDePastas, Quadrado } from "./NavegadorDePastas";
import { Campo, TituloDeSecao } from "./Seletores";
import { invalidarAcervo, useAcervo, type ImagemDoAcervo } from "./contextoDoCliente";
import { pastaDaFoto, pastasDoAcervo, useArvoreDoWorkspace } from "@/lib/mesa/pastas";

/**
 * Imagens (acervo de fotos reais do cliente): a Mesa traz as imagens de todas
 * as pastas do Workspace e de Arquivos, a IA organiza (descrição, categoria e
 * tags) e a equipe corrige. O Estúdio usa estas fotos como base das lâminas.
 *
 * "Por pasta" espelha a árvore do Workspace do cliente (pedido do dono,
 * 23/09: "já está tudo pronto lá"): cada foto aparece na mesma pasta onde o
 * arquivo mora no Workspace; as de Arquivos e as enviadas ganham pasta própria.
 */

const POR_GRUPO = 24;
const TOKENS_ENTRADA_POR_IMAGEM = 1500;
const TOKENS_SAIDA_POR_IMAGEM = 150;
const SEM_CATEGORIA = "";

type Agrupar = "categoria" | "pasta";

const ORDEM_DAS_CATEGORIAS = CATEGORIAS_DO_ACERVO.map((c) => c.valor);

function EditorDaImagem({ imagem, onFechar }: { imagem: ImagemDoAcervo; onFechar: () => void }) {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const [nome, setNome] = useState(imagem.nome);
  const [categoria, setCategoria] = useState(imagem.categoria || "outro");
  const [tags, setTags] = useState((imagem.tags || []).join(", "));
  const [descricao, setDescricao] = useState(imagem.descricao || "");
  const [ativa, setAtiva] = useState(imagem.ativa);
  const [salvando, setSalvando] = useState(false);

  const salvar = async () => {
    setSalvando(true);
    try {
      const listaDeTags: string[] = [];
      for (const t of tags.split(",")) {
        const limpa = t.trim().toLowerCase();
        if (limpa && listaDeTags.indexOf(limpa) < 0) listaDeTags.push(limpa);
      }
      const { error } = await (supabase as any)
        .from("cliente_imagens")
        .update({
          nome: nome.trim() || imagem.nome,
          categoria,
          tags: listaDeTags,
          descricao: descricao.trim() || null,
          ativa,
        })
        .eq("id", imagem.id);
      if (error) throw error;
      toast.success("Imagem salva");
      invalidarAcervo(queryClient, clientId);
      onFechar();
    } catch (e) {
      toast.error("Imagem não salva", { description: textoDoErro(e) });
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v && !salvando) onFechar(); }}>
      <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] max-w-2xl overflow-y-auto bg-background">
        <DialogHeader className="text-left">
          <DialogTitle className="[overflow-wrap:anywhere]">{imagem.nome}</DialogTitle>
          <DialogDescription className="text-[12px] [overflow-wrap:anywhere]">
            {imagem.origem === "workspace" ? "Workspace" : imagem.origem === "arquivo" ? "Arquivos" : "Enviada"}
            {imagem.pasta ? ` · pasta ${imagem.pasta}` : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[220px_minmax(0,1fr)]">
          <div className="min-w-0">
            <Quadrado className="border border-border">
              <ImagemDaMesa caminho={imagem.storage_path} bucket={imagem.storage_bucket} alt={imagem.nome} className="h-full w-full !object-contain" />
            </Quadrado>
          </div>
          <div className="min-w-0 space-y-3">
            <Campo rotulo="Nome">
              <Input value={nome} onChange={(e) => setNome(e.target.value)} className="h-9" />
            </Campo>
            <Campo rotulo="Categoria">
              <Select value={categoria} onValueChange={setCategoria}>
                <SelectTrigger className="h-9 text-[12.5px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIAS_DO_ACERVO.map((c) => <SelectItem key={c.valor} value={c.valor}>{c.rotulo}</SelectItem>)}
                </SelectContent>
              </Select>
            </Campo>
            <Campo rotulo="Tags (separadas por vírgula)">
              <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Ex.: quarto, luz natural, casal" className="h-9" />
            </Campo>
            <Campo rotulo="Descrição">
              <Textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} rows={3} placeholder="O que aparece na foto" />
            </Campo>
            <label className="flex items-center text-[12.5px]">
              <Switch checked={ativa} onCheckedChange={setAtiva} className="mr-2" />
              {ativa ? "Ativa: o Estúdio pode usar" : "Desativada: o Estúdio não usa"}
            </label>
          </div>
        </div>
        <DialogFooter className="flex-row justify-end">
          <Button type="button" variant="ghost" className="mr-2" onClick={onFechar} disabled={salvando}>Cancelar</Button>
          <Button type="button" onClick={() => void salvar()} disabled={salvando}>
            {salvando && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CartaoDoAcervo({ imagem, onAbrir, onAmpliar }: { imagem: ImagemDoAcervo; onAbrir: () => void; onAmpliar: () => void }) {
  const tags = imagem.tags || [];
  return (
    <div className={`relative min-w-0 rounded-xl border border-border bg-card p-1.5 transition-colors hover:border-primary/60 ${imagem.ativa ? "" : "opacity-60"}`}>
      <button type="button" onClick={onAbrir} title={imagem.descricao || imagem.nome} className="block w-full min-w-0 text-left">
        <Quadrado>
          <MiniaturaDoStorage bucket={imagem.storage_bucket || "mesa"} caminho={imagem.storage_path} alt={imagem.nome} className="h-full w-full" />
          {!imagem.ativa && (
            <span className="absolute left-1.5 top-1.5 flex items-center rounded-full bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
              <EyeOff className="mr-1 h-3 w-3" /> desativada
            </span>
          )}
        </Quadrado>
        <span className="mt-1.5 block truncate px-0.5 text-[12px] font-medium">{imagem.nome}</span>
        <span className="block truncate px-0.5 text-[11px] text-muted-foreground">
          {imagem.descricao ? imagem.descricao : "sem descrição"}
        </span>
        {tags.length > 0 && (
          <span className="mt-1 flex flex-wrap px-0.5">
            {tags.slice(0, 3).map((t) => (
              <span key={t} className="mb-0.5 mr-1 max-w-full truncate rounded-full bg-muted px-1.5 py-px text-[10px] text-muted-foreground">{t}</span>
            ))}
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={onAmpliar}
        aria-label={`Ver ${imagem.nome} maior`}
        title="Ver maior"
        className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-md bg-background/90 text-foreground shadow-sm hover:bg-background"
      >
        <Maximize2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export default function ContextoImagens() {
  const { clientId, catalogo, atualizarCusto } = useMesa();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const acervo = useAcervo(clientId);
  const [agrupar, setAgrupar] = useState<Agrupar>("pasta");
  const [pastaAberta, setPastaAberta] = useState("");
  const [busca, setBusca] = useState("");
  const [mostrarInativas, setMostrarInativas] = useState(false);
  const [abertos, setAbertos] = useState<Record<string, boolean>>({});
  const [editando, setEditando] = useState<ImagemDoAcervo | null>(null);
  const [ampliada, setAmpliada] = useState<{ lista: ImagemDoAcervo[]; indice: number } | null>(null);
  const [sincronizando, setSincronizando] = useState(false);

  const todas = useMemo(() => acervo.data || [], [acervo.data]);
  const arvore = useArvoreDoWorkspace(clientId, agrupar === "pasta");
  const espelho = useMemo(() => pastasDoAcervo(arvore.data || [], todas), [arvore.data, todas]);
  const noExplorador = useMemo(() => (mostrarInativas ? todas : todas.filter((i) => i.ativa)), [todas, mostrarInativas]);
  const ativas = todas.filter((i) => i.ativa);
  const semDescricao = ativas.filter((i) => !i.descricao || !i.descricao.trim());
  const leitor = padraoPara(catalogo, "leitura");
  const termo = busca.trim().toLowerCase();

  const grupos = useMemo(() => {
    const base = (mostrarInativas ? todas : todas.filter((i) => i.ativa)).filter(
      (i) =>
        !termo ||
        `${i.nome} ${i.pasta || ""} ${i.descricao || ""} ${rotuloDaCategoria(i.categoria)} ${(i.tags || []).join(" ")}`.toLowerCase().indexOf(termo) >= 0,
    );
    const m = new Map<string, ImagemDoAcervo[]>();
    for (const i of base) {
      const k = agrupar === "categoria" ? i.categoria || SEM_CATEGORIA : i.pasta || SEM_CATEGORIA;
      const lista = m.get(k) || [];
      lista.push(i);
      m.set(k, lista);
    }
    const chaves = Array.from(m.keys());
    chaves.sort((a, b) => {
      if (a === SEM_CATEGORIA) return 1;
      if (b === SEM_CATEGORIA) return -1;
      if (agrupar === "categoria") {
        const ia = ORDEM_DAS_CATEGORIAS.indexOf(a);
        const ib = ORDEM_DAS_CATEGORIAS.indexOf(b);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
      }
      return a.localeCompare(b, "pt-BR");
    });
    return chaves.map((k) => ({ chave: k, imagens: m.get(k) || [] }));
  }, [todas, termo, agrupar, mostrarInativas]);

  const rotuloDoGrupo = (chave: string) =>
    agrupar === "categoria" ? (chave ? rotuloDaCategoria(chave) : "Sem categoria (organize com IA)") : chave || "Sem pasta";

  const sincronizar = async () => {
    setSincronizando(true);
    try {
      const data = await chamarFuncao<{ novas?: number; total?: number }>("agente-contexto", { acao: "acervo_sincronizar", client_id: clientId });
      const novas = Number(data?.novas || 0);
      const total = Number(data?.total || 0);
      toast.success(novas ? `${novas} ${novas === 1 ? "imagem nova" : "imagens novas"} no acervo` : "O acervo já estava em dia", {
        description: total ? `${total} ${total === 1 ? "imagem" : "imagens"} no total.` : undefined,
      });
      invalidarAcervo(queryClient, clientId);
    } catch (e) {
      avisarErro(e, "Imagens não buscadas");
    } finally {
      setSincronizando(false);
    }
  };

  return (
    <div className="min-w-0 space-y-4">
      <section className="space-y-3 rounded-xl border border-border bg-card p-3.5">
        <div className="flex flex-col sm:flex-row sm:items-start">
          <div className="min-w-0 flex-1 sm:mr-3">
            <p className="text-[13px] font-medium">Fotos reais do cliente</p>
            <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
              {todas.length
                ? `${ativas.length} ${ativas.length === 1 ? "ativa" : "ativas"} de ${todas.length}. ${semDescricao.length ? `${semDescricao.length} sem descrição.` : "Todas organizadas."}`
                : "Traga as imagens de todas as pastas do Workspace e de Arquivos (fora os materiais entregues)."}
            </p>
          </div>
          <div className="mt-2 flex flex-wrap sm:mt-0 sm:justify-end">
            <Button type="button" size="sm" variant="outline" className="mb-1.5 mr-2 h-8 text-[12px]" onClick={() => void sincronizar()} disabled={sincronizando}>
              {sincronizando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <FolderSync className="mr-1.5 h-3.5 w-3.5" />}
              Buscar imagens do workspace e de Arquivos
            </Button>
            <BotaoComCusto
              rotulo={<><Sparkles className="mr-1.5 h-3.5 w-3.5" />Organizar com IA{semDescricao.length ? ` (${semDescricao.length})` : ""}</>}
              titulo="Organizar o acervo com IA"
              descricao="O modelo de leitura olha cada imagem sem descrição e preenche descrição, categoria e tags. A equipe pode corrigir depois."
              className="mb-1.5 h-8 text-[12px]"
              disabled={semDescricao.length === 0}
              fecharAoConfirmar
              partes={() => [
                {
                  modeloId: leitor?.id,
                  tipo: "texto",
                  tokensEntrada: TOKENS_ENTRADA_POR_IMAGEM,
                  tokensSaida: TOKENS_SAIDA_POR_IMAGEM,
                  vezes: semDescricao.length,
                },
              ]}
              executar={() => chamarFuncao("agente-contexto", { acao: "acervo_classificar", client_id: clientId })}
              aoConcluir={(data) => {
                const n = Number(data?.classificadas || 0);
                avisarCustoReal(`${n} ${n === 1 ? "imagem organizada" : "imagens organizadas"}`, data, atualizarCusto);
                invalidarAcervo(queryClient, clientId);
              }}
            />
          </div>
        </div>

        {todas.length > 0 && (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
            <div className="relative min-w-0">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome, pasta, tag ou descrição" className="h-9 pl-8" />
            </div>
            <div role="group" aria-label="Agrupar por" className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
              {(["pasta", "categoria"] as Agrupar[]).map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setAgrupar(a)}
                  aria-pressed={agrupar === a}
                  className={`rounded-md px-3 py-1 text-[12px] ${agrupar === a ? "bg-card font-medium text-foreground shadow-sm" : "text-muted-foreground"}`}
                >
                  Por {a}
                </button>
              ))}
            </div>
            <label className="flex items-center text-[12px] text-muted-foreground">
              <Switch checked={mostrarInativas} onCheckedChange={setMostrarInativas} className="mr-2" />
              Mostrar desativadas
            </label>
          </div>
        )}
      </section>

      {acervo.isLoading && (
        <p className="flex items-center text-[12px] text-muted-foreground"><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Lendo o acervo...</p>
      )}
      {acervo.isError && <AvisoDeErro erro={acervo.error} />}
      {acervo.data && todas.length === 0 && (
        <p className="rounded-xl border border-dashed border-border bg-card p-6 text-center text-[12.5px] text-muted-foreground">
          O acervo está vazio. Clique em "Buscar imagens do workspace e de Arquivos" para trazer as fotos do cliente.
        </p>
      )}
      {todas.length > 0 && grupos.length === 0 && (
        <p className="rounded-xl border border-dashed border-border bg-card p-4 text-center text-[12.5px] text-muted-foreground">Nenhuma imagem com essa busca.</p>
      )}

      {agrupar === "pasta" && !termo && todas.length > 0 && (
        <section className="min-w-0 rounded-xl border border-border bg-card p-3">
          <ExploradorDePastas<ImagemDoAcervo>
            pastas={espelho.pastas}
            itens={noExplorador}
            pastaDoItem={(i) => pastaDaFoto(i, espelho.pastaDoNo)}
            atual={pastaAberta}
            onAtual={setPastaAberta}
            carregando={arvore.isLoading}
            erro={arvore.isError ? "Não foi possível ler as pastas do Workspace." : null}
            vazio="Nenhuma foto nesta pasta."
            alturaMax="min(70vh, 720px)"
            renderizarItens={(lista) => (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
                {lista.map((i, n) => (
                  <CartaoDoAcervo key={i.id} imagem={i} onAbrir={() => setEditando(i)} onAmpliar={() => setAmpliada({ lista, indice: n })} />
                ))}
              </div>
            )}
          />
        </section>
      )}

      {(agrupar === "categoria" || !!termo) && grupos.map(({ chave, imagens }) => {
        const idGrupo = `${agrupar}:${chave}`;
        const aberto = !!abertos[idGrupo];
        const visiveis = aberto ? imagens : imagens.slice(0, POR_GRUPO);
        return (
          <section key={idGrupo} className="min-w-0 space-y-2">
            <TituloDeSecao acao={<span className="text-[11px] text-muted-foreground">{imagens.length}</span>}>
              <span className="[overflow-wrap:anywhere]">{rotuloDoGrupo(chave)}</span>
            </TituloDeSecao>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
              {visiveis.map((i, n) => (
                <CartaoDoAcervo key={i.id} imagem={i} onAbrir={() => setEditando(i)} onAmpliar={() => setAmpliada({ lista: imagens, indice: n })} />
              ))}
            </div>
            {imagens.length > POR_GRUPO && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8 text-[12px]"
                onClick={() => setAbertos((a) => ({ ...a, [idGrupo]: !aberto }))}
              >
                {aberto ? "Mostrar menos" : `Ver mais ${imagens.length - POR_GRUPO}`}
              </Button>
            )}
          </section>
        );
      })}

      {editando && <EditorDaImagem key={editando.id} imagem={editando} onFechar={() => setEditando(null)} />}
      <Ampliar
        imagens={(ampliada ? ampliada.lista : []).map(
          (i): ImagemAmpliavel => ({ caminho: i.storage_path, bucket: i.storage_bucket || "mesa", titulo: i.nome, legenda: legendaDaFoto(i) }),
        )}
        indice={ampliada ? ampliada.indice : null}
        onFechar={() => setAmpliada(null)}
      />
    </div>
  );
}
