import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Upload, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { useMesa } from "@/components/mesa/MesaContexto";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { botao, campo, campoTexto, etiqueta, juntar, texto } from "@/components/sistema/estilos";
import { chamarMesaVideos, chaveDosArquivos, subirVideos, useArquivosDeVideo } from "@/components/mesa-videos/videosApi";
import { midiaDaFonte, type ProjetoDeEdicao } from "../../../../supabase/functions/_shared/projeto-de-edicao";
import {
  GALERIA_DE_CENARIOS,
  INFO_DAS_QUALIDADES,
  LAYOUTS_DA_TROCA,
  NOTA_DO_LAYOUT,
  QUALIDADES_DA_TROCA,
  ROTULO_DO_LAYOUT,
  type LayoutDaTroca,
  type QualidadeDaTroca,
} from "../../../../supabase/functions/mesa-videos/modulos/troca-de-cenario";
import {
  clipesDeVideo,
  emCurso,
  itemDoResultado,
  ondeEntra,
  origemDoAcervo,
  pedirComCusto,
  prontasParaEntrar,
  trechoNoLimite,
  usd,
  type CustoMostrado,
  type EstadoDasQualidades,
  type OrigemDoVideo,
  type TrocaNaTela,
} from "@/lib/editor/cenario";
import { opsParaInserir } from "@/lib/editor/biblioteca";
import { blobDoDataUrl, extrairQuadro, tempoDoQuadro } from "@/lib/editor/quadros";
import { novoId, subirDoEditor } from "@/lib/editor/api";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import type { Operacao } from "@/lib/editor/operacoes";
import { assinarFonte } from "./apoio";
import EstadoDaMaquina from "./EstadoDaMaquina";

/**
 * Trocar o cenário com a pessoa fixa (frente TCN, rodada 3 parte 1, 01/10/2026).
 * Vídeo (clipe da edição, acervo ou subir), cenário escrito ou da galeria,
 * qualidade e saída; amostra barata primeiro; a final anda sozinha (máquina de
 * render e provedor) e entra como clipe novo logo depois do clipe de origem,
 * com Desfazer. Regras e preços em mesa-videos/modulos/troca-de-cenario.ts.
 */

type Resposta = { trocas: TrocaNaTela[]; qualidades: EstadoDasQualidades };

const chaveDasTrocas = (clientId: string, versaoId: string) => ["mesa-edicao", "cenarios", clientId, versaoId];

/** As trocas desta versão (lê ao abrir; de 8 em 8 s só enquanto alguma anda). */
export function useTrocasDeCenario(clientId: string, versaoId: string, ativo = true) {
  return useQuery({
    queryKey: chaveDasTrocas(clientId, versaoId),
    enabled: ativo && !!clientId && !!versaoId,
    retry: false,
    staleTime: 5_000,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<Resposta> => {
      const r = await chamarMesaVideos<Resposta>({ acao: "cenario_status", client_id: clientId, versao_id: versaoId });
      return { trocas: (r && r.trocas) || [], qualidades: (r && r.qualidades) || {} };
    },
    refetchInterval: (q) => {
      const d = q.state.data as Resposta | undefined;
      return d && d.trocas.some(emCurso) ? 8_000 : false;
    },
  });
}

/**
 * Põe na linha do tempo, uma vez, a troca que ficou pronta (mesmo com o painel
 * fechado, enquanto o editor está aberto). Um passo do Ctrl+Z; o aviso tem Desfazer.
 */
export function useEntradaDasTrocas(o: { clientId: string; versaoId: string; projeto: ProjetoDeEdicao; onOps: (ops: Operacao[], rotulo: string) => void; desfazer: () => void }) {
  // Abrir o editor não chama a função: só pergunta quando há troca andando (vista pelo painel nesta
  // aba, ou lembrada de antes de recarregar a página) até ela entrar na linha do tempo.
  const queryClient = useQueryClient();
  const [lembrada, setLembrada] = useEstadoDaTela<boolean>(`mesa-edicao:cenario:pendente:${o.versaoId}`, false, { validar: (v) => typeof v === "boolean" });
  const vistas = queryClient.getQueryData<Resposta>(chaveDasTrocas(o.clientId, o.versaoId));
  const pendente = (d: Resposta | undefined) => !!d && d.trocas.some((t) => t.versao_id === o.versaoId && (emCurso(t) || (t.estado === "pronto" && !t.inserido_em)));
  const q = useTrocasDeCenario(o.clientId, o.versaoId, lembrada || pendente(vistas));
  useEffect(() => {
    if (!q.data) return;
    const p = pendente(q.data);
    if (p !== lembrada) setLembrada(p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data]);
  const postas = useRef<Record<string, true>>({});
  const projetoRef = useRef(o.projeto);
  projetoRef.current = o.projeto;
  useEffect(() => {
    const lista = q.data ? prontasParaEntrar(q.data.trocas, o.versaoId, postas.current) : [];
    lista.forEach((t) => {
      const item = itemDoResultado(t);
      if (!item) return;
      postas.current[t.id] = true;
      try {
        const p = projetoRef.current;
        o.onOps(opsParaInserir(p, item, ondeEntra(p, t), 0, { tipo: "cena", ref: `cenario:${t.id.slice(0, 8)}` }), "Cenário novo");
        toast.success("Cenário novo na linha do tempo.", { action: { label: "Desfazer", onClick: () => o.desfazer() } });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "O cenário novo não entrou na linha do tempo. Ele está na Mídia.");
      }
      void chamarMesaVideos({ acao: "cenario_inserido", cenario_id: t.id }).catch(() => undefined);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data, o.versaoId]);
  return q;
}

/** "Preparar" (custo, nada gasto) e "Gerar por US$ X" (o clique do dono). */
function CustoEConfirmar({
  rotulo,
  primario,
  desativado,
  motivo,
  preparar,
  confirmar,
}: {
  rotulo: string;
  primario?: boolean;
  desativado?: boolean;
  motivo?: string | null;
  preparar: () => Promise<CustoMostrado | string>;
  confirmar: (custo: CustoMostrado, uid: string) => Promise<CustoMostrado | string | null>;
}) {
  const [estado, setEstado] = useState<{ fase: "ocioso" } | { fase: "ocupado"; texto: string } | { fase: "custo"; custo: CustoMostrado; uid: string; mudou: boolean } | { fase: "erro"; mensagem: string }>({ fase: "ocioso" });
  const ir = async () => {
    setEstado({ fase: "ocupado", texto: "Calculando o custo" });
    const r = await preparar().catch((e: unknown) => (e instanceof Error ? e.message : "Não deu."));
    setEstado(typeof r === "string" ? { fase: "erro", mensagem: r } : { fase: "custo", custo: r, uid: novoId(), mudou: false });
  };
  const gerar = async (custo: CustoMostrado, uid: string) => {
    setEstado({ fase: "ocupado", texto: "Gerando" });
    const r = await confirmar(custo, uid).catch((e: unknown) => (e instanceof Error ? e.message : "Não deu."));
    if (r === null) setEstado({ fase: "ocioso" });
    else if (typeof r === "string") setEstado({ fase: "erro", mensagem: r });
    else setEstado({ fase: "custo", custo: r, uid: novoId(), mudou: true });
  };
  const e = estado;
  return (
    <div className="min-w-0" data-custo-e-confirmar={rotulo}>
      {(e.fase === "ocioso" || e.fase === "erro") && (
        <div className="flex min-w-0 flex-wrap items-center">
          <button type="button" className={juntar(primario ? botao.primario : botao.secundario, "mb-1 mr-2")} disabled={desativado} onClick={() => void ir()}>
            <Wand2 className="mr-1.5 h-3.5 w-3.5" />
            {rotulo}
          </button>
          <span className={juntar(texto.auxiliar, "mb-1")}>{desativado && motivo ? motivo : "Sem custo até confirmar."}</span>
        </div>
      )}
      {e.fase === "ocupado" && (
        <p className={juntar(texto.auxiliar, "flex items-center")}>
          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          {e.texto}
        </p>
      )}
      {e.fase === "custo" && (
        <div className="flex min-w-0 flex-wrap items-center rounded-md bg-muted/50 px-2.5 py-2" title={e.custo.detalhe}>
          <span className="mb-1 mr-auto text-[13px]">
            {e.mudou ? "O custo mudou: " : "Custo: "}
            <strong className="tabular-nums">{usd(e.custo.usd)}</strong>
          </span>
          <button type="button" className={juntar(botao.primario, "mb-1 mr-1 h-8")} onClick={() => void gerar(e.custo, e.uid)}>
            Gerar por {usd(e.custo.usd)}
          </button>
          <button type="button" className={juntar(botao.discreto, "mb-1 h-8")} onClick={() => setEstado({ fase: "ocioso" })}>
            Cancelar
          </button>
        </div>
      )}
      {e.fase === "erro" && <p className="text-[12px] text-destructive">{e.mensagem}</p>}
    </div>
  );
}

export default function PainelTrocaDeCenario({
  projeto,
  urls,
  selecao,
  versaoId,
  irParaTempo,
}: {
  projeto: ProjetoDeEdicao;
  urls: Record<string, string>;
  selecao: string[];
  versaoId: string;
  irParaTempo: (s: number) => void;
}) {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const trocasQ = useTrocasDeCenario(clientId, versaoId);
  const arquivosQ = useArquivosDeVideo(clientId);
  const [cenario, setCenario] = useEstadoDaTela<string>(`mesa-edicao:cenario:texto:${clientId}`, "", { validar: (v) => typeof v === "string" });
  const [galeria, setGaleria] = useState<string | null>(null);
  const [qualidade, setQualidade] = useEstadoDaTela<QualidadeDaTroca>(`mesa-edicao:cenario:qualidade:${clientId}`, "rapido", { validar: (v) => QUALIDADES_DA_TROCA.indexOf(v as QualidadeDaTroca) >= 0 });
  const [layout, setLayout] = useEstadoDaTela<LayoutDaTroca>(`mesa-edicao:cenario:layout:${clientId}`, "cheio", { validar: (v) => LAYOUTS_DA_TROCA.indexOf(v as LayoutDaTroca) >= 0 });
  const [autorizou, setAutorizou] = useState(false);
  const [atualId, setAtualId] = useState<string | null>(null);
  const [escolha, setEscolha] = useState<number>(1);
  const [subindo, setSubindo] = useState(false);
  const arquivoRef = useRef<HTMLInputElement | null>(null);

  // ---------------------------------------------------------------- origem do vídeo
  const clipes = useMemo(() => clipesDeVideo(projeto), [projeto]);
  const maxS = INFO_DAS_QUALIDADES[qualidade].max_s;
  const doAcervo = useMemo(
    () =>
      ((arquivosQ.data && arquivosQ.data.arquivos) || [])
        .filter((a) => a.estado !== "arquivado" && (a.storage_bucket || "mesa") === "mesa" && midiaDaFonte(a.tipo, a.nome, a.storage_path) === "video" && !a.so_no_storage)
        .slice(0, 60),
    [arquivosQ.data],
  );
  const [origemChave, setOrigemChave] = useState<string>("");
  const padrao = (selecao[0] && clipes.find((c) => c.clipe_ref === selecao[0])) || clipes[0] || null;
  const escolhida: OrigemDoVideo | null = useMemo(() => {
    const c = clipes.find((x) => x.chave === origemChave);
    if (c) return c;
    const a = doAcervo.find((x) => `arquivo:${x.id}` === origemChave);
    if (a) return origemDoAcervo(a, maxS);
    return padrao;
  }, [origemChave, clipes, doAcervo, maxS, padrao]);
  const [trecho, setTrecho] = useState<{ entrada_s: number; saida_s: number }>({ entrada_s: 0, saida_s: 0 });
  useEffect(() => {
    if (escolhida) setTrecho(trechoNoLimite(escolhida.entrada_s, escolhida.saida_s, maxS, escolhida.duracao_s));
  }, [escolhida && escolhida.chave, maxS]); // eslint-disable-line react-hooks/exhaustive-deps
  const duracao = Math.round(Math.max(0, trecho.saida_s - trecho.entrada_s) * 100) / 100;
  const info = INFO_DAS_QUALIDADES[qualidade];
  const foraDoLimite = duracao < info.min_s ? `${info.rotulo}: mínimo de ${info.min_s} s.` : duracao > info.max_s + 0.05 ? `${info.rotulo}: até ${info.max_s} s por vez.` : null;

  const subir = async (f: File | null) => {
    if (!f) return;
    setSubindo(true);
    try {
      const r = await subirVideos(clientId, [f], () => undefined);
      await queryClient.invalidateQueries({ queryKey: chaveDosArquivos(clientId) });
      if (r.registrados[0]) setOrigemChave(`arquivo:${r.registrados[0].id}`);
      else toast.error(r.recusados[0] ? `${r.recusados[0].nome}: ${r.recusados[0].motivo}` : r.aviso || "O vídeo não subiu.");
    } finally {
      setSubindo(false);
    }
  };

  // ---------------------------------------------------------------- trocas
  const dados = trocasQ.data;
  const trocas = (dados && dados.trocas) || [];
  const qualidades = (dados && dados.qualidades) || {};
  const atual = trocas.find((t) => t.id === atualId) || trocas[0] || null;
  useEffect(() => {
    if (atual && atual.escolha) setEscolha(atual.escolha);
  }, [atual && atual.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const atualizar = (t: TrocaNaTela) => {
    queryClient.setQueryData<Resposta>(chaveDasTrocas(clientId, versaoId), (d) => ({ trocas: [t].concat(((d && d.trocas) || []).filter((x) => x.id !== t.id)), qualidades: (d && d.qualidades) || {} }));
    setAtualId(t.id);
  };
  const motivoDaQualidade = qualidades[qualidade] && !qualidades[qualidade].pronto ? qualidades[qualidade].motivo : null;
  const texto3 = cenario.trim();

  const corpoDaAmostra = async (): Promise<Record<string, unknown>> => {
    if (!escolhida) throw new Error("Escolha o vídeo.");
    let url = escolhida.fonte ? urls[escolhida.fonte] : null;
    if (!url) url = await assinarFonte(escolhida.fonte_bucket, escolhida.fonte_path);
    if (!url) throw new Error("Não deu para abrir o vídeo agora.");
    const q = await extrairQuadro(url, tempoDoQuadro(trecho.entrada_s, projeto.fps), { largura: 1024, qualidade: 0.9 });
    if (!q) throw new Error("Não deu para ler o quadro do vídeo neste navegador.");
    const blob = blobDoDataUrl(q.dataUrl);
    const quadro = await subirDoEditor(clientId, "quadros", blob, blob.type === "image/png" ? "png" : "jpg");
    return {
      acao: "cenario_amostra",
      client_id: clientId,
      versao_id: versaoId,
      arquivo_id: escolhida.arquivo_id,
      fonte_path: escolhida.fonte_path,
      clipe_ref: escolhida.clipe_ref,
      entrada_s: trecho.entrada_s,
      saida_s: trecho.saida_s,
      cenario: texto3,
      galeria,
      qualidade,
      layout,
      formato: projeto.formato,
      quadro_path: quadro,
      variacoes: 2,
      confirma_direito_de_imagem: autorizou,
    };
  };
  const corpoGuardado = useRef<Record<string, unknown> | null>(null);

  const semAmostra = !escolhida ? "Escolha o vídeo." : texto3.length < 3 ? "Descreva o cenário." : foraDoLimite ? foraDoLimite : !autorizou ? "Confirme a autorização de imagem." : motivoDaQualidade;

  // ---------------------------------------------------------------- tela
  return (
    <div className="space-y-4" data-painel="cenario">
      <div className="flex min-w-0 items-center">
        <p className="text-[14px] font-semibold">Trocar cenário</p>
        <AjudaRecolhida className="ml-1" titulo="Trocar o cenário com a pessoa fixa">
          Escolha o vídeo e escreva o cenário que quiser (a galeria é só atalho). A amostra mostra o quadro com o cenário novo por centavos; a final só gasta depois de você ver e confirmar o custo. O resultado entra logo depois do clipe, como clipe novo (Ctrl+Z desfaz). A final passa pela máquina de render da agência.
        </AjudaRecolhida>
      </div>

      <div className="space-y-2">
        <div className="flex min-w-0 items-end">
          <label className="block min-w-0 flex-1">
            <span className={texto.rotulo}>Vídeo</span>
            <select className={juntar(campo, "mt-1")} value={escolhida ? escolhida.chave : ""} onChange={(e) => setOrigemChave(e.target.value)} data-campo="origem">
              {!clipes.length && !doAcervo.length && <option value="">Nenhum vídeo</option>}
              {clipes.length > 0 && (
                <optgroup label="Na edição">
                  {clipes.map((c) => (
                    <option key={c.chave} value={c.chave}>
                      {c.rotulo}
                    </option>
                  ))}
                </optgroup>
              )}
              {doAcervo.length > 0 && (
                <optgroup label="No acervo">
                  {doAcervo.map((a) => (
                    <option key={a.id} value={`arquivo:${a.id}`}>
                      {a.nome}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>
          <button type="button" className={juntar(botao.icone, "ml-1 h-9 w-9")} onClick={() => arquivoRef.current && arquivoRef.current.click()} aria-label="Subir vídeo" title="Subir vídeo" disabled={subindo}>
            {subindo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          </button>
          <input ref={arquivoRef} type="file" accept="video/*" className="hidden" onChange={(e) => void subir(e.target.files && e.target.files[0] ? e.target.files[0] : null)} />
        </div>
        <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
          <label className="block min-w-0">
            <span className={texto.rotulo}>De (s)</span>
            <input className={juntar(campo, "mt-1 h-8")} type="number" min={0} step={0.1} value={trecho.entrada_s} onChange={(e) => setTrecho((t) => ({ ...t, entrada_s: Math.max(0, Number(e.target.value) || 0) }))} />
          </label>
          <label className="block min-w-0">
            <span className={texto.rotulo}>Até (s)</span>
            <input className={juntar(campo, "mt-1 h-8")} type="number" min={0} step={0.1} value={trecho.saida_s} onChange={(e) => setTrecho((t) => ({ ...t, saida_s: Math.max(0, Number(e.target.value) || 0) }))} />
          </label>
          <span className={juntar(texto.auxiliar, "pb-2 tabular-nums", foraDoLimite && "text-destructive")}>{duracao} s</span>
        </div>
      </div>

      <div className="space-y-2">
        <label className="block">
          <span className={texto.rotulo}>Cenário</span>
          <textarea
            className={juntar(campoTexto, "mt-1 min-h-[64px]")}
            rows={2}
            maxLength={600}
            value={cenario}
            placeholder="Ex.: loja reformada com luz quente de vitrine"
            onChange={(e) => {
              setCenario(e.target.value);
              setGaleria(null);
            }}
            data-campo="cenario"
          />
        </label>
        <div className="grid grid-cols-4 gap-1.5" role="list" aria-label="Cenários prontos">
          {GALERIA_DE_CENARIOS.map((c) => (
            <button
              key={c.id}
              type="button"
              role="listitem"
              className={juntar("min-w-0 overflow-hidden rounded-md border text-left transition-colors", galeria === c.id ? "border-primary" : "border-border hover:border-foreground/30")}
              onClick={() => {
                setCenario(c.texto);
                setGaleria(c.id);
              }}
              title={c.texto}
              data-cenario-pronto={c.id}
            >
              <span className="block h-7 w-full" style={{ backgroundImage: `linear-gradient(135deg, ${c.cores[0]}, ${c.cores[1]})` }} aria-hidden="true" />
              <span className="block truncate px-1.5 py-1 text-[11px] leading-4">{c.rotulo}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex min-w-0 items-center">
          <span className={texto.rotulo}>Qualidade</span>
          <AjudaRecolhida className="ml-1" titulo={info.rotulo}>
            {info.nota} Até {info.max_s} s por vez.
          </AjudaRecolhida>
        </div>
        <SeletorCompacto
          rotulo="Qualidade"
          valor={qualidade}
          onEscolher={(v) => setQualidade(v as QualidadeDaTroca)}
          opcoes={QUALIDADES_DA_TROCA.map((q) => ({ valor: q, rotulo: INFO_DAS_QUALIDADES[q].rotulo, desativada: !!(qualidades[q] && !qualidades[q].pronto) }))}
          larguraTotal
        />
        <div className="flex min-w-0 items-center">
          <span className={texto.rotulo}>Saída</span>
          <AjudaRecolhida className="ml-1" titulo={ROTULO_DO_LAYOUT[layout]}>
            {NOTA_DO_LAYOUT[layout]}
          </AjudaRecolhida>
        </div>
        <SeletorCompacto rotulo="Saída" valor={layout} onEscolher={(v) => setLayout(v as LayoutDaTroca)} opcoes={LAYOUTS_DA_TROCA.map((l) => ({ valor: l, rotulo: ROTULO_DO_LAYOUT[l] }))} larguraTotal />
      </div>

      <label className="flex min-w-0 items-start text-[12px] leading-4">
        <input type="checkbox" className="mr-2 mt-0.5" checked={autorizou} onChange={(e) => setAutorizou(e.target.checked)} data-campo="autorizacao" />
        <span>A pessoa do vídeo autorizou o uso da imagem (termo de imagem).</span>
      </label>

      <CustoEConfirmar
        rotulo="Ver amostra"
        desativado={!!semAmostra}
        motivo={semAmostra}
        preparar={async () => {
          const corpo = await corpoDaAmostra();
          corpoGuardado.current = corpo;
          const r = await pedirComCusto(chamarMesaVideos, corpo);
          return r.tipo === "custo" ? r.custo : r.tipo === "erro" ? r.mensagem : "Já existe esta amostra.";
        }}
        confirmar={async (custo, uid) => {
          const r = await pedirComCusto(chamarMesaVideos, corpoGuardado.current || {}, { usd: custo.usd, uid });
          if (r.tipo === "custo") return r.custo;
          if (r.tipo === "erro") return r.mensagem;
          atualizar(r.troca);
          setEscolha(1);
          return null;
        }}
      />

      {atual && <TrocaAtual troca={atual} escolha={escolha} setEscolha={setEscolha} qualidade={qualidade} layout={layout} atualizar={atualizar} irParaTempo={irParaTempo} projeto={projeto} />}

      {trocas.length > 1 && (
        <div className="space-y-1">
          <p className={texto.rotulo}>Anteriores</p>
          <ul className="-mx-2 min-w-0">
            {trocas.slice(0, 8).map((t) => (
              <li key={t.id}>
                <button type="button" className={juntar("flex w-full min-w-0 items-center rounded-md px-2 py-1 text-left hover:bg-muted", atual && atual.id === t.id && "bg-muted")} onClick={() => setAtualId(t.id)}>
                  <span className="min-w-0 flex-1 truncate text-[12px]">{t.cenario}</span>
                  <span className={juntar(etiqueta, "ml-2", t.estado === "pronto" ? "bg-primary/10 text-primary" : t.estado === "erro" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground")}>{t.estado_texto}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function TrocaAtual({
  troca,
  escolha,
  setEscolha,
  qualidade,
  layout,
  atualizar,
  irParaTempo,
  projeto,
}: {
  troca: TrocaNaTela;
  escolha: number;
  setEscolha: (n: number) => void;
  qualidade: QualidadeDaTroca;
  layout: LayoutDaTroca;
  atualizar: (t: TrocaNaTela) => void;
  irParaTempo: (s: number) => void;
  projeto: ProjetoDeEdicao;
}) {
  const t = troca;
  const corpoDaFinal = (): Record<string, unknown> => ({ acao: "cenario_gerar", cenario_id: t.id, escolha, qualidade, layout });
  const andando = emCurso(t);
  const idDoResultado = t.resultado ? t.resultado.id : "";
  const clipeNaLinha = idDoResultado ? projeto.trilhas.reduce<{ inicio_s: number } | null>((achado, tr) => achado || tr.clipes.find((c) => !!c.fonte && !!projeto.fontes[c.fonte] && projeto.fontes[c.fonte].arquivo_id === idDoResultado) || null, null) : null;
  const naLinha = !!clipeNaLinha;
  return (
    <div className="space-y-2 border-t border-border pt-3" data-troca={t.id} data-estado-da-troca={t.estado}>
      <div className="flex min-w-0 items-center">
        <p className="min-w-0 flex-1 truncate text-[13px] font-medium" title={t.cenario}>
          {t.cenario}
        </p>
        {t.custo_usd > 0 && <span className={juntar(texto.auxiliar, "ml-2 tabular-nums")}>{usd(t.custo_usd)} gastos</span>}
      </div>
      {t.amostras.length > 0 && (
        <div className={juntar("grid gap-2", t.amostras.length > 1 ? "grid-cols-2" : "grid-cols-1")} role="radiogroup" aria-label="Amostras">
          {t.amostras.map((a) => (
            <button
              key={a.n}
              type="button"
              role="radio"
              aria-checked={escolha === a.n}
              disabled={t.estado !== "amostra" && t.estado !== "erro"}
              className={juntar("relative min-w-0 overflow-hidden rounded-md border-2 bg-black", escolha === a.n ? "border-primary" : "border-transparent")}
              onClick={() => setEscolha(a.n)}
              data-amostra={a.n}
            >
              <span className="block w-full" style={{ paddingBottom: projeto.formato === "16:9" ? "56.25%" : projeto.formato === "1:1" ? "100%" : projeto.formato === "4:5" ? "125%" : "177.78%" }} />
              {a.url ? <img src={a.url} alt={`Amostra ${a.n}`} className="absolute left-0 top-0 h-full w-full object-cover" /> : null}
              {escolha === a.n && (
                <span className="absolute right-1 top-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <Check className="h-3 w-3" />
                </span>
              )}
            </button>
          ))}
        </div>
      )}
      {andando && (
        <div className="space-y-1">
          <p className={juntar(texto.auxiliar, "flex items-center")} data-andando="">
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            {t.estado_texto}
          </p>
          {(t.estado === "preparando" || t.estado === "compondo") && <EstadoDaMaquina compacto />}
        </div>
      )}
      {t.estado === "erro" && t.erro && <p className="text-[12px] text-destructive">{t.erro}</p>}
      {(t.estado === "amostra" || (t.estado === "erro" && t.amostras.length > 0)) && (
        <CustoEConfirmar
          rotulo={t.estado === "erro" ? "Tentar a final de novo" : "Gerar a final"}
          primario
          preparar={async () => {
            const r = await pedirComCusto(chamarMesaVideos, corpoDaFinal());
            return r.tipo === "custo" ? r.custo : r.tipo === "erro" ? r.mensagem : "A final já está andando.";
          }}
          confirmar={async (custo, uid) => {
            const r = await pedirComCusto(chamarMesaVideos, corpoDaFinal(), { usd: custo.usd, uid });
            if (r.tipo === "custo") return r.custo;
            if (r.tipo === "erro") return r.mensagem;
            atualizar(r.troca);
            return null;
          }}
        />
      )}
      {t.estado === "pronto" && (
        <p className="flex items-center text-[12px]" data-pronta="">
          <Check className="mr-1.5 h-3.5 w-3.5 text-primary" />
          {naLinha ? "Na linha do tempo." : "Pronto. Entra na linha do tempo em instantes (também está na Mídia)."}
          {naLinha && (
            <button type="button" className="ml-1.5 underline-offset-2 hover:underline" onClick={() => clipeNaLinha && irParaTempo(clipeNaLinha.inicio_s)}>
              Ver
            </button>
          )}
        </p>
      )}
    </div>
  );
}
