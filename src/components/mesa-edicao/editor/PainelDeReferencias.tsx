import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Columns2, Eye, Film, Link2, Loader2, Ruler, Save, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useMesa, useUrlDaMesa } from "@/components/mesa/MesaContexto";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { EstadoVazio } from "@/components/sistema/Estados";
import { botao, campo, etiqueta, juntar, texto } from "@/components/sistema/estilos";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import CartaoDeAcao from "@/components/agentes/CartaoDeAcao";
import ComparadorAntesDepois from "@/components/comparar/ComparadorAntesDepois";
import { FIDELIDADES } from "@/components/mesa/fidelidadeDaReferencia";
import { textoDoErro, usd, type ModeloIa } from "@/lib/mesa/api";
import type { AcaoDoAgente, RespostaDaAcao } from "@/lib/agentes/acoesDoAgente";
import { useArquivosDeVideo } from "@/components/mesa-videos/videosApi";
import type { ProjetoDeEdicao, ReferenciaDeEdicao } from "../../../../supabase/functions/_shared/projeto-de-edicao";
import { juntarVisao, normalizarReceita, planoDoLink, receitaDaMedida, type Fidelidade, type ReceitaDeEdicao } from "../../../../supabase/functions/editor-video/receita";
import { estimarPasso } from "../../../../supabase/functions/editor-video/ferramentas";
import { chamarEditorVideo, emPreparacao, novoId, subirDoEditor } from "@/lib/editor/api";
import { medirReferencia } from "@/lib/editor/referencia";
import { proporReceita } from "@/lib/editor/skills/receita";
import { acaoDaProposta, acaoFeita } from "@/lib/editor/cartao";
import { aplicarOperacao, trilhaPrincipal } from "@/lib/editor/operacoes";
import { base64DoDataUrl, extrairQuadro, tempoDoQuadro } from "@/lib/editor/quadros";
import { tempoFino } from "@/lib/editor/tempo";
import type { PropostaDaSkill } from "@/lib/editor/skills";
import type { ControleDePropostas } from "./PainelDeSkills";

/**
 * Referências de edição (frente V-B): vídeos cuja EDIÇÃO o dono quer no vídeo
 * do cliente. Entra da Mídia do cliente, por upload ou por link (rede social
 * só como link, sem baixar). O navegador mede a receita (cortes, ritmo,
 * áudio) sem custo; "Ler a edição" manda alguns quadros a um modelo com
 * imagem para o estilo (legenda, textos, cor), com custo antes. Aplica com os
 * níveis do Estúdio (Idêntica, Próxima, Inspirada, Criativa) pelas skills,
 * com Confirmar/Desfazer e comparação lado a lado. Templates por cliente e da
 * agência (SQL V-B-01).
 */

const aceitaImagem = (m: ModeloIa) => {
  const mod = (m as unknown as { modalidades?: { entrada?: string[] } | null }).modalidades;
  if (mod && Array.isArray(mod.entrada)) return mod.entrada.indexOf("image") >= 0;
  return m.provedor === "openai" || /gpt|claude|gemini/i.test(m.modelo_api);
};

function resumoDaReceita(r: ReceitaDeEdicao): string {
  const partes = [`${r.cortes.length} cortes`, `plano de ~${tempoFino(r.plano_mediano_s)}`, `${r.planos_por_minuto} por minuto`];
  if (r.punch_ins.length) partes.push(`${r.punch_ins.length} punch-ins prováveis`);
  if (r.musica.batidas_por_minuto) partes.push(`${r.musica.batidas_por_minuto} batidas/min`);
  if (r.legenda.tem) partes.push(`legenda ${r.legenda.posicao || ""} ${r.legenda.palavras_por_vez || ""} palavras`.replace(/\s+/g, " "));
  return partes.join(" · ");
}

function Referencia({
  r,
  projeto,
  controle,
  mudar,
  tirar,
  urlDoProjeto,
}: {
  r: ReferenciaDeEdicao;
  projeto: ProjetoDeEdicao;
  controle: ControleDePropostas;
  mudar: (nova: ReferenciaDeEdicao, rotulo: string) => void;
  tirar: () => void;
  urlDoProjeto: string | null;
}) {
  const { clientId, catalogo } = useMesa();
  const queryClient = useQueryClient();
  const url = useUrlDaMesa(r.storage_path, r.storage_bucket || "mesa");
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [proposta, setProposta] = useState<{ acao: AcaoDoAgente; p: PropostaDaSkill } | null>(null);
  const [comparando, setComparando] = useState(false);
  const [confirmarLeitura, setConfirmarLeitura] = useState(false);
  const cancelado = useRef(false);
  const receita = normalizarReceita(r.receita);
  const modelos = useMemo(() => (catalogo || []).filter((m) => m.tipo === "texto" && m.ativo && aceitaImagem(m)).sort((a, b) => (Number(a.preco_saida_1m) || 0) - (Number(b.preco_saida_1m) || 0)), [catalogo]);
  const [modeloId, setModeloId] = useState("");
  const modelo = modelos.find((m) => m.id === modeloId) || modelos[0] || null;
  const quadrosDaLeitura = receita ? Math.min(10, receita.cortes.length + 1) : 0;
  const custoDaLeitura = modelo ? estimarPasso(modelo, (quadrosDaLeitura * 1600 + 1200) * 4, null) : 0;

  const medir = async () => {
    if (!url.data) return;
    setOcupado("Medindo");
    cancelado.current = false;
    try {
      const m = await medirReferencia(url.data, (t) => setOcupado(t), () => cancelado.current);
      mudar({ ...r, receita: receitaDaMedida(m) as unknown as Record<string, unknown>, em: new Date().toISOString() }, "Medir referência");
      toast.success("Receita medida", { description: `${m.cortes.length} cortes em ${tempoFino(m.duracao_s)}.` });
    } catch (e) {
      toast.error("Não deu para medir", { description: textoDoErro(e) });
    } finally {
      setOcupado(null);
    }
  };

  const lerEdicao = async () => {
    if (!receita || !url.data || !modelo) return;
    setConfirmarLeitura(false);
    setOcupado("Lendo a edição");
    try {
      const marcos = [0].concat(receita.cortes).concat([receita.duracao_s]);
      const meios: number[] = [];
      for (let i = 1; i < marcos.length; i++) meios.push((marcos[i - 1] + marcos[i]) / 2);
      const passo = Math.max(1, Math.ceil(meios.length / 10));
      const escolhidos = meios.filter((_, k) => k % passo === 0).slice(0, 10);
      const quadros: { tempo_s: number; jpeg_base64: string }[] = [];
      for (const t of escolhidos) {
        const q = await extrairQuadro(url.data, tempoDoQuadro(t, 30), { largura: 384, qualidade: 0.6 });
        if (q) quadros.push({ tempo_s: q.tempo_s, jpeg_base64: base64DoDataUrl(q.dataUrl) });
      }
      if (!quadros.length) throw new Error("Não deu para ler os quadros da referência aqui.");
      const resp = await chamarEditorVideo<{ visao: Record<string, unknown> | null; custo_usd: number; modelo_id: string }>({
        acao: "receita_ler",
        client_id: clientId,
        modelo_id: modelo.id,
        quadros,
        medida: receita,
        referencia_id: novoId(),
        custo_maximo_usd: custoDaLeitura,
      });
      mudar({ ...r, receita: juntarVisao(receita, resp.visao, resp.modelo_id) as unknown as Record<string, unknown> }, "Ler a edição");
      toast.success("Edição lida", { description: `${usd(resp.custo_usd)} na carteira do cliente.` });
    } catch (e) {
      toast.error(emPreparacao(e) ? "Ler a edição está em preparação" : "Não deu para ler", { description: emPreparacao(e) ? "Falta publicar a função editor-video." : textoDoErro(e) });
    } finally {
      setOcupado(null);
    }
  };

  const verProposta = () => {
    if (!receita) return;
    const p = proporReceita(projeto, receita, r.fidelidade, { agora: new Date().toISOString() }, r.nome);
    if (!p.operacoes.length) return toast.info(p.resumo, { description: p.avisos.join(" ") || undefined });
    const id = `ref-${Date.now().toString(36)}`;
    setProposta({ acao: acaoDaProposta(id, "editor", p.resumo, p.operacoes, projeto, p.avisos), p });
  };

  const aoPedido = async (pedido: "confirmar" | "descartar" | "desfazer"): Promise<RespostaDaAcao> => {
    if (!proposta) return {};
    const agora = new Date().toISOString();
    if (pedido === "descartar") {
      setProposta(null);
      return { anexo: { ...proposta.acao, descartada_em: agora } };
    }
    if (pedido === "desfazer") {
      // AG2: Desfazer que não voltou não mostra mais "Voltou como estava, 0 itens" (o cartão mostra o motivo).
      if (!controle.desfazer(proposta.p)) throw new Error("Mudou depois de aplicar: use Ctrl+Z para voltar passo a passo.");
      return { anexo: { ...acaoFeita(proposta.acao, agora), desfeita_em: agora }, voltaram: proposta.acao.itens.length };
    }
    if (!controle.aplicar(proposta.p, proposta.p.titulo)) throw new Error("O projeto mudou. Veja a proposta de novo.");
    return { anexo: acaoFeita(proposta.acao, agora), feitos: proposta.acao.itens.length, falhas: 0 };
  };

  const salvarTemplate = async (daAgencia: boolean) => {
    if (!receita) return;
    setOcupado("Salvando template");
    try {
      await chamarEditorVideo({ acao: "receita_salvar", client_id: daAgencia ? null : clientId, nome: r.nome, receita, origem: { url: r.url, storage_path: r.storage_path, rede: r.rede } });
      void queryClient.invalidateQueries({ queryKey: ["mesa-edicao", "receitas", clientId] });
      toast.success(daAgencia ? "Template da agência salvo" : "Template do cliente salvo");
    } catch (e) {
      toast.error("Template não salvo", { description: emPreparacao(e) ? "Falta publicar a função editor-video." : textoDoErro(e) });
    } finally {
      setOcupado(null);
    }
  };

  return (
    <li className="py-2.5" data-referencia={r.id}>
      <div className="flex min-w-0 items-start">
        {r.miniatura ? <img src={r.miniatura} alt="" className="mr-2 h-10 w-16 shrink-0 rounded object-cover" /> : <Film className="mr-2 mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium" title={r.nome}>
            {r.nome}
          </p>
          <p className={juntar(texto.auxiliar, "truncate")}>{receita ? resumoDaReceita(receita) : r.rede ? `Link do ${r.rede}: suba o arquivo para medir` : r.url && r.url.indexOf("template:") === 0 ? "Template" : "Sem receita ainda"}</p>
        </div>
        <button type="button" className={botao.icone} onClick={tirar} aria-label={`Tirar a referência ${r.nome}`}>
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      {r.url && r.rede && (
        <a href={r.url} target="_blank" rel="noreferrer noopener" className="mt-1 inline-flex items-center text-[12px] text-primary hover:underline">
          <Link2 className="mr-1 h-3 w-3" />
          Abrir no {r.rede}
        </a>
      )}
      <div className="mt-2 grid grid-cols-4 gap-0.5 rounded-md border border-border p-0.5" role="radiogroup" aria-label={`Fidelidade à referência ${r.nome}`}>
        {FIDELIDADES.map((f) => (
          <button
            key={f.valor}
            type="button"
            role="radio"
            aria-checked={r.fidelidade === f.valor}
            title={f.dica}
            onClick={() => r.fidelidade !== f.valor && mudar({ ...r, fidelidade: f.valor as Fidelidade }, "Fidelidade")}
            className={juntar("h-6 min-w-0 truncate rounded px-1 text-[11px]", r.fidelidade === f.valor ? "bg-primary font-medium text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            {f.rotulo}
          </button>
        ))}
      </div>
      {ocupado ? (
        <p className={juntar(texto.auxiliar, "mt-2 flex items-center")}>
          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          <span className="mr-auto">{ocupado}</span>
          <button type="button" className="underline" onClick={() => (cancelado.current = true)}>
            Parar
          </button>
        </p>
      ) : (
        <div className="mt-2 flex flex-wrap">
          {r.storage_path && (
            <button type="button" className={juntar(botao.secundario, "mb-1 mr-1 h-8")} onClick={() => void medir()} disabled={!url.data}>
              <Ruler className="mr-1.5 h-3.5 w-3.5" />
              {receita ? "Medir de novo" : "Medir"}
            </button>
          )}
          {receita && r.storage_path && (
            <button type="button" className={juntar(botao.secundario, "mb-1 mr-1 h-8")} onClick={() => setConfirmarLeitura(true)} disabled={!modelo}>
              <Eye className="mr-1.5 h-3.5 w-3.5" />
              Ler a edição
            </button>
          )}
          {receita && (
            <button type="button" className={juntar(botao.primario, "mb-1 mr-1 h-8")} onClick={verProposta}>
              Aplicar no vídeo
            </button>
          )}
          {receita && url.data && urlDoProjeto && (
            <button type="button" className={juntar(botao.discreto, "mb-1 mr-1 h-8")} onClick={() => setComparando(true)}>
              <Columns2 className="mr-1.5 h-3.5 w-3.5" />
              Lado a lado
            </button>
          )}
          {receita && (
            <>
              <button type="button" className={juntar(botao.discreto, "mb-1 mr-1 h-8")} onClick={() => void salvarTemplate(false)}>
                <Save className="mr-1.5 h-3.5 w-3.5" />
                Template do cliente
              </button>
              <button type="button" className={juntar(botao.discreto, "mb-1 h-8")} onClick={() => void salvarTemplate(true)}>
                Da agência
              </button>
            </>
          )}
        </div>
      )}
      {confirmarLeitura && (
        <div className="mt-1 flex flex-wrap items-center rounded-md bg-muted/50 px-2.5 py-2 text-[12px]">
          <select className={juntar(campo, "mb-1 mr-2 h-8 w-auto text-[12px]")} value={modelo ? modelo.id : ""} onChange={(e) => setModeloId(e.target.value)} aria-label="Modelo que lê a edição">
            {modelos.map((m) => (
              <option key={m.id} value={m.id}>
                {m.rotulo || m.modelo_api}
              </option>
            ))}
          </select>
          <span className="mb-1 mr-auto">{quadrosDaLeitura} quadros: ~{usd(custoDaLeitura)}</span>
          <button type="button" className={juntar(botao.primario, "mb-1 mr-1 h-8")} onClick={() => void lerEdicao()}>
            Ler por ~{usd(custoDaLeitura)}
          </button>
          <button type="button" className={juntar(botao.discreto, "mb-1 h-8")} onClick={() => setConfirmarLeitura(false)}>
            Cancelar
          </button>
        </div>
      )}
      {proposta && (
        <div className="mt-2">
          <CartaoDeAcao key={proposta.acao.id} acao={proposta.acao} titulo={proposta.p.titulo} onPedido={aoPedido} observacao="Só a edição da referência vem. Nada muda até confirmar." />
        </div>
      )}
      <Dialog open={comparando} onOpenChange={setComparando}>
        <DialogContent className="max-w-4xl">
          <DialogTitle className="text-[15px]">Referência e o vídeo do cliente</DialogTitle>
          {url.data && urlDoProjeto && (
            <ComparadorAntesDepois tipo="video" antes={{ src: url.data, rotulo: "Referência" }} depois={{ src: urlDoProjeto, rotulo: "Vídeo do cliente" }} modoInicial="lado_a_lado" proporcao={projeto.altura / projeto.largura / 2 + 0.05} />
          )}
        </DialogContent>
      </Dialog>
    </li>
  );
}

interface LinhaDeReceita {
  id: string;
  client_id: string | null;
  nome: string;
  receita: unknown;
}

export default function PainelDeReferencias({ projeto, controle, urlsDoProjeto }: { projeto: ProjetoDeEdicao; controle: ControleDePropostas; urlsDoProjeto: Record<string, string> }) {
  const { clientId } = useMesa();
  const arquivosQ = useArquivosDeVideo(clientId);
  const [link, setLink] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);
  const [subindo, setSubindo] = useState(false);
  const arquivoRef = useRef<HTMLInputElement | null>(null);
  const principal = trilhaPrincipal(projeto);
  const primeiraFonte = principal && principal.clipes.length ? principal.clipes.slice().sort((a, b) => a.inicio_s - b.inicio_s)[0].fonte : null;
  const urlDoProjeto = primeiraFonte ? urlsDoProjeto[primeiraFonte] || null : null;

  const templatesQ = useQuery({
    queryKey: ["mesa-edicao", "receitas", clientId],
    staleTime: 60_000,
    retry: false,
    queryFn: async (): Promise<{ lista: LinhaDeReceita[]; disponivel: boolean }> => {
      const { data, error } = await (supabase as any).from("video_receitas").select("id, client_id, nome, receita").or(`client_id.eq.${clientId},client_id.is.null`).is("arquivada_em", null).order("criado_em", { ascending: false }).limit(100);
      if (error) return { lista: [], disponivel: false };
      return { lista: (data || []) as LinhaDeReceita[], disponivel: true };
    },
  });

  const gravar = (lista: ReferenciaDeEdicao[], rotulo: string) => controle.aplicar({ skill: "brabo", titulo: rotulo, resumo: rotulo, operacoes: [{ op: "referencias", lista }], avisos: [], base: "", resultado: aplicarOperacao(projeto, { op: "referencias", lista }) }, rotulo);
  const nova = (x: Partial<ReferenciaDeEdicao>): ReferenciaDeEdicao => ({
    id: `r${Date.now().toString(36)}`,
    nome: "Referência",
    origem: "arquivo",
    storage_bucket: null,
    storage_path: null,
    url: null,
    rede: null,
    miniatura: null,
    receita: null,
    fidelidade: "identica",
    template_id: null,
    em: new Date().toISOString(),
    ...x,
  });
  const adicionar = (r: ReferenciaDeEdicao) => gravar(projeto.referencias.concat([r]), "Nova referência");

  const porLink = () => {
    const plano = planoDoLink(link);
    setAviso(plano.mensagem);
    if (plano.tipo === "invalido" || plano.tipo === "arquivo_externo") return;
    if (plano.tipo === "rede") {
      adicionar(nova({ nome: `${plano.rede} ${link.split("/").filter(Boolean).pop() || ""}`.trim().slice(0, 120), origem: "link", url: link.trim(), rede: plano.rede, miniatura: plano.miniatura }));
    } else {
      // Arquivo do próprio painel: caminho depois de /object/(sign|public)/<bucket>/
      const m = /\/storage\/v1\/object\/(?:sign|public|authenticated)\/([^/]+)\/([^?]+)/.exec(new URL(link.trim()).pathname);
      if (!m) return setAviso("Não reconheci o arquivo do painel. Escolha pela Mídia.");
      adicionar(nova({ nome: decodeURIComponent(m[2].split("/").pop() || "Referência"), storage_bucket: m[1], storage_path: decodeURIComponent(m[2]) }));
    }
    setLink("");
  };

  const porUpload = async (f: File | null) => {
    if (!f) return;
    setSubindo(true);
    try {
      const ext = (/\.([a-z0-9]{2,5})$/i.exec(f.name) || [])[1] || "mp4";
      const caminho = await subirDoEditor(clientId, "referencias", f, ext.toLowerCase());
      adicionar(nova({ nome: f.name.slice(0, 120), storage_bucket: "mesa", storage_path: caminho }));
    } catch (e) {
      toast.error("Não subiu", { description: textoDoErro(e) });
    } finally {
      setSubindo(false);
      if (arquivoRef.current) arquivoRef.current.value = "";
    }
  };

  const arquivos = ((arquivosQ.data && arquivosQ.data.arquivos) || []).filter((a) => a.estado !== "arquivado" && a.tipo !== "audio");
  const templates = (templatesQ.data && templatesQ.data.lista) || [];

  return (
    <div className="space-y-3" data-painel-de-referencias="">
      <div className="flex min-w-0 items-center">
        <p className={juntar(texto.rotulo, "mr-1")}>Referências de edição</p>
        <AjudaRecolhida titulo="Referências">
          Vídeos cuja edição você quer copiar: ritmo de cortes, punch-ins, legenda, transições, batidas. Só a edição vem; fala, marca e pessoas da referência nunca entram. Links de Instagram, TikTok e YouTube ficam só como link (as plataformas não deixam baixar): para medir, suba o arquivo.
        </AjudaRecolhida>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-1">
        <input className={juntar(campo, "h-8")} value={link} onChange={(e) => setLink(e.target.value)} placeholder="Link (Instagram, TikTok, YouTube ou do painel)" aria-label="Link da referência" onKeyDown={(e) => e.key === "Enter" && porLink()} />
        <button type="button" className={juntar(botao.secundario, "h-8")} onClick={porLink} disabled={!link.trim()}>
          <Link2 className="mr-1 h-3.5 w-3.5" />
          Pôr
        </button>
      </div>
      {aviso && <p className={texto.auxiliar}>{aviso}</p>}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-1">
        <select
          className={juntar(campo, "h-8")}
          value=""
          onChange={(e) => {
            const a = arquivos.find((x) => x.id === e.target.value);
            if (a) adicionar(nova({ nome: a.nome, storage_bucket: a.storage_bucket, storage_path: a.storage_path }));
          }}
          aria-label="Referência da Mídia do cliente"
        >
          <option value="">Da Mídia do cliente</option>
          {arquivos.map((a) => (
            <option key={a.id} value={a.id}>
              {a.nome}
            </option>
          ))}
        </select>
        <button type="button" className={juntar(botao.secundario, "h-8")} onClick={() => arquivoRef.current && arquivoRef.current.click()} disabled={subindo}>
          {subindo ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1 h-3.5 w-3.5" />}
          Subir
        </button>
        <input ref={arquivoRef} type="file" accept="video/*" className="hidden" onChange={(e) => void porUpload(e.target.files && e.target.files[0])} />
      </div>
      {templates.length > 0 && (
        <select
          className={juntar(campo, "h-8")}
          value=""
          onChange={(e) => {
            const t = templates.find((x) => x.id === e.target.value);
            const rec = t ? normalizarReceita(t.receita) : null;
            if (t && rec) adicionar(nova({ nome: t.nome, origem: "link", url: `template:${t.id}`, template_id: t.id, receita: rec as unknown as Record<string, unknown> }));
          }}
          aria-label="Usar um template de edição"
        >
          <option value="">Usar template ({templates.length})</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.nome}
              {t.client_id ? "" : " (agência)"}
            </option>
          ))}
        </select>
      )}
      {templatesQ.data && !templatesQ.data.disponivel && <p className={juntar(etiqueta, "bg-muted text-muted-foreground")}>Templates: falta o SQL V-B-01</p>}
      {!projeto.referencias.length ? (
        <EstadoVazio compacto titulo="Nenhuma referência." descricao="Ponha um vídeo cuja edição você quer usar." />
      ) : (
        <ul className="divide-y divide-border">
          {projeto.referencias.map((r, k) => (
            <Referencia
              key={r.id}
              r={r}
              projeto={projeto}
              controle={controle}
              urlDoProjeto={urlDoProjeto}
              mudar={(novaRef, rotulo) => gravar(projeto.referencias.map((x, j) => (j === k ? novaRef : x)), rotulo)}
              tirar={() => gravar(projeto.referencias.filter((_, j) => j !== k), "Tirar referência")}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
