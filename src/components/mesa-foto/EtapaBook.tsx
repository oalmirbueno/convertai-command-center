import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, BookImage, Check, Download, Images, Library, Loader2, Maximize2, MessageSquare, Plus, Search, Send, Sparkles, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Ampliar } from "@/components/mesa/Ampliar";
import { AvisoDeErro, BotaoComCusto, useAvisarErro } from "@/components/mesa/Custo";
import { imagensDoColar } from "@/components/mesa/EstudioFotos";
import { ImagemDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { SeletorDeQualidade } from "@/components/mesa/Seletores";
import { padraoPara, textoDoErro, usd, type Qualidade } from "@/lib/mesa/api";
import { AprovarFoto, useAcoesDeUso } from "./AcoesDeUso";
import AcoesProDaFoto from "./AcoesProDaFoto";
import { Cartao, MiniaturaDaFoto, Moldura, Pilulas } from "./Comuns";
import { ImagemDaBiblioteca } from "./EtapaBiblioteca";
import { ZonaDeEnvio } from "./EtapaAcervo";
import SeletorDeFotos from "./SeletorDeFotos";
import SeletorLateral, { type ItemDoSeletor } from "./SeletorLateral";
import { MenuDeUso } from "./UsoDaFoto";
import { useClones } from "./clonesApi";
import { acrescentarFotos, classeDaFoto, invalidarFotos, semearUrl, subirOriginais, useBiblioteca, useFotos, useKits, type FotoDoAcervo, type ItemDaBiblioteca } from "./fotoApi";
import { chaveDoAndamento, emParalelo, marcarAndamento, useAndamentos, usePersonas, usePrecoNoServidor } from "./modelosApi";
import {
  chaveDosBooks,
  criarBook,
  conversarNoBook,
  FORMATOS_DO_BOOK,
  gerarNoBook,
  guardarBookNaLista,
  MAX_ESTILO_POR_FOTO,
  moverNaSelecao,
  mudarBookAberto,
  novoIdDePedido,
  partesDoBook,
  partesDoDiretorDoBook,
  pedidoDaBiblioteca,
  salvarBook,
  TIPOS_DO_ASSUNTO,
  useBookAberto,
  useBooks,
  type Book,
  type BookAberto,
  type PedidoDoBook,
  type TipoDoAssunto,
} from "./bookApi";

/**
 * Book (pedido do dono, 26/09): "dentro da Mesa Foto, uma área de BOOK: um
 * estúdio fotográfico. Pegar as referências, trabalhar em cima de cada
 * produto ('quero o produto desse jeito') ou da pessoa; já ter um arsenal de
 * prompts lateral; colocar o prompt no agente, ele gera; selecionar as
 * imagens que eu quero; embaixo, mais referências; fazer um book completo
 * profissional, tanto do produto quanto da pessoa".
 *
 * Tela: à esquerda o arsenal de prompts da biblioteca (filtrado pelo
 * assunto, com as miniaturas); no centro o assunto, a conversa com o diretor
 * que monta os pedidos, a fila de pedidos (gerar em lote, custo antes), os
 * resultados para escolher e, embaixo, as referências; à direita o book final
 * em ordem (baixar em alta, uma a uma; aprovação; Arquivos).
 *
 * Reaproveita o que já existe: a biblioteca, o diretor (as mesmas regras da
 * casa), a identidade do kit, da persona e do clone (a variação do clone é a
 * mesma função da aba Clones, com a autorização). Sem laço de correção: gera
 * uma vez, a equipe escolhe. Nada escurece a foto; toda foto é marcada como
 * gerada.
 */

const chaveDoEscolhido = (clientId: string) => `mesa-foto:book:${clientId}`;
function lerEscolhido(clientId: string): string | null {
  try {
    return window.sessionStorage.getItem(chaveDoEscolhido(clientId));
  } catch {
    return null;
  }
}
function gravarEscolhido(clientId: string, id: string | null) {
  try {
    if (id) window.sessionStorage.setItem(chaveDoEscolhido(clientId), id);
    else window.sessionStorage.removeItem(chaveDoEscolhido(clientId));
  } catch {
    /* sem armazenamento: abre o primeiro */
  }
}

function Titulo({ children, acao }: { children: ReactNode; acao?: ReactNode }) {
  return (
    <div className="mb-1.5 flex min-w-0 flex-wrap items-center">
      <p className="mr-auto text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">{children}</p>
      {acao}
    </div>
  );
}

/** Grava partes do book: muda o cache na hora e manda à função; se ela recusar, relê. */
function useGravarBook(aberto: BookAberto) {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  return (campos: Partial<Pick<Book, "pedidos" | "referencias" | "selecao" | "status" | "nome">>) => {
    mudarBookAberto(queryClient, aberto.book.id, (b) => ({ ...b, book: { ...b.book, ...campos } }));
    salvarBook(aberto.book.id, campos)
      .then((b) => {
        if (b) guardarBookNaLista(queryClient, clientId, b);
      })
      .catch((e) => {
        avisarErro(e, "Book não gravado");
        void queryClient.invalidateQueries({ queryKey: ["mesa-foto", "book", aberto.book.id] });
      });
  };
}

// ------------------------------------------------------------------ lote fora da tela

async function rodarPedidos(p: { queryClient: QueryClient; clientId: string; bookId: string; pedidos: PedidoDoBook[]; qualidade: Qualidade; atualizar: () => void }) {
  let feitas = 0;
  let falhas = 0;
  let custo = 0;
  const avisos: string[] = [];
  const rodada = String(Date.now());
  const itens = p.pedidos.map((pedido, i) => ({ pedido, chave: chaveDoAndamento(p.bookId, "book", rodada, String(i)) }));
  itens.forEach((x) => marcarAndamento(x.chave, { estado: "gerando", erro: "" }));
  await emParalelo(itens, 2, async ({ pedido, chave }) => {
    try {
      const r = await gerarNoBook({ bookId: p.bookId, pedido, qualidade: p.qualidade });
      if (r.imagem) {
        const nova = r.imagem;
        // Aparece na hora, com a URL da resposta (sem esperar a releitura do book).
        semearUrl(p.queryClient, nova.storage_bucket, nova.storage_path, r.url);
        mudarBookAberto(p.queryClient, p.bookId, (b) => ({ ...b, resultados: [nova].concat(b.resultados.filter((x) => x.id !== nova.id)) }));
        acrescentarFotos(p.queryClient, p.clientId, [nova]);
      }
      r.avisos.forEach((a) => {
        if (avisos.indexOf(a) < 0) avisos.push(a);
      });
      custo += Number(r.custo_usd || 0);
      feitas++;
      marcarAndamento(chave, null);
    } catch (e) {
      falhas++;
      marcarAndamento(chave, { estado: "falhou", erro: `${pedido.titulo}: ${textoDoErro(e)}` });
    }
  });
  invalidarFotos(p.queryClient, p.clientId);
  p.atualizar();
  if (feitas) toast.success(`${feitas} ${feitas === 1 ? "foto pronta" : "fotos prontas"} no book`, { description: `Custo real: ${usd(custo)}.${falhas ? ` ${falhas} não saiu.` : ""}${avisos.length ? ` ${avisos[0]}` : ""}` });
  else if (falhas) toast.error("Nenhuma foto saiu", { description: "Veja o erro na fila e tente de novo." });
}

// ------------------------------------------------------------------ novo book

function NovoBook({ onCriado, onCancelar }: { onCriado: (b: Book) => void; onCancelar: () => void }) {
  const { clientId } = useMesa();
  const avisarErro = useAvisarErro();
  const [tipo, setTipo] = useState<TipoDoAssunto>("produto");
  const [assuntoId, setAssuntoId] = useState<string | null>(null);
  const [nome, setNome] = useState("");
  const [criando, setCriando] = useState(false);
  const [escolhendoFoto, setEscolhendoFoto] = useState(false);
  const kits = useKits(clientId);
  const personas = usePersonas(clientId, tipo === "persona");
  const clones = useClones(clientId, tipo === "clone");
  const fotos = useFotos(clientId);
  const opcoes: { id: string; nome: string; nota: string }[] =
    tipo === "produto"
      ? (kits.data || []).filter((k) => k.id && k.tipo !== "pessoa" && k.status !== "arquivado").map((k) => ({ id: String(k.id), nome: k.nome, nota: k.status === "confirmado" ? "confirmado" : "rascunho" }))
      : tipo === "persona"
        ? (personas.data || []).filter((p) => p.status !== "arquivada").map((p) => ({ id: p.id, nome: p.nome, nota: p.ancora_imagem_id ? (p.client_id ? "do cliente" : "da agência") : "sem âncora" }))
        : tipo === "clone"
          ? (clones.data || []).filter((c) => c.status !== "arquivada").map((c) => ({ id: c.id, nome: c.nome, nota: c.autorizacao_valida.ok ? "autorizado" : "autorização inválida" }))
          : [];
  const fotoEscolhida = tipo === "foto" && assuntoId ? (fotos.data || []).find((f) => f.id === assuntoId) || null : null;
  const criar = async () => {
    if (!assuntoId || criando) return;
    setCriando(true);
    try {
      const r = await criarBook(clientId, { tipo, id: assuntoId }, nome);
      if (!r.book) throw new Error("A função não devolveu o book criado.");
      toast.success(`${r.book.nome} criado`, { description: "Escolha prompts no arsenal, converse com o diretor e gere as fotos. O custo aparece antes." });
      onCriado(r.book);
    } catch (e) {
      avisarErro(e, "Book não criado");
    } finally {
      setCriando(false);
    }
  };
  return (
    <Cartao titulo="Novo book" dica="Um book é um ensaio completo de UM assunto: o produto ou a pessoa sai fiel às fotos de identidade, com as referências só como estilo.">
      <Pilulas
        rotulo="Assunto do book"
        opcoes={TIPOS_DO_ASSUNTO.map((t) => ({ valor: t.valor, rotulo: t.rotulo, dica: t.dica }))}
        valor={tipo}
        onEscolher={(t) => {
          setTipo(t);
          setAssuntoId(null);
        }}
      />
      {tipo === "foto" ? (
        <div className="mt-1 min-w-0">
          {fotoEscolhida ? (
            <div className="flex min-w-0 items-center">
              <span className="mr-2 block w-16 shrink-0">
                <MiniaturaDaFoto foto={fotoEscolhida} />
              </span>
              <span className="mr-2 min-w-0 truncate text-[12.5px] font-medium">{fotoEscolhida.nome}</span>
              <Button type="button" size="sm" variant="ghost" className="h-8 text-[12px]" onClick={() => setEscolhendoFoto(true)}>
                Trocar
              </Button>
            </div>
          ) : (
            <Button type="button" size="sm" variant="outline" className="h-8 text-[12px]" onClick={() => setEscolhendoFoto(true)}>
              <Images className="mr-1.5 h-3.5 w-3.5" /> Escolher a foto do acervo
            </Button>
          )}
          {escolhendoFoto && (
            <div className="mt-2">
              <SeletorDeFotos
                fotos={(fotos.data || []).filter((f) => !f.referencia_web)}
                titulo="Foto do assunto"
                multiplas={false}
                onUsar={(ids) => {
                  setAssuntoId(ids[0] || null);
                  setEscolhendoFoto(false);
                }}
                onFechar={() => setEscolhendoFoto(false)}
              />
            </div>
          )}
          <p className="mt-1 text-[11px] text-muted-foreground">Foto de pessoa real entra pelo Clone (com a autorização registrada).</p>
        </div>
      ) : opcoes.length === 0 ? (
        <p className="mt-1 text-[12px] text-muted-foreground">
          {tipo === "produto" ? "Nenhum produto identificado ainda: identifique em Fotos." : tipo === "persona" ? "Nenhuma persona ainda: crie em Modelos." : "Nenhum clone ainda: crie em Clones, com a autorização."}
        </p>
      ) : (
        <ul className="mt-1 grid min-w-0 grid-cols-1 gap-1.5 sm:grid-cols-2 xl:grid-cols-3" aria-label="Escolha o assunto">
          {opcoes.map((o) => (
            <li key={o.id} className="min-w-0">
              <button
                type="button"
                aria-pressed={assuntoId === o.id}
                onClick={() => setAssuntoId(o.id)}
                className={`flex w-full min-w-0 items-center rounded-lg border px-2.5 py-2 text-left ${assuntoId === o.id ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary/40"}`}
              >
                <span className="mr-auto min-w-0 truncate text-[12.5px] font-medium">{o.nome}</span>
                <span className="ml-2 shrink-0 text-[10.5px] text-muted-foreground">{o.nota}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
        <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome do book (opcional)" aria-label="Nome do book" className="h-9 text-[12.5px]" />
        <Button type="button" size="sm" className="h-9 text-[12.5px]" disabled={!assuntoId || criando} onClick={() => void criar()}>
          {criando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1.5 h-3.5 w-3.5" />} Criar book
        </Button>
        <Button type="button" size="sm" variant="ghost" className="h-9 text-[12.5px]" onClick={onCancelar}>
          Cancelar
        </Button>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">Criar não gasta. O custo aparece antes de cada geração.</p>
    </Cartao>
  );
}

// ------------------------------------------------------------------ arsenal de prompts

/** Os prompts da biblioteca que servem ao assunto, com a miniatura: pôr na fila ou mandar ao diretor. */
function ArsenalDePrompts({ aberto, paraODiretor, onParaODiretor }: { aberto: BookAberto; paraODiretor: string[]; onParaODiretor: (ids: string[]) => void }) {
  const { clientId } = useMesa();
  const biblioteca = useBiblioteca(clientId);
  const gravar = useGravarBook(aberto);
  const [busca, setBusca] = useState("");
  const [so, setSo] = useState<"assunto" | "todos">("assunto");
  const categorias = aberto.assunto.categorias;
  const prompts = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return (biblioteca.data || []).filter((i) => {
      if (i.tipo !== "prompt") return false;
      if (so === "assunto" && categorias.length && categorias.indexOf(i.categoria) < 0) return false;
      if (termo && `${i.titulo} ${i.prompt_pt} ${i.tags.join(" ")}`.toLowerCase().indexOf(termo) < 0) return false;
      return true;
    });
  }, [biblioteca.data, busca, so, categorias]);
  const porNaFila = (item: ItemDaBiblioteca) => {
    const p = pedidoDaBiblioteca(item);
    if (!p) return;
    gravar({ pedidos: aberto.book.pedidos.concat([p]) });
    toast.message("Na fila", { description: item.titulo });
  };
  return (
    <section className="min-w-0 rounded-xl border border-border bg-card p-2.5" aria-label="Arsenal de prompts" data-arsenal-de-prompts="">
      <Titulo>
        <Library className="mr-1 inline h-3.5 w-3.5" /> Arsenal de prompts · {prompts.length}
      </Titulo>
      <div className="relative mb-1.5 min-w-0">
        <Search className="pointer-events-none absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
        <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar prompt" aria-label="Buscar prompt" className="h-8 pl-7 text-[12px]" />
      </div>
      <Pilulas
        rotulo="Quais prompts"
        opcoes={[
          { valor: "assunto" as const, rotulo: aberto.assunto.tipo === "produto" || aberto.assunto.tipo === "foto" ? "Do produto" : "Da pessoa" },
          { valor: "todos" as const, rotulo: "Todos" },
        ]}
        valor={so}
        onEscolher={setSo}
      />
      {biblioteca.isLoading && <p className="text-[11.5px] text-muted-foreground">Lendo a biblioteca...</p>}
      <ul className="min-w-0 space-y-1 lg:max-h-[70vh] lg:overflow-y-auto" style={{ overscrollBehavior: "contain" }} aria-label="Prompts da biblioteca">
        {prompts.slice(0, 80).map((i) => {
          const marcado = paraODiretor.indexOf(i.id) >= 0;
          return (
            <li key={i.id} className={`flex min-w-0 items-start rounded-lg border p-1.5 ${marcado ? "border-primary/60 bg-primary/5" : "border-transparent hover:border-border"}`} data-prompt-do-arsenal={i.id}>
              <span className="relative mr-2 block h-11 w-11 shrink-0 overflow-hidden rounded-md bg-muted">
                <ImagemDaBiblioteca item={i} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[11.5px] font-medium" title={i.titulo}>
                  {i.titulo}
                </span>
                <span className="mt-0.5 flex flex-wrap">
                  <button type="button" className="mr-2 text-[10.5px] font-medium text-primary hover:underline" onClick={() => porNaFila(i)}>
                    Pôr na fila
                  </button>
                  <button type="button" aria-pressed={marcado} className="text-[10.5px] text-muted-foreground hover:text-foreground" onClick={() => onParaODiretor(marcado ? paraODiretor.filter((x) => x !== i.id) : paraODiretor.concat([i.id]).slice(-8))}>
                    {marcado ? "tirar do diretor" : "mandar ao diretor"}
                  </button>
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ------------------------------------------------------------------ diretor

function DiretorDoBook({ aberto, paraODiretor, onLimpar }: { aberto: BookAberto; paraODiretor: string[]; onLimpar: () => void }) {
  const { clientId, catalogo } = useMesa();
  const queryClient = useQueryClient();
  const biblioteca = useBiblioteca(clientId);
  const [mensagem, setMensagem] = useState("");
  const [quantidade, setQuantidade] = useState(4);
  const escolhidos = (biblioteca.data || []).filter((i) => paraODiretor.indexOf(i.id) >= 0);
  const ultima = aberto.book.conversa.filter((m) => m.papel === "diretor").pop() || null;
  return (
    <div className="min-w-0 rounded-lg border border-border bg-background p-2.5" data-diretor-do-book="">
      <Titulo>
        <MessageSquare className="mr-1 inline h-3.5 w-3.5" /> Diretor do book
      </Titulo>
      {ultima && <p className="mb-2 rounded-md bg-primary/5 px-2 py-1.5 text-[12px] leading-snug [overflow-wrap:anywhere]">{ultima.texto}</p>}
      <Textarea
        value={mensagem}
        onChange={(e) => setMensagem(e.target.value)}
        rows={2}
        placeholder={aberto.assunto.tipo === "produto" || aberto.assunto.tipo === "foto" ? "Ex.: quero o produto na bancada de travertino com luz de fim de tarde, e um close da textura" : "Ex.: book da pessoa no trabalho, retrato editorial e um corpo inteiro na rua"}
        aria-label="Pedido ao diretor do book"
        className="text-[12.5px]"
      />
      {escolhidos.length > 0 && (
        <div className="mt-1.5 flex min-w-0 flex-wrap items-center">
          {escolhidos.map((i) => (
            <span key={i.id} className="mb-1 mr-1 inline-flex max-w-full items-center rounded-full border border-primary/30 bg-card px-2 py-px text-[11px] text-primary">
              <span className="truncate">{i.titulo}</span>
            </span>
          ))}
          <button type="button" className="mb-1 text-[11px] text-muted-foreground hover:text-foreground" onClick={onLimpar}>
            limpar
          </button>
        </div>
      )}
      <div className="mt-1.5 flex min-w-0 flex-wrap items-center">
        <span className="mb-1.5 mr-1.5 text-[11.5px] text-muted-foreground">Pedidos:</span>
        <Pilulas rotulo="Quantos pedidos o diretor monta" opcoes={[2, 4, 6, 8].map((n) => ({ valor: n, rotulo: String(n) }))} valor={quantidade} onEscolher={setQuantidade} className="mr-1" />
        <BotaoComCusto
          rotulo={
            <>
              <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Montar os pedidos
            </>
          }
          titulo="Pedidos do diretor"
          descricao="O diretor lê o contexto do cliente, o assunto, os prompts escolhidos e as referências e monta os pedidos de foto (texto, não gera imagem). Eles entram na fila para você revisar."
          className="mb-1.5 h-8 text-[12px]"
          disabled={!mensagem.trim() && !escolhidos.length}
          partes={() => partesDoDiretorDoBook(padraoPara(catalogo, "diretor_arte"))}
          executar={() => conversarNoBook({ bookId: aberto.book.id, mensagem, promptIds: paraODiretor, quantidade })}
          aoConcluir={(data) => {
            if (!data) return;
            const novos = (data.pedidos || []) as PedidoDoBook[];
            mudarBookAberto(queryClient, aberto.book.id, (b) => ({ ...b, book: { ...b.book, conversa: data.conversa || b.book.conversa, pedidos: b.book.pedidos.concat(novos) } }));
            salvarBook(aberto.book.id, { pedidos: aberto.book.pedidos.concat(novos) }).catch(() => undefined);
            setMensagem("");
            onLimpar();
            if (data.avisos && data.avisos.length) toast.message("Diretor", { description: data.avisos.join(" ") });
          }}
        />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ fila de pedidos

function FilaDePedidos({ aberto }: { aberto: BookAberto }) {
  const { clientId, catalogo, atualizarCusto } = useMesa();
  const queryClient = useQueryClient();
  const andamentos = useAndamentos();
  const gravar = useGravarBook(aberto);
  const [marcados, setMarcados] = useState<string[] | null>(null);
  const [qualidade, setQualidade] = useState<Qualidade>("alta");
  const [livre, setLivre] = useState("");
  const pedidos = aberto.book.pedidos;
  const ids = marcados === null ? pedidos.map((p) => p.id) : marcados.filter((id) => pedidos.some((p) => p.id === id));
  const escolhidos = pedidos.filter((p) => ids.indexOf(p.id) >= 0);
  const chaves = Object.keys(andamentos).filter((k) => k.indexOf(`${aberto.book.id}|book|`) === 0);
  const gerando = chaves.filter((k) => andamentos[k].estado === "gerando").length;
  const falhas = chaves.filter((k) => andamentos[k].estado === "falhou").map((k) => andamentos[k].erro);
  const refs = (aberto.assunto.tipo === "clone" ? 6 : aberto.assunto.tipo === "produto" ? 4 : 2) + Math.min(MAX_ESTILO_POR_FOTO, aberto.book.referencias.length);
  const servidor = usePrecoNoServidor(clientId, "book_gerar", { book_id: aberto.book.id, quantidade: Math.max(1, escolhidos.length), qualidade }, escolhidos.length > 0);
  const mudar = (id: string, campos: Partial<PedidoDoBook>) => gravar({ pedidos: pedidos.map((p) => (p.id === id ? { ...p, ...campos } : p)) });
  const tirar = (id: string) => gravar({ pedidos: pedidos.filter((p) => p.id !== id) });
  const somarLivre = () => {
    const t = livre.trim();
    if (!t) return;
    gravar({ pedidos: pedidos.concat([{ id: novoIdDePedido(), titulo: t.slice(0, 60), prompt: t, formato: "4:5", origem: { tipo: "livre", id: null }, referencias: [] }]) });
    setLivre("");
  };
  const alternar = (id: string) => setMarcados(ids.indexOf(id) >= 0 ? ids.filter((x) => x !== id) : ids.concat([id]));
  return (
    <div className="min-w-0" data-fila-do-book="">
      <Titulo acao={<span className="text-[11px] text-muted-foreground">{escolhidos.length} de {pedidos.length} marcados</span>}>Fila de pedidos (uma foto por pedido)</Titulo>
      {pedidos.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-3 text-center text-[12px] text-muted-foreground">Ponha prompts do arsenal, peça ao diretor ou escreva um pedido abaixo.</p>
      ) : (
        <ul className="space-y-1.5" aria-label="Pedidos do book">
          {pedidos.map((p) => {
            const marcado = ids.indexOf(p.id) >= 0;
            return (
              <li key={p.id} className={`min-w-0 rounded-lg border p-2 ${marcado ? "border-primary/40 bg-card" : "border-border bg-muted/30"}`} data-pedido-do-book={p.id}>
                <div className="flex min-w-0 items-center">
                  <input type="checkbox" checked={marcado} onChange={() => alternar(p.id)} className="mr-2 h-4 w-4 shrink-0 accent-[hsl(var(--primary))]" aria-label={`Gerar ${p.titulo}`} />
                  <Input value={p.titulo} onChange={(e) => mudar(p.id, { titulo: e.target.value })} aria-label="Título do pedido" className="mr-1.5 h-7 min-w-0 flex-1 text-[12px] font-medium" />
                  <span className="mr-1 shrink-0 text-[10px] text-muted-foreground">{p.origem.tipo === "biblioteca" ? "biblioteca" : p.origem.tipo === "diretor" ? "diretor" : "livre"}</span>
                  <button type="button" aria-label={`Tirar ${p.titulo}`} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted" onClick={() => tirar(p.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <Textarea value={p.prompt} onChange={(e) => mudar(p.id, { prompt: e.target.value })} rows={2} aria-label={`Prompt de ${p.titulo}`} className="mt-1.5 text-[12px]" />
                <div className="mt-1 flex min-w-0 flex-wrap items-center">
                  <Pilulas rotulo={`Formato de ${p.titulo}`} opcoes={FORMATOS_DO_BOOK.map((f) => ({ valor: f, rotulo: f }))} valor={p.formato} onEscolher={(f) => mudar(p.id, { formato: f })} />
                </div>
                {aberto.referencias.length > 0 && (
                  <div className="mt-0.5 flex min-w-0 flex-wrap items-center text-[11px]">
                    <span className="mb-1 mr-1.5 text-muted-foreground">Estilo:</span>
                    {aberto.referencias.map((r) => {
                      const usa = p.referencias.indexOf(r.id) >= 0;
                      return (
                        <button
                          key={r.id}
                          type="button"
                          aria-pressed={usa}
                          className={`mb-1 mr-1 max-w-[140px] truncate rounded-full border px-2 py-px ${usa ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}
                          onClick={() => mudar(p.id, { referencias: usa ? p.referencias.filter((x) => x !== r.id) : p.referencias.concat([r.id]).slice(-MAX_ESTILO_POR_FOTO) })}
                        >
                          {r.titulo}
                        </button>
                      );
                    })}
                    {p.referencias.length === 0 && <span className="mb-1 text-muted-foreground">(sem escolha: as {Math.min(MAX_ESTILO_POR_FOTO, aberto.referencias.length)} primeiras)</span>}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-2 flex min-w-0 items-center">
        <Input
          value={livre}
          onChange={(e) => setLivre(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") somarLivre();
          }}
          placeholder="Escreva um pedido (ex.: o produto de cima, sobre linho, sombra de janela)"
          aria-label="Pedido livre do book"
          className="mr-1.5 h-9 min-w-0 flex-1 text-[12.5px]"
        />
        <Button type="button" size="sm" variant="outline" className="h-9 shrink-0 text-[12px]" onClick={somarLivre} disabled={!livre.trim()}>
          <Plus className="mr-1 h-3.5 w-3.5" /> Pôr na fila
        </Button>
      </div>
      <div className="mt-2 grid min-w-0 grid-cols-1 items-center gap-2 border-t border-border pt-2.5 sm:grid-cols-[220px_minmax(0,1fr)]">
        <SeletorDeQualidade valor={qualidade} onChange={setQualidade} />
        <div className="flex min-w-0 flex-wrap items-center">
          <BotaoComCusto
            rotulo={
              <>
                <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Gerar {escolhidos.length} {escolhidos.length === 1 ? "foto" : "fotos"}
              </>
            }
            titulo="Fotos do book"
            descricao={`Uma foto por pedido; aparece aqui assim que sai e fica salva mesmo se você sair da aba.${typeof servidor.data === "number" ? ` Pela função: ~${usd(servidor.data)}.` : ""}`}
            className="mb-1.5 mr-2 h-9 text-[12.5px]"
            disabled={!escolhidos.length || gerando > 0 || aberto.book.status === "arquivado"}
            fecharAoConfirmar
            partes={() => partesDoBook(padraoPara(catalogo, "imagem") ? padraoPara(catalogo, "imagem")!.id : null, qualidade, refs, escolhidos.length)}
            executar={() => {
              void rodarPedidos({ queryClient, clientId, bookId: aberto.book.id, pedidos: escolhidos, qualidade, atualizar: atualizarCusto });
              return Promise.resolve({});
            }}
          />
          {gerando > 0 && (
            <span className="mb-1.5 inline-flex items-center text-[12px] text-muted-foreground" role="status">
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> gerando {gerando}
            </span>
          )}
        </div>
      </div>
      {falhas.slice(0, 3).map((e, i) => (
        <p key={`${i}-${e}`} className="text-[11px] text-destructive [overflow-wrap:anywhere]" role="alert">
          {e}
        </p>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ resultados

function ResultadosDoBook({ aberto }: { aberto: BookAberto }) {
  const queryClient = useQueryClient();
  const andamentos = useAndamentos();
  const gravar = useGravarBook(aberto);
  const [ampliada, setAmpliada] = useState<number | null>(null);
  const [aberta, setAberta] = useState<string | null>(null);
  const gerando = Object.keys(andamentos).filter((k) => k.indexOf(`${aberto.book.id}|book|`) === 0 && andamentos[k].estado === "gerando").length;
  const selecao = aberto.book.selecao;
  const noBook = (id: string) => selecao.indexOf(id) >= 0;
  const alternar = (id: string) => gravar({ selecao: noBook(id) ? selecao.filter((x) => x !== id) : selecao.concat([id]) });
  const mudou = (f: FotoDoAcervo) => mudarBookAberto(queryClient, aberto.book.id, (b) => ({ ...b, resultados: b.resultados.map((x) => (x.id === f.id ? f : x)) }));
  const fotoAberta = aberta ? aberto.resultados.find((f) => f.id === aberta) || null : null;
  if (!aberto.resultados.length && !gerando) return null;
  return (
    <div className="min-w-0" data-resultados-do-book="">
      <Titulo acao={<span className="text-[11px] text-muted-foreground">{selecao.length} no book</span>}>Resultados · {aberto.resultados.length} (marque as que vão para o book)</Titulo>
      {fotoAberta && (
        <div className="mb-2 grid min-w-0 grid-cols-1 gap-2.5 rounded-xl border border-primary/40 bg-card p-2.5 sm:grid-cols-[160px_minmax(0,1fr)]" data-resultado-aberto={fotoAberta.id}>
          <Moldura proporcao={fotoAberta.largura && fotoAberta.altura ? fotoAberta.largura / fotoAberta.altura : 0.8} className="border border-border">
            <ImagemDaMesa caminho={fotoAberta.storage_path} bucket={fotoAberta.storage_bucket || "mesa"} alt={fotoAberta.nome} className="h-full w-full !object-contain" />
          </Moldura>
          <div className="min-w-0 space-y-1.5">
            <div className="flex min-w-0 items-start">
              <p className="mr-auto truncate text-[12.5px] font-semibold">{fotoAberta.nome}</p>
              <button type="button" aria-label="Fechar o resultado" className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted" onClick={() => setAberta(null)}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex min-w-0 flex-wrap items-center">
              <Button type="button" size="sm" variant={noBook(fotoAberta.id) ? "default" : "outline"} className="mb-1.5 mr-1.5 h-8 text-[12px]" onClick={() => alternar(fotoAberta.id)}>
                <BookImage className="mr-1.5 h-3.5 w-3.5" /> {noBook(fotoAberta.id) ? "No book" : "Pôr no book"}
              </Button>
              <AprovarFoto foto={fotoAberta} onMudou={mudou} />
              <MenuDeUso foto={fotoAberta} rotulo="Usar" variante="outline" className="mb-1.5" />
            </div>
            <p className="mb-1 text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">Ampliar e tirar fundo (pro)</p>
            <AcoesProDaFoto
              foto={fotoAberta}
              onPronta={(nova) => {
                // A versão ampliada entra nos resultados (tag do book herdada ou não, ela é do book).
                mudarBookAberto(queryClient, aberto.book.id, (b) => ({ ...b, resultados: [nova].concat(b.resultados.filter((x) => x.id !== nova.id)) }));
                if (noBook(fotoAberta.id)) gravar({ selecao: selecao.map((x) => (x === fotoAberta.id ? nova.id : x)) });
                setAberta(nova.id);
              }}
            />
          </div>
        </div>
      )}
      <ul className="grid min-w-0 grid-cols-3 gap-1.5 sm:grid-cols-4 xl:grid-cols-5" aria-label="Resultados do book">
        {Array.from({ length: gerando }, (_x, i) => (
          <li key={`gerando-${i}`} className="min-w-0 rounded-lg border border-dashed border-primary/40 bg-card p-1" data-resultado-gerando="">
            <Moldura proporcao={1} className="animate-pulse">
              <span className="flex h-full w-full flex-col items-center justify-center text-[11px] text-muted-foreground">
                <Loader2 className="mb-1 h-4 w-4 animate-spin text-primary" /> gerando
              </span>
            </Moldura>
          </li>
        ))}
        {aberto.resultados.map((f, i) => (
          <li key={f.id} className={`relative min-w-0 rounded-lg border bg-card p-1 ${noBook(f.id) ? "border-primary" : "border-border"}`} data-resultado-do-book={f.id}>
            <div className="relative">
              <button type="button" className="block w-full" onClick={() => setAberta(f.id)} aria-label={`Abrir ${f.nome}`}>
                <MiniaturaDaFoto foto={f} />
              </button>
              <button type="button" onClick={() => setAmpliada(i)} aria-label={`Ver grande ${f.nome}`} className="absolute bottom-1 right-1 flex h-5 w-5 items-center justify-center rounded-md border border-border bg-card text-muted-foreground shadow-sm">
                <Maximize2 className="h-3 w-3" />
              </button>
            </div>
            <button
              type="button"
              aria-pressed={noBook(f.id)}
              onClick={() => alternar(f.id)}
              className={`mt-1 flex w-full items-center justify-center rounded-md border px-1 py-0.5 text-[11px] font-medium ${noBook(f.id) ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}
            >
              {noBook(f.id) ? (
                <>
                  <Check className="mr-0.5 h-3 w-3" /> no book
                </>
              ) : (
                "pôr no book"
              )}
            </button>
          </li>
        ))}
      </ul>
      <Ampliar
        imagens={aberto.resultados.map((f) => ({ caminho: f.storage_path, bucket: f.storage_bucket || "mesa", titulo: f.nome, legenda: "Imagem gerada por IA.", proporcao: f.largura && f.altura ? f.largura / f.altura : undefined }))}
        indice={ampliada}
        onFechar={() => setAmpliada(null)}
      />
    </div>
  );
}

// ------------------------------------------------------------------ referências (embaixo)

function ReferenciasDoBook({ aberto }: { aberto: BookAberto }) {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const gravar = useGravarBook(aberto);
  const fotos = useFotos(clientId);
  const biblioteca = useBiblioteca(clientId);
  const [modo, setModo] = useState<"nenhum" | "acervo" | "biblioteca">("nenhum");
  const [andamento, setAndamento] = useState<string | null>(null);
  const refs = aberto.book.referencias;
  const somar = (novas: { tipo: "acervo" | "biblioteca"; id: string }[]) => {
    const lista = refs.slice();
    novas.forEach((n) => {
      if (!lista.some((r) => r.id === n.id)) lista.push(n);
    });
    gravar({ referencias: lista.slice(0, 12) });
    // A leitura do book traz o título e a URL de cada referência nova.
    window.setTimeout(() => void queryClient.invalidateQueries({ queryKey: ["mesa-foto", "book", aberto.book.id] }), 800);
  };
  const subir = async (arquivos: File[]) => {
    if (!arquivos.length || andamento) return;
    setAndamento("Subindo referências");
    try {
      const r = await subirOriginais(clientId, arquivos.slice(0, 6), (feitos, total) => setAndamento(feitos < total ? `Subindo ${feitos} de ${total}` : "Registrando"));
      acrescentarFotos(queryClient, clientId, r.registradas);
      invalidarFotos(queryClient, clientId);
      somar(r.registradas.map((f) => ({ tipo: "acervo" as const, id: f.id })));
    } catch (e) {
      avisarErro(e, "Referências não subiram");
    } finally {
      setAndamento(null);
    }
  };
  // Ctrl+V com imagem na aba: vira referência (colar texto segue normal).
  const subirRef = useRef(subir);
  subirRef.current = subir;
  useEffect(() => {
    const aoColar = (e: ClipboardEvent) => {
      const alvo = e.target as HTMLElement | null;
      const imagens = imagensDoColar(e.clipboardData);
      if (!imagens.length || (alvo && (alvo.tagName === "INPUT" || alvo.tagName === "TEXTAREA"))) return;
      e.preventDefault();
      void subirRef.current(imagens);
    };
    window.addEventListener("paste", aoColar);
    return () => window.removeEventListener("paste", aoColar);
  }, []);
  const refsDaBiblioteca = (biblioteca.data || []).filter((i) => i.tipo === "referencia" || !!(i.storage_path || i.imagem_url || i.miniatura_url));
  return (
    <div className="min-w-0 border-t border-border pt-3" data-referencias-do-book="">
      <Titulo acao={<span className="text-[11px] text-muted-foreground">só como estilo; até {MAX_ESTILO_POR_FOTO} por foto</span>}>Referências · {refs.length}</Titulo>
      {aberto.referencias.length > 0 && (
        <ul className="mb-2 grid min-w-0 grid-cols-4 gap-1.5 sm:grid-cols-6 xl:grid-cols-8" aria-label="Referências do book">
          {aberto.referencias.map((r) => (
            <li key={r.id} className="relative min-w-0" data-referencia-do-book={r.id}>
              <Moldura proporcao={1} className="border border-border">
                {r.storage_path ? (
                  <ImagemDaMesa caminho={r.storage_path} alt={r.titulo} className="h-full w-full" />
                ) : r.url ? (
                  <img src={r.url} alt={r.titulo} loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">sem imagem</span>
                )}
              </Moldura>
              <p className="mt-0.5 truncate text-[10px] text-muted-foreground" title={r.titulo}>
                {r.titulo}
              </p>
              <button type="button" aria-label={`Tirar a referência ${r.titulo}`} className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-md border border-border bg-card text-muted-foreground" onClick={() => gravar({ referencias: refs.filter((x) => x.id !== r.id) })}>
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="grid min-w-0 grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
        <ZonaDeEnvio compacta onArquivos={(a) => void subir(a)} andamento={andamento} />
        <div className="flex min-w-0 flex-wrap items-center">
          <Button type="button" size="sm" variant="outline" className="mb-1.5 mr-1.5 h-8 text-[12px]" onClick={() => setModo(modo === "acervo" ? "nenhum" : "acervo")}>
            <Images className="mr-1.5 h-3.5 w-3.5" /> Do acervo
          </Button>
          <Button type="button" size="sm" variant="outline" className="mb-1.5 h-8 text-[12px]" onClick={() => setModo(modo === "biblioteca" ? "nenhum" : "biblioteca")}>
            <Library className="mr-1.5 h-3.5 w-3.5" /> Da biblioteca
          </Button>
        </div>
      </div>
      {modo === "acervo" && (
        <div className="mt-2">
          <SeletorDeFotos
            fotos={fotos.data || []}
            titulo="Referências do acervo (só estilo)"
            jaEscolhidas={refs.filter((r) => r.tipo === "acervo").map((r) => r.id)}
            onUsar={(ids) => {
              somar(ids.map((id) => ({ tipo: "acervo" as const, id })));
              setModo("nenhum");
            }}
            onFechar={() => setModo("nenhum")}
          />
        </div>
      )}
      {modo === "biblioteca" && (
        <ul className="mt-2 grid min-w-0 grid-cols-4 gap-1.5 rounded-xl border border-border bg-card p-2 sm:grid-cols-6 xl:grid-cols-8" aria-label="Referências da biblioteca">
          {refsDaBiblioteca.slice(0, 48).map((i) => {
            const ja = refs.some((r) => r.id === i.id);
            return (
              <li key={i.id} className="min-w-0">
                <button type="button" disabled={ja} className={`block w-full rounded-lg border p-0.5 text-left ${ja ? "border-primary" : "border-transparent hover:border-border"}`} onClick={() => somar([{ tipo: "biblioteca", id: i.id }])} aria-label={`Usar ${i.titulo} como referência`}>
                  <Moldura proporcao={1}>
                    <ImagemDaBiblioteca item={i} />
                  </Moldura>
                  <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">{i.titulo}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-1 text-[11px] text-muted-foreground">Solte, cole (Ctrl+V) ou escolha. A referência dá luz, cenário, paleta e clima; o assunto sai sempre das fotos de identidade.</p>
    </div>
  );
}

// ------------------------------------------------------------------ book final

function BookFinal({ aberto }: { aberto: BookAberto }) {
  const gravar = useGravarBook(aberto);
  const { baixar, enviar, baixando, enviando } = useAcoesDeUso();
  const fotos = aberto.book.selecao.map((id) => aberto.resultados.find((f) => f.id === id)).filter((f): f is FotoDoAcervo => !!f);
  const semAprovar = fotos.filter((f) => classeDaFoto(f) === "gerada" && !f.aprovada).length;
  return (
    <section className="min-w-0 rounded-xl border border-border bg-card p-2.5" aria-label="Book final" data-book-final="">
      <Titulo acao={<span className="text-[11px] text-muted-foreground">{aberto.book.status === "entregue" ? "entregue" : "em ordem"}</span>}>
        <BookImage className="mr-1 inline h-3.5 w-3.5" /> Book final · {fotos.length}
      </Titulo>
      {fotos.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">Marque "pôr no book" nos resultados. A ordem daqui é a do book.</p>
      ) : (
        <ol className="space-y-1" aria-label="Fotos do book em ordem">
          {fotos.map((f, i) => (
            <li key={f.id} className="flex min-w-0 items-center rounded-lg border border-border p-1" data-foto-do-book={f.id}>
              <span className="mr-1.5 w-4 shrink-0 text-center text-[11px] font-semibold tabular-nums text-muted-foreground">{i + 1}</span>
              <span className="mr-2 block w-10 shrink-0">
                <MiniaturaDaFoto foto={f} selo={false} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[11.5px] font-medium">{f.nome}</span>
                <span className={`text-[10.5px] ${f.aprovada ? "text-success" : "text-muted-foreground"}`}>{f.aprovada ? "aprovada" : "a aprovar"}</span>
              </span>
              <button type="button" aria-label={`Subir ${f.nome}`} className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-40" disabled={i === 0} onClick={() => gravar({ selecao: moverNaSelecao(aberto.book.selecao, f.id, -1) })}>
                <ArrowUp className="h-3.5 w-3.5" />
              </button>
              <button type="button" aria-label={`Descer ${f.nome}`} className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-40" disabled={i === fotos.length - 1} onClick={() => gravar({ selecao: moverNaSelecao(aberto.book.selecao, f.id, 1) })}>
                <ArrowDown className="h-3.5 w-3.5" />
              </button>
              <button type="button" aria-label={`Baixar ${f.nome}`} title="Original, sem ZIP" className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted" disabled={!!baixando} onClick={() => void baixar([f])}>
                <Download className="h-3.5 w-3.5" />
              </button>
              <button type="button" aria-label={`Tirar ${f.nome} do book`} className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted" onClick={() => gravar({ selecao: aberto.book.selecao.filter((x) => x !== f.id) })}>
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ol>
      )}
      {fotos.length > 0 && (
        <div className="mt-2 flex min-w-0 flex-wrap items-center border-t border-border pt-2">
          <Button type="button" size="sm" variant="outline" className="mb-1.5 mr-1.5 h-8 text-[12px]" disabled={!!baixando} onClick={() => void baixar(fotos)} title="Uma a uma, no tamanho original">
            {baixando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1.5 h-3.5 w-3.5" />}
            {baixando ? `Baixando ${baixando.feitos} de ${baixando.total}` : "Baixar o book (sem ZIP)"}
          </Button>
          <Button type="button" size="sm" variant="outline" className="mb-1.5 mr-1.5 h-8 text-[12px]" disabled={!!enviando} onClick={() => void enviar(fotos, "aprovacao")}>
            {enviando === "aprovacao" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1.5 h-3.5 w-3.5" />} Mandar para aprovação
          </Button>
          <Button type="button" size="sm" variant="ghost" className="mb-1.5 mr-1.5 h-8 text-[12px]" disabled={!!enviando} onClick={() => void enviar(fotos, "arquivos")}>
            <Upload className="mr-1.5 h-3.5 w-3.5" /> Arquivos
          </Button>
          {aberto.book.status !== "entregue" && (
            <Button type="button" size="sm" variant="ghost" className="mb-1.5 h-8 text-[12px]" onClick={() => gravar({ status: "entregue" })}>
              <Check className="mr-1.5 h-3.5 w-3.5" /> Marcar entregue
            </Button>
          )}
          {semAprovar > 0 && <p className="w-full text-[11px] text-muted-foreground">{semAprovar} ainda sem a aprovação da equipe: aprove antes de mandar ao cliente.</p>}
        </div>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ book aberto

function BookAbertoNaTela({ id }: { id: string }) {
  const q = useBookAberto(id);
  const [paraODiretor, setParaODiretor] = useState<string[]>([]);
  if (q.isError && !q.data) return <AvisoDeErro erro={q.error} />;
  if (!q.data) {
    return (
      <div aria-busy="true" className="space-y-3">
        <div className="h-20 animate-pulse rounded-xl bg-muted" />
        <div className="h-[40vh] animate-pulse rounded-xl bg-muted/70" />
      </div>
    );
  }
  const aberto = q.data;
  const a = aberto.assunto;
  return (
    // Terceira coluna (o book final) só na tela grande: no notebook (até 1799 px) ele desce para baixo do estúdio.
    <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[250px_minmax(0,1fr)] min-[1800px]:grid-cols-[260px_minmax(0,1fr)_300px]" data-book-aberto={aberto.book.id}>
      <div className="order-2 min-w-0 lg:order-none">
        <ArsenalDePrompts aberto={aberto} paraODiretor={paraODiretor} onParaODiretor={setParaODiretor} />
      </div>
      <div className="order-1 min-w-0 space-y-3 lg:order-none">
        <section className="flex min-w-0 items-center rounded-xl border border-border bg-card p-2.5" aria-label="Assunto do book">
          <span className="relative mr-3 block h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-muted">
            {a.capa_url ? <img src={a.capa_url} alt={a.nome} className="h-full w-full object-cover" loading="lazy" /> : <BookImage className="m-4 h-6 w-6 text-muted-foreground" />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] font-semibold">{aberto.book.nome}</p>
            <p className="truncate text-[11.5px] text-muted-foreground">
              {TIPOS_DO_ASSUNTO.find((t) => t.valor === a.tipo)?.rotulo}: {a.nome}
              {a.detalhe ? ` · ${a.detalhe}` : ""}
              {aberto.book.custo_usd ? ` · ${usd(aberto.book.custo_usd)} gasto` : ""}
            </p>
            {a.aviso && <p className="text-[11.5px] font-medium text-warning [overflow-wrap:anywhere]">{a.aviso}</p>}
          </div>
        </section>
        <Cartao titulo="Estúdio" dica="Diga ao diretor como quer o assunto, ou ponha prompts do arsenal na fila. Gere, escolha as boas e monte o book.">
          <div className="space-y-3">
            <DiretorDoBook aberto={aberto} paraODiretor={paraODiretor} onLimpar={() => setParaODiretor([])} />
            <FilaDePedidos aberto={aberto} />
            <ResultadosDoBook aberto={aberto} />
            <ReferenciasDoBook aberto={aberto} />
          </div>
        </Cartao>
        <div className="min-[1800px]:hidden">
          <BookFinal aberto={aberto} />
        </div>
      </div>
      <div className="hidden min-w-0 min-[1800px]:block">
        <BookFinal aberto={aberto} />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ etapa

export default function EtapaBook() {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const booksQ = useBooks(clientId);
  const books = useMemo(() => booksQ.data || [], [booksQ.data]);
  const [escolhido, setEscolhido] = useState<string | null>(() => lerEscolhido(clientId));
  const [novo, setNovo] = useState(false);
  const aberto = books.find((b) => b.id === escolhido) || (novo ? null : books[0] || null);
  useEffect(() => {
    gravarEscolhido(clientId, aberto ? aberto.id : null);
  }, [clientId, aberto]);
  const itens: ItemDoSeletor[] = books.map((b) => ({
    id: b.id,
    nome: b.nome,
    miniatura: (
      <span className="flex h-full w-full items-center justify-center text-muted-foreground">
        <BookImage className="h-4 w-4" />
      </span>
    ),
    estado: { rotulo: b.status === "entregue" ? "entregue" : `${b.selecao.length} no book`, ponto: b.status === "entregue" ? "bg-success" : "bg-primary" },
    nota: TIPOS_DO_ASSUNTO.find((t) => t.valor === b.assunto.tipo)?.rotulo.toLowerCase() || null,
  }));
  const semTabela = booksQ.isError && /migration 05|foto_books/i.test(textoDoErro(booksQ.error));
  return (
    <div className="min-w-0 space-y-3 pb-24">
      {booksQ.isError && <AvisoDeErro erro={booksQ.error} />}
      {semTabela && <p className="text-[12px] text-muted-foreground">O Book precisa da migration 05 (docs/mesa-foto/migrations/05_book.sql) no banco.</p>}
      <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-[250px_minmax(0,1fr)] md:items-start">
        <SeletorLateral
          titulo="Books"
          itens={itens}
          escolhido={aberto ? aberto.id : null}
          onEscolher={(id) => {
            setNovo(false);
            setEscolhido(id);
          }}
          onNovo={() => setNovo(true)}
          novoRotulo="Novo book"
          novoAberto={novo}
          vazio="Nenhum book ainda. Crie o primeiro: escolha o produto ou a pessoa."
        />
        <p className="hidden text-[12px] leading-relaxed text-muted-foreground md:block">
          Estúdio fotográfico de UM assunto: o arsenal de prompts fica à esquerda, o diretor monta os pedidos, você gera com o custo antes, marca as boas e fecha o book em ordem (baixar em alta, aprovação e Arquivos).
        </p>
      </div>
      {novo || !aberto ? (
        novo || booksQ.isSuccess ? (
          <NovoBook
            onCancelar={() => setNovo(false)}
            onCriado={(b) => {
              guardarBookNaLista(queryClient, clientId, b);
              setEscolhido(b.id);
              setNovo(false);
              void queryClient.invalidateQueries({ queryKey: chaveDosBooks(clientId) });
            }}
          />
        ) : (
          booksQ.isLoading && <div className="h-40 animate-pulse rounded-xl bg-muted" aria-busy="true" />
        )
      ) : (
        <BookAbertoNaTela key={aberto.id} id={aberto.id} />
      )}
    </div>
  );
}
