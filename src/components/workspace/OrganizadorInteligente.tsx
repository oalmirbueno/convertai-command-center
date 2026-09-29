import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Check, FileText, Film, FolderTree, Loader2, Pencil, RotateCcw, Square, Wand2, X as XIcon } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { botao, campo, etiqueta, juntar, rolagem, superficie, texto } from "@/components/sistema/estilos";
import { supabase } from "@/integrations/supabase/client";
import { textoDoErro, usd } from "@/lib/mesa/api";
import { urlsLevesEmLote } from "@/lib/miniaturas";
import {
  chamadasDeLeitura,
  chamarOrganizador,
  type EdicaoDaPrevia,
  gruposParaConfirmar,
  guardarLeituras,
  guardarUltimaOrganizacao,
  leiturasGuardadas,
  type Lido,
  type Preparacao,
  type Previa,
  quadroDoVideo,
  type RespostaDaConfirmacao,
  type RespostaDaLeitura,
  type RespostaDaProposta,
  type RespostaDoDesfazer,
  ultimaOrganizacao,
  type UltimaOrganizacao,
} from "@/lib/workspace/organizadorApi";

/**
 * Organizar inteligente do Workspace (frente OR, 29/09/2026).
 *
 * Pedido do dono: "quando eu clico em Organizar, tem que ser inteligente:
 * entender a foto, entender o que é antes e depois, nomear, deixar essa foto
 * combinando com essa... tem que ver realmente."
 *
 * Fluxo: preparar (quanto vai custar) -> ler (visão, em lotes, com Parar) ->
 * prévia (pastas, miniaturas, nomes novos, dúvidas; a pessoa tira itens e
 * muda o nome das pastas) -> Confirmar -> Desfazer. Nada é apagado.
 */

type Fase = "preparando" | "inicio" | "lendo" | "montando" | "previa" | "aplicando" | "feito";

type Props = {
  aberto: boolean;
  onFechar: () => void;
  clientId: string;
  /** Pasta real onde a organização começa (null = raiz do cliente). */
  parentId: string | null;
  nivelNome: string;
  /** Algo mudou no workspace (confirmou ou desfez): a tela recarrega. */
  onMudou: () => void;
};

const ROTULO_DA_SITUACAO: Record<string, string> = { publicado: "publicado", aprovado: "aprovado", em_aprovacao: "em aprovação" };

const dataCurta = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
};

export default function OrganizadorInteligente({ aberto, onFechar, clientId, parentId, nivelNome, onMudou }: Props) {
  const [fase, setFase] = useState<Fase>("preparando");
  const [tudo, setTudo] = useState(false);
  const [prep, setPrep] = useState<Preparacao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [progresso, setProgresso] = useState({ feitos: 0, total: 0 });
  const [custoLeitura, setCustoLeitura] = useState(0);
  const [avisoDaLeitura, setAvisoDaLeitura] = useState<string | null>(null);
  const [proposta, setProposta] = useState<RespostaDaProposta | null>(null);
  const [edicao, setEdicao] = useState<EdicaoDaPrevia>({ fora: new Set(), nomes: {} });
  const [soDuvidas, setSoDuvidas] = useState(false);
  const [capas, setCapas] = useState<Record<string, string>>({});
  const [resultado, setResultado] = useState<RespostaDaConfirmacao | null>(null);
  const [ultima, setUltima] = useState<UltimaOrganizacao | null>(null);
  const [desfazendo, setDesfazendo] = useState(false);
  const parar = useRef(false);
  const quadros = useRef<Map<string, string>>(new Map());
  const lidosRef = useRef<Map<string, Lido>>(new Map());
  const falhasRef = useRef<Record<string, string>>({});

  // Abrir (ou trocar "reorganizar tudo"): conta o que entra e estima o custo, sem IA.
  useEffect(() => {
    if (!aberto) return;
    let vivo = true;
    setFase("preparando");
    setErro(null);
    setProposta(null);
    setResultado(null);
    setUltima(ultimaOrganizacao(clientId));
    chamarOrganizador<Preparacao>("preparar", { client_id: clientId, parent_id: parentId, tudo })
      .then((p) => {
        if (!vivo) return;
        setPrep(p);
        setFase("inicio");
      })
      .catch((e) => {
        if (!vivo) return;
        setErro(textoDoErro(e));
        setFase("inicio");
      });
    return () => {
      vivo = false;
    };
  }, [aberto, clientId, parentId, tudo]);

  const guardadas = useMemo(() => (prep ? leiturasGuardadas(clientId, prep.candidatos) : new Map<string, Lido>()), [prep, clientId]);
  const paraLer = useMemo(() => (prep ? prep.candidatos.filter((c) => c.leitura !== "nome" && !guardadas.has(c.id)) : []), [prep, guardadas]);
  const estimativa = prep ? paraLer.length * prep.por_imagem_usd : 0;

  async function assinar(caminhos: string[]): Promise<Record<string, string>> {
    if (!caminhos.length) return {};
    const { data } = await supabase.storage.from("workspace").createSignedUrls(caminhos, 3600);
    const mapa: Record<string, string> = {};
    for (const r of (data || []) as Array<{ path: string | null; signedUrl: string }>) if (r.path && r.signedUrl) mapa[r.path] = r.signedUrl;
    return mapa;
  }

  async function lerEMontar() {
    if (!prep) return;
    parar.current = false;
    setErro(null);
    setAvisoDaLeitura(null);
    setCustoLeitura(0);
    lidosRef.current = new Map(guardadas);
    falhasRef.current = {};
    const fila = paraLer.slice();
    setProgresso({ feitos: 0, total: fila.length });
    setFase("lendo");
    // Rajadas de envio inteiras na mesma chamada: o leitor vê as lâminas do mesmo card juntas.
    const porId = new Map(fila.map((c) => [c.id, c]));
    const chamadas = chamadasDeLeitura(prep, fila.map((c) => c.id)).map((ids) => ids.map((id) => porId.get(id)!).filter(Boolean));
    let feitos = 0;
    let custo = 0;
    try {
      for (let i = 0; i < chamadas.length && !parar.current; i++) {
        const parte = chamadas[i];
        // Vídeo: o quadro sai daqui (o servidor não abre vídeo).
        const videos = parte.filter((c) => c.leitura === "video" && c.storage_path);
        const urls = await assinar(videos.map((v) => v.storage_path!)).catch(() => ({} as Record<string, string>));
        const itens: Array<{ id: string; quadro?: string }> = [];
        for (const c of parte) {
          if (c.leitura !== "video") {
            itens.push({ id: c.id });
            continue;
          }
          const url = c.storage_path ? urls[c.storage_path] : null;
          const q = url ? await quadroDoVideo(url) : null;
          if (q) quadros.current.set(c.id, q.url);
          itens.push(q ? { id: c.id, quadro: q.base64 } : { id: c.id });
        }
        const r = await chamarOrganizador<RespostaDaLeitura>("ler", { client_id: clientId, itens });
        for (const l of r.lidos) lidosRef.current.set(l.id, l);
        for (const f of r.falhas) falhasRef.current[f.id] = f.motivo;
        guardarLeituras(clientId, prep.candidatos, r.lidos);
        custo += Number(r.custo_usd) || 0;
        setCustoLeitura(custo);
        feitos += parte.length - (r.restantes?.length || 0);
        setProgresso({ feitos, total: fila.length });
        if (r.parou) {
          setAvisoDaLeitura(`${r.parou.mensagem} A prévia sai com o que já foi lido.`);
          break;
        }
      }
      if (parar.current) setAvisoDaLeitura("Leitura parada. A prévia sai com o que já foi lido; o resto fica onde está.");
    } catch (e) {
      setAvisoDaLeitura(`A leitura parou: ${textoDoErro(e)} A prévia sai com o que já foi lido.`);
    }
    await montar();
  }

  async function montar() {
    setFase("montando");
    try {
      const lidos: Record<string, unknown> = {};
      lidosRef.current.forEach((l, id) => {
        lidos[id] = { leitura: l.leitura, hash: l.hash, largura: l.largura, altura: l.altura };
      });
      const r = await chamarOrganizador<RespostaDaProposta>("propor", { client_id: clientId, parent_id: parentId, tudo, lidos, falhas: falhasRef.current });
      setProposta(r);
      setEdicao({ fora: new Set(), nomes: {} });
      setSoDuvidas(false);
      setFase("previa");
      // Miniaturas: cópia leve das imagens; vídeos com o quadro que a leitura tirou.
      const caminhos = new Set<string>();
      for (const g of r.previa.grupos) for (const it of g.itens) if (it.storage_path && !String(it.mime || "").startsWith("video/")) caminhos.add(it.storage_path);
      for (const f of r.previa.ficam) if (f.storage_path && !String(f.mime || "").startsWith("video/")) caminhos.add(f.storage_path);
      urlsLevesEmLote("workspace", Array.from(caminhos), 3600)
        .then((m) => setCapas(m))
        .catch(() => setCapas({}));
    } catch (e) {
      setErro(textoDoErro(e));
      setFase("inicio");
    }
  }

  const previa: Previa | null = proposta?.previa ?? null;
  const confirmaveis = useMemo(() => (previa ? gruposParaConfirmar(previa, edicao) : []), [previa, edicao]);
  const totalConfirmado = confirmaveis.reduce((s, g) => s + g.itens.length, 0);

  async function confirmar() {
    if (!confirmaveis.length) return;
    setFase("aplicando");
    try {
      const r = await chamarOrganizador<RespostaDaConfirmacao>("confirmar", { client_id: clientId, parent_id: parentId, grupos: confirmaveis });
      setResultado(r);
      const resumo = `${r.movidos + r.renomeados > 0 ? `${totalConfirmado} arquivos` : "nada"} em ${confirmaveis.length} pastas`;
      if (r.registro.itens.length) {
        const u = { registro: r.registro, resumo };
        guardarUltimaOrganizacao(clientId, u);
        setUltima(u);
      }
      setFase("feito");
      onMudou();
    } catch (e) {
      toast.error("Não foi possível organizar", { description: textoDoErro(e) });
      setFase("previa");
    }
  }

  async function desfazer(u: UltimaOrganizacao) {
    setDesfazendo(true);
    try {
      const r = await chamarOrganizador<RespostaDoDesfazer>("desfazer", { client_id: clientId, registro: u.registro });
      guardarUltimaOrganizacao(clientId, null);
      setUltima(null);
      onMudou();
      toast.success("Organização desfeita", {
        description: `${r.restaurados} ${r.restaurados === 1 ? "arquivo voltou" : "arquivos voltaram"} para onde estavam${r.pulados.length ? `; ${r.pulados.length} ${r.pulados.length === 1 ? "foi mexido" : "foram mexidos"} depois e ${r.pulados.length === 1 ? "ficou" : "ficaram"} como está` : ""}.`,
        duration: 9000,
      });
      onFechar();
    } catch (e) {
      toast.error("Não foi possível desfazer", { description: textoDoErro(e) });
    } finally {
      setDesfazendo(false);
    }
  }

  // Tudo já lido antes (ou só documentos): monta direto, sem custo de leitura.
  async function montarSemLer() {
    lidosRef.current = new Map(guardadas);
    falhasRef.current = {};
    setCustoLeitura(0);
    setAvisoDaLeitura(null);
    await montar();
  }

  const fechar = () => {
    if (fase === "lendo") parar.current = true;
    onFechar();
  };

  const grupos = previa ? previa.grupos.filter((g) => !soDuvidas || g.itens.some((i) => i.duvida)) : [];

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && fechar()}>
      <DialogContent className="flex max-h-[92vh] w-[calc(100vw-24px)] max-w-5xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 space-y-0 border-b border-border px-5 py-4 text-left">
          <div className="flex min-w-0 items-center">
            <DialogTitle className={juntar(texto.tituloSecao, "mr-1.5 truncate")}>Organizar {nivelNome}</DialogTitle>
            <AjudaRecolhida titulo="Como o organizador pensa">
              Cada imagem é lida de verdade (visão, em cópia leve): o tipo, o tema, o texto que aparece e a identidade visual. Lâminas do mesmo card viram
              uma pasta em Carrosséis, na ordem da numeração e do texto. Fotos de antes e depois do mesmo objeto ficam juntas. Duplicatas vão para Duplicadas
              e versões da mesma arte ficam juntas. Quando a visão fica em dúvida, o Jev decide o tipo, o "mesmo carrossel?", o par e a ordem. Nada muda antes
              de você confirmar, nada é apagado e o Desfazer volta tudo como estava. O que já está em pasta com nome seu fica onde está, a não ser que você
              marque "Reorganizar tudo".
            </AjudaRecolhida>
          </div>
          <DialogDescription className={juntar(texto.auxiliar, "mt-0.5 truncate")}>
            {fase === "previa" && previa ? previa.resumo : fase === "feito" ? "Organizado" : prep ? `${prep.candidatos.length} arquivos neste nível` : "Contando os arquivos..."}
          </DialogDescription>
        </DialogHeader>

        <div className={juntar("min-h-0 flex-1 px-5 py-4", rolagem.janela, "max-h-none")}>
          {erro && (
            <p role="alert" className="mb-3 flex items-start text-[13px] text-destructive">
              <AlertCircle className="mr-1.5 mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              {erro}
            </p>
          )}

          {(fase === "preparando" || (fase === "inicio" && !prep && !erro)) && (
            <p className={juntar(texto.auxiliar, "flex items-center")}>
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Contando o que entra...
            </p>
          )}

          {fase === "inicio" && prep && (
            <Inicio
              prep={prep}
              guardadas={guardadas.size}
              paraLer={paraLer.length}
              estimativa={estimativa}
              tudo={tudo}
              setTudo={setTudo}
              ultima={ultima}
              desfazendo={desfazendo}
              onDesfazer={desfazer}
            />
          )}

          {fase === "lendo" && (
            <div aria-live="polite">
              <p className={texto.corpo}>
                Lendo as imagens: {progresso.feitos} de {progresso.total}
              </p>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={progresso.total} aria-valuenow={progresso.feitos}>
                <div className="h-full bg-primary transition-all" style={{ width: `${progresso.total ? Math.round((progresso.feitos / progresso.total) * 100) : 0}%` }} />
              </div>
              <p className={juntar(texto.auxiliar, "mt-2 tabular-nums")}>Custo até agora: {usd(custoLeitura)}</p>
            </div>
          )}

          {fase === "montando" && (
            <p className={juntar(texto.auxiliar, "flex items-center")} aria-live="polite">
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Montando a prévia: carrosséis, pares e nomes...
            </p>
          )}

          {(fase === "previa" || fase === "aplicando") && previa && proposta && (
            <div className="min-w-0">
              {(avisoDaLeitura || proposta.aviso) && (
                <p className="mb-3 flex items-start text-[13px] text-warning">
                  <AlertCircle className="mr-1.5 mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  {[avisoDaLeitura, proposta.aviso].filter(Boolean).join(" ")}
                </p>
              )}
              <div className="mb-3 flex min-w-0 flex-wrap items-center">
                <span className={juntar(texto.auxiliar, "mr-3 tabular-nums")}>Custo real: {usd(custoLeitura + (proposta.custo_jev_usd || 0))}</span>
                {previa.duvidas > 0 && (
                  <button type="button" className={juntar(botao.barra, soDuvidas && "bg-muted text-foreground")} aria-pressed={soDuvidas} onClick={() => setSoDuvidas((v) => !v)}>
                    Só dúvidas ({previa.duvidas})
                  </button>
                )}
                {previa.ja_organizados > 0 && <span className={juntar(texto.auxiliar, "ml-2")}>{previa.ja_organizados} já estavam no lugar</span>}
              </div>
              {previa.grupos.length === 0 && <p className={texto.corpo}>Nada para mover: está tudo no lugar ou nada foi lido.</p>}
              <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {grupos.map((g) => (
                  <CartaoDoGrupo
                    key={g.chave}
                    grupo={g}
                    capas={capas}
                    quadros={quadros.current}
                    fora={edicao.fora}
                    soDuvidas={soDuvidas}
                    nome={edicao.nomes[g.chave]}
                    onNome={(n) => setEdicao((e) => ({ ...e, nomes: { ...e.nomes, [g.chave]: n } }))}
                    onAlternar={(id) =>
                      setEdicao((e) => {
                        const fora = new Set(e.fora);
                        if (fora.has(id)) fora.delete(id);
                        else fora.add(id);
                        return { ...e, fora };
                      })}
                  />
                ))}
              </div>
              {previa.ficam.length > 0 && (
                <details className="mt-5">
                  <summary className={juntar(texto.rotulo, "cursor-pointer select-none")}>Ficam onde estão ({previa.ficam.length})</summary>
                  <ul className="mt-2 min-w-0 space-y-1">
                    {previa.ficam.map((f) => (
                      <li key={f.id} className="flex min-w-0 items-center text-[13px]">
                        <Miniatura url={f.storage_path ? capas[f.storage_path] : quadros.current.get(f.id)} video={String(f.mime || "").startsWith("video/")} tamanho="h-7 w-7" />
                        <span className="ml-2 min-w-0 truncate">{f.nome}</span>
                        <span className="ml-2 shrink-0 text-muted-foreground">{f.motivo}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}

          {fase === "feito" && resultado && (
            <div className="min-w-0">
              <p className={juntar(texto.corpo, "flex items-center")}>
                <Check className="mr-1.5 h-4 w-4 text-primary" aria-hidden="true" />
                {resultado.movidos} {resultado.movidos === 1 ? "arquivo movido" : "arquivos movidos"}, {resultado.renomeados} {resultado.renomeados === 1 ? "renomeado" : "renomeados"}, {resultado.pastas_criadas}{" "}
                {resultado.pastas_criadas === 1 ? "pasta nova" : "pastas novas"}.
              </p>
              {resultado.falhas.length > 0 && (
                <ul className="mt-3 space-y-1">
                  {resultado.falhas.map((f) => (
                    <li key={f.id} className="text-[13px] text-muted-foreground">
                      <span className="text-foreground">{f.nome}</span>: {f.motivo}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-end border-t border-border px-5 py-3">
          {fase === "inicio" && (
            <>
              <button type="button" className={botao.discreto} onClick={fechar}>
                Cancelar
              </button>
              <button type="button" className={juntar(botao.primario, "ml-2")} disabled={!prep || !prep.candidatos.length} onClick={() => void (paraLer.length ? lerEMontar() : montarSemLer())}>
                <Wand2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
                {paraLer.length ? `Ler e montar a prévia (${usd(estimativa)})` : "Montar a prévia"}
              </button>
            </>
          )}
          {fase === "lendo" && (
            <button type="button" className={botao.secundario} onClick={() => (parar.current = true)}>
              <Square className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Parar
            </button>
          )}
          {(fase === "previa" || fase === "aplicando") && (
            <>
              <button type="button" className={botao.discreto} onClick={fechar} disabled={fase === "aplicando"}>
                Cancelar
              </button>
              <button type="button" className={juntar(botao.primario, "ml-2")} disabled={!totalConfirmado || fase === "aplicando"} onClick={() => void confirmar()}>
                {fase === "aplicando" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <FolderTree className="mr-1.5 h-4 w-4" aria-hidden="true" />}
                Confirmar {totalConfirmado} {totalConfirmado === 1 ? "arquivo" : "arquivos"}
              </button>
            </>
          )}
          {fase === "feito" && (
            <>
              {ultima && (
                <button type="button" className={botao.secundario} disabled={desfazendo} onClick={() => void desfazer(ultima)}>
                  {desfazendo ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <RotateCcw className="mr-1.5 h-4 w-4" aria-hidden="true" />}
                  Desfazer
                </button>
              )}
              <button type="button" className={juntar(botao.primario, "ml-2")} onClick={fechar}>
                Fechar
              </button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );

}

function Inicio({
  prep,
  guardadas,
  paraLer,
  estimativa,
  tudo,
  setTudo,
  ultima,
  desfazendo,
  onDesfazer,
}: {
  prep: Preparacao;
  guardadas: number;
  paraLer: number;
  estimativa: number;
  tudo: boolean;
  setTudo: (v: boolean) => void;
  ultima: UltimaOrganizacao | null;
  desfazendo: boolean;
  onDesfazer: (u: UltimaOrganizacao) => void;
}) {
  return (
    <div className="min-w-0 space-y-4">
      <div className="flex min-w-0 flex-wrap items-baseline">
        <span className={juntar(texto.numero, "mr-2")}>{prep.candidatos.length}</span>
        <span className={texto.corpo}>
          {prep.candidatos.length === 1 ? "arquivo entra" : "arquivos entram"}: {prep.imagens} {prep.imagens === 1 ? "imagem" : "imagens"}, {prep.videos} {prep.videos === 1 ? "vídeo" : "vídeos"}, {prep.outros}{" "}
          {prep.outros === 1 ? "outro" : "outros"}
        </span>
      </div>
      {prep.candidatos.length === 0 && <p className={texto.auxiliar}>Nada solto neste nível. Marque "Reorganizar tudo" para incluir as pastas.</p>}
      <p className={juntar(texto.auxiliar, "tabular-nums")}>
        Leitura estimada: {usd(estimativa)} ({paraLer} para ler{guardadas ? `, ${guardadas} já lidas antes, sem custo` : ""}) com {prep.modelo}
      </p>
      <label className="flex cursor-pointer items-center text-[13px]">
        <input type="checkbox" className="mr-2 h-4 w-4 accent-[hsl(var(--primary))]" checked={tudo} onChange={(e) => setTudo(e.target.checked)} />
        Reorganizar tudo (inclui as pastas que já têm nome)
      </label>
      {ultima && (
        <p className={juntar(texto.auxiliar, "flex min-w-0 flex-wrap items-center")}>
          <span className="mr-2">Última organização: {dataCurta(ultima.registro.feito_em)}, {ultima.resumo}.</span>
          <button type="button" className={botao.barra} disabled={desfazendo} onClick={() => onDesfazer(ultima)}>
            {desfazendo ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <RotateCcw className="mr-1 h-3.5 w-3.5" aria-hidden="true" />}
            Desfazer
          </button>
        </p>
      )}
    </div>
  );
}

function Miniatura({ url, video, tamanho = "h-9 w-9" }: { url?: string | null; video?: boolean; tamanho?: string }) {
  const [falhou, setFalhou] = useState(false);
  if (url && !falhou) return <img src={url} alt="" loading="lazy" onError={() => setFalhou(true)} className={juntar(tamanho, "shrink-0 rounded object-cover bg-muted")} />;
  const Icone = video ? Film : FileText;
  return (
    <span className={juntar(tamanho, "inline-flex shrink-0 items-center justify-center rounded bg-muted text-muted-foreground")}>
      <Icone className="h-3.5 w-3.5" aria-hidden="true" />
    </span>
  );
}

const MAX_LINHAS = 6;

function CartaoDoGrupo({
  grupo,
  capas,
  quadros,
  fora,
  soDuvidas,
  nome,
  onNome,
  onAlternar,
}: {
  grupo: Previa["grupos"][number];
  capas: Record<string, string>;
  quadros: Map<string, string>;
  fora: Set<string>;
  soDuvidas: boolean;
  nome: string | undefined;
  onNome: (n: string) => void;
  onAlternar: (id: string) => void;
}) {
  const [editando, setEditando] = useState(false);
  const [todos, setTodos] = useState(false);
  const ultimo = grupo.caminho[grupo.caminho.length - 1];
  const [rascunho, setRascunho] = useState(nome || ultimo);
  const acima = grupo.caminho.slice(0, -1).join(" / ");
  const itens = soDuvidas ? grupo.itens.filter((i) => i.duvida) : grupo.itens;
  const visiveis = todos ? itens : itens.slice(0, MAX_LINHAS);
  const dentro = grupo.itens.filter((i) => !fora.has(i.id));
  const capaDe = (i: (typeof grupo.itens)[number]) => (i.storage_path && capas[i.storage_path]) || quadros.get(i.id) || null;

  return (
    <article className={juntar(superficie.painel, "min-w-0 overflow-hidden")} data-grupo={grupo.chave}>
      <div className="grid grid-cols-4 gap-px bg-border">
        {grupo.itens.slice(0, 4).map((i) => (
          <div key={i.id} className={juntar("relative aspect-square bg-muted", fora.has(i.id) && "opacity-30")}>
            {capaDe(i) ? (
              <img src={capaDe(i)!} alt="" loading="lazy" className="h-full w-full object-cover" />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-muted-foreground">
                {String(i.mime || "").startsWith("video/") ? <Film className="h-4 w-4" aria-hidden="true" /> : <FileText className="h-4 w-4" aria-hidden="true" />}
              </span>
            )}
            {i.ordem !== null && grupo.categoria === "carrosseis" && (
              <span className={juntar(etiqueta, "absolute left-1 top-1 bg-background/85 text-foreground")}>{i.ordem}</span>
            )}
          </div>
        ))}
        {Array.from({ length: Math.max(0, 4 - grupo.itens.length) }).map((_, k) => <div key={`v${k}`} className="aspect-square bg-muted/40" />)}
      </div>
      <div className="min-w-0 p-3">
        {acima && <p className={juntar(texto.auxiliar, "truncate")}>{acima} /</p>}
        {editando ? (
          <form
            className="mt-0.5 flex min-w-0 items-center"
            onSubmit={(e) => {
              e.preventDefault();
              onNome(rascunho.trim());
              setEditando(false);
            }}
          >
            <input className={juntar(campo, "h-8")} value={rascunho} maxLength={80} autoFocus aria-label="Nome da pasta" onChange={(e) => setRascunho(e.target.value)} />
            <button type="submit" className={juntar(botao.icone, "ml-1 text-primary")} aria-label="Salvar nome da pasta">
              <Check className="h-3.5 w-3.5" />
            </button>
          </form>
        ) : (
          <div className="mt-0.5 flex min-w-0 items-center">
            <h3 className={juntar(texto.tituloSecao, "min-w-0 truncate")}>{nome || ultimo}</h3>
            <button type="button" className={juntar(botao.icone, "ml-0.5 h-7 w-7")} aria-label={`Mudar o nome da pasta ${nome || ultimo}`} onClick={() => setEditando(true)}>
              <Pencil className="h-3 w-3" />
            </button>
            <span className={juntar(etiqueta, "ml-auto bg-muted text-muted-foreground")}>{dentro.length}</span>
          </div>
        )}
        <p className={juntar(texto.auxiliar, "mt-0.5 line-clamp-2")}>{grupo.ideia}</p>
        <ul className="-mx-1 mt-2 min-w-0">
          {visiveis.map((i) => {
            const tirado = fora.has(i.id);
            return (
              <li key={i.id} className={juntar("flex min-w-0 items-center rounded-md px-1 py-1", tirado && "opacity-45")} title={i.motivo}>
                <Miniatura url={capaDe(i)} video={String(i.mime || "").startsWith("video/")} tamanho="h-8 w-8" />
                <div className="ml-2 min-w-0 flex-1">
                  <p className={juntar("truncate text-[13px] font-medium", tirado && "line-through")}>{i.nome_novo}</p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {i.nome_novo !== i.nome_atual ? `era ${i.nome_atual}` : i.motivo}
                  </p>
                  {(i.duvida || i.situacao) && (
                    <p className="mt-0.5 flex min-w-0 flex-wrap items-center">
                      {i.duvida && <span className={juntar(etiqueta, "mr-1 max-w-full truncate bg-warning/15 text-warning")} title={i.duvida}>dúvida: {i.duvida}</span>}
                      {i.situacao && <span className={juntar(etiqueta, "bg-primary/10 text-primary")}>{ROTULO_DA_SITUACAO[i.situacao] || i.situacao}</span>}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  className={juntar(botao.icone, "ml-1 h-7 w-7")}
                  aria-label={tirado ? `Pôr ${i.nome_atual} de volta na organização` : `Tirar ${i.nome_atual} desta pasta (fica onde está)`}
                  onClick={() => onAlternar(i.id)}
                >
                  {tirado ? <RotateCcw className="h-3 w-3" /> : <XIcon className="h-3 w-3" />}
                </button>
              </li>
            );
          })}
        </ul>
        {itens.length > MAX_LINHAS && (
          <button type="button" className={juntar(botao.barra, "mt-1")} onClick={() => setTodos((v) => !v)}>
            {todos ? "Mostrar menos" : `Ver todos (${itens.length})`}
          </button>
        )}
      </div>
    </article>
  );
}

