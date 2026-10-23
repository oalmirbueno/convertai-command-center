import { useEffect, useRef, useState } from "react";
import { ExternalLink, ImagePlus, Loader2, Search, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { campo, juntar, texto } from "@/components/sistema/estilos";
import { chamarFuncao } from "@/lib/mesa/api";
import { AvisoDeErro } from "./Custo";
import type { Trabalho } from "./useItensDoMes";

export type BancoDeImagens = "todos" | "noticias" | "wikimedia" | "openverse" | "pexels";
type BancoDoResultado = Exclude<BancoDeImagens, "todos">;
interface ImagemReal {
  arquivo: string; nome: string; url: string; miniatura_url?: string;
  fonte_url: string; licenca?: string; autor?: string | null;
  banco?: BancoDoResultado; data?: string;
}
interface ResultadoReal { resultados: ImagemReal[]; avisos?: string[]; melhor?: { indice: number } | null }
/** A imagem guardada na pasta do cliente, com a origem (a tela monta o crédito da mídia com ela). */
export interface FonteAplicada { nome: string; caminho?: string; fonte_url?: string; licenca?: string; autor?: string | null; banco?: BancoDoResultado }
interface AplicacaoReal { precisa_print?: boolean; motivo?: string; fonte?: FonteAplicada }
const BANCOS: Array<{ valor: BancoDeImagens; rotulo: string; botao: string }> = [
  { valor: "todos", rotulo: "Tudo", botao: "Buscar em todos" },
  { valor: "noticias", rotulo: "Notícias", botao: "Buscar nas notícias" },
  { valor: "wikimedia", rotulo: "Wikimedia", botao: "Buscar na Wikimedia" },
  { valor: "openverse", rotulo: "Openverse", botao: "Buscar no Openverse" },
  { valor: "pexels", rotulo: "Pexels", botao: "Buscar no Pexels" },
];
export const ROTULO_DO_BANCO: Record<BancoDoResultado, string> = { noticias: "Notícia", wikimedia: "Wikimedia", openverse: "Openverse", pexels: "Pexels" };
const https = (v?: string) => { try { const u = new URL(v || ""); return u.protocol === "https:" && !u.username && !u.password ? u.href : undefined; } catch { return undefined; } };
/** A etiqueta do achado: "Notícia · Forbes Brasil · 23/10", "Pexels · Ana Souza"... */
export function etiquetaDoAchado(r: Pick<ImagemReal, "banco" | "autor" | "data">): string {
  const banco = r.banco ? ROTULO_DO_BANCO[r.banco] : "Internet";
  const data = r.data && /^\d{4}-\d{2}-\d{2}$/.test(r.data) ? `${r.data.slice(8, 10)}/${r.data.slice(5, 7)}` : "";
  return [banco, r.autor || "", data].filter(Boolean).join(" · ");
}

/**
 * Busca de imagens reais (Wikimedia; Openverse desde 21/10; notícias, Pexels e "Tudo" desde 23/10, dono:
 * "pode buscar imagens de notícias mesmo e não só Wikipedia"). Os achados aparecem em grade, com o banco,
 * o veículo ou o autor à vista; um toque usa a imagem. Ela vai para a pasta do cliente com a origem e a
 * licença guardadas e vira uma fonte da lâmina no Template, inteira.
 * `embutido`: sem o recolhível, dentro da etapa Imagem do Template (abre em "Tudo").
 */
export default function ImagensReaisDoDiretor({ trabalho, ordem, bloqueado, onAtualizar, onAbrirTemplate, onAbrirFotos, embutido = false, onAplicada, consultaInicial }: {
  trabalho: Trabalho; ordem: number; bloqueado: boolean; onAtualizar: () => void;
  onAbrirTemplate?: () => void; onAbrirFotos?: () => void;
  embutido?: boolean;
  /** Depois de guardada: a imagem nova na pasta do cliente, com a origem (o Template já a escolhe). */
  onAplicada?: (fonte: FonteAplicada) => void;
  /** O que buscar ao abrir (a sugestão do gerador); sem ela, o texto da lâmina. */
  consultaInicial?: string;
}) {
  const card = trabalho.direcao.cards?.find((c) => c.ordem === ordem);
  const [consulta, setConsulta] = useState((consultaInicial || card?.texto_exato || "").replace(/\*\*/g, "").replace(/\s+/g, " ").trim().slice(0, 160));
  const [tipo, setTipo] = useState<"imagem" | "logo">("imagem");
  const [banco, setBanco] = useState<BancoDeImagens>(embutido ? "todos" : "wikimedia");
  const [url, setUrl] = useState("");
  const [resultado, setResultado] = useState<ResultadoReal | null>(null);
  const [ocupado, setOcupado] = useState(false), [erro, setErro] = useState<unknown>(null), [aviso, setAviso] = useState("");
  const vivo = useRef(true), emCurso = useRef(false);
  useEffect(() => { vivo.current = true; return () => { vivo.current = false; }; }, []);
  const travado = bloqueado || ocupado || ["aguardando_agencia", "aguardando_cliente", "aprovado", "agendado"].includes(trabalho.entrega_status || "");
  const executar = async (acao: () => Promise<void>) => {
    if (emCurso.current || travado) return;
    emCurso.current = true; setOcupado(true); setErro(null); setAviso("");
    try { await acao(); } catch (e) { if (vivo.current) setErro(e); }
    finally { emCurso.current = false; if (vivo.current) setOcupado(false); }
  };
  const buscar = () => executar(async () => {
    const r = await chamarFuncao<ResultadoReal>("estudio-arte", { acao: "imagens_reais_buscar", trabalho_id: trabalho.id, ordem, consulta: consulta.trim(), tipo, ...(banco !== "wikimedia" ? { banco } : {}) });
    if (vivo.current) setResultado(r);
  });
  const aplicar = (fonte: { arquivo: string } | { url: string }) => executar(async () => {
    const versao = Math.max(0, ...trabalho.cards.filter((c) => c.ordem === ordem).map((c) => c.versao));
    const r = await chamarFuncao<AplicacaoReal>("estudio-arte", { acao: "imagem_real_aplicar", trabalho_id: trabalho.id, ordem, texto_base: card?.texto_exato || "", versao_esperada: versao, tipo, ...fonte });
    if (!vivo.current) return;
    if (r.precisa_print) { setAviso(r.motivo || "Envie a captura da tela em Fotos para usar o painel exato."); return; }
    if (!r.fonte) throw new Error(r.motivo || "A imagem não foi adicionada. Confira a fonte e tente novamente.");
    setAviso(onAplicada ? `${r.fonte.nome} entrou no bloco da lâmina.` : `${r.fonte.nome} adicionada às fontes da lâmina. Selecione a imagem no Template para preservar os pixels.`);
    onAtualizar();
    onAplicada?.(r.fonte);
  });
  const rotuloDoBanco = BANCOS.find((b) => b.valor === banco) || BANCOS[0];
  const bancos = tipo === "logo" ? BANCOS.filter((b) => b.valor !== "noticias" && b.valor !== "pexels") : BANCOS;
  const achados = resultado ? resultado.resultados.slice(0, embutido ? 12 : 6) : [];

  const conteudo = <div className={embutido ? "space-y-3" : "mt-3 space-y-3"}>
    {!embutido && <div className="flex items-center"><span className={texto.auxiliar}>Compor com uma fonte real</span><AjudaRecolhida className="ml-1.5" rotulo="Como usar imagens reais">Busque pelo assunto ou pela marca. Confira a origem e a licença antes de escolher. No Template, fotos, logos e telas entram inteiras, sem redesenho. Para ensinar um botão ou configuração com login, envie uma captura atual em Fotos e marque o ponto na prévia do Template.</AjudaRecolhida></div>}
    <fieldset disabled={travado} className="space-y-2 disabled:opacity-70">
      <div role="group" aria-label="Banco de imagens" className="flex flex-wrap">
        {bancos.map((b) => <button key={b.valor} type="button" aria-pressed={banco === b.valor} onClick={() => { setBanco(b.valor); setResultado(null); }} className={juntar("mb-1 mr-1.5 h-8 rounded-full border px-3 text-[12px] transition-colors", banco === b.valor ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground")}>{b.rotulo}</button>)}
      </div>
      <div className="flex min-w-0 items-end">
        <label className={juntar("block min-w-0 flex-1", texto.rotulo)}>Assunto ou marca<Input aria-label="Assunto das imagens reais" value={consulta} maxLength={200} onChange={(e) => { setConsulta(e.target.value); setResultado(null); }} onKeyDown={(e) => { if (e.key === "Enter" && consulta.trim().length >= 2) { e.preventDefault(); void buscar(); } }} className="mt-1" /></label>
        <Button size="sm" variant="outline" className="ml-2 shrink-0" disabled={consulta.trim().length < 2} onClick={() => void buscar()} aria-label={rotuloDoBanco.botao} title={rotuloDoBanco.botao}>{ocupado ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}<span className="ml-1.5">Buscar</span></Button>
      </div>
      <label className={juntar("block", texto.rotulo)}>Tipo de imagem<select aria-label="Tipo de imagem real" value={tipo} onChange={(e) => { const t = e.target.value as "imagem" | "logo"; setTipo(t); setResultado(null); if (t === "logo" && (banco === "noticias" || banco === "pexels")) setBanco("todos"); }} className={`${campo} mt-1`}><option value="imagem">Imagem do assunto</option><option value="logo">Logo ou marca</option></select></label>
      <p className={texto.auxiliar}>Pesquisa sem IA · sem custo</p>
      {resultado && <div className="space-y-2" aria-label="Fontes reais encontradas">
        {achados.length === 0 && <p className={texto.auxiliar}>Sem imagens. Refine o assunto ou troque o banco.</p>}
        {achados.length > 0 && <ul className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3" aria-label="Imagens encontradas">
          {achados.map((r, i) => <li key={r.arquivo} className="min-w-0" data-banco-do-achado={r.banco || ""}>
            <button type="button" className="group block w-full min-w-0 text-left" onClick={() => void aplicar({ arquivo: r.arquivo })} aria-label={`Usar na lâmina: ${r.nome}`} title={`Usar na lâmina: ${r.nome}`}>
              <span className="relative block w-full overflow-hidden rounded-md border border-border bg-muted transition-colors group-hover:border-primary" style={{ paddingBottom: "75%" }}>
                {https(r.miniatura_url || r.url) && <img src={https(r.miniatura_url || r.url)} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" referrerPolicy="no-referrer" />}
                {resultado.melhor && resultado.melhor.indice === i && <span className="absolute left-1 top-1 inline-flex items-center rounded-full bg-primary px-1.5 py-0.5 text-[11px] font-medium text-primary-foreground"><Sparkles className="mr-1 h-3 w-3" aria-hidden="true" />Melhor</span>}
              </span>
              <span className="mt-1 block truncate text-[12px]">{r.nome}</span>
              <span className={juntar(texto.auxiliar, "block truncate")}>{etiquetaDoAchado(r)}</span>
            </button>
            {https(r.fonte_url) && <a href={https(r.fonte_url)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center text-[11px] text-primary underline" aria-label={`Conferir fonte e licença de ${r.nome}`}><ExternalLink className="mr-1 h-3 w-3" aria-hidden="true" />Conferir fonte e licença</a>}
          </li>)}
        </ul>}
        {resultado.avisos?.map((a) => <p key={a} className={texto.auxiliar}>{a}</p>)}
      </div>}
      <details><summary className="cursor-pointer text-[12px] text-muted-foreground">Usar link de uma imagem pública</summary><div className="mt-2 space-y-2"><Input aria-label="Link da imagem real" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/imagem.png" maxLength={1800} /><Button size="sm" variant="outline" disabled={!https(url)} onClick={() => void aplicar({ url: url.trim() })}>Adicionar imagem do link</Button><p className={texto.auxiliar}>Painel com login: envie a captura em Fotos.</p></div></details>
    </fieldset>
    {erro ? <AvisoDeErro erro={erro} /> : null}
    {aviso && <p role="status" className={texto.auxiliar}>{aviso}</p>}
    {(onAbrirFotos || onAbrirTemplate) && <div className="flex flex-wrap">{onAbrirFotos && <Button size="sm" variant="ghost" className="mr-1" onClick={onAbrirFotos}>Enviar print em Fotos</Button>}{onAbrirTemplate && <Button size="sm" variant="ghost" onClick={onAbrirTemplate}>Abrir Template</Button>}</div>}
  </div>;

  if (embutido) return conteudo;
  return <details className="min-w-0 border-b border-border pb-3" aria-label="Imagens reais do diretor">
    <summary className="cursor-pointer text-[12px] font-medium"><ImagePlus className="mr-1.5 inline h-3.5 w-3.5" aria-hidden="true" />Imagens reais · lâmina {ordem}</summary>
    {conteudo}
  </details>;
}
