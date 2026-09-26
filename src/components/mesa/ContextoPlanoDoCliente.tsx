import { useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Compass, Copy, Download, FileUp, FolderTree, Loader2, Map as Mapa, Package, Palette, Pencil, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import CartaoDeAcao from "@/components/agentes/CartaoDeAcao";
import { acaoDoAnexo, chamarAcaoDoAgente } from "@/lib/agentes/acoesDoAgente";
import { textoDoErro } from "@/lib/mesa/api";
import { AvisoDeErro, avisarCustoReal } from "./Custo";
import { useMesa } from "./MesaContexto";
import { chaveDoHistorico, useInvalidarContexto } from "./contextoDoCliente";
import {
  baixarTexto,
  type CaminhoDoCliente,
  chaveDoPlano,
  copiarTexto,
  importarBrandBook,
  montarPacote,
  organizarPorTipo,
  type PacoteExterno,
  prepararIdentidade,
  type RespostaComProposta,
  salvarCaminho,
  TIPOS_DE_PACOTE,
  TIPOS_DO_BRAND_BOOK,
  type TipoDePacote,
  usePlanoDoCliente,
} from "./planoDoClienteApi";

/**
 * Plano do cliente (frente C, 26/09): o que o agente do cliente prepara para a
 * equipe. O plano em si é conversado no agente ao lado (modo "Plano do
 * cliente"); aqui ficam a fase, o caminho e a stack (editáveis), o pacote
 * para LLM externo, a preparação da identidade visual e o organizar tudo.
 * Toda escrita do agente passa pelo cartão de ação: nada muda sem confirmar.
 */

export const PEDIDO_DO_COMECO =
  "Comece o plano deste cliente: leia o briefing, o dossiê, o cérebro e os arquivos, proponha o nicho realista para o estágio dele, o posicionamento e o plano do projeto pelo método Acelera, com marcos e tarefas com dono e prazo.";
export const PEDIDO_DO_CAMINHO =
  "Proponha o caminho deste cliente: o que fazer primeiro, as ferramentas e o tech stack recomendados, com custo aproximado só quando houver fonte, e por quê.";

const dataCurta = (iso: string | null | undefined) => (iso ? `${String(iso).slice(8, 10)}/${String(iso).slice(5, 7)}` : "");

function Bloco({ icone, titulo, dica, children }: { icone: ReactNode; titulo: string; dica?: string; children: ReactNode }) {
  return (
    <section className="min-w-0 rounded-xl border border-border bg-background p-3">
      <p className="flex items-center text-[12.5px] font-semibold">
        <span className="mr-1.5 shrink-0 text-primary">{icone}</span>
        {titulo}
      </p>
      {dica && <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">{dica}</p>}
      <div className="mt-2.5 min-w-0">{children}</div>
    </section>
  );
}

/** Markdown do pacote com Copiar e Baixar (.md e .json). */
export function VisorDoPacote({ pacote }: { pacote: PacoteExterno }) {
  const copiar = async () => {
    const ok = await copiarTexto(pacote.markdown);
    if (ok) toast.success("Pacote copiado", { description: "Cole no ChatGPT ou no Claude." });
    else toast.error("Não foi possível copiar", { description: "Use o Baixar .md." });
  };
  return (
    <div className="min-w-0" data-pacote-externo="">
      {pacote.avisos.length > 0 && (
        <ul className="mb-1.5 text-[11.5px] text-muted-foreground">
          {pacote.avisos.map((a) => (
            <li key={a} className="[overflow-wrap:anywhere]">{a}</li>
          ))}
        </ul>
      )}
      <pre className="max-h-72 min-w-0 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-card p-2.5 text-[11.5px] leading-relaxed [overflow-wrap:anywhere]">{pacote.markdown}</pre>
      <div className="mt-2 flex flex-wrap items-center">
        <Button type="button" size="sm" className="mb-1 mr-1.5 h-8" onClick={() => void copiar()}>
          <Copy className="mr-1.5 h-3.5 w-3.5" /> Copiar
        </Button>
        <Button type="button" size="sm" variant="outline" className="mb-1 mr-1.5 h-8" onClick={() => baixarTexto(`${pacote.nome_arquivo}.md`, pacote.markdown, "text/markdown")}>
          <Download className="mr-1.5 h-3.5 w-3.5" /> Baixar .md
        </Button>
        <Button type="button" size="sm" variant="outline" className="mb-1 h-8" onClick={() => baixarTexto(`${pacote.nome_arquivo}.json`, JSON.stringify(pacote.json, null, 2), "application/json")}>
          <Download className="mr-1.5 h-3.5 w-3.5" /> Baixar .json
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">Sem senhas, chaves nem dados de acesso.</p>
    </div>
  );
}

/** Linhas "a | b | c" em objetos (o editor do caminho é texto simples, uma linha por item). */
export function linhasParaCaminho(resumo: string, etapas: string, stack: string, cuidados: string): CaminhoDoCliente {
  const partes = (l: string) => l.split("|").map((x) => x.trim());
  return {
    resumo: resumo.trim() || null,
    etapas: etapas
      .split("\n")
      .map((l) => partes(l))
      .filter((p) => p[0])
      .map((p) => ({ titulo: p[0], porque: p[1] || null, quando: p[2] || null })),
    stack: stack
      .split("\n")
      .map((l) => partes(l))
      .filter((p) => p[0])
      .map((p) => ({ ferramenta: p[0], para_que: p[1] || null, custo: p[2] || null, fonte: p[3] || null, porque: p[4] || null })),
    cuidados: cuidados.split("\n").map((l) => l.trim()).filter(Boolean),
  };
}

export function caminhoParaLinhas(c: CaminhoDoCliente | null) {
  return {
    resumo: (c && c.resumo) || "",
    etapas: ((c && c.etapas) || []).map((e) => [e.titulo, e.porque || "", e.quando || ""].join(" | ").replace(/( \| )+$/, "")).join("\n"),
    stack: ((c && c.stack) || []).map((s) => [s.ferramenta, s.para_que || "", s.custo || "", s.fonte || "", s.porque || ""].join(" | ").replace(/( \| )+$/, "")).join("\n"),
    cuidados: ((c && c.cuidados) || []).join("\n"),
  };
}

function Caminho({ clientId, caminho, onPedirAoAgente }: { clientId: string; caminho: CaminhoDoCliente | null; onPedirAoAgente: (t: string) => void }) {
  const queryClient = useQueryClient();
  const [editando, setEditando] = useState<ReturnType<typeof caminhoParaLinhas> | null>(null);
  const [salvando, setSalvando] = useState(false);
  const salvar = async () => {
    if (!editando) return;
    setSalvando(true);
    try {
      const novo = linhasParaCaminho(editando.resumo, editando.etapas, editando.stack, editando.cuidados);
      const vazio = !novo.resumo && !(novo.etapas || []).length && !(novo.stack || []).length;
      await salvarCaminho(clientId, vazio ? null : novo);
      toast.success(vazio ? "Caminho apagado" : "Caminho salvo");
      setEditando(null);
      void queryClient.invalidateQueries({ queryKey: chaveDoPlano(clientId) });
    } catch (e) {
      toast.error("Caminho não salvo", { description: textoDoErro(e) });
    } finally {
      setSalvando(false);
    }
  };
  if (editando) {
    const campo = (k: keyof typeof editando, rotulo: string, dica: string, linhas: number) => (
      <label className="mb-2 block min-w-0">
        <span className="text-[11.5px] font-medium">{rotulo}</span>
        <span className="block text-[11px] text-muted-foreground">{dica}</span>
        <Textarea className="mt-1 text-[12px]" rows={linhas} value={editando[k]} onChange={(e) => setEditando({ ...editando, [k]: e.target.value })} />
      </label>
    );
    return (
      <div className="min-w-0">
        {campo("resumo", "Resumo", "Uma ou duas frases.", 2)}
        {campo("etapas", "Etapas", "Uma por linha: título | por quê | quando.", 5)}
        {campo("stack", "Ferramentas e stack", "Uma por linha: ferramenta | para quê | custo | fonte | por quê. Sem fonte, o custo fica a confirmar.", 5)}
        {campo("cuidados", "Cuidados", "Um por linha.", 2)}
        <div className="flex flex-wrap items-center">
          <Button type="button" size="sm" className="mb-1 mr-1.5 h-8" onClick={() => void salvar()} disabled={salvando}>
            {salvando && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Salvar
          </Button>
          <Button type="button" size="sm" variant="ghost" className="mb-1 h-8" onClick={() => setEditando(null)} disabled={salvando}>
            Cancelar
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="min-w-0">
      {!caminho ? (
        <p className="text-[12px] text-muted-foreground">Ainda sem caminho. Peça ao agente ou escreva à mão.</p>
      ) : (
        <div className="min-w-0 space-y-2 text-[12px] leading-relaxed">
          {caminho.resumo && <p className="[overflow-wrap:anywhere]">{caminho.resumo}</p>}
          {(caminho.etapas || []).length > 0 && (
            <ol className="list-decimal pl-5">
              {(caminho.etapas || []).map((e, i) => (
                <li key={`${e.titulo}-${i}`} className="[overflow-wrap:anywhere]">
                  <span className="font-medium">{e.titulo}</span>
                  {e.quando && <span className="text-muted-foreground"> ({e.quando})</span>}
                  {e.porque && <span className="text-muted-foreground">: {e.porque}</span>}
                </li>
              ))}
            </ol>
          )}
          {(caminho.stack || []).length > 0 && (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {(caminho.stack || []).map((s, i) => (
                <li key={`${s.ferramenta}-${i}`} className="px-2.5 py-1.5 [overflow-wrap:anywhere]">
                  <span className="font-medium">{s.ferramenta}</span>
                  {s.para_que && <span> · {s.para_que}</span>}
                  {s.custo && <span className="block text-[11.5px] text-muted-foreground">Custo: {s.custo}{s.fonte ? ` (fonte: ${s.fonte})` : ""}</span>}
                  {s.porque && <span className="block text-[11.5px] text-muted-foreground">{s.porque}</span>}
                </li>
              ))}
            </ul>
          )}
          {(caminho.cuidados || []).length > 0 && <p className="text-[11.5px] text-muted-foreground [overflow-wrap:anywhere]">Cuidados: {(caminho.cuidados || []).join("; ")}</p>}
          {caminho.atualizado_em && <p className="text-[11px] text-muted-foreground">Atualizado em {dataCurta(caminho.atualizado_em)}.</p>}
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center">
        <Button type="button" size="sm" variant="outline" className="mb-1 mr-1.5 h-8" onClick={() => onPedirAoAgente(PEDIDO_DO_CAMINHO)}>
          <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Pedir ao agente
        </Button>
        <Button type="button" size="sm" variant="ghost" className="mb-1 h-8" onClick={() => setEditando(caminhoParaLinhas(caminho))}>
          <Pencil className="mr-1.5 h-3.5 w-3.5" /> Editar
        </Button>
      </div>
    </div>
  );
}

function Pacote({ clientId, tarefas }: { clientId: string; tarefas: { id: string; titulo: string; prazo: string | null }[] }) {
  const { atualizarCusto } = useMesa();
  const [tipo, setTipo] = useState<TipoDePacote>("google_meu_negocio");
  const [tarefa, setTarefa] = useState("");
  const [extra, setExtra] = useState("");
  const [comIa, setComIa] = useState(false);
  const [montando, setMontando] = useState(false);
  const [pacote, setPacote] = useState<{ clientId: string; pacote: PacoteExterno } | null>(null);
  const [erro, setErro] = useState<unknown>(null);
  const montar = async () => {
    setMontando(true);
    setErro(null);
    try {
      const r = await montarPacote(clientId, { tipo, descricao: extra.trim() || undefined, task_id: tipo === "tarefa" && tarefa ? tarefa : undefined, com_ia: comIa });
      setPacote({ clientId, pacote: r.pacote });
      if (comIa) avisarCustoReal("Pacote montado com IA", r, atualizarCusto);
    } catch (e) {
      setErro(e);
    } finally {
      setMontando(false);
    }
  };
  const faltaTarefa = tipo === "tarefa" && !tarefa;
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 flex-wrap items-center">
        <label className="mb-1.5 mr-2 min-w-0">
          <span className="sr-only">Tipo do pacote</span>
          <select className="h-8 max-w-full rounded-lg border border-border bg-card px-2 text-[12px]" value={tipo} onChange={(e) => setTipo(e.target.value as TipoDePacote)}>
            {TIPOS_DE_PACOTE.map((t) => (
              <option key={t.valor} value={t.valor}>{t.rotulo}</option>
            ))}
          </select>
        </label>
        {tipo === "tarefa" && (
          <label className="mb-1.5 min-w-0 max-w-full">
            <span className="sr-only">Tarefa do plano</span>
            <select className="h-8 max-w-full rounded-lg border border-border bg-card px-2 text-[12px]" value={tarefa} onChange={(e) => setTarefa(e.target.value)}>
              <option value="">{tarefas.length ? "Escolha a tarefa" : "Sem tarefa aberta"}</option>
              {tarefas.map((t) => (
                <option key={t.id} value={t.id}>{t.titulo}{t.prazo ? ` (até ${dataCurta(t.prazo)})` : ""}</option>
              ))}
            </select>
          </label>
        )}
      </div>
      <Textarea className="mt-1 text-[12px]" rows={2} value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="O que mais o LLM precisa saber? (opcional)" />
      <div className="mt-2 flex flex-wrap items-center">
        <Button type="button" size="sm" className="mb-1 mr-2 h-8" onClick={() => void montar()} disabled={montando || faltaTarefa}>
          {montando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Package className="mr-1.5 h-3.5 w-3.5" />}
          Montar pacote
        </Button>
        <label className="mb-1 flex items-center text-[11.5px] text-muted-foreground">
          <input type="checkbox" className="mr-1.5" checked={comIa} onChange={(e) => setComIa(e.target.checked)} />
          Escrever o pedido com IA (centavos)
        </label>
      </div>
      {erro !== null && <AvisoDeErro erro={erro} className="mt-2" />}
      {pacote && pacote.clientId === clientId && (
        <div className="mt-2.5">
          <VisorDoPacote pacote={pacote.pacote} />
        </div>
      )}
    </div>
  );
}

/** Cartão da proposta que a função devolveu (brand book ou organizar por tipo), já guardado na conversa. */
function PropostaNaHora({ r, onFeito }: { r: RespostaComProposta; onFeito: () => void }) {
  const acao = acaoDoAnexo(r.acao);
  if (!acao || !r.mensagem_id) return <p className="mt-2 text-[12px] text-muted-foreground [overflow-wrap:anywhere]">{r.resposta}</p>;
  const mensagemId = r.mensagem_id;
  return (
    <div className="mt-2.5 min-w-0">
      <CartaoDeAcao
        acao={acao}
        titulo="O agente vai fazer"
        observacao="Sem custo. Nada é apagado, e dá para desfazer."
        onPedido={(p) => chamarAcaoDoAgente("agente-contexto", mensagemId, acao.id, p)}
        onFeito={(p) => {
          if (p !== "descartar") onFeito();
        }}
      />
    </div>
  );
}

function Identidade({
  clientId,
  identidade,
  onMudou,
}: {
  clientId: string;
  identidade: { briefing: string | null; lacunas: string[]; gerado_em: string | null; brand_book: { arquivos?: { nome: string }[]; importado_em?: string } | null } | null;
  onMudou: () => void;
}) {
  const { atualizarCusto } = useMesa();
  const arquivo = useRef<HTMLInputElement>(null);
  const [preparando, setPreparando] = useState(false);
  const [preparado, setPreparado] = useState<{ clientId: string; lacunas: string[]; pacote: PacoteExterno } | null>(null);
  const [etapa, setEtapa] = useState<string | null>(null);
  const [proposta, setProposta] = useState<{ clientId: string; r: RespostaComProposta } | null>(null);
  const [erro, setErro] = useState<unknown>(null);
  const preparar = async () => {
    setPreparando(true);
    setErro(null);
    try {
      const r = await prepararIdentidade(clientId);
      setPreparado({ clientId, lacunas: r.lacunas || [], pacote: r.pacote });
      onMudou();
    } catch (e) {
      setErro(e);
    } finally {
      setPreparando(false);
    }
  };
  const importar = async (lista: FileList | null) => {
    const arquivos = lista ? Array.prototype.slice.call(lista, 0, 12) as File[] : [];
    if (!arquivos.length) return;
    setErro(null);
    setProposta(null);
    setEtapa("Guardando os arquivos...");
    try {
      const r = await importarBrandBook(clientId, arquivos, setEtapa);
      setProposta({ clientId, r });
      avisarCustoReal("Brand book lido", r, atualizarCusto);
      onMudou();
    } catch (e) {
      setErro(e);
    } finally {
      setEtapa(null);
      if (arquivo.current) arquivo.current.value = "";
    }
  };
  const bb = identidade && identidade.brand_book;
  return (
    <div className="min-w-0">
      <p className="text-[12px] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
        {identidade && identidade.gerado_em ? `Briefing de identidade preparado em ${dataCurta(identidade.gerado_em)}.` : "Briefing de identidade ainda não preparado."}
        {bb && bb.importado_em ? ` Brand book importado em ${dataCurta(bb.importado_em)} (${(bb.arquivos || []).length} ${(bb.arquivos || []).length === 1 ? "arquivo" : "arquivos"}).` : ""}
      </p>
      <div className="mt-2 flex flex-wrap items-center">
        <Button type="button" size="sm" className="mb-1 mr-1.5 h-8" onClick={() => void preparar()} disabled={preparando || !!etapa}>
          {preparando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Palette className="mr-1.5 h-3.5 w-3.5" />}
          Preparar identidade visual
        </Button>
        <Button type="button" size="sm" variant="outline" className="mb-1 h-8" onClick={() => arquivo.current && arquivo.current.click()} disabled={preparando || !!etapa}>
          {etapa ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <FileUp className="mr-1.5 h-3.5 w-3.5" />}
          Importar brand book
        </Button>
        <input ref={arquivo} type="file" multiple accept={TIPOS_DO_BRAND_BOOK} className="hidden" onChange={(e) => void importar(e.target.files)} aria-label="Arquivos do brand book" />
      </div>
      <p className="text-[11px] text-muted-foreground">PDF e as logos em PNG. O agente lê cores, fontes e logos e propõe o kit para você confirmar.</p>
      {etapa && <p className="mt-1.5 flex items-center text-[12px] text-muted-foreground"><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />{etapa}</p>}
      {erro !== null && <AvisoDeErro erro={erro} className="mt-2" />}
      {proposta && proposta.clientId === clientId && <PropostaNaHora r={proposta.r} onFeito={onMudou} />}
      {preparado && preparado.clientId === clientId && (
        <div className="mt-2.5 min-w-0">
          {preparado.lacunas.length > 0 && (
            <p className="mb-1.5 text-[11.5px] text-muted-foreground [overflow-wrap:anywhere]">Perguntar ao dono antes de gerar: {preparado.lacunas.join("; ")}.</p>
          )}
          <VisorDoPacote pacote={preparado.pacote} />
        </div>
      )}
    </div>
  );
}

function Organizar({ clientId, onMudou }: { clientId: string; onMudou: () => void }) {
  const [fazendo, setFazendo] = useState(false);
  const [r, setR] = useState<{ clientId: string; r: RespostaComProposta } | null>(null);
  const pedir = async () => {
    setFazendo(true);
    try {
      const resposta = await organizarPorTipo(clientId);
      setR({ clientId, r: resposta });
      if (!resposta.acao) toast.info(resposta.resposta || "Nada solto para organizar.");
      onMudou();
    } catch (e) {
      toast.error("Não foi possível organizar", { description: textoDoErro(e) });
    } finally {
      setFazendo(false);
    }
  };
  return (
    <div className="min-w-0">
      <Button type="button" size="sm" variant="outline" className="h-8" onClick={() => void pedir()} disabled={fazendo}>
        {fazendo ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <FolderTree className="mr-1.5 h-3.5 w-3.5" />}
        Organizar tudo por tipo
      </Button>
      {r && r.clientId === clientId && r.r.acao ? <PropostaNaHora r={r.r} onFeito={onMudou} /> : null}
    </div>
  );
}

export default function ContextoPlanoDoCliente({ onPedirAoAgente }: { onPedirAoAgente: (texto: string) => void }) {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const invalidar = useInvalidarContexto();
  const plano = usePlanoDoCliente(clientId);
  const mudou = () => {
    void queryClient.invalidateQueries({ queryKey: chaveDoPlano(clientId) });
    void queryClient.invalidateQueries({ queryKey: chaveDoHistorico(clientId) });
    invalidar(clientId);
  };
  const d = plano.data;
  return (
    <div className="min-w-0 space-y-3">
      <Bloco icone={<Compass className="h-3.5 w-3.5" />} titulo="Começo do cliente" dica="O agente ao lado lê tudo o que o painel tem, define nicho e posicionamento com você e propõe o plano. Nada muda sem confirmar.">
        {plano.isLoading && <div className="h-10 animate-pulse rounded-lg bg-muted" aria-label="Lendo o plano" />}
        {plano.isError && <AvisoDeErro erro={plano.error} />}
        {d && (
          <div className="min-w-0 space-y-1 text-[12px] leading-relaxed">
            {d.fase && (
              <p className="[overflow-wrap:anywhere]">
                <span className="font-medium">Fase do método:</span> {d.fase.nome} <span className="text-muted-foreground">({d.fase.motivo})</span>
              </p>
            )}
            <p className="[overflow-wrap:anywhere]"><span className="font-medium">Nicho:</span> {d.nicho || <span className="text-muted-foreground">a definir</span>}</p>
            {d.estagio && <p className="[overflow-wrap:anywhere]"><span className="font-medium">Estágio:</span> {d.estagio}</p>}
            {d.posicionamento && <p className="[overflow-wrap:anywhere]"><span className="font-medium">Posicionamento:</span> {d.posicionamento}</p>}
            {d.projetos.length > 0 ? (
              <ul className="mt-1 text-[11.5px] text-muted-foreground">
                {d.projetos.map((p, i) => (
                  <li key={`${p.nome}-${i}`} className="[overflow-wrap:anywhere]">
                    {p.nome} · {p.marcos} {p.marcos === 1 ? "marco" : "marcos"} · {p.tarefas_abertas} {p.tarefas_abertas === 1 ? "tarefa aberta" : "tarefas abertas"}{p.prazo ? ` · até ${dataCurta(p.prazo)}` : ""}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[11.5px] text-muted-foreground">Ainda sem projeto no painel.</p>
            )}
          </div>
        )}
        <Button type="button" size="sm" className="mt-2 h-8" onClick={() => onPedirAoAgente(PEDIDO_DO_COMECO)}>
          <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Começar o plano com o agente
        </Button>
      </Bloco>

      <Bloco icone={<Mapa className="h-3.5 w-3.5" />} titulo="Caminho e tech stack" dica="O que fazer primeiro, com que ferramenta e por quê. Custo só com fonte.">
        <Caminho clientId={clientId} caminho={d ? d.caminho : null} onPedirAoAgente={onPedirAoAgente} />
      </Bloco>

      <Bloco icone={<Package className="h-3.5 w-3.5" />} titulo="Pacote para LLM externo" dica="Contexto do cliente, tarefa e instruções prontos para colar no ChatGPT ou no Claude. Google Meu Negócio sai com os dados de cadastro; o cadastro é feito com o dono.">
        <Pacote clientId={clientId} tarefas={d ? d.tarefas : []} />
      </Bloco>

      <Bloco icone={<Palette className="h-3.5 w-3.5" />} titulo="Identidade visual" dica="Prepara o briefing de identidade para o gerador externo e traz o brand book de volta para o kit.">
        <Identidade clientId={clientId} identidade={d ? d.identidade : null} onMudou={mudou} />
      </Bloco>

      <Bloco icone={<FolderTree className="h-3.5 w-3.5" />} titulo="Organizar arquivos" dica="Arquivos soltos do workspace vão para pastas por tipo (Marca, Fotos, Vídeos, Documentos...). Você confirma a lista antes.">
        <Organizar clientId={clientId} onMudou={mudou} />
      </Bloco>
    </div>
  );
}
