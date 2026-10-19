import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, FileCode2, Folder, Loader2, Lock, RotateCw, Save, Search } from "lucide-react";
import { toast } from "sonner";
import { useAvisarErro } from "@/components/mesa/Custo";
import JanelaCentral from "@/components/sistema/JanelaCentral";
import { botao, campo, juntar, rolagem, texto } from "@/components/sistema/estilos";
import { arvoreDosArquivos, buscarNosArquivos, motivoDeProtecao, type NoDaArvore } from "../../../supabase/functions/mesa-site/modulos/editor-de-codigo";
import { abrirZipDoCodigo, comFimDeLinhaOriginal, sha256DoTexto, type ArquivoDoCodigo } from "./arquivosDoNavegador";
import { CHAVES, chamarSite, type LinhaDoSite } from "./siteApi";

/**
 * Editor de código no navegador (Gravyx, 19/10/2026: "Arquivos da página"),
 * só equipe. Abre o código mais novo que o motor guardou (o zip do rascunho
 * ou da versão salva), mostra a árvore, busca nos arquivos e edita numa caixa
 * leve com números de linha (sem biblioteca: carrega só quando abre). Salvar
 * vira um trabalho do motor sem IA e sem custo: grava no RASCUNHO, recompila
 * e confere; o rascunho segue o Salvar versão e o Descartar de sempre. Cada
 * arquivo leva a marca (sha256) de quando foi aberto: se o motor ou outra
 * pessoa mexeu nele depois, o motor recusa em vez de passar por cima.
 */

type Leitura = {
  arquivos: ArquivoDoCodigo[];
  commit: string | null;
  em: string | null;
  casca: string[];
  importado: boolean;
  rascunho: { aberto: boolean; em_andamento: boolean };
};

const ALTURA_DA_LINHA = 20;
const semCr = (t: string) => t.split("\r\n").join("\n");

function lerCasca(arquivos: ArquivoDoCodigo[]): string[] {
  const c = arquivos.find((a) => a.caminho === ".aceleriq/casca.json");
  try {
    const v = c && c.texto ? (JSON.parse(c.texto) as { arquivos?: unknown }) : null;
    return v && Array.isArray(v.arquivos) ? v.arquivos.map((x) => String(x)) : [];
  } catch {
    return [];
  }
}

function Arvore({ nos, aberto, onAbrir, mudados, nivel = 0 }: { nos: NoDaArvore[]; aberto: string | null; onAbrir: (c: string) => void; mudados: Set<string>; nivel?: number }) {
  const [fechadas, setFechadas] = useState<Set<string>>(() => new Set(nivel === 0 ? nos.filter((n) => n.pasta && (n.nome.charAt(0) === "." || n.nome === "public")).map((n) => n.caminho) : []));
  return (
    <ul className="min-w-0" role={nivel === 0 ? "tree" : "group"}>
      {nos.map((n) => {
        const fechada = fechadas.has(n.caminho);
        return (
          <li key={n.caminho} className="min-w-0" role="treeitem" aria-expanded={n.pasta ? !fechada : undefined} aria-selected={!n.pasta && aberto === n.caminho}>
            <button
              type="button"
              className={juntar("flex w-full min-w-0 items-center rounded px-1.5 py-0.5 text-left", texto.corpo, !n.pasta && aberto === n.caminho ? "bg-primary/10" : "hover:bg-muted/60")}
              style={{ paddingLeft: 6 + nivel * 12 }}
              onClick={() => {
                if (!n.pasta) return onAbrir(n.caminho);
                setFechadas((f) => {
                  const g = new Set(f);
                  if (g.has(n.caminho)) g.delete(n.caminho);
                  else g.add(n.caminho);
                  return g;
                });
              }}
              title={n.caminho}
            >
              {n.pasta ? (fechada ? <ChevronRight className="mr-1 h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : <ChevronDown className="mr-1 h-3.5 w-3.5 shrink-0" aria-hidden="true" />) : <span className="mr-1 w-3.5 shrink-0" />}
              {n.pasta ? <Folder className="mr-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" /> : null}
              <span className="min-w-0 flex-1 truncate">{n.nome}</span>
              {!n.pasta && mudados.has(n.caminho) && <span className="ml-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" aria-label="alterado" />}
            </button>
            {n.pasta && !fechada && <Arvore nos={n.filhos} aberto={aberto} onAbrir={onAbrir} mudados={mudados} nivel={nivel + 1} />}
          </li>
        );
      })}
    </ul>
  );
}

export default function EditorDeCodigo({ site, aberta, onMudar }: { site: LinhaDoSite; aberta: boolean; onMudar: (v: boolean) => void }) {
  const qc = useQueryClient();
  const avisarErro = useAvisarErro();
  const [leitura, setLeitura] = useState<Leitura | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [semCodigo, setSemCodigo] = useState<string | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);
  /** O que foi editado (sem CR), por caminho. */
  const [edicoes, setEdicoes] = useState<Record<string, string>>({});
  const [salvando, setSalvando] = useState(false);
  const [buscando, setBuscando] = useState(false);
  const [termo, setTermo] = useState("");
  const caixa = useRef<HTMLTextAreaElement>(null);
  const margem = useRef<HTMLDivElement>(null);

  const ler = async () => {
    setCarregando(true);
    setSemCodigo(null);
    try {
      const d = await chamarSite<{ zip: { url: string; commit: string | null; em: string | null } | null; rascunho: Leitura["rascunho"]; motivo?: string }>("codigo_ler", { site_id: site.id });
      if (!d.zip) {
        setLeitura(null);
        setSemCodigo(d.motivo || "O código ainda não foi guardado.");
        return;
      }
      const arquivos = await abrirZipDoCodigo(d.zip.url);
      const importado = arquivos.some((a) => a.caminho === ".aceleriq/importado.json");
      const casca = lerCasca(arquivos);
      setLeitura({ arquivos, commit: d.zip.commit, em: d.zip.em, casca, importado, rascunho: d.rascunho });
      setEdicoes({});
      // Abre num arquivo que se edita: a página inicial, o App ou o primeiro de texto fora do motor e da casca.
      const editaveis = arquivos.filter((a) => a.texto !== null && !motivoDeProtecao(a.caminho, importado ? [] : casca));
      const primeiro = editaveis.find((a) => a.caminho === "index.html") || editaveis.find((a) => /^src\/(App|main)\.(tsx|jsx|ts|js)$/.test(a.caminho)) || editaveis.find((a) => a.caminho.indexOf("src/secoes/") === 0) || editaveis[0] || null;
      setAberto((atual) => (atual && arquivos.some((a) => a.caminho === atual) ? atual : primeiro ? primeiro.caminho : null));
    } catch (e) {
      avisarErro(e, "O código não abriu");
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => {
    if (aberta && !leitura && !carregando) void ler();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberta]);

  const porCaminho = useMemo(() => {
    const m = new Map<string, ArquivoDoCodigo>();
    (leitura ? leitura.arquivos : []).forEach((a) => m.set(a.caminho, a));
    return m;
  }, [leitura]);
  const arvore = useMemo(() => arvoreDosArquivos((leitura ? leitura.arquivos : []).map((a) => a.caminho)), [leitura]);
  const mudados = useMemo(() => {
    const s = new Set<string>();
    Object.keys(edicoes).forEach((c) => {
      const a = porCaminho.get(c);
      if (a && a.texto !== null && edicoes[c] !== semCr(a.texto)) s.add(c);
    });
    return s;
  }, [edicoes, porCaminho]);
  const achados = useMemo(() => (buscando && leitura ? buscarNosArquivos(leitura.arquivos.filter((a) => a.texto !== null).map((a) => ({ caminho: a.caminho, conteudo: edicoes[a.caminho] !== undefined ? edicoes[a.caminho] : semCr(a.texto as string) })), termo) : []), [buscando, leitura, termo, edicoes]);

  const atual = aberto ? porCaminho.get(aberto) || null : null;
  const protecao = atual ? motivoDeProtecao(atual.caminho, leitura && !leitura.importado ? leitura.casca : []) : null;
  const editavel = !!atual && atual.texto !== null && !protecao;
  const valor = atual && atual.texto !== null ? (edicoes[atual.caminho] !== undefined ? edicoes[atual.caminho] : semCr(atual.texto)) : "";
  const linhas = valor ? valor.split("\n").length : 1;
  const numeros = useMemo(() => Array.from({ length: linhas }, (_, i) => String(i + 1)).join("\n"), [linhas]);

  const irParaLinha = (caminho: string, linha: number) => {
    setAberto(caminho);
    window.setTimeout(() => {
      const el = caixa.current;
      if (!el) return;
      el.scrollTop = Math.max(0, (linha - 3) * ALTURA_DA_LINHA);
      const partes = el.value.split("\n");
      const inicio = partes.slice(0, linha - 1).reduce((n, l) => n + l.length + 1, 0);
      el.focus();
      el.setSelectionRange(inicio, inicio + (partes[linha - 1] || "").length);
    }, 30);
  };

  const salvar = async () => {
    if (!leitura || !mudados.size || salvando) return;
    setSalvando(true);
    try {
      const arquivos = Array.from(mudados).map((c) => {
        const a = porCaminho.get(c) as ArquivoDoCodigo;
        return { caminho: c, conteudo: comFimDeLinhaOriginal(edicoes[c], a.crlf), sha_antes: a.sha };
      });
      await chamarSite("codigo_salvar", { site_id: site.id, arquivos, de: leitura.commit || undefined });
      // O que foi mandado vira a base (a marca nova é a do conteúdo que o motor vai gravar).
      const novos = await Promise.all(arquivos.map(async (a) => ({ caminho: a.caminho, texto: a.conteudo, sha: await sha256DoTexto(a.conteudo) })));
      setLeitura((l) => (l ? { ...l, rascunho: { ...l.rascunho, aberto: true }, arquivos: l.arquivos.map((x) => { const n = novos.find((y) => y.caminho === x.caminho); return n ? { ...x, texto: n.texto, sha: n.sha } : x; }) } : l));
      setEdicoes({});
      void qc.invalidateQueries({ queryKey: CHAVES.trabalhos(site.id) });
      toast.success(`${arquivos.length === 1 ? "Arquivo na fila" : `${arquivos.length} arquivos na fila`} do motor: ele grava no rascunho, compila e confere (sem custo).`);
    } catch (e) {
      avisarErro(e, "O código não foi salvo");
    } finally {
      setSalvando(false);
    }
  };

  const teclas = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) {
      e.preventDefault();
      void salvar();
      return;
    }
    if (e.key === "Tab" && !e.shiftKey && atual) {
      e.preventDefault();
      const el = e.currentTarget;
      const ini = el.selectionStart;
      const fim = el.selectionEnd;
      const novo = `${valor.slice(0, ini)}  ${valor.slice(fim)}`;
      setEdicoes((x) => ({ ...x, [atual.caminho]: novo }));
      window.setTimeout(() => el.setSelectionRange(ini + 2, ini + 2), 0);
    }
  };

  const status = leitura
    ? `${leitura.arquivos.length} arquivos${leitura.commit ? ` · versão ${leitura.commit.slice(0, 8)}` : ""}${leitura.rascunho.em_andamento ? " · motor trabalhando" : leitura.rascunho.aberto ? " · rascunho aberto" : ""}${leitura.importado ? " · importado" : ""}`
    : carregando
      ? "Abrindo o código"
      : semCodigo || "";

  const painelDeBusca = buscando ? (
    <div className="mb-2 min-w-0">
      <input value={termo} onChange={(e) => setTermo(e.target.value)} placeholder="Buscar nos arquivos" className={juntar(campo, "h-8")} aria-label="Buscar nos arquivos" />
      <ul className={juntar(rolagem.janela, "mt-1 min-w-0 sm:max-h-none")} data-achados="">
        {achados.map((a) => (
          <li key={`${a.caminho}:${a.linha}`}>
            <button type="button" className={juntar(texto.auxiliar, "block w-full min-w-0 truncate rounded px-1.5 py-0.5 text-left hover:bg-muted/60")} onClick={() => irParaLinha(a.caminho, a.linha)} title={`${a.caminho}:${a.linha}`}>
              <span className="text-foreground">{`${a.caminho.split("/").pop()}:${a.linha}`}</span> {a.trecho}
            </button>
          </li>
        ))}
        {termo.length >= 2 && !achados.length && <li className={juntar(texto.auxiliar, "px-1.5")}>Nada achado.</li>}
      </ul>
    </div>
  ) : null;

  return (
    <JanelaCentral
      aberta={aberta}
      onMudar={(v) => {
        if (!v && mudados.size && !window.confirm(`Há ${mudados.size} ${mudados.size === 1 ? "arquivo alterado" : "arquivos alterados"} sem salvar. Fechar mesmo assim?`)) return;
        onMudar(v);
      }}
      titulo={`Código de ${site.nome}`}
      icone={<FileCode2 className="h-4 w-4" />}
      descricao={status}
      ajuda="O código mais novo que o motor guardou (o do rascunho, se houver um). Salvar não gasta IA: o motor grava no rascunho, compila e confere no computador e no celular; depois é Salvar versão ou Descartar, como sempre. Arquivos do motor (pacote, marca, casca da casa, dependências) e de segredo ficam só para leitura: peça ao diretor de site. Se o motor ou outra pessoa mexeu no arquivo depois que você abriu, o Salvar é recusado: abra de novo e refaça. Ctrl+S salva."
      largura="tela"
      corpo="fixo"
      semEspaco
      data-editor-de-codigo=""
      acoes={
        <>
          <button type="button" className={juntar(botao.icone, buscando ? "bg-muted text-foreground" : "")} aria-label="Buscar nos arquivos" title="Buscar nos arquivos" aria-pressed={buscando} onClick={() => setBuscando((b) => !b)} data-buscar-no-codigo="">
            <Search className="h-4 w-4" />
          </button>
          <button type="button" className={botao.icone} aria-label="Abrir de novo" title="Abrir de novo (o código mais novo do motor)" onClick={() => (mudados.size && !window.confirm("As alterações sem salvar saem. Abrir de novo?") ? undefined : void ler())} disabled={carregando}>
            {carregando ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />}
          </button>
          <button type="button" className={juntar(botao.primario, "ml-1 h-8 px-3")} onClick={() => void salvar()} disabled={!mudados.size || salvando || (!!leitura && leitura.rascunho.em_andamento)} title={leitura && leitura.rascunho.em_andamento ? "O motor está mexendo no site: salve quando ele terminar" : "Salvar no rascunho (sem custo)"} data-salvar-codigo="">
            {salvando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Save className="mr-1 h-3.5 w-3.5" aria-hidden="true" />}
            {mudados.size > 1 ? `Salvar ${mudados.size}` : "Salvar"}
          </button>
        </>
      }
    >
      <div className="flex h-full min-h-0 min-w-0 flex-col sm:flex-row">
        {/* Árvore (computador) ou lista de escolha (celular). */}
        <div className="hidden min-h-0 w-64 shrink-0 overflow-y-auto overscroll-contain border-r border-border p-2 sm:block" data-arvore-do-codigo="">
          {painelDeBusca}
          <Arvore nos={arvore} aberto={aberto} onAbrir={setAberto} mudados={mudados} />
        </div>
        <div className="shrink-0 border-b border-border p-2 sm:hidden">
          {painelDeBusca}
          <select className={campo} value={aberto || ""} onChange={(e) => setAberto(e.target.value || null)} aria-label="Arquivo aberto">
            {(leitura ? leitura.arquivos : []).map((a) => (
              <option key={a.caminho} value={a.caminho}>{`${mudados.has(a.caminho) ? "* " : ""}${a.caminho}`}</option>
            ))}
          </select>
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {!leitura && (
            <div className="flex flex-1 items-center justify-center p-6">
              <p className={juntar(texto.corpo, "flex items-center text-muted-foreground")}>
                {carregando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                {carregando ? "Abrindo o código guardado" : semCodigo || "Sem código para mostrar."}
              </p>
            </div>
          )}
          {leitura && atual && (
            <>
              <div className="flex min-w-0 shrink-0 items-center border-b border-border px-3 py-1.5">
                <span className={juntar(texto.auxiliar, "min-w-0 flex-1 truncate font-mono")} title={atual.caminho}>{atual.caminho}</span>
                {!editavel && (
                  <span className={juntar(texto.auxiliar, "ml-2 flex shrink-0 items-center")} title={protecao || "binário ou grande demais para o editor"}>
                    <Lock className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                    Só leitura
                  </span>
                )}
              </div>
              {atual.texto === null ? (
                <p className={juntar(texto.corpo, "p-4 text-muted-foreground")}>{`Arquivo binário ou grande demais para o editor (${Math.max(1, Math.round(atual.bytes / 1024))} KB).`}</p>
              ) : (
                <div className="flex min-h-0 min-w-0 flex-1 font-mono text-[12px] leading-5">
                  <div ref={margem} className="w-12 shrink-0 select-none overflow-hidden bg-muted/40 py-2 pr-2 text-right text-muted-foreground" aria-hidden="true">
                    <pre className="m-0 font-mono text-[12px] leading-5">{numeros}</pre>
                  </div>
                  <textarea
                    ref={caixa}
                    value={valor}
                    readOnly={!editavel}
                    onChange={(e) => editavel && setEdicoes((x) => ({ ...x, [atual.caminho]: e.target.value }))}
                    onScroll={(e) => {
                      if (margem.current) margem.current.scrollTop = e.currentTarget.scrollTop;
                    }}
                    onKeyDown={teclas}
                    wrap="off"
                    spellCheck={false}
                    autoCapitalize="off"
                    autoCorrect="off"
                    aria-label={`Conteúdo de ${atual.caminho}`}
                    className="min-h-0 min-w-0 flex-1 resize-none overflow-auto whitespace-pre bg-background px-3 py-2 font-mono text-[12px] leading-5 text-foreground outline-none"
                    style={{ tabSize: 2 }}
                    data-caixa-do-codigo=""
                  />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </JanelaCentral>
  );
}
