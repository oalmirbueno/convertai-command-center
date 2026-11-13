import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { EditorContent, useEditor, type ChainedCommands, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Placeholder from "@tiptap/extension-placeholder";
import Link from "@tiptap/extension-link";
import { Bold, Code, Code2, Heading1, Heading2, Heading3, Italic, Link2, List, ListChecks, ListOrdered, Minus, Pilcrow, Quote, Strikethrough } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { botao, campo, juntar, texto } from "@/components/sistema";
import { consultaDaBarra, filtrarBlocos, linkSeguro, type BlocoDoMenu, type BlocoId, type DocDoEditor } from "@/lib/produto/espaco";
import "./espaco.css";

/**
 * O editor de blocos do Espaço (TipTap). Este arquivo só é carregado quando a
 * pessoa abre uma página (lazy em EspacoDaConta), para não pesar o resto do CRM.
 *
 * - Texto, títulos 1 a 3, listas, lista de tarefas, citação, divisor, código e link.
 * - Atalhos de markdown vêm do próprio TipTap: "# ", "## ", "- ", "1. ", "[ ] ", "> ", "```", "---", **negrito**.
 * - Menu de barra: digitar "/" abre os tipos de bloco; setas escolhem, Enter aplica, Esc fecha.
 * - Sem edição (`editavel` falso) é só leitura: os links abrem e as caixas não marcam.
 *
 * Quem chama monta um editor por página (key = id): o conteúdo é o de partida.
 */

const ICONE_DO_BLOCO: Record<BlocoId, ReactNode> = {
  texto: <Pilcrow className="h-4 w-4" aria-hidden="true" />,
  titulo1: <Heading1 className="h-4 w-4" aria-hidden="true" />,
  titulo2: <Heading2 className="h-4 w-4" aria-hidden="true" />,
  titulo3: <Heading3 className="h-4 w-4" aria-hidden="true" />,
  lista: <List className="h-4 w-4" aria-hidden="true" />,
  numerada: <ListOrdered className="h-4 w-4" aria-hidden="true" />,
  tarefas: <ListChecks className="h-4 w-4" aria-hidden="true" />,
  citacao: <Quote className="h-4 w-4" aria-hidden="true" />,
  codigo: <Code2 className="h-4 w-4" aria-hidden="true" />,
  divisor: <Minus className="h-4 w-4" aria-hidden="true" />,
};

function aplicarBloco(c: ChainedCommands, id: BlocoId): ChainedCommands {
  if (id === "titulo1") return c.setHeading({ level: 1 });
  if (id === "titulo2") return c.setHeading({ level: 2 });
  if (id === "titulo3") return c.setHeading({ level: 3 });
  if (id === "lista") return c.toggleBulletList();
  if (id === "numerada") return c.toggleOrderedList();
  if (id === "tarefas") return c.toggleTaskList();
  if (id === "citacao") return c.setBlockquote();
  if (id === "codigo") return c.setCodeBlock();
  if (id === "divisor") return c.setHorizontalRule();
  return c.setParagraph();
}

interface MenuDeBarra {
  /** Onde a barra está no documento. */
  de: number;
  itens: BlocoDoMenu[];
  indice: number;
  esquerda: number;
  /** Abre para baixo (topo) ou, sem espaço embaixo, para cima (base). */
  topo: number | null;
  base: number | null;
}

/** Lê o que há depois da barra no bloco do cursor. Nulo quando não há menu para abrir. */
function lerBarra(editor: Editor): { de: number; consulta: string } | null {
  const { selection } = editor.state;
  if (!selection.empty) return null;
  const $de = selection.$from;
  if (!$de.parent.isTextblock || $de.parent.type.spec.code) return null;
  const antes = $de.parent.textBetween(0, $de.parentOffset, undefined, "￼");
  const consulta = consultaDaBarra(antes);
  if (consulta === null) return null;
  return { de: $de.pos - consulta.length - 1, consulta };
}

export default function EditorDaPagina({
  conteudo,
  editavel,
  aoMudar,
  pedidoDeFoco = 0,
}: {
  conteudo: DocDoEditor;
  editavel: boolean;
  aoMudar: (doc: DocDoEditor) => void;
  /** Muda de valor quando o título pede o cursor no começo do texto (Enter no título). */
  pedidoDeFoco?: number;
}) {
  const caixa = useRef<HTMLDivElement | null>(null);
  const [menu, setMenu] = useState<MenuDeBarra | null>(null);
  const menuAtual = useRef<MenuDeBarra | null>(null);
  menuAtual.current = menu;
  /** A barra que a pessoa fechou com Esc: não reabre enquanto ela continuar naquela barra. */
  const dispensada = useRef<number | null>(null);
  const aoMudarAtual = useRef(aoMudar);
  aoMudarAtual.current = aoMudar;
  const editorAtual = useRef<Editor | null>(null);

  const atualizarMenu = useCallback((ed: Editor) => {
    if (!ed.isEditable || !ed.isFocused) {
      setMenu(null);
      return;
    }
    const barra = lerBarra(ed);
    if (!barra) {
      dispensada.current = null;
      setMenu(null);
      return;
    }
    if (dispensada.current === barra.de) {
      setMenu(null);
      return;
    }
    const itens = filtrarBlocos(barra.consulta);
    const el = caixa.current;
    if (!itens.length || !el) {
      setMenu(null);
      return;
    }
    let ponto: { left: number; top: number; bottom: number };
    try {
      ponto = ed.view.coordsAtPos(barra.de);
    } catch {
      setMenu(null);
      return;
    }
    const borda = el.getBoundingClientRect();
    const altura = Math.min(320, itens.length * 36 + 10);
    const cabeEmbaixo = ponto.bottom + altura + 8 <= window.innerHeight;
    const esquerda = Math.max(0, Math.min(ponto.left - borda.left, borda.width - 264));
    const anterior = menuAtual.current;
    setMenu({
      de: barra.de,
      itens,
      indice: anterior && anterior.de === barra.de ? Math.min(anterior.indice, itens.length - 1) : 0,
      esquerda,
      topo: cabeEmbaixo ? ponto.bottom - borda.top + 6 : null,
      base: cabeEmbaixo ? null : borda.bottom - ponto.top + 6,
    });
  }, []);

  const escolher = useCallback((bloco: BlocoDoMenu) => {
    const ed = editorAtual.current;
    const m = menuAtual.current;
    if (!ed || !m) return;
    const ate = ed.state.selection.from;
    aplicarBloco(ed.chain().focus().deleteRange({ from: m.de, to: ate }), bloco.id).run();
    setMenu(null);
  }, []);
  const escolherAtual = useRef(escolher);
  escolherAtual.current = escolher;

  const editor = useEditor(
    {
      editable: editavel,
      content: conteudo,
      extensions: [
        StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
        TaskList,
        TaskItem.configure({ nested: true }),
        Placeholder.configure({
          placeholder: ({ node }) => (node.type.name === "heading" ? "Título" : "Escreva, ou digite / para escolher um bloco"),
          showOnlyWhenEditable: true,
        }),
        Link.configure({
          openOnClick: !editavel,
          autolink: true,
          linkOnPaste: true,
          protocols: ["http", "https", "mailto", "tel"],
          isAllowedUri: (url) => /^(https?:\/\/|mailto:|tel:)/i.test(String(url || "").trim()),
          HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" },
        }),
      ],
      editorProps: {
        attributes: {
          role: "textbox",
          "aria-multiline": "true",
          "aria-label": "Conteúdo da página",
          ...(editavel ? {} : { "aria-readonly": "true" }),
        },
        handleKeyDown: (_view, evento) => {
          const m = menuAtual.current;
          if (!m || !m.itens.length) return false;
          if (evento.key === "ArrowDown" || evento.key === "ArrowUp") {
            const passo = evento.key === "ArrowDown" ? 1 : -1;
            setMenu({ ...m, indice: (m.indice + passo + m.itens.length) % m.itens.length });
            return true;
          }
          if (evento.key === "Enter" || evento.key === "Tab") {
            escolherAtual.current(m.itens[m.indice]);
            return true;
          }
          if (evento.key === "Escape") {
            dispensada.current = m.de;
            setMenu(null);
            return true;
          }
          return false;
        },
      },
      onUpdate: ({ editor: ed }) => {
        aoMudarAtual.current(ed.getJSON() as DocDoEditor);
        atualizarMenu(ed as Editor);
      },
      onSelectionUpdate: ({ editor: ed }) => atualizarMenu(ed as Editor),
      onBlur: () => {
        // O clique num item do menu não tira o foco (mousedown é segurado); qualquer outro fecha.
        setMenu(null);
      },
    },
    [editavel],
  );
  editorAtual.current = editor;

  const primeiroPedido = useRef(pedidoDeFoco);
  useEffect(() => {
    if (!editor || pedidoDeFoco === primeiroPedido.current) return;
    editor.commands.focus("start");
  }, [editor, pedidoDeFoco]);

  // O item escolhido pelas setas fica à vista dentro do menu.
  const lista = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (!menu || !lista.current) return;
    const el = lista.current.querySelector<HTMLElement>("[data-escolhido='true']");
    if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "nearest" });
  }, [menu]);

  if (!editor) return null;

  return (
    <div ref={caixa} className="espaco-editor relative min-w-0" data-editor-da-pagina="" data-editavel={editavel ? "sim" : "nao"}>
      {editavel && <Ferramentas editor={editor} />}
      <EditorContent editor={editor} />
      {menu && (
        <div
          ref={lista}
          role="listbox"
          aria-label="Tipos de bloco"
          className="espaco-menu-de-barra espaco-so-na-tela"
          style={{ left: menu.esquerda, ...(menu.topo !== null ? { top: menu.topo } : { bottom: menu.base || 0 }) }}
          data-menu-de-barra=""
        >
          {menu.itens.map((bl, i) => (
            <button
              key={bl.id}
              type="button"
              role="option"
              aria-selected={i === menu.indice}
              data-escolhido={i === menu.indice ? "true" : "false"}
              data-compacto=""
              data-bloco={bl.id}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => escolher(bl)}
              onMouseEnter={() => setMenu((m) => (m && m.indice !== i ? { ...m, indice: i } : m))}
              className={juntar("flex h-9 w-full min-w-0 items-center rounded-md px-2 text-left text-[13px] text-foreground", i === menu.indice && "bg-muted")}
            >
              <span className="mr-2.5 flex h-6 w-6 shrink-0 items-center justify-center text-muted-foreground">{ICONE_DO_BLOCO[bl.id]}</span>
              <span className="min-w-0 flex-1 truncate">{bl.nome}</span>
              {bl.atalho && <span className={juntar(texto.etiqueta, "ml-2 shrink-0 font-mono text-muted-foreground")}>{bl.atalho}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Botao({ nome, ativo, aoClicar, children }: { nome: string; ativo?: boolean; aoClicar: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={nome}
      title={nome}
      aria-pressed={!!ativo}
      onMouseDown={(e) => e.preventDefault()}
      onClick={aoClicar}
      className={juntar(botao.icone, "mr-0.5", ativo && "bg-muted text-foreground")}
    >
      {children}
    </button>
  );
}

/** A faixa de formatação em cima do texto: o mesmo que os atalhos e o menu de barra, para quem prefere tocar. */
function Ferramentas({ editor }: { editor: Editor }) {
  // O editor não avisa o React a cada tecla: esta faixa relê o estado quando a seleção ou o texto mudam.
  const [, repintar] = useState(0);
  useEffect(() => {
    const avisar = () => repintar((n) => n + 1);
    editor.on("transaction", avisar);
    return () => {
      editor.off("transaction", avisar);
    };
  }, [editor]);

  const traco = <span className="mx-1.5 h-4 w-px shrink-0 bg-border" aria-hidden="true" />;
  const c = () => editor.chain().focus();
  const i = "h-4 w-4";

  return (
    <div role="toolbar" aria-label="Formatação" className="espaco-so-na-tela -mx-1 mb-3 flex min-w-0 items-center overflow-x-auto border-b border-border pb-2" data-ferramentas="">
      <Botao nome="Negrito" ativo={editor.isActive("bold")} aoClicar={() => c().toggleBold().run()}><Bold className={i} aria-hidden="true" /></Botao>
      <Botao nome="Itálico" ativo={editor.isActive("italic")} aoClicar={() => c().toggleItalic().run()}><Italic className={i} aria-hidden="true" /></Botao>
      <Botao nome="Riscado" ativo={editor.isActive("strike")} aoClicar={() => c().toggleStrike().run()}><Strikethrough className={i} aria-hidden="true" /></Botao>
      <Botao nome="Código no texto" ativo={editor.isActive("code")} aoClicar={() => c().toggleCode().run()}><Code className={i} aria-hidden="true" /></Botao>
      <BotaoDeLink editor={editor} />
      {traco}
      <Botao nome="Título 1" ativo={editor.isActive("heading", { level: 1 })} aoClicar={() => c().toggleHeading({ level: 1 }).run()}><Heading1 className={i} aria-hidden="true" /></Botao>
      <Botao nome="Título 2" ativo={editor.isActive("heading", { level: 2 })} aoClicar={() => c().toggleHeading({ level: 2 }).run()}><Heading2 className={i} aria-hidden="true" /></Botao>
      <Botao nome="Título 3" ativo={editor.isActive("heading", { level: 3 })} aoClicar={() => c().toggleHeading({ level: 3 }).run()}><Heading3 className={i} aria-hidden="true" /></Botao>
      {traco}
      <Botao nome="Lista" ativo={editor.isActive("bulletList")} aoClicar={() => c().toggleBulletList().run()}><List className={i} aria-hidden="true" /></Botao>
      <Botao nome="Lista numerada" ativo={editor.isActive("orderedList")} aoClicar={() => c().toggleOrderedList().run()}><ListOrdered className={i} aria-hidden="true" /></Botao>
      <Botao nome="Lista de tarefas" ativo={editor.isActive("taskList")} aoClicar={() => c().toggleTaskList().run()}><ListChecks className={i} aria-hidden="true" /></Botao>
      {traco}
      <Botao nome="Citação" ativo={editor.isActive("blockquote")} aoClicar={() => c().toggleBlockquote().run()}><Quote className={i} aria-hidden="true" /></Botao>
      <Botao nome="Bloco de código" ativo={editor.isActive("codeBlock")} aoClicar={() => c().toggleCodeBlock().run()}><Code2 className={i} aria-hidden="true" /></Botao>
      <Botao nome="Divisor" aoClicar={() => c().setHorizontalRule().run()}><Minus className={i} aria-hidden="true" /></Botao>
    </div>
  );
}

/** Link: um campo pequeno preso ao botão. Aceita só http, https, e-mail e telefone. */
function BotaoDeLink({ editor }: { editor: Editor }) {
  const [aberto, setAberto] = useState(false);
  const [endereco, setEndereco] = useState("");
  const [erro, setErro] = useState(false);
  const noLink = editor.isActive("link");

  const abrir = (v: boolean) => {
    if (v) {
      const atual = editor.getAttributes("link").href;
      setEndereco(typeof atual === "string" ? atual : "");
      setErro(false);
    }
    setAberto(v);
  };

  const aplicar = () => {
    const href = linkSeguro(endereco);
    if (!href) {
      setErro(true);
      return;
    }
    const vazio = editor.state.selection.empty && !noLink;
    if (vazio) {
      editor.chain().focus().insertContent({ type: "text", text: endereco.trim(), marks: [{ type: "link", attrs: { href } }] }).run();
    } else {
      editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
    }
    setAberto(false);
  };

  const tirar = () => {
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    setAberto(false);
  };

  const atual = noLink ? linkSeguro(String(editor.getAttributes("link").href || "")) : null;

  return (
    <Popover open={aberto} onOpenChange={abrir}>
      <PopoverTrigger asChild>
        <button type="button" aria-label="Link" title="Link" aria-pressed={noLink} onMouseDown={(e) => e.preventDefault()} className={juntar(botao.icone, "mr-0.5", noLink && "bg-muted text-foreground")} data-botao-de-link="">
          <Link2 className="h-4 w-4" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            aplicar();
          }}
        >
          <label htmlFor="espaco-link" className={texto.rotulo}>Endereço do link</label>
          <input
            id="espaco-link"
            className={juntar(campo, "mt-1.5")}
            value={endereco}
            onChange={(e) => {
              setEndereco(e.target.value);
              setErro(false);
            }}
            placeholder="https://"
            inputMode="url"
            autoComplete="off"
            aria-invalid={erro}
            aria-describedby={erro ? "espaco-link-erro" : undefined}
          />
          {erro && <p id="espaco-link-erro" className="mt-1.5 text-[12px] leading-4 text-destructive">Use um endereço que comece com https://, um e-mail ou um telefone.</p>}
          <div className="mt-3 flex min-w-0 items-center">
            <button type="submit" className={juntar(botao.primario, "h-8")}>Aplicar</button>
            {noLink && <button type="button" className={juntar(botao.discreto, "ml-1 h-8")} onClick={tirar}>Tirar link</button>}
            {atual && <a href={atual} target="_blank" rel="noopener noreferrer nofollow" className={juntar(botao.discreto, "ml-auto h-8")}>Abrir</a>}
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
