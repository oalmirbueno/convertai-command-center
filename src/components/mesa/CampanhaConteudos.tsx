import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck2, Check, ChevronDown, ExternalLink, Layers, Loader2, Pencil, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { padraoPara, saidaPorRaciocinio, TAMANHOS, type ModeloIa, type ParteDaEstimativa } from "@/lib/mesa/api";
import { AvisoDeErro, BotaoComCusto, useAvisarErro } from "./Custo";
import { Cronometro } from "./Cronometro";
import { useFiltroDaMarca, useMesa } from "./MesaContexto";
import { projetosDaListaNaMarca } from "@/lib/mesa/marcas";
import MesEscolhaEditorial from "./MesEscolhaEditorial";
import { corpoDaEscolha, escolhaLivre, rotuloEditorial, type EscolhaEditorial } from "./MesConhecimento";
import {
  atualizarAgenda,
  chaves,
  diaCurto,
  editarItemDaProposta,
  gravarSelecionados,
  hojeIso,
  laminasDoItem,
  lerProjetosDoCliente,
  mesDaData,
  rotuloDoFormato,
  type Campanha,
  type CamposDoItem,
  type ItemProposto,
  type PropostaV4,
} from "./mesaV4Api";
import { aplicarRespostaDaCampanha, campanhaConteudos } from "./campanhasApi";

/**
 * Conteúdos da campanha (pedido do dono em 25/09): "quando abro a campanha,
 * vejo os conteúdos e ele já gera; posso alterar os conteúdos, a arte por
 * dentro, seleciono e envio para a agenda com os dias certinhos, depois vai
 * para o calendário e entra no estúdio". Cada conteúdo mostra a etapa, o tipo
 * e o framework, o formato e o dia; editar abre texto, lâminas, CTA e a
 * instrução de arte (sem IA). Os que ainda não estão na agenda têm caixa de
 * seleção; "Mandar para a agenda" grava só os marcados, cada um no seu dia,
 * com a direção pronta no Estúdio.
 */

export const partesDosConteudosDaCampanha = (catalogo: ModeloIa[], quantidade: number): ParteDaEstimativa[] => {
  const m = padraoPara(catalogo, "estrategista");
  const lotes = Math.max(1, Math.ceil(quantidade / 2));
  return [
    {
      modeloId: m ? m.id : null,
      tipo: "texto",
      tokensEntrada: 16000 * lotes,
      tokensSaida: lotes * saidaPorRaciocinio("medium") + quantidade * TAMANHOS.detalhar.saidaPorItem,
    },
  ];
};

function EditorDoConteudo({
  item,
  salvando,
  onSalvar,
  onCancelar,
}: {
  item: ItemProposto;
  salvando: boolean;
  onSalvar: (campos: CamposDoItem) => void;
  onCancelar: () => void;
}) {
  const cardsIniciais = (item.cards || []).slice().sort((a, b) => a.ordem - b.ordem);
  const [tema, setTema] = useState(item.tema || "");
  const [gancho, setGancho] = useState(item.gancho || "");
  const [cta, setCta] = useState(item.cta || "");
  const [copy, setCopy] = useState(item.copy || "");
  const [instrucao, setInstrucao] = useState(item.instrucao_arte || "");
  const [cards, setCards] = useState(cardsIniciais.map((c) => ({ ordem: c.ordem, texto: c.texto || "" })));

  const salvar = () => {
    const campos: CamposDoItem = { tema, gancho, cta, copy, instrucao_arte: instrucao };
    const mudados = cards.filter((c) => {
      const antes = cardsIniciais.filter((x) => x.ordem === c.ordem)[0];
      return antes && (antes.texto || "") !== c.texto && c.texto.trim();
    });
    if (mudados.length) campos.cards = mudados.map((c) => ({ ordem: c.ordem, texto: c.texto }));
    onSalvar(campos);
  };

  return (
    <div className="space-y-2.5 border-t border-border px-3 py-3" data-editor-do-conteudo>
      <label className="block text-[11px] font-medium text-muted-foreground">
        Título
        <Input value={tema} onChange={(e) => setTema(e.target.value)} className="mt-1 h-8 text-[12.5px]" />
      </label>
      <label className="block text-[11px] font-medium text-muted-foreground">
        Gancho
        <Input value={gancho} onChange={(e) => setGancho(e.target.value)} className="mt-1 h-8 text-[12.5px]" />
      </label>
      {cards.map((c, i) => (
        <label key={c.ordem} className="block text-[11px] font-medium text-muted-foreground">
          Lâmina {c.ordem}
          {cardsIniciais[i] && cardsIniciais[i].funcao ? ` · ${cardsIniciais[i].funcao}` : ""}
          <Textarea
            value={c.texto}
            rows={2}
            onChange={(e) => setCards((l) => l.map((x) => (x.ordem === c.ordem ? { ...x, texto: e.target.value } : x)))}
            className="mt-1 min-h-[48px] text-[12.5px]"
          />
        </label>
      ))}
      <label className="block text-[11px] font-medium text-muted-foreground">
        CTA
        <Input value={cta} onChange={(e) => setCta(e.target.value)} className="mt-1 h-8 text-[12.5px]" />
      </label>
      <label className="block text-[11px] font-medium text-muted-foreground">
        Instrução de arte
        <Input
          value={instrucao}
          onChange={(e) => setInstrucao(e.target.value)}
          placeholder="Ex.: troque o céu por um pôr do sol; produto maior na capa"
          className="mt-1 h-8 text-[12.5px]"
        />
      </label>
      <label className="block text-[11px] font-medium text-muted-foreground">
        Legenda
        <Textarea value={copy} rows={3} onChange={(e) => setCopy(e.target.value)} className="mt-1 min-h-[60px] text-[12.5px]" />
      </label>
      <div className="flex items-center justify-end">
        <Button type="button" size="sm" variant="ghost" className="mr-1.5 h-8" onClick={onCancelar} disabled={salvando}>Cancelar</Button>
        <Button type="button" size="sm" className="h-8" onClick={salvar} disabled={salvando}>
          {salvando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1.5 h-3.5 w-3.5" />}
          Salvar
        </Button>
      </div>
    </div>
  );
}

function LinhaDoConteudo({
  item,
  marcado,
  onMarcar,
  onEditar,
  onAbrir,
}: {
  item: ItemProposto;
  marcado: boolean;
  onMarcar: (v: boolean) => void;
  onEditar: (campos: CamposDoItem) => Promise<void>;
  onAbrir?: (taskId: string, mes: string) => void;
}) {
  const [editando, setEditando] = useState(false);
  const [aberto, setAberto] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const naAgenda = !!item.task_id;
  const laminas = laminasDoItem(item);
  const editorial = rotuloEditorial(item.tipo_editorial, item.framework);

  const salvar = async (campos: CamposDoItem) => {
    setSalvando(true);
    try {
      await onEditar(campos);
      setEditando(false);
    } finally {
      setSalvando(false);
    }
  };

  return (
    <li className={`min-w-0 rounded-lg border bg-background ${marcado ? "border-primary/60" : "border-border"}`} data-conteudo={item.tema_id}>
      <div className="flex min-w-0 items-start px-3 py-2.5">
        {naAgenda ? (
          <CalendarCheck2 className="mr-2.5 mt-0.5 h-4 w-4 shrink-0 text-success" aria-label="Na agenda" />
        ) : (
          <input
            type="checkbox"
            checked={marcado}
            onChange={(e) => onMarcar(e.target.checked)}
            aria-label={`Selecionar ${item.tema || "conteúdo"}`}
            className="mr-2.5 mt-1 h-4 w-4 shrink-0 accent-[hsl(var(--primary))]"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center text-[11px] text-muted-foreground">
            {item.etapa && <span className="mb-0.5 mr-1.5 rounded-full bg-primary/10 px-2 py-0.5 font-medium capitalize text-primary">{item.etapa}</span>}
            <span className="mb-0.5 mr-2">{rotuloDoFormato(item.formato)}</span>
            {laminas > 0 && (
              <span className="mb-0.5 mr-2 inline-flex items-center"><Layers className="mr-0.5 h-3 w-3" />{laminas}</span>
            )}
            {editorial && <span className="mb-0.5 mr-2">{editorial}</span>}
            {naAgenda && <span className="mb-0.5 font-medium text-success">na agenda · {diaCurto(item.data)}</span>}
          </div>
          <p className="mt-0.5 text-[13px] font-medium leading-snug [overflow-wrap:anywhere]">{item.tema || "Sem título"}</p>
          {item.gancho && <p className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-muted-foreground [overflow-wrap:anywhere]">{item.gancho}</p>}
          {item.instrucao_arte && <p className="mt-1 text-[11.5px] text-foreground [overflow-wrap:anywhere]">Arte: {item.instrucao_arte}</p>}
          <div className="mt-1.5 flex flex-wrap items-center">
            {!naAgenda && (
              <>
                <Input
                  type="date"
                  value={item.data || ""}
                  min={hojeIso()}
                  aria-label={`Dia de ${item.tema || "conteúdo"}`}
                  onChange={(e) => { if (e.target.value) void onEditar({ data: e.target.value }); }}
                  className="mb-1 mr-1.5 h-7 w-[140px] text-[11.5px]"
                />
                <Select value={item.formato === "estatico" ? "estatico" : "carrossel"} onValueChange={(v) => void onEditar({ formato: v as "estatico" | "carrossel" })}>
                  <SelectTrigger className="mb-1 mr-1.5 h-7 w-[112px] text-[11.5px]" aria-label="Formato"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="estatico">Estático</SelectItem>
                    <SelectItem value="carrossel">Carrossel</SelectItem>
                  </SelectContent>
                </Select>
                <button type="button" onClick={() => setEditando((v) => !v)} className="mb-1 mr-3 inline-flex items-center text-[11.5px] font-medium text-primary hover:underline">
                  <Pencil className="mr-1 h-3 w-3" /> {editando ? "Fechar edição" : "Editar"}
                </button>
              </>
            )}
            {!editando && (
              <button type="button" onClick={() => setAberto((v) => !v)} aria-expanded={aberto} className="mb-1 mr-3 inline-flex items-center text-[11.5px] text-muted-foreground hover:text-foreground">
                {aberto ? "Fechar roteiro" : "Ver roteiro"}
                <ChevronDown className={`ml-0.5 h-3.5 w-3.5 transition-transform ${aberto ? "rotate-180" : ""}`} />
              </button>
            )}
            {naAgenda && onAbrir && (
              <button type="button" onClick={() => onAbrir(item.task_id as string, mesDaData(item.data))} className="mb-1 inline-flex items-center text-[11.5px] font-medium text-primary hover:underline">
                Abrir no Estúdio <ExternalLink className="ml-1 h-3 w-3" />
              </button>
            )}
          </div>
        </div>
      </div>
      {editando && !naAgenda && <EditorDoConteudo item={item} salvando={salvando} onSalvar={(c) => void salvar(c)} onCancelar={() => setEditando(false)} />}
      {aberto && !editando && (
        <ol className="space-y-1.5 border-t border-border px-3 py-2.5">
          {(item.cards || []).slice().sort((a, b) => a.ordem - b.ordem).map((c) => (
            <li key={c.ordem} className="rounded-md bg-muted px-2.5 py-2">
              <p className="text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">Lâmina {c.ordem}{c.funcao ? ` · ${c.funcao}` : ""}</p>
              {c.texto && <p className="mt-0.5 text-[12px] leading-snug [overflow-wrap:anywhere]">{c.texto}</p>}
              {c.ilustracao && <p className="mt-1 text-[11px] leading-snug text-muted-foreground [overflow-wrap:anywhere]">{c.ilustracao}</p>}
            </li>
          ))}
          {item.cta && <li className="text-[11.5px] text-muted-foreground">CTA: {item.cta}</li>}
        </ol>
      )}
    </li>
  );
}

export default function CampanhaConteudos({
  campanha,
  proposta,
  carregando,
  erro,
  projetoSugerido,
  onAbrirNoEstudio,
  onPedirAoAgente,
}: {
  campanha: Campanha;
  proposta: PropostaV4 | null;
  carregando: boolean;
  erro: unknown;
  projetoSugerido?: string | null;
  onAbrirNoEstudio?: (taskId: string, mes: string) => void;
  onPedirAoAgente?: (texto: string) => void;
}) {
  const { clientId, catalogo } = useMesa();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const [quantidade, setQuantidade] = useState("5");
  const [formato, setFormato] = useState<"" | "estatico" | "carrossel">("");
  const [escolha, setEscolha] = useState<EscolhaEditorial>(escolhaLivre);
  const [gerandoDesde, setGerandoDesde] = useState<number | null>(null);
  const [marcados, setMarcados] = useState<string[] | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [projetoEscolhido, setProjetoEscolhido] = useState("");

  const itens = useMemo(
    () => ((proposta && proposta.itens) || []).slice().sort((a, b) => String(a.data || "").localeCompare(String(b.data || ""))),
    [proposta],
  );
  const livres = itens.filter((i) => !i.task_id && i.tema_id);
  const naAgenda = itens.filter((i) => !!i.task_id);
  // Padrão: todos os que ainda não estão na agenda ficam marcados.
  const selecao = marcados === null ? livres.map((i) => i.tema_id as string) : marcados.filter((id) => livres.some((i) => i.tema_id === id));

  useEffect(() => {
    setMarcados(null);
  }, [proposta ? proposta.id : ""]);

  // Resultado parcial: enquanto gera, relê a proposta (e a campanha, que ganha
  // a proposta na primeira geração) a cada 3 s; cada lote aparece ao gravar.
  useEffect(() => {
    if (gerandoDesde === null) return;
    const relogio = window.setInterval(() => {
      if (campanha.proposta_id) void queryClient.invalidateQueries({ queryKey: chaves.proposta(campanha.proposta_id) });
      else void queryClient.invalidateQueries({ queryKey: chaves.campanhas(clientId) });
    }, 3000);
    return () => window.clearInterval(relogio);
  }, [gerandoDesde, campanha.proposta_id, clientId, queryClient]);

  const projetoDaProposta = projetoSugerido || (proposta && proposta.project_id) || "";
  const projetos = useQuery({
    queryKey: chaves.projetosSocial(clientId),
    enabled: !projetoDaProposta && livres.length > 0,
    queryFn: () => lerProjetosDoCliente(clientId),
  });
  // Marca por projeto (Acerbi e CME): só os projetos da marca aberta; sem marca, todos.
  const filtroDaMarca = useFiltroDaMarca();
  const candidatos = useMemo(() => {
    const todos = projetos.data || [];
    const social = todos.filter((p) => p.project_type === "social_media");
    return projetosDaListaNaMarca(social.length ? social : todos, filtroDaMarca);
  }, [projetos.data, filtroDaMarca]);
  const projeto = projetoDaProposta || projetoEscolhido || (candidatos.length === 1 ? candidatos[0].id : "");

  const aplicarProposta = (p: PropostaV4 | null | undefined) => {
    if (p && p.id) queryClient.setQueryData(chaves.proposta(p.id), p);
  };

  const editar = async (item: ItemProposto, campos: CamposDoItem) => {
    if (!proposta || !item.tema_id) return;
    try {
      const d = await editarItemDaProposta(proposta.id, item.tema_id, campos);
      aplicarProposta(d && d.proposta);
      if (d && Array.isArray(d.avisos) && d.avisos.length) toast.info(d.avisos.join(" "));
    } catch (e) {
      avisarErro(e, "Não foi possível salvar o conteúdo");
      throw e;
    }
  };

  const gerar = async () => {
    setGerandoDesde(Date.now());
    try {
      return await campanhaConteudos({
        campanhaId: campanha.id,
        quantidade: Number(quantidade) || 5,
        formato: formato || null,
        escolha,
      });
    } finally {
      setGerandoDesde(null);
      if (campanha.proposta_id) void queryClient.invalidateQueries({ queryKey: chaves.proposta(campanha.proposta_id) });
    }
  };

  const mandar = async () => {
    if (!proposta || !selecao.length || !projeto) return;
    setEnviando(true);
    try {
      const d = await gravarSelecionados(proposta.id, selecao, projeto);
      aplicarProposta(d && d.proposta);
      setMarcados(null);
      const n = Array.isArray(d && d.itens) ? d.itens.length : selecao.length;
      toast.success("Na agenda", { description: `${n} conteúdo(s) no calendário, cada um no seu dia, com a direção pronta no Estúdio.` });
    } catch (e) {
      avisarErro(e, "Não foi possível mandar para a agenda");
    } finally {
      setEnviando(false);
      atualizarAgenda(queryClient, clientId);
      void queryClient.invalidateQueries({ queryKey: chaves.proposta(proposta.id) });
      void queryClient.invalidateQueries({ queryKey: chaves.campanhas(clientId) });
    }
  };

  const primeiroNaAgenda = naAgenda[0];

  return (
    <div className="min-w-0 space-y-3" data-conteudos-da-campanha>
      {carregando && <div className="h-24 animate-pulse rounded-lg bg-muted" />}
      {!!erro && <AvisoDeErro erro={erro} />}

      {/* Gerar na hora: quantos, formato, tipos e frameworks. */}
      <div className="min-w-0 space-y-2 rounded-lg border border-dashed border-border p-2.5">
        <div className="flex min-w-0 flex-wrap items-center">
          <Select value={quantidade} onValueChange={setQuantidade} disabled={gerandoDesde !== null}>
            <SelectTrigger className="mb-1 mr-1.5 h-8 w-[130px] text-[12px]" aria-label="Quantos conteúdos"><SelectValue /></SelectTrigger>
            <SelectContent>
              {["1", "2", "3", "4", "5", "6", "8"].map((n) => <SelectItem key={n} value={n}>{n} conteúdo{n === "1" ? "" : "s"}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={formato || "auto"} onValueChange={(v) => setFormato(v === "auto" ? "" : (v as "estatico" | "carrossel"))} disabled={gerandoDesde !== null}>
            <SelectTrigger className="mb-1 mr-1.5 h-8 w-[160px] text-[12px]" aria-label="Formato dos conteúdos"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Formato pela etapa</SelectItem>
              <SelectItem value="estatico">Só estático</SelectItem>
              <SelectItem value="carrossel">Só carrossel</SelectItem>
            </SelectContent>
          </Select>
          <BotaoComCusto
            rotulo={<><Sparkles className="mr-1.5 h-3.5 w-3.5" />{itens.length ? "Gerar mais conteúdos" : "Gerar os conteúdos da campanha"}</>}
            titulo="Conteúdos da campanha"
            descricao="O estrategista escreve os conteúdos pelo arco da campanha (aquecimento, lançamento, prova, objeção, último chamado), em paralelo, com o briefing e as imagens. Eles aparecem conforme ficam prontos."
            partes={() => partesDosConteudosDaCampanha(catalogo, Number(quantidade) || 5)}
            executar={gerar}
            aoConcluir={(d) => aplicarRespostaDaCampanha(queryClient, clientId, d)}
            disabled={gerandoDesde !== null}
            variant={itens.length ? "outline" : "default"}
            className="mb-1 h-8"
          />
        </div>
        <MesEscolhaEditorial valor={escolha} onChange={setEscolha} disabled={gerandoDesde !== null} />
        {gerandoDesde !== null && <Cronometro desde={gerandoDesde} rotulo={`Escrevendo em paralelo: ${itens.length} conteúdo(s) na campanha`} previsao="~1 min" />}
      </div>

      {proposta && itens.length === 0 && gerandoDesde === null && (
        <p className="text-[12.5px] text-muted-foreground">Nenhum conteúdo ainda. Gere acima ou peça ao agente da campanha.</p>
      )}

      {itens.length > 0 && (
        <ul className="min-w-0 space-y-2" aria-label="Conteúdos da campanha">
          {itens.map((it) => (
            <LinhaDoConteudo
              key={it.tema_id || it.tema}
              item={it}
              marcado={!!it.tema_id && selecao.indexOf(it.tema_id) >= 0}
              onMarcar={(v) => {
                const id = it.tema_id as string;
                setMarcados(v ? selecao.concat([id]) : selecao.filter((x) => x !== id));
              }}
              onEditar={(campos) => editar(it, campos)}
              onAbrir={onAbrirNoEstudio}
            />
          ))}
        </ul>
      )}

      {/* Barra: mandar os marcados para a agenda, ajustar com o agente, abrir no Estúdio. */}
      {itens.length > 0 && (
        <div className="flex min-w-0 flex-wrap items-center rounded-lg bg-muted px-2.5 py-2">
          {livres.length > 0 ? (
            <>
              {!projetoDaProposta && candidatos.length !== 1 && (
                <Select value={projetoEscolhido} onValueChange={setProjetoEscolhido}>
                  <SelectTrigger className="mb-1 mr-1.5 h-8 w-full min-w-0 text-[12px] sm:w-[190px]" aria-label="Projeto de social">
                    <SelectValue placeholder={projetos.isLoading ? "Lendo projetos…" : candidatos.length ? "Projeto de social" : "Cliente sem projeto"} />
                  </SelectTrigger>
                  <SelectContent>
                    {candidatos.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
              <Button type="button" size="sm" className="mb-1 mr-1.5 h-8" onClick={() => void mandar()} disabled={!selecao.length || !projeto || enviando}>
                {enviando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <CalendarCheck2 className="mr-1.5 h-3.5 w-3.5" />}
                Mandar para a agenda ({selecao.length})
              </Button>
            </>
          ) : (
            <span className="mb-1 mr-2 inline-flex items-center text-[12px]">
              <CalendarCheck2 className="mr-1.5 h-3.5 w-3.5 text-success" /> Tudo na agenda
            </span>
          )}
          {onPedirAoAgente && (
            <Button type="button" size="sm" variant="outline" className="mb-1 mr-1.5 h-8" onClick={() => onPedirAoAgente("Nos conteúdos, ")}>
              <Pencil className="mr-1.5 h-3.5 w-3.5" /> Ajustar com o agente
            </Button>
          )}
          {primeiroNaAgenda && onAbrirNoEstudio && (
            <button
              type="button"
              onClick={() => onAbrirNoEstudio(primeiroNaAgenda.task_id as string, mesDaData(primeiroNaAgenda.data))}
              className="mb-1 ml-auto inline-flex items-center text-[12px] font-medium text-primary hover:underline"
            >
              Abrir no Estúdio <ExternalLink className="ml-1 h-3 w-3" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
