import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { AlertTriangle, Archive, ArrowRightLeft, BookOpen, Check, Copy, CopyPlus, Download, Images, Lightbulb, Loader2, Maximize2, MoreHorizontal, Plus, RefreshCw, RotateCcw, ScanSearch, ShieldCheck, Shirt, Smile, Sparkles, Star, Trash2, UserRound, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Ampliar } from "@/components/mesa/Ampliar";
import { BotaoComCusto, useAvisarErro } from "@/components/mesa/Custo";
import { ImagemDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { SeletorDeQualidade } from "@/components/mesa/Seletores";
import { useClients } from "@/hooks/useSupabaseData";
import { padraoPara, textoDoErro, usd, type ParteDaEstimativa, type Qualidade } from "@/lib/mesa/api";
import { AprovarFoto, useAcoesDeUso } from "./AcoesDeUso";
import AcoesProDaFoto from "./AcoesProDaFoto";
import { MiniaturaDaFoto, Moldura, Pilulas, useMesaFoto } from "./Comuns";
import { AjudaRecolhida, BarraDeAcoes, CampoDeEscolha, CampoDeFormulario, Carregando, EstadoDeErro, EstadoVazio, GrupoDeCampos, Secao, SeletorCompacto, botao, foco, juntar, superficie, texto, useEstadoDaTela } from "@/components/sistema";
import { ZonaDeEnvio } from "./EtapaAcervo";
import SeletorDeFotos from "./SeletorDeFotos";
import SeletorLateral, { type ItemDoSeletor } from "./SeletorLateral";
import { AtalhosDaFoto, MenuDeUso } from "./UsoDaFoto";
import { useSelecaoParaODiretor } from "./diretorApi";
import { acrescentarFotos, baixarDoStorage, baixarUmaAUma, classeDaFoto, invalidarFotos, subirOriginais, useFotos, type FotoDoAcervo } from "./fotoApi";
import { caminhoDaImagem, chaveDoAndamento, emParalelo, marcarAndamento, proporcaoDaImagem, useAndamentos, usePrecoNoServidor, type ImagemDaPersona } from "./modelosApi";
import {
  arquivarImagemDoClone,
  chaveDosArquivados,
  cloneAbertoProvisorio,
  cloneComAFoto,
  conferirClone,
  criarClone,
  decidirVistaDoClone,
  duplicarClone,
  editarClone,
  editarFotosDoClone,
  fotosDeOrigemDoClone,
  marcarFotosNovas,
  moverVariacaoNoCache,
  moverVistaNoCache,
  mudancaNasFotos,
  nomeDaCopiaDoClone,
  problemaDaFotoDeOrigem,
  refazerVariacaoDoClone,
  useClonesArquivados,
  type FotosDeOrigem,
  type VistaDoClone,
  FORMAS_DE_AUTORIZACAO,
  FORMATOS_DO_CLONE,
  gerarVariacaoDoClone,
  gerarVistaDoClone,
  guardarCloneNaLista,
  guardarVariacaoDoClone,
  guardarVistaDoClone,
  guardarFotosDeExpressaoDoClone,
  IDADE_MINIMA_CLONE,
  MAX_FOTOS_DA_EXPRESSAO,
  type ExpressaoDaVariacao,
  invalidarClone,
  MAX_FOTOS_DO_CLONE,
  mudarCloneAberto,
  pacoteDoClone,
  partesDaConferenciaDoClone,
  partesDaSugestaoDoClone,
  partesDoClone,
  pedidoDaSugestao,
  PRESET_UNIFORME,
  problemasDoClone,
  rascunhoDoClone,
  statusDoClone,
  sugerirVariacoesDoClone,
  tirarCloneDaLista,
  transferirClone,
  useCloneAberto,
  useClones,
  VISTAS_DO_CLONE,
  type Clone,
  type CloneAberto,
  type ConferenciaDoClone,
  type PedidoDaVariacao,
  type RascunhoDoClone,
  type SugestaoDoClone,
} from "./clonesApi";

/**
 * Clones (pedido do dono, 25/09; docs/mesa-foto/CLONES.md): de 1 a 4 fotos
 * REAIS da mesma pessoa do cliente, com a autorização de uso de imagem
 * registrada, nasce a folha de identidade (frente, 3/4, perfil, meio corpo,
 * corpo inteiro, uma imagem por vista) e depois as variações (roupa, cenário,
 * pose, expressão) com o mesmo rosto. As variações entram no acervo marcadas
 * como geradas e seguem o caminho de aprovar e usar. A conferência de
 * semelhança (visão descreve os traços; Jev compara) é só aviso.
 *
 * Pensado para a futura mesa de vídeo: a folha aprovada vira o pacote de
 * referência do rosto (clone_pacote).
 *
 * Layout: no computador, clones à esquerda e o clone aberto à direita, com a
 * folha e as variações lado a lado; no celular, tudo em uma coluna.
 *
 * 26/09 (pedido do dono): sem piscar ao criar ou gerar (provisório no lugar
 * do esqueleto e imagem no cache assim que a função devolve), aprovar na hora
 * (otimista), baixar o original sem ZIP, variações com todas as vistas
 * aprovadas da folha, "Pelo contexto do cliente", "Uniforme da marca" com a
 * logo oficial, plano das variações em 3 passos e "Transferir para outro
 * cliente". Seletor lateral compacto, como o das personas.
 */

const ehTextoOuNulo = (v: unknown) => v === null || typeof v === "string";
const ehBooleano = (v: unknown) => typeof v === "boolean";

/** Erro de leitura na região, com "Tentar de novo". */
function ErroNaRegiao({ titulo, erro, onTentar, className = "" }: { titulo: string; erro: unknown; onTentar: () => void; className?: string }) {
  return (
    <EstadoDeErro
      className={className}
      titulo={titulo}
      descricao={textoDoErro(erro)}
      acao={
        <button type="button" className={botao.secundario} onClick={onTentar}>
          Tentar de novo
        </button>
      }
    />
  );
}

function SeloGerada({ texto = "gerada" }: { texto?: string }) {
  return (
    <span className="pointer-events-none absolute left-1 top-1 inline-flex items-center rounded-full border border-primary/30 bg-card px-1.5 py-px text-[9.5px] font-semibold text-primary" data-selo="gerada">
      <Sparkles className="mr-0.5 h-2.5 w-2.5" /> {texto}
    </span>
  );
}


function NotasDaSemelhanca({ c }: { c: ConferenciaDoClone }) {
  return (
    <div className={juntar(superficie.poco, "mt-1.5 min-w-0 p-1.5 text-[11px] leading-snug")} data-conferencia-do-clone="">
      <p className="mb-0.5 font-medium text-muted-foreground">
        Semelhança (aviso, você decide){c.semelhanca != null ? `: ${Math.round(c.semelhanca * 100)}%` : ""}
      </p>
      {c.alertas.map((a) => (
        <p key={a} className="flex items-start text-warning [overflow-wrap:anywhere]">
          <AlertTriangle className="mr-1 mt-px h-3 w-3 shrink-0" /> {a}
        </p>
      ))}
      {c.conferir.length > 0 && <p className="text-muted-foreground">Conferir de perto: {c.conferir.join(", ")}.</p>}
      {c.resumo && <p className="text-muted-foreground [overflow-wrap:anywhere]">{c.resumo}</p>}
    </div>
  );
}

function BotaoConferirClone({ cloneId, imagemId, origem, onConferencia }: { cloneId: string; imagemId: string; origem: "folha" | "acervo"; onConferencia: (c: ConferenciaDoClone | null) => void }) {
  const { catalogo } = useMesa();
  return (
    <BotaoComCusto
      rotulo={
        <>
          <ScanSearch className="mr-1 h-3 w-3" /> Conferir
        </>
      }
      titulo="Semelhança conferida"
      descricao="A visão descreve os traços do rosto nas fotos reais e nesta imagem; o Jev compara traço por traço. Sem biometria, só aviso."
      variant="ghost"
      className="h-7 px-1.5 text-[11px]"
      partes={() => partesDaConferenciaDoClone(padraoPara(catalogo, "leitura"))}
      executar={() => conferirClone(cloneId, imagemId, origem)}
      aoConcluir={(data) => onConferencia(data ? data.conferencia : null)}
    />
  );
}

// ------------------------------------------------------------------ lotes fora da tela

function avisarFim(rotulo: string, feitas: number, falhas: number, custo: number, atualizar: () => void, avisos: string[] = []) {
  atualizar();
  if (feitas) toast.success(`${feitas} ${rotulo}${feitas === 1 ? "" : "s"} pronta${feitas === 1 ? "" : "s"}`, { description: `Custo real: ${usd(custo)}.${falhas ? ` ${falhas} não saiu.` : ""}${avisos.length ? ` ${avisos[0]}` : ""}` });
  else if (falhas) toast.error("Nenhuma imagem saiu", { description: "Veja o erro em cada item e tente de novo." });
}

async function rodarVistas(p: { queryClient: QueryClient; clientId: string; cloneId: string; vistas: string[]; qualidade: Qualidade; atualizar: () => void; fotos?: string[] | null }) {
  let feitas = 0;
  let falhas = 0;
  let custo = 0;
  p.vistas.forEach((v) => marcarAndamento(chaveDoAndamento(p.cloneId, "clone-vista", v), { estado: "gerando", erro: "" }));
  await emParalelo(p.vistas, 3, async (v) => {
    const chave = chaveDoAndamento(p.cloneId, "clone-vista", v);
    try {
      const r = await gerarVistaDoClone({ modeloId: p.cloneId, vista: v, qualidade: p.qualidade, fotos: p.fotos });
      // A vista entra na tela assim que a função devolve (com a URL já assinada), sem esperar a releitura.
      if (r.imagem) guardarVistaDoClone(p.queryClient, p.cloneId, r.imagem);
      custo += Number(r.custo_usd || 0);
      feitas++;
      marcarAndamento(chave, null);
    } catch (e) {
      falhas++;
      marcarAndamento(chave, { estado: "falhou", erro: textoDoErro(e) });
    }
  });
  invalidarClone(p.queryClient, p.clientId, p.cloneId);
  avisarFim("vista", feitas, falhas, custo, p.atualizar);
}

/** Um item do lote de variações: o pedido e um rótulo curto para o andamento. */
type ItemDoLote = { pedido: PedidoDaVariacao; rotulo: string };

async function rodarVariacoes(p: { queryClient: QueryClient; clientId: string; cloneId: string; itens: ItemDoLote[]; formato: string; qualidade: Qualidade; atualizar: () => void; expressao?: ExpressaoDaVariacao | null }) {
  let feitas = 0;
  let falhas = 0;
  let custo = 0;
  const avisos: string[] = [];
  const rodada = String(Date.now());
  const chaves = p.itens.map((it, i) => ({ chave: chaveDoAndamento(p.cloneId, "clone-variacao", rodada, String(i)), item: it, i }));
  chaves.forEach((k) => marcarAndamento(k.chave, { estado: "gerando", erro: "" }));
  await emParalelo(chaves, 2, async ({ chave, item, i }) => {
    try {
      // A foto da expressão vai em todas; "guardar no clone" só na primeira (uma vez basta).
      const expressao = p.expressao && p.expressao.ids.length ? { ids: p.expressao.ids, guardar: !!p.expressao.guardar && i === 0 } : null;
      const r = await gerarVariacaoDoClone({ modeloId: p.cloneId, pedido: item.pedido, formato: p.formato, qualidade: p.qualidade, expressao });
      if (r.imagem) {
        // Aparece na hora: no clone aberto e no acervo, com a URL da resposta no cache.
        guardarVariacaoDoClone(p.queryClient, p.cloneId, r.imagem, r.url);
        acrescentarFotos(p.queryClient, p.clientId, [r.imagem]);
      }
      r.avisos.forEach((a) => {
        if (avisos.indexOf(a) < 0) avisos.push(a);
      });
      custo += Number(r.custo_usd || 0);
      feitas++;
      marcarAndamento(chave, null);
    } catch (e) {
      falhas++;
      marcarAndamento(chave, { estado: "falhou", erro: `${item.rotulo}: ${textoDoErro(e)}` });
    }
  });
  invalidarClone(p.queryClient, p.clientId, p.cloneId);
  invalidarFotos(p.queryClient, p.clientId);
  avisarFim("variação", feitas, falhas, custo, p.atualizar, avisos);
}

/** Gerar de novo UMA variação (o mesmo pedido), fora da tela: entra no lugar "gerando" das variações. */
async function rodarRefazerVariacao(p: { queryClient: QueryClient; clientId: string; cloneId: string; foto: FotoDoAcervo; qualidade: Qualidade; fotos: string[] | null; atualizar: () => void }) {
  const chave = chaveDoAndamento(p.cloneId, "clone-variacao", "refazer", p.foto.id, String(Date.now()));
  marcarAndamento(chave, { estado: "gerando", erro: "" });
  try {
    const r = await refazerVariacaoDoClone({ modeloId: p.cloneId, imagemId: p.foto.id, qualidade: p.qualidade, fotos: p.fotos });
    if (r.imagem) {
      guardarVariacaoDoClone(p.queryClient, p.cloneId, r.imagem, r.url);
      acrescentarFotos(p.queryClient, p.clientId, [r.imagem]);
    }
    marcarAndamento(chave, null);
    invalidarClone(p.queryClient, p.clientId, p.cloneId);
    invalidarFotos(p.queryClient, p.clientId);
    avisarFim("variação", 1, 0, Number(r.custo_usd || 0), p.atualizar, r.avisos);
  } catch (e) {
    marcarAndamento(chave, { estado: "falhou", erro: `Gerar de novo: ${textoDoErro(e)}` });
  }
}

// ------------------------------------------------------------------ peças comuns da edição

type ItemDoMenu = { rotulo: string; icone: ReactNode; acao: () => void; perigo?: boolean; desativado?: boolean };

/** Menu "..." pequeno (vista, variação, clone): abre no clique, fecha ao escolher. */
function MenuDoItem({ rotulo, itens, className = "" }: { rotulo: string; itens: ItemDoMenu[]; className?: string }) {
  const [aberto, setAberto] = useState(false);
  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <button type="button" aria-label={rotulo} title={rotulo} className={juntar(botao.icone, className)}>
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={4} className="w-60 max-w-[calc(100vw-24px)] p-1">
        <ul role="menu" aria-label={rotulo}>
          {itens.map((i) => (
            <li key={i.rotulo} role="none">
              <button
                type="button"
                role="menuitem"
                disabled={i.desativado}
                onClick={() => {
                  setAberto(false);
                  i.acao();
                }}
                className={`flex w-full min-w-0 items-center rounded-md px-2 py-1.5 text-left text-[12.5px] hover:bg-muted disabled:opacity-50 ${i.perigo ? "text-destructive" : ""}`}
              >
                <span className="mr-2 shrink-0">{i.icone}</span>
                <span className="min-w-0 truncate">{i.rotulo}</span>
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Gerar de novo escolhendo as fotos de origem desta geração (vista ou
 * variação). Todas marcadas de início; o custo aparece antes, como sempre.
 */
function DialogoDeFotosDaGeracao({
  titulo,
  reais,
  onFechar,
  partes,
  executar,
}: {
  titulo: string;
  reais: (FotoDoAcervo & { principal: boolean })[];
  onFechar: () => void;
  partes: (fotos: number) => ParteDaEstimativa[];
  executar: (fotos: string[] | null) => Promise<unknown>;
}) {
  const [marcadas, setMarcadas] = useState<string[]>(() => reais.map((r) => r.id));
  const n = marcadas.length;
  const alternar = (id: string) => setMarcadas((l) => (l.indexOf(id) >= 0 ? l.filter((x) => x !== id) : l.concat([id])));
  return (
    <Dialog open onOpenChange={(v) => (!v ? onFechar() : undefined)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>Escolha quais fotos de origem vão nesta geração. As outras ficam de fora só desta vez.</DialogDescription>
        </DialogHeader>
        <ul className="grid min-w-0 grid-cols-4 gap-2" aria-label="Fotos de origem desta geração" data-fotos-da-geracao="">
          {reais.map((r) => {
            const marcada = marcadas.indexOf(r.id) >= 0;
            return (
              <li key={r.id} className="min-w-0">
                <label className={`block cursor-pointer rounded-lg border p-0.5 ${marcada ? "border-primary" : "border-border opacity-60"}`}>
                  <MiniaturaDaFoto foto={r} selo={false} />
                  <span className="mt-0.5 flex min-w-0 items-center text-[10.5px]">
                    <input type="checkbox" className="mr-1 h-3.5 w-3.5 shrink-0" checked={marcada} onChange={() => alternar(r.id)} aria-label={`Usar ${r.nome}`} />
                    <span className="truncate">{r.principal ? "principal" : r.nome}</span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
        {n === 0 && <p className="text-[11.5px] text-warning">Escolha pelo menos 1 foto.</p>}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onFechar}>
            Cancelar
          </Button>
          <BotaoComCusto
            rotulo={
              <>
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Gerar de novo com {n} {n === 1 ? "foto" : "fotos"}
              </>
            }
            titulo={titulo}
            className="h-9 text-[12.5px]"
            disabled={n === 0}
            fecharAoConfirmar
            partes={() => partes(Math.max(1, n))}
            executar={() => executar(n === reais.length ? null : marcadas)}
            aoConcluir={() => onFechar()}
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ lista

const PONTO_DO_CLONE: Record<string, string> = { rascunho: "bg-muted-foreground/40", folha: "bg-primary", pronta: "bg-success", arquivada: "bg-muted-foreground/30" };

/** Clones no seletor lateral compacto (o mesmo das personas, 26/09). */
function ListaDeClones({ clones, escolhido, onEscolher, onNovo, novoAberto }: { clones: Clone[]; escolhido: string | null; onEscolher: (id: string) => void; onNovo: () => void; novoAberto: boolean }) {
  const itens: ItemDoSeletor[] = clones.map((c) => ({
    id: c.id,
    nome: c.nome,
    miniatura: (
      <span className="block h-full w-full" data-clone={c.id}>
        {c.capa_url ? (
          <img src={c.capa_url} alt={c.nome} className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-muted-foreground">
            <UserRound className="h-4 w-4" />
          </span>
        )}
      </span>
    ),
    estado: { rotulo: statusDoClone(c.status).rotulo, ponto: PONTO_DO_CLONE[c.status] || "bg-muted-foreground/40" },
    nota: c.autorizacao_valida.ok ? null : "autorização inválida",
    alerta: !c.autorizacao_valida.ok,
  }));
  return (
    <SeletorLateral
      titulo="Clones"
      itens={itens}
      escolhido={escolhido}
      onEscolher={onEscolher}
      onNovo={onNovo}
      novoRotulo="Novo clone"
      novoAberto={novoAberto}
      vazio="Nenhum clone ainda."
      ajuda="De 1 a 4 fotos reais da mesma pessoa do cliente, com a autorização de uso de imagem registrada. Depois vêm a folha de identidade e as variações com o mesmo rosto."
    />
  );
}

// ------------------------------------------------------------------ novo clone

/**
 * Fotos de origem (as reais da pessoa), iguais na criação e no clone já
 * criado (pedido do dono, 25/09 à noite: "às vezes quero mudar uma foto,
 * excluir, trocar"): x tira, a seta troca por outra, a estrela marca a
 * principal, + põe mais (do acervo ou subindo na hora). Limite de 4 e a
 * mesma qualidade mínima da função (foto real, ativa, com tamanho).
 */
function EditorDeFotosDeOrigem({
  ids,
  principal,
  onMudar,
  modo,
  bloqueado = false,
  conhecidas = [],
}: {
  ids: string[];
  principal: string | null;
  onMudar: (ids: string[], principal: string | null) => void;
  modo: "criacao" | "faixa";
  bloqueado?: boolean;
  /** Fotos já lidas (as reais do clone aberto), para a miniatura não esperar o acervo. */
  conhecidas?: FotoDoAcervo[];
}) {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const fotos = useFotos(clientId);
  const todas = fotos.data || [];
  const servem = todas.filter((f) => classeDaFoto(f) === "original" && !problemaDaFotoDeOrigem(f));
  const [escolhendo, setEscolhendo] = useState<{ trocar: string | null } | null>(null);
  const [andamento, setAndamento] = useState<string | null>(null);
  const cheio = ids.length >= MAX_FOTOS_DO_CLONE;
  const principalAtual = principal && ids.indexOf(principal) >= 0 ? principal : ids[0] || null;
  const minimo = modo === "faixa" ? 1 : 0;
  const fotoDe = (id: string) => todas.find((x) => x.id === id) || conhecidas.find((x) => x.id === id) || null;

  const somar = (novas: string[]) => {
    const saida = ids.slice();
    novas.forEach((id) => {
      if (saida.length < MAX_FOTOS_DO_CLONE && saida.indexOf(id) < 0) saida.push(id);
    });
    onMudar(saida, principalAtual && saida.indexOf(principalAtual) >= 0 ? principalAtual : saida[0] || null);
  };
  const trocar = (velha: string, nova: string) => {
    if (ids.indexOf(nova) >= 0) return;
    onMudar(
      ids.map((x) => (x === velha ? nova : x)),
      principalAtual === velha ? nova : principalAtual,
    );
  };
  const tirar = (id: string) => {
    const saida = ids.filter((x) => x !== id);
    onMudar(saida, principalAtual === id ? saida[0] || null : principalAtual);
  };
  const usar = (escolhidas: string[]) => {
    const alvo = escolhendo && escolhendo.trocar;
    if (alvo && escolhidas[0]) trocar(alvo, escolhidas[0]);
    else somar(escolhidas);
    setEscolhendo(null);
  };
  const subir = async (arquivos: File[]) => {
    const alvo = escolhendo && escolhendo.trocar;
    const vagas = alvo ? 1 : MAX_FOTOS_DO_CLONE - ids.length;
    if (!arquivos.length || andamento || vagas <= 0) return;
    setAndamento("Subindo fotos");
    try {
      const res = await subirOriginais(clientId, arquivos.slice(0, vagas), (feitos, total) => setAndamento(feitos < total ? `Subindo ${feitos} de ${total}` : "Registrando"));
      acrescentarFotos(queryClient, clientId, res.registradas);
      invalidarFotos(queryClient, clientId);
      const boas = res.registradas.filter((f) => !problemaDaFotoDeOrigem(f));
      const ruim = res.registradas.find((f) => !!problemaDaFotoDeOrigem(f));
      if (ruim) toast.warning("Foto fora do padrão", { description: `${problemaDaFotoDeOrigem(ruim)} Ela ficou no acervo, mas não entra no clone.` });
      if (boas.length) usar(boas.map((f) => f.id));
    } catch (e) {
      avisarErro(e, "Fotos não subiram");
    } finally {
      setAndamento(null);
    }
  };

  const miniaturas = (
    <ul className={`grid min-w-0 gap-1.5 ${modo === "faixa" ? "grid-cols-4 sm:grid-cols-6" : "mb-2 grid-cols-4"}`} aria-label="Fotos de origem">
      {ids.map((id) => {
        const f = fotoDe(id);
        const eh = principalAtual === id;
        return (
          <li key={id} className="relative min-w-0" data-foto-real={id}>
            {f ? <MiniaturaDaFoto foto={f} selo={false} className={eh ? "ring-2 ring-primary" : ""} /> : <span className="block w-full rounded-lg bg-muted" style={{ paddingBottom: "100%" }} />}
            {!bloqueado && (
              <>
                <button type="button" aria-label="Foto principal" title="Marcar como principal" aria-pressed={eh} onClick={() => onMudar(ids, id)} className="absolute left-1 top-1 flex h-6 w-6 items-center justify-center rounded-md border border-border bg-card">
                  <Star className={`h-3 w-3 ${eh ? "fill-primary text-primary" : "text-muted-foreground"}`} />
                </button>
                <button
                  type="button"
                  aria-label="Tirar a foto"
                  title={ids.length <= minimo ? "O clone precisa de pelo menos 1 foto: troque em vez de tirar" : "Tirar esta foto"}
                  disabled={ids.length <= minimo}
                  onClick={() => tirar(id)}
                  className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-md border border-border bg-card text-muted-foreground disabled:opacity-40"
                >
                  <X className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  aria-label="Trocar a foto"
                  title="Trocar por outra foto"
                  onClick={() => setEscolhendo({ trocar: id })}
                  className="absolute bottom-1 right-1 flex h-6 w-6 items-center justify-center rounded-md border border-border bg-card text-muted-foreground"
                >
                  <ArrowRightLeft className="h-3 w-3" />
                </button>
              </>
            )}
            {eh && <span className="pointer-events-none absolute bottom-1 left-1 rounded-full border border-primary/30 bg-card px-1.5 py-px text-[9.5px] font-semibold text-primary">principal</span>}
          </li>
        );
      })}
      {modo === "faixa" && !bloqueado && !cheio && (
        <li className="min-w-0">
          <button
            type="button"
            onClick={() => setEscolhendo({ trocar: null })}
            aria-label="Adicionar foto de origem"
            className="relative block w-full rounded-lg border border-dashed border-primary/50 bg-card text-primary hover:bg-primary/5"
            style={{ paddingBottom: "100%" }}
          >
            <span className="absolute inset-0 flex flex-col items-center justify-center text-[10.5px]">
              <Plus className="mb-0.5 h-4 w-4" /> foto
            </span>
          </button>
        </li>
      )}
    </ul>
  );

  const escolha = escolhendo && (
    <div className={juntar(superficie.poco, "mt-2 min-w-0 p-2")} data-escolha-de-foto="">
      <p className={juntar(texto.auxiliar, "mb-1.5")}>{escolhendo.trocar ? "Escolha a foto que entra no lugar desta (ou suba uma nova)." : "Suba fotos novas ou escolha do acervo."}</p>
      <ZonaDeEnvio compacta onArquivos={(a) => void subir(a)} andamento={andamento} />
      <div className="mt-2">
        <SeletorDeFotos
          fotos={servem.filter((f) => ids.indexOf(f.id) < 0)}
          titulo={escolhendo.trocar ? "Trocar por" : "Fotos reais da pessoa"}
          filtroInicial="original"
          multiplas={!escolhendo.trocar}
          jaEscolhidas={ids}
          onUsar={usar}
          onFechar={() => setEscolhendo(null)}
        />
      </div>
    </div>
  );

  if (modo === "faixa") {
    return (
      <div className="min-w-0" data-faixa-de-origem="">
        {miniaturas}
        {escolha}
      </div>
    );
  }
  return (
    <div className="min-w-0" data-fotos-reais="">
      <div className="mb-1.5 flex min-w-0 items-center">
        <span className={texto.rotulo}>
          Fotos reais da pessoa · {ids.length} de {MAX_FOTOS_DO_CLONE}
        </span>
        <AjudaRecolhida className="ml-1">De preferência uma de frente com luz uniforme, uma de 3/4 e uma de corpo inteiro, sem filtro e sem óculos escuros. A estrela marca a principal. Dá para mudar depois.</AjudaRecolhida>
        {!escolhendo && (
          <button type="button" className={juntar(botao.discreto, "ml-auto h-7 px-2 text-[12px]")} disabled={cheio} onClick={() => setEscolhendo({ trocar: null })}>
            <Images className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Escolher do acervo
          </button>
        )}
      </div>
      {ids.length > 0 && miniaturas}
      {!cheio && !escolhendo && <ZonaDeEnvio compacta onArquivos={(a) => void subir(a)} andamento={andamento} />}
      {escolha}
    </div>

  );
}

function FotosReaisDoRascunho({ r, onMudar }: { r: RascunhoDoClone; onMudar: (r: RascunhoDoClone) => void }) {
  return <EditorDeFotosDeOrigem modo="criacao" ids={r.imagem_ids} principal={r.principal_id} onMudar={(ids, principal) => onMudar({ ...r, imagem_ids: ids, principal_id: principal })} />;
}

const ehRascunhoDoClone = (v: unknown) => !!v && typeof v === "object" && typeof (v as RascunhoDoClone).nome === "string" && Array.isArray((v as RascunhoDoClone).imagem_ids) && !!(v as RascunhoDoClone).autorizacao;

function NovoClone({ fotoInicial, onCriado, onCancelar }: { fotoInicial: string | null; onCriado: (c: Clone) => void; onCancelar: () => void }) {
  const { clientId } = useMesa();
  const avisarErro = useAvisarErro();
  // Rascunho que não se perde ao sair e voltar. As confirmações da autorização voltam desmarcadas: são da equipe, na hora de criar.
  const [r, setR, esquecerRascunho] = useEstadoDaTela<RascunhoDoClone>(`mesa-foto:clones:rascunho:${clientId}`, rascunhoDoClone(fotoInicial ? [fotoInicial] : []), { validar: ehRascunhoDoClone, esperaMs: 300 });
  useEffect(() => {
    setR((x) => {
      const ids = fotoInicial && x.imagem_ids.indexOf(fotoInicial) < 0 && x.imagem_ids.length < MAX_FOTOS_DO_CLONE ? x.imagem_ids.concat([fotoInicial]) : x.imagem_ids;
      const a = x.autorizacao;
      if (ids === x.imagem_ids && !a.confirmada && !a.sabe_que_e_ia && !a.adulta) return x;
      return { ...x, imagem_ids: ids, principal_id: x.principal_id || ids[0] || null, autorizacao: { ...a, confirmada: false, sabe_que_e_ia: false, adulta: false } };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [tentou, setTentou] = useState(false);
  const [criando, setCriando] = useState(false);
  const problemas = problemasDoClone(r);
  const a = r.autorizacao;
  const aut = (campo: keyof RascunhoDoClone["autorizacao"], valor: string | boolean) => setR({ ...r, autorizacao: { ...a, [campo]: valor } });
  const altura = "h-9 text-[13px]";

  const criar = async () => {
    setTentou(true);
    if (problemas.length || criando) return;
    setCriando(true);
    try {
      const c = await criarClone(clientId, r);
      if (!c) throw new Error("A função não devolveu o clone criado.");
      toast.success(`Clone de ${c.nome} criado`, { description: "Agora a folha de identidade: frente, 3/4, perfil e corpo com o mesmo rosto." });
      esquecerRascunho();
      onCriado(c);
    } catch (e) {
      avisarErro(e, "Clone não criado");
    } finally {
      setCriando(false);
    }
  };

  return (
    <Secao titulo="Novo clone" ajuda="Uma pessoa REAL do cliente. Sem a autorização dela registrada aqui, nada é gerado. Criar não gasta; o custo aparece antes de cada geração." data-novo-clone="">
      <div className="grid min-w-0 grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="min-w-0 space-y-4">
          <CampoDeFormulario rotulo="Nome da pessoa (como a equipe chama)">
            <Input value={r.nome} onChange={(e) => setR({ ...r, nome: e.target.value })} placeholder="Ex.: Dra. Paula" aria-label="Nome do clone" className={altura} />
          </CampoDeFormulario>
          <FotosReaisDoRascunho r={r} onMudar={setR} />
          <CampoDeFormulario rotulo="Traços que nunca mudam (um por linha, opcional)">
            <Textarea value={r.invariantes} onChange={(e) => setR({ ...r, invariantes: e.target.value })} rows={2} placeholder={"Ex.: pinta acima do lábio, à esquerda dela\ncabelo cacheado na altura do ombro"} aria-label="Traços que nunca mudam" className="text-[13px]" />
          </CampoDeFormulario>
        </div>
        <div className={juntar("min-w-0 rounded-lg border p-4", a.confirmada ? "border-success/40" : "border-warning/50")} data-autorizacao-do-clone="">
          <p className="mb-3 flex items-center text-[14px] font-semibold">
            <ShieldCheck className="mr-1.5 h-4 w-4 text-primary" aria-hidden="true" /> Autorização de uso de imagem
          </p>
          <GrupoDeCampos>
            <CampoDeFormulario rotulo="Quem autorizou">
              <Input value={a.quem} onChange={(e) => aut("quem", e.target.value)} placeholder="A própria pessoa" aria-label="Quem autorizou" className={altura} />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Data (DD/MM/AAAA)">
              <Input value={a.data} onChange={(e) => aut("data", e.target.value)} placeholder="25/09/2026" aria-label="Data da autorização" className={altura} />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Finalidade" largo>
              <Input value={a.finalidade} onChange={(e) => aut("finalidade", e.target.value)} placeholder="Ex.: posts e anúncios da clínica no Instagram" aria-label="Finalidade" className={altura} />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Validade (opcional)">
              <Input value={a.validade} onChange={(e) => aut("validade", e.target.value)} placeholder="Até revogar" aria-label="Validade" className={altura} />
            </CampoDeFormulario>
            <CampoDeEscolha rotulo="Como">
              <Pilulas rotulo="Forma da autorização" opcoes={FORMAS_DE_AUTORIZACAO} valor={a.forma} onEscolher={(v) => aut("forma", v)} />
            </CampoDeEscolha>
          </GrupoDeCampos>
          <div className="mt-4 space-y-2 border-t border-border pt-3">
            {[
              { campo: "sabe_que_e_ia" as const, texto: "A pessoa sabe que as fotos dela serão recriadas por IA (roupa, cenário e pose novos, o mesmo rosto)." },
              { campo: "adulta" as const, texto: `A pessoa tem ${IDADE_MINIMA_CLONE} anos ou mais.` },
              { campo: "confirmada" as const, texto: "Confirmo a autorização de uso de imagem para a finalidade acima. As imagens saem marcadas como geradas." },
            ].map((x) => (
              <label key={x.campo} className="flex min-w-0 items-start text-[13px] leading-5">
                <input type="checkbox" className="mr-2 mt-0.5 h-4 w-4 shrink-0" checked={a[x.campo] as boolean} onChange={(e) => aut(x.campo, e.target.checked)} aria-label={x.texto} />
                <span className="min-w-0">{x.texto}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
      {tentou && problemas.length > 0 && (
        <ul className="mt-3 space-y-0.5" role="alert">
          {problemas.map((p) => (
            <li key={p} className="text-[12px] text-warning">
              {p}
            </li>
          ))}
        </ul>
      )}
      <BarraDeAcoes className="mt-4 border-t border-border pt-3" inicio="Criar não gasta.">
        <button
          type="button"
          className={botao.discreto}
          onClick={() => {
            esquecerRascunho();
            onCancelar();
          }}
        >
          Cancelar
        </button>
        <button type="button" className={botao.primario} onClick={() => void criar()} disabled={criando}>
          {criando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1.5 h-3.5 w-3.5" />} Criar clone
        </button>
      </BarraDeAcoes>
    </Secao>
  );
}

// ------------------------------------------------------------------ clone aberto

function ImagemDaFolhaNaTela({ imagem, alt }: { imagem: ImagemDaPersona; alt: string }) {
  return <ImagemDaMesa caminho={caminhoDaImagem(imagem)} bucket={imagem.storage_bucket || "mesa"} alt={alt} className="h-full w-full" />;
}

/** Botão pequeno de baixar o arquivo original (sem ZIP, nome bom). */
function BotaoBaixarOriginal({ baixar, rotulo }: { baixar: () => Promise<void>; rotulo: string }) {
  const avisarErro = useAvisarErro();
  const [baixando, setBaixando] = useState(false);
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className="h-7 px-1.5 text-[11px]"
      disabled={baixando}
      title="Baixar no tamanho original, sem ZIP"
      aria-label={rotulo}
      onClick={() => {
        setBaixando(true);
        baixar()
          .catch((e) => avisarErro(e, "Não baixou"))
          .then(() => setBaixando(false));
      }}
    >
      {baixando ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
    </Button>
  );
}

function FolhaDeIdentidade({ aberto }: { aberto: CloneAberto }) {
  const { clientId, atualizarCusto } = useMesa();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const andamentos = useAndamentos();
  const [qualidade, setQualidade] = useState<Qualidade>("alta");
  const [conferencias, setConferencias] = useState<Record<string, ConferenciaDoClone | null>>({});
  const [ampliada, setAmpliada] = useState<number | null>(null);
  // Vista em que a equipe escolhe as fotos de origem antes de gerar de novo.
  const [escolhendoFotos, setEscolhendoFotos] = useState<{ valor: string; rotulo: string } | null>(null);
  const c = aberto.clone;
  const bloqueado = !c.autorizacao_valida.ok || c.status === "arquivada";
  const motor = aberto.motores.find((m) => m.modelo_imagem_id === c.motor_preferido_id) || aberto.motores.find((m) => m.padrao) || null;
  const motorId = motor ? motor.modelo_imagem_id : null;
  const refs = Math.min(5, aberto.reais.length + aberto.folha.aprovadas);
  const servidor = usePrecoNoServidor(clientId, "clone_folha", { modelo_id: c.id }, !bloqueado);
  const porVista = typeof servidor.data === "number" ? servidor.data : null;
  const ultimaDe = (v: string) => aberto.imagens.filter((i) => i.papel === "vista" && i.vista === v).pop() || null;
  const aprovadaDe = (v: string) => aberto.imagens.find((i) => i.papel === "vista" && i.vista === v && i.aprovada === true) || null;
  const naTela: (VistaDoClone | null)[] = VISTAS_DO_CLONE.map((v) => aprovadaDe(v.valor) || ultimaDe(v.valor));
  const prontas = naTela.filter((x): x is VistaDoClone => !!x);
  const faltam = VISTAS_DO_CLONE.filter((v) => !ultimaDe(v.valor)).map((v) => v.valor);
  // Feitas com as fotos de origem antigas: continuam guardadas, com "Gerar de novo com as fotos novas".
  const antigas = VISTAS_DO_CLONE.filter((_v, k) => !!naTela[k] && naTela[k]!.desatualizada).map((v) => v.valor);
  const gerandoAlguma = VISTAS_DO_CLONE.some((v) => {
    const a = andamentos[chaveDoAndamento(c.id, "clone-vista", v.valor)];
    return !!a && a.estado === "gerando";
  });
  const rodar = (vistas: string[], fotos: string[] | null = null) => {
    void rodarVistas({ queryClient, clientId, cloneId: c.id, vistas, qualidade, atualizar: atualizarCusto, fotos });
    return Promise.resolve({});
  };
  /**
   * Aprovar na hora (pedido do dono, 26/09: "aprovar demora, fica
   * carregando"): a vista fica aprovada na tela antes da função responder
   * (e a anterior da mesma vista perde a aprovação, como no servidor); se a
   * função recusar, volta como estava.
   */
  const decidir = async (img: VistaDoClone, decisao: "aprovar" | "rejeitar") => {
    const antes = aberto.imagens;
    mudarCloneAberto(queryClient, c.id, (a) => ({
      ...a,
      imagens: a.imagens.map((i) =>
        i.id === img.id ? { ...i, aprovada: decisao === "aprovar" } : decisao === "aprovar" && i.papel === "vista" && i.vista === img.vista && i.aprovada === true ? { ...i, aprovada: null } : i,
      ),
    }));
    try {
      await decidirVistaDoClone(img.id, decisao);
      invalidarClone(queryClient, clientId, c.id);
    } catch (e) {
      mudarCloneAberto(queryClient, c.id, (a) => ({ ...a, imagens: antes }));
      avisarErro(e, "Decisão não gravada");
    }
  };
  /** Apagar = arquivar, na hora e com desfazer. Nada sai do Storage. */
  const restaurar = async (img: VistaDoClone) => {
    moverVistaNoCache(queryClient, c.id, img.id, false);
    try {
      await arquivarImagemDoClone(c.id, img.id, "folha", true);
      invalidarClone(queryClient, clientId, c.id);
    } catch (e) {
      moverVistaNoCache(queryClient, c.id, img.id, true);
      avisarErro(e, "Vista não restaurada");
    }
  };
  const apagar = async (img: VistaDoClone, rotulo: string) => {
    moverVistaNoCache(queryClient, c.id, img.id, true);
    try {
      await arquivarImagemDoClone(c.id, img.id, "folha");
      invalidarClone(queryClient, clientId, c.id);
      toast.success(`Vista ${rotulo} apagada`, { description: "Fica em Apagadas, no fim da folha. Dá para restaurar.", action: { label: "Desfazer", onClick: () => void restaurar(img) } });
    } catch (e) {
      moverVistaNoCache(queryClient, c.id, img.id, false);
      avisarErro(e, "Vista não apagada");
    }
  };

  return (
    <Secao
      titulo="Folha de identidade"
      descricao={`${aberto.folha.aprovadas} de ${aberto.folha.total} aprovadas${aberto.folha.pronto ? " · pronta" : ""}`}
      ajuda={`A mesma pessoa em 6 vistas, fundo neutro e luz uniforme: é a identidade das variações (todas as vistas aprovadas vão em cada variação) e, depois, do vídeo. Gerador: ${motor ? motor.rotulo : "padrão"}.${aberto.folha.pronto ? " Pronto." : " Aprove a frente e mais 2 para ficar pronto."}`}
      data-folha-do-clone=""
      acao={
        !bloqueado && faltam.length > 0 ? (
          <BotaoComCusto
            rotulo={
              <>
                <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Gerar {faltam.length === 6 ? "a folha" : `as ${faltam.length} que faltam`}
              </>
            }
            titulo="Folha de identidade"
            descricao={porVista != null ? `~${usd(porVista)} por vista pela função.` : undefined}
            className="h-9 text-[13px]"
            disabled={gerandoAlguma}
            fecharAoConfirmar
            partes={() => partesDoClone(motorId, qualidade, refs, faltam.length)}
            executar={() => rodar(faltam)}
          />
        ) : undefined
      }
    >
      {antigas.length > 0 && (
        <div className="mb-3 min-w-0 rounded-lg border border-warning/50 bg-warning/5 p-3" data-folha-desatualizada="" role="status">
          <p className="text-[12px] leading-snug [overflow-wrap:anywhere]">
            {antigas.length === 1 ? "1 vista foi feita" : `${antigas.length} vistas foram feitas`} com as fotos antigas. {antigas.length === 1 ? "Ela continua guardada" : "Elas continuam guardadas"}, mas não {antigas.length === 1 ? "vai" : "vão"} mais ao gerador como identidade.
          </p>
          {!bloqueado && (
            <BotaoComCusto
              rotulo={
                <>
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Gerar de novo com as fotos novas ({antigas.length})
                </>
              }
              titulo="Folha com as fotos novas"
              descricao={porVista != null ? `~${usd(porVista)} por vista pela função. Uma vez só, sem refazer sozinho.` : "Uma vez só, sem refazer sozinho."}
              variant="outline"
              className="mt-1.5 h-8 text-[12px]"
              disabled={gerandoAlguma}
              fecharAoConfirmar
              partes={() => partesDoClone(motorId, qualidade, refs, antigas.length)}
              executar={() => rodar(antigas)}
            />
          )}
        </div>
      )}
      <div className="mb-3 w-full sm:w-56">
        <SeletorDeQualidade valor={qualidade} onChange={setQualidade} disabled={bloqueado} />
      </div>
      <ul className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3" aria-label="Vistas da folha do clone">
        {VISTAS_DO_CLONE.map((v, k) => {
          const img = naTela[k];
          const a = andamentos[chaveDoAndamento(c.id, "clone-vista", v.valor)];
          const gerando = !!a && a.estado === "gerando";
          const conf = img ? (conferencias[img.id] !== undefined ? conferencias[img.id] : null) : null;
          return (
            <li key={v.valor} className="min-w-0" data-vista-do-clone={v.valor}>
              <Moldura proporcao={img ? proporcaoDaImagem(img) : 0.8} className={`border ${img && img.aprovada === true ? "border-success/60" : "border-border"}`}>
                {img ? (
                  <button type="button" className="block h-full w-full cursor-zoom-in" aria-label={`Ver grande: ${v.rotulo}`} onClick={() => setAmpliada(prontas.indexOf(img))}>
                    <ImagemDaFolhaNaTela imagem={img} alt={`${c.nome}, ${v.rotulo}`} />
                  </button>
                ) : (
                  <span className={`flex h-full w-full flex-col items-center justify-center text-[10.5px] text-muted-foreground ${gerando ? "animate-pulse bg-muted" : ""}`}>
                    {gerando && <Loader2 className="mb-1 h-4 w-4 animate-spin text-primary" />}
                    {gerando ? "gerando" : "vazia"}
                  </span>
                )}
                {img && <SeloGerada />}
                {img && img.desatualizada && (
                  <span className="pointer-events-none absolute right-1 top-1 inline-flex items-center rounded-full border border-warning/50 bg-card px-1.5 py-px text-[9.5px] font-semibold text-warning" data-vista-desatualizada="">
                    fotos antigas
                  </span>
                )}
                {img && gerando && (
                  <span className="pointer-events-none absolute bottom-1 left-1 inline-flex items-center rounded-full border border-border bg-card px-1.5 py-px text-[9.5px] text-muted-foreground">
                    <Loader2 className="mr-0.5 h-2.5 w-2.5 animate-spin" /> gerando de novo
                  </span>
                )}
              </Moldura>
              <div className="mt-1 flex min-w-0 items-center">
                <p className="mr-auto truncate text-[11px] font-medium">{v.rotulo}</p>
                {img && <BotaoBaixarOriginal rotulo={`Baixar ${v.rotulo}`} baixar={() => baixarDoStorage(img.storage_bucket || "mesa", img.storage_path, `${c.nome} ${v.rotulo} gerada`)} />}
                {img && (
                  <MenuDoItem
                    rotulo={`Mais opções: ${v.rotulo}`}
                    itens={[
                      { rotulo: "Escolher as fotos e gerar de novo", icone: <Images className="h-3.5 w-3.5" />, acao: () => setEscolhendoFotos(v), desativado: bloqueado || gerando },
                      { rotulo: "Apagar esta vista", icone: <Trash2 className="h-3.5 w-3.5" />, acao: () => void apagar(img, v.rotulo), perigo: true },
                    ]}
                  />
                )}
              </div>
              {img && img.aprovada === true && (
                <div className="flex min-w-0 flex-wrap items-center">
                  <span className="mr-1.5 inline-flex items-center text-[10.5px] font-medium text-success">
                    <Check className="mr-0.5 h-3 w-3" /> aprovada
                  </span>
                  <button type="button" className="text-[10.5px] text-muted-foreground hover:text-foreground" onClick={() => void decidir(img, "rejeitar")}>
                    tirar
                  </button>
                </div>
              )}
              {img && img.aprovada !== true && (
                <Button type="button" size="sm" variant="outline" className="mb-1 h-7 w-full px-1.5 text-[11px]" onClick={() => void decidir(img, "aprovar")}>
                  <Check className="h-3 w-3" /> <span className="ml-0.5">Aprovar</span>
                </Button>
              )}
              {img && <BotaoConferirClone cloneId={c.id} imagemId={img.id} origem="folha" onConferencia={(x) => setConferencias({ ...conferencias, [img.id]: x })} />}
              {conf && <NotasDaSemelhanca c={conf} />}
              {a && a.estado === "falhou" && (
                <p className="text-[10.5px] leading-snug text-destructive [overflow-wrap:anywhere]" role="alert">
                  {a.erro}
                </p>
              )}
              {!bloqueado && (
                <BotaoComCusto
                  rotulo={
                    img ? (
                      <>
                        <RefreshCw className="mr-1 h-3 w-3" /> Gerar de novo
                      </>
                    ) : (
                      "Gerar"
                    )
                  }
                  titulo={`Vista ${v.rotulo}`}
                  descricao={img ? "Uma imagem nova desta vista com todas as fotos de origem. A atual fica guardada." : undefined}
                  variant="ghost"
                  className="h-7 w-full px-1 text-[11px]"
                  disabled={gerando}
                  fecharAoConfirmar
                  partes={() => partesDoClone(motorId, qualidade, refs)}
                  executar={() => rodar([v.valor])}
                />
              )}
            </li>
          );
        })}
      </ul>
      {aberto.arquivadas.length > 0 && (
        <details className="mt-4 min-w-0 border-t border-border pt-3" data-vistas-apagadas="">
          <summary className="cursor-pointer text-[12px] font-medium text-muted-foreground">Apagadas ({aberto.arquivadas.length})</summary>
          <ul className="mt-2 grid min-w-0 grid-cols-3 gap-2 pb-1 sm:grid-cols-4">
            {aberto.arquivadas.map((img) => {
              const rotulo = (VISTAS_DO_CLONE.find((v) => v.valor === img.vista) || { rotulo: img.vista || "vista" }).rotulo;
              return (
                <li key={img.id} className="min-w-0" data-vista-apagada={img.id}>
                  <Moldura proporcao={proporcaoDaImagem(img)} className="border border-border">
                    <ImagemDaFolhaNaTela imagem={img} alt={`${c.nome}, ${rotulo} (apagada)`} />
                  </Moldura>
                  <p className="mt-0.5 truncate text-[10.5px] text-muted-foreground">{rotulo}</p>
                  <Button type="button" size="sm" variant="ghost" className="h-7 w-full px-1 text-[11px]" onClick={() => void restaurar(img)}>
                    <RotateCcw className="mr-1 h-3 w-3" /> Restaurar
                  </Button>
                </li>
              );
            })}
          </ul>
        </details>
      )}
      {escolhendoFotos && (
        <DialogoDeFotosDaGeracao
          titulo={`Gerar de novo: ${escolhendoFotos.rotulo}`}
          reais={aberto.reais}
          onFechar={() => setEscolhendoFotos(null)}
          partes={(n) => partesDoClone(motorId, qualidade, Math.min(5, n + aberto.folha.aprovadas))}
          executar={(fotos) => rodar([escolhendoFotos.valor], fotos)}
        />
      )}
      <Ampliar
        imagens={prontas.map((i) => ({ caminho: caminhoDaImagem(i), bucket: i.storage_bucket || "mesa", titulo: `${c.nome} (gerada)`, legenda: "Pessoa real recriada por IA com autorização.", proporcao: proporcaoDaImagem(i) }))}
        indice={ampliada !== null && ampliada >= 0 ? ampliada : null}
        onFechar={() => setAmpliada(null)}
      />
    </Secao>
  );
}

const PEDIDO_VAZIO: PedidoDaVariacao = { preset: null, roupa: "", cenario: "", pose: "", expressao: "", livre: "" };

type ModoDaVariacao = "prontas" | "contexto" | "uniforme" | "livre";
/** O que muda na variação: sub-aba de 4 opções (seletor segmentado). A explicação de cada uma fica no "?". */
const MODOS_DA_VARIACAO: { valor: ModoDaVariacao; rotulo: string; dica: string }[] = [
  { valor: "prontas", rotulo: "Prontas", dica: "Estilos prontos: editorial, rua, café, casa, estúdio, UGC." },
  { valor: "contexto", rotulo: "Contexto", dica: "Pelo contexto do cliente: o diretor lê o negócio do cliente e sugere fotos do trabalho da pessoa." },
  { valor: "uniforme", rotulo: "Uniforme", dica: "Uniforme da marca: roupa profissional com a logo oficial do kit da marca aplicada." },
  { valor: "livre", rotulo: "Livre", dica: "Do meu jeito: roupa, cenário, pose e expressão escritos pela equipe." },
];
const ehModoDaVariacao = (v: unknown) => MODOS_DA_VARIACAO.some((m) => m.valor === v);
const ehPedidoDaVariacao = (v: unknown) => !!v && typeof v === "object" && typeof (v as PedidoDaVariacao).roupa === "string" && typeof (v as PedidoDaVariacao).livre === "string";

/** Campos do pedido (roupa, cenário, pose, expressão, livre), recolhíveis para a tela ficar limpa. */
function CamposDoPedido({ pedido, onMudar, aberto }: { pedido: PedidoDaVariacao; onMudar: (p: PedidoDaVariacao) => void; aberto: boolean }) {
  return (
    <details className="mt-3 min-w-0" open={aberto} data-campos-do-pedido="">
      <summary className="cursor-pointer text-[12px] font-medium text-muted-foreground">Ajustar roupa, cenário, pose e expressão</summary>
      <GrupoDeCampos className="mt-2">
        {(
          [
            ["roupa", "Roupa", "Ex.: blazer bege sobre camiseta branca"],
            ["cenario", "Cenário", "Ex.: consultório claro com plantas"],
            ["pose", "Pose", "Ex.: braços cruzados, meio sorriso"],
            ["expressao", "Expressão", "Ex.: confiante, olhando para a câmera"],
          ] as const
        ).map(([campo, rotulo, dica]) => (
          <CampoDeFormulario key={campo} rotulo={rotulo}>
            <Input value={pedido[campo]} onChange={(e) => onMudar({ ...pedido, [campo]: e.target.value })} placeholder={dica} aria-label={rotulo} className="h-9 text-[13px]" />
          </CampoDeFormulario>
        ))}
        <CampoDeFormulario rotulo="Pedido livre (opcional)" largo>
          <Input value={pedido.livre} onChange={(e) => onMudar({ ...pedido, livre: e.target.value })} placeholder="O rosto, a idade e o corpo não mudam" aria-label="Pedido livre da variação" className="h-9 text-[13px]" />
        </CampoDeFormulario>
      </GrupoDeCampos>
    </details>
  );
}

/** "Pelo contexto do cliente": o diretor sugere, a equipe marca as que quer (uma foto por sugestão). */
function PeloContexto({ clone, marcadas, onMarcar, sugestoes, onSugestoes }: { clone: Clone; marcadas: number[]; onMarcar: (i: number) => void; sugestoes: SugestaoDoClone[] | null; onSugestoes: (s: SugestaoDoClone[], negocio: string) => void }) {
  const { catalogo } = useMesa();
  const [negocio, setNegocio] = useState("");
  const [pedido, setPedido] = useState("");
  const bloqueado = !clone.autorizacao_valida.ok || clone.status === "arquivada";
  return (
    <div className="min-w-0" data-pelo-contexto="">
      <div className="flex min-w-0 flex-wrap items-center">
        <Input value={pedido} onChange={(e) => setPedido(e.target.value)} placeholder="Opcional: foco (ex.: atendendo o cliente, com as ferramentas)" aria-label="Foco das sugestões" className="mb-1.5 mr-1.5 h-9 min-w-0 flex-1 text-[12.5px]" />
        <BotaoComCusto
          rotulo={
            <>
              <Lightbulb className="mr-1.5 h-3.5 w-3.5" /> {sugestoes ? "Sugerir de novo" : "Sugerir pelo contexto"}
            </>
          }
          titulo="Sugestões pelo contexto do cliente"
          descricao="O diretor lê o contexto do cliente (o que ele faz, serviços, público, marca e campanha) e sugere fotos do trabalho da pessoa. Não gera imagem."
          variant="outline"
          className="mb-1.5 h-9 text-[12px]"
          disabled={bloqueado}
          partes={() => partesDaSugestaoDoClone(padraoPara(catalogo, "diretor_arte"))}
          executar={() => sugerirVariacoesDoClone(clone.id, pedido)}
          aoConcluir={(data) => {
            if (data) {
              setNegocio(data.negocio || "");
              onSugestoes(data.sugestoes || [], data.negocio || "");
              if (data.avisos && data.avisos.length) toast.message("Sugestões", { description: data.avisos.join(" ") });
            }
          }}
        />
      </div>
      {negocio && <p className="mb-1.5 text-[12px] leading-snug text-muted-foreground [overflow-wrap:anywhere]">{negocio}</p>}
      {sugestoes && sugestoes.length > 0 ? (
        <ul className="grid min-w-0 grid-cols-1 gap-1.5 sm:grid-cols-2" aria-label="Sugestões pelo contexto">
          {sugestoes.map((s, i) => {
            const marcada = marcadas.indexOf(i) >= 0;
            return (
              <li key={`${i}-${s.rotulo}`} className="min-w-0">
                <button
                  type="button"
                  aria-pressed={marcada}
                  onClick={() => onMarcar(i)}
                  className={`block w-full min-w-0 rounded-lg border p-2 text-left transition-colors ${marcada ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary/40"}`}
                >
                  <span className="flex min-w-0 items-center text-[12px] font-semibold">
                    <span className={`mr-1.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${marcada ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>
                      {marcada && <Check className="h-3 w-3" />}
                    </span>
                    <span className="truncate">{s.rotulo}</span>
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground [overflow-wrap:anywhere]">{[s.roupa, s.cenario].filter(Boolean).join(" · ")}</span>
                  {s.porque && <span className="mt-0.5 block text-[10.5px] leading-snug text-primary [overflow-wrap:anywhere]">{s.porque}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className={juntar(texto.auxiliar, "flex items-center")}>
          Marque as que quiser: sai uma foto por sugestão.
          <AjudaRecolhida className="ml-1">O diretor já sabe o trabalho do cliente (ex.: paisagismo) e monta as fotos da pessoa em cima disso.</AjudaRecolhida>
        </p>
      )}

    </div>
  );
}

/** A variação aberta: grande, com aprovar, baixar o original, usar e as ferramentas pro (ampliar para o cliente). */
function VariacaoAberta({
  foto,
  clone,
  onFechar,
  onMudou,
  onRefazer,
  onApagar,
}: {
  foto: FotoDoAcervo;
  clone: Clone;
  onFechar: () => void;
  onMudou: (f: FotoDoAcervo) => void;
  /** Gerar de novo (o mesmo pedido, escolhendo as fotos); nulo quando o clone não pode gerar. */
  onRefazer: (() => void) | null;
  onApagar: () => void;
}) {
  const { clientId } = useMesa();
  const [conferencia, setConferencia] = useState<ConferenciaDoClone | null>(null);
  return (
    <section className="mb-3 grid min-w-0 grid-cols-1 gap-3 rounded-lg border border-primary/40 p-3 sm:grid-cols-[180px_minmax(0,1fr)]" aria-label={`Variação ${foto.nome}`} data-variacao-aberta={foto.id}>
      <div className="min-w-0">
        <Moldura proporcao={foto.largura && foto.altura ? foto.largura / foto.altura : 0.8} className="border border-border">
          <ImagemDaMesa caminho={foto.storage_path} bucket={foto.storage_bucket || "mesa"} alt={foto.nome} className="h-full w-full !object-contain" />
          <SeloGerada />
        </Moldura>
      </div>
      <div className="min-w-0 space-y-2">
        <div className="flex min-w-0 items-start">
          <p className="mr-auto min-w-0 truncate text-[13px] font-semibold" title={foto.nome}>
            {foto.nome}
          </p>
          <button type="button" onClick={onFechar} aria-label="Fechar a variação" className={juntar(botao.icone, "ml-2")}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex min-w-0 flex-wrap items-center">
          <AprovarFoto foto={foto} onMudou={onMudou} />
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mb-1.5 mr-1.5 h-8 text-[12px]"
            onClick={() => void baixarUmaAUma(clientId, [foto]).catch(() => toast.error("Não foi possível baixar agora"))}
            title="O arquivo original, sem ZIP"
          >
            <Download className="mr-1.5 h-3.5 w-3.5" /> Baixar original
          </Button>
          <MenuDeUso foto={foto} rotulo="Usar" variante="outline" className="mb-1.5 mr-1.5" />
          <AtalhosDaFoto foto={foto} />
          <BotaoConferirClone cloneId={clone.id} imagemId={foto.id} origem="acervo" onConferencia={setConferencia} />
          {onRefazer && (
            <Button type="button" size="sm" variant="outline" className="mb-1.5 mr-1.5 h-8 text-[12px]" onClick={onRefazer} title="O mesmo pedido de novo; dá para escolher as fotos de origem">
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Gerar de novo
            </Button>
          )}
          <Button type="button" size="sm" variant="ghost" className="mb-1.5 h-8 text-[12px] text-muted-foreground" onClick={onApagar} title="Sai do acervo e fica em Apagadas (dá para restaurar)">
            <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Apagar
          </Button>
        </div>
        {conferencia && <NotasDaSemelhanca c={conferencia} />}
        {foto.tags.indexOf("uniforme_da_marca") >= 0 && <p className="text-[11px] text-warning">Uniforme com a logo oficial: confira letras, cores e proporção da logo antes de aprovar.</p>}
        {foto.aprovada ? (
          <div className="min-w-0 border-t border-border pt-2">
            <p className={juntar(texto.rotulo, "mb-1.5")}>Ampliar para enviar ao cliente</p>
            <AcoesProDaFoto foto={foto} mostrarCriativo={false} />
          </div>
        ) : (
          <p className={texto.auxiliar}>Aprove para ampliar e mandar ao cliente.</p>
        )}
      </div>
    </section>
  );
}

const ehListaDeIds = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === "string");

/**
 * Foto de referência da expressão (26/09, "meu sorriso está diferente"):
 * 1 ou 2 fotos reais da pessoa com a expressão pedida, só nesta variação
 * (do acervo, das guardadas no clone ou subindo na hora). "Guardar no clone"
 * deixa a foto no clone como foto de expressão, com a mesma autorização.
 * Sem foto aqui, a função procura nas fotos de origem uma em que a pessoa
 * está sorrindo.
 */
function FotoDaExpressao({
  aberto,
  ids,
  onMudar,
  guardar,
  onGuardar,
  bloqueado,
}: {
  aberto: CloneAberto;
  ids: string[];
  onMudar: (ids: string[]) => void;
  guardar: boolean;
  onGuardar: (v: boolean) => void;
  bloqueado: boolean;
}) {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const fotos = useFotos(clientId);
  const todas = fotos.data || [];
  const [escolhendo, setEscolhendo] = useState(false);
  const [andamento, setAndamento] = useState<string | null>(null);
  const guardadas = aberto.fotos_de_expressao;
  const servem = todas.filter((f) => classeDaFoto(f) === "original" && !problemaDaFotoDeOrigem(f));
  const fotoDe = (id: string) => todas.find((x) => x.id === id) || guardadas.find((x) => x.id === id) || aberto.reais.find((x) => x.id === id) || null;
  const cheio = ids.length >= MAX_FOTOS_DA_EXPRESSAO;
  const novasParaGuardar = ids.filter((id) => !guardadas.some((g) => g.id === id));
  const somar = (novas: string[]) => {
    const saida = ids.slice();
    novas.forEach((id) => {
      if (saida.length < MAX_FOTOS_DA_EXPRESSAO && saida.indexOf(id) < 0) saida.push(id);
    });
    onMudar(saida);
  };
  const subir = async (arquivos: File[]) => {
    const vagas = MAX_FOTOS_DA_EXPRESSAO - ids.length;
    if (!arquivos.length || andamento || vagas <= 0) return;
    setAndamento("Subindo fotos");
    try {
      const res = await subirOriginais(clientId, arquivos.slice(0, vagas), (feitos, total) => setAndamento(feitos < total ? `Subindo ${feitos} de ${total}` : "Registrando"));
      acrescentarFotos(queryClient, clientId, res.registradas);
      invalidarFotos(queryClient, clientId);
      const boas = res.registradas.filter((f) => !problemaDaFotoDeOrigem(f));
      const ruim = res.registradas.find((f) => !!problemaDaFotoDeOrigem(f));
      if (ruim) toast.warning("Foto fora do padrão", { description: `${problemaDaFotoDeOrigem(ruim)} Ela ficou no acervo, mas não vai como expressão.` });
      if (boas.length) somar(boas.map((f) => f.id));
      setEscolhendo(false);
    } catch (e) {
      avisarErro(e, "Fotos não subiram");
    } finally {
      setAndamento(null);
    }
  };
  const tirarDoClone = async (id: string) => {
    try {
      await guardarFotosDeExpressaoDoClone(aberto.clone.id, [id], true);
      mudarCloneAberto(queryClient, aberto.clone.id, (a) => ({ ...a, fotos_de_expressao: a.fotos_de_expressao.filter((f) => f.id !== id) }));
      invalidarClone(queryClient, clientId, aberto.clone.id);
    } catch (e) {
      avisarErro(e, "Foto não saiu do clone");
    }
  };
  const miniatura = (id: string) => {
    const f = fotoDe(id);
    return f ? <MiniaturaDaFoto foto={f} selo={false} /> : <span className="block w-full rounded-lg bg-muted" style={{ paddingBottom: "100%" }} />;
  };

  return (
    <details className="mt-3 min-w-0" open={ids.length > 0 || undefined} data-foto-da-expressao="">
      <summary className="cursor-pointer text-[12px] font-medium text-muted-foreground">
        <Smile className="mr-1 inline h-3.5 w-3.5 align-[-2px]" aria-hidden="true" />
        Foto de referência da expressão{ids.length ? ` (${ids.length})` : " (opcional)"}
      </summary>
      <div className="mt-2 min-w-0">
        <p className={juntar(texto.auxiliar, "mb-1.5 flex items-center")}>
          Uma foto sua com a expressão pedida, até {MAX_FOTOS_DA_EXPRESSAO}.
          <AjudaRecolhida className="ml-1">
            Vai só nesta variação como a expressão real da pessoa: boca, dentes, gengiva, covinhas e como os olhos fecham ao sorrir. Não copia roupa, fundo nem luz. Sem foto aqui, a função procura nas fotos de origem uma em que você está sorrindo.
          </AjudaRecolhida>
        </p>
        <ul className="grid min-w-0 grid-cols-4 gap-1.5 sm:grid-cols-6" aria-label="Fotos da expressão desta variação">
          {ids.map((id) => (
            <li key={id} className="relative min-w-0" data-foto-da-expressao-escolhida={id}>
              {miniatura(id)}
              <button
                type="button"
                aria-label="Tirar a foto da expressão"
                title="Tirar desta variação"
                onClick={() => onMudar(ids.filter((x) => x !== id))}
                className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-md border border-border bg-card text-muted-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
          {!cheio && !bloqueado && (
            <li className="min-w-0">
              <button
                type="button"
                onClick={() => setEscolhendo((v) => !v)}
                aria-label="Adicionar foto da expressão"
                aria-expanded={escolhendo}
                className="relative block w-full rounded-lg border border-dashed border-primary/50 bg-card text-primary hover:bg-primary/5"
                style={{ paddingBottom: "100%" }}
              >
                <span className="absolute inset-0 flex flex-col items-center justify-center text-[10.5px]">
                  <Plus className="mb-0.5 h-4 w-4" /> foto
                </span>
              </button>
            </li>
          )}
        </ul>
        {guardadas.length > 0 && (
          <div className="mt-2 min-w-0" data-expressoes-guardadas="">
            <p className={juntar(texto.rotulo, "mb-1")}>Guardadas no clone</p>
            <ul className="grid min-w-0 grid-cols-4 gap-1.5 sm:grid-cols-6" aria-label="Fotos de expressão guardadas no clone">
              {guardadas.map((g) => {
                const usada = ids.indexOf(g.id) >= 0;
                return (
                  <li key={g.id} className="relative min-w-0" data-expressao-guardada={g.id}>
                    <button type="button" className={`block w-full rounded-lg ${usada ? "ring-2 ring-primary" : ""}`} onClick={() => (usada ? onMudar(ids.filter((x) => x !== g.id)) : somar([g.id]))} aria-pressed={usada} aria-label={`Usar nesta variação: ${g.nome}`} disabled={bloqueado || (!usada && cheio)}>
                      <MiniaturaDaFoto foto={g} selo={false} />
                    </button>
                    <button type="button" aria-label="Tirar do clone" title="Tirar do clone (a foto continua no acervo)" onClick={() => void tirarDoClone(g.id)} className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-md border border-border bg-card text-muted-foreground">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {escolhendo && !cheio && (
          <div className="mt-2 min-w-0" data-escolha-da-expressao="">
            <ZonaDeEnvio compacta onArquivos={(a) => void subir(a)} andamento={andamento} />
            <div className="mt-2">
              <SeletorDeFotos
                fotos={servem.filter((f) => ids.indexOf(f.id) < 0)}
                titulo="Foto sua com a expressão"
                filtroInicial="original"
                multiplas={MAX_FOTOS_DA_EXPRESSAO - ids.length > 1}
                jaEscolhidas={ids}
                onUsar={(escolhidas) => {
                  somar(escolhidas);
                  setEscolhendo(false);
                }}
                onFechar={() => setEscolhendo(false)}
              />
            </div>
          </div>
        )}
        {novasParaGuardar.length > 0 && (
          <label className="mt-2 flex min-w-0 items-center text-[12px]">
            <input type="checkbox" className="mr-1.5 h-3.5 w-3.5 shrink-0" checked={guardar} onChange={(e) => onGuardar(e.target.checked)} disabled={bloqueado} />
            <span className="min-w-0">Guardar no clone como foto de expressão</span>
          </label>
        )}
      </div>
    </details>
  );
}

function Variacoes({ aberto }: { aberto: CloneAberto }) {
  const { clientId, atualizarCusto } = useMesa();
  const idDoClone = aberto.clone.id;
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const andamentos = useAndamentos();
  const { baixar, baixando } = useAcoesDeUso();
  const c = aberto.clone;
  const bloqueado = !c.autorizacao_valida.ok || c.status === "arquivada";
  // O modo (sub-aba) e o pedido escrito ficam lembrados por clone: sair e voltar não perde.
  const [modo, setModo] = useEstadoDaTela<ModoDaVariacao>(`mesa-foto:clones:modo:${idDoClone}`, "prontas", { validar: ehModoDaVariacao });
  const [pedido, setPedido] = useEstadoDaTela<PedidoDaVariacao>(`mesa-foto:clones:pedido:${idDoClone}`, PEDIDO_VAZIO, { validar: ehPedidoDaVariacao, esperaMs: 300 });
  // Foto de referência da expressão (26/09): lembrada por clone, como o pedido.
  const [fotosDaExpressao, setFotosDaExpressao] = useEstadoDaTela<string[]>(`mesa-foto:clones:expressao:${idDoClone}`, [], { validar: ehListaDeIds });
  const [guardarExpressao, setGuardarExpressao] = useState(false);

  const [sugestoes, setSugestoes] = useState<SugestaoDoClone[] | null>(null);
  const [marcadasSug, setMarcadasSug] = useState<number[]>([]);
  const [formato, setFormato] = useState("4:5");
  const [quantidade, setQuantidade] = useState(2);
  const [qualidade, setQualidade] = useState<Qualidade>("alta");
  const [conferencias, setConferencias] = useState<Record<string, ConferenciaDoClone | null>>({});
  const [ampliada, setAmpliada] = useState<number | null>(null);
  const [aberta, setAberta] = useState<string | null>(null);
  const [escolhidas, setEscolhidas] = useState<string[]>([]);
  // As variações marcadas vão ao diretor de fotografia (ele trabalha nelas sem o dono reenviar).
  useSelecaoParaODiretor(clientId, "clones", escolhidas);
  const motor = aberto.motores.find((m) => m.modelo_imagem_id === c.motor_preferido_id) || aberto.motores.find((m) => m.padrao) || null;
  // Identidade que vai em cada variação: a foto real principal e TODAS as vistas aprovadas (até 8).
  const refs = Math.min(8, 1 + aberto.folha.aprovadas + (modo === "uniforme" ? 1 : 0) + fotosDaExpressao.length);
  const presets = aberto.presets.filter((p) => p.id !== PRESET_UNIFORME);
  const uniforme = aberto.presets.find((p) => p.id === PRESET_UNIFORME) || null;
  const chavesDoClone = Object.keys(andamentos).filter((k) => k.indexOf(`${c.id}|clone-variacao|`) === 0);
  const gerando = chavesDoClone.filter((k) => andamentos[k].estado === "gerando").length;
  const falhas = chavesDoClone.filter((k) => andamentos[k].estado === "falhou").map((k) => andamentos[k].erro);

  // O lote que sai do botão: uma foto por sugestão marcada, ou N do pedido escrito.
  const itensDoLote: ItemDoLote[] =
    modo === "contexto"
      ? marcadasSug.filter((i) => !!(sugestoes && sugestoes[i])).map((i) => ({ pedido: pedidoDaSugestao(sugestoes![i], pedido.livre), rotulo: sugestoes![i].rotulo }))
      : Array.from({ length: quantidade }, () => ({ pedido: modo === "uniforme" ? { ...pedido, preset: PRESET_UNIFORME } : pedido, rotulo: modo === "uniforme" ? "Uniforme" : "Variação" }));
  const pedidoVazio = !pedido.preset && !pedido.roupa.trim() && !pedido.cenario.trim() && !pedido.pose.trim() && !pedido.expressao.trim() && !pedido.livre.trim();
  const vazio = modo === "contexto" ? itensDoLote.length === 0 : modo === "uniforme" ? false : pedidoVazio;
  const servidor = usePrecoNoServidor(clientId, "clone_variacao", { modelo_id: c.id, quantidade: Math.max(1, itensDoLote.length) }, !bloqueado);

  const trocarModo = (m: ModoDaVariacao) => {
    setModo(m);
    if (m === "uniforme" && uniforme) setPedido({ preset: PRESET_UNIFORME, roupa: "", cenario: "", pose: "", expressao: "", livre: pedido.livre });
    else if (m !== "uniforme" && pedido.preset === PRESET_UNIFORME) setPedido({ ...PEDIDO_VAZIO, livre: pedido.livre });
  };
  const escolherPreset = (id: string) => {
    const p = aberto.presets.find((x) => x.id === id);
    if (!p) return;
    setPedido({ preset: p.id, roupa: p.roupa, cenario: p.cenario, pose: p.pose, expressao: p.expressao, livre: pedido.livre });
  };
  const variacaoAberta = aberta ? aberto.variacoes.find((v) => v.id === aberta) || null : null;
  const mudouVariacao = (f: FotoDoAcervo) => guardarVariacaoDoClone(queryClient, c.id, f);
  const marcar = (id: string) => setEscolhidas((l) => (l.indexOf(id) >= 0 ? l.filter((x) => x !== id) : l.concat([id])));
  const selecionadas = aberto.variacoes.filter((v) => escolhidas.indexOf(v.id) >= 0);
  // "Gerar de novo" de uma variação que não ficou parecida: o mesmo pedido, escolhendo as fotos de origem.
  const [refazendo, setRefazendo] = useState<FotoDoAcervo | null>(null);
  const refazer = (foto: FotoDoAcervo, fotos: string[] | null) => {
    void rodarRefazerVariacao({ queryClient, clientId, cloneId: c.id, foto, qualidade, fotos, atualizar: atualizarCusto });
    return Promise.resolve({});
  };
  /** Apagar = tirar do acervo (inativa), na hora e com desfazer; o arquivo fica. */
  const restaurarVariacao = async (f: FotoDoAcervo) => {
    moverVariacaoNoCache(queryClient, c.id, f.id, false);
    try {
      await arquivarImagemDoClone(c.id, f.id, "acervo", true);
      invalidarClone(queryClient, clientId, c.id);
      invalidarFotos(queryClient, clientId);
    } catch (e) {
      moverVariacaoNoCache(queryClient, c.id, f.id, true);
      avisarErro(e, "Variação não restaurada");
    }
  };
  const apagarVariacao = async (f: FotoDoAcervo) => {
    if (aberta === f.id) setAberta(null);
    setEscolhidas((l) => l.filter((x) => x !== f.id));
    moverVariacaoNoCache(queryClient, c.id, f.id, true);
    try {
      await arquivarImagemDoClone(c.id, f.id, "acervo");
      invalidarClone(queryClient, clientId, c.id);
      invalidarFotos(queryClient, clientId);
      toast.success("Variação apagada", { description: "Saiu do acervo e fica em Apagadas. Dá para restaurar.", action: { label: "Desfazer", onClick: () => void restaurarVariacao(f) } });
    } catch (e) {
      moverVariacaoNoCache(queryClient, c.id, f.id, false);
      avisarErro(e, "Variação não apagada");
    }
  };
  const menuDaVariacao = (f: FotoDoAcervo): ItemDoMenu[] => [
    { rotulo: "Gerar de novo (escolher as fotos)", icone: <RefreshCw className="h-3.5 w-3.5" />, acao: () => setRefazendo(f), desativado: bloqueado },
    { rotulo: "Apagar esta variação", icone: <Trash2 className="h-3.5 w-3.5" />, acao: () => void apagarVariacao(f), perigo: true },
  ];

  return (
    <Secao
      className="border-t border-border pt-5 min-[1600px]:border-t-0 min-[1600px]:pt-0"
      titulo="Variações"
      descricao={`${aberto.variacoes.length} ${aberto.variacoes.length === 1 ? "pronta" : "prontas"}`}
      ajuda={
        aberto.folha.aprovadas
          ? `Mesmo rosto em outra roupa, cenário, pose ou expressão. Cada variação leva a foto real e as ${aberto.folha.aprovadas} ${aberto.folha.aprovadas === 1 ? "vista aprovada" : "vistas aprovadas"} da folha, com os traços repetidos no pedido.`
          : "Dá para gerar já com as fotos reais; com a folha aprovada o rosto fica mais estável (as vistas aprovadas vão em toda variação)."
      }
      data-variacoes-do-clone=""
    >
      {/* 1. O que muda: sub-aba de 4 (segmentado); a explicação de cada uma no "?". */}
      <div className="min-w-0" data-plano-da-variacao="">
        <div className="mb-2 flex min-w-0 items-center">
          <SeletorCompacto rotulo="Como montar a variação" opcoes={MODOS_DA_VARIACAO.map((m) => ({ valor: m.valor, rotulo: m.rotulo }))} valor={modo} onEscolher={(v) => trocarModo(v as ModoDaVariacao)} className="min-w-0 flex-1 sm:flex-none" larguraTotal />
          <AjudaRecolhida className="ml-1.5">
            {MODOS_DA_VARIACAO.map((m) => (
              <span key={m.valor} className="block">
                <strong className="text-foreground">{m.rotulo}:</strong> {m.dica}
              </span>
            ))}
          </AjudaRecolhida>
        </div>
        <div className={juntar(superficie.poco, "min-w-0 p-3")}>
          {modo === "prontas" && (
            <>
              <Pilulas rotulo="Variação pronta" opcoes={presets.map((p) => ({ valor: p.id, rotulo: p.rotulo }))} valor={pedido.preset} onEscolher={escolherPreset} />
              <CamposDoPedido pedido={pedido} onMudar={setPedido} aberto={false} />
            </>
          )}
          {modo === "contexto" && (
            <PeloContexto
              clone={c}
              sugestoes={sugestoes}
              marcadas={marcadasSug}
              onMarcar={(i) => setMarcadasSug((l) => (l.indexOf(i) >= 0 ? l.filter((x) => x !== i) : l.concat([i])))}
              onSugestoes={(s) => {
                setSugestoes(s);
                setMarcadasSug(s.map((_x, i) => i).slice(0, 2));
              }}
            />
          )}
          {modo === "uniforme" && (
            <div className="min-w-0" data-uniforme-da-marca="">
              <p className="flex items-start text-[13px] leading-5">
                <Shirt className="mr-1.5 mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                <span className="min-w-0">
                  Com a <strong>logo oficial do kit da marca</strong>, aplicada sem redesenhar.
                </span>
                <AjudaRecolhida className="ml-1">Uniforme profissional nas cores da marca, com a logo oficial do kit anexada ao gerador. Sem logo no kit, a função avisa antes de gastar. Confira a logo em cada foto antes de aprovar.</AjudaRecolhida>
              </p>
              {!uniforme && <p className="mt-1 text-[12px] text-warning">A função ainda não oferece o uniforme (publique a versão nova da função mesa-foto).</p>}
              <CamposDoPedido pedido={pedido} onMudar={setPedido} aberto={false} />
            </div>
          )}
          {modo === "livre" && <CamposDoPedido pedido={pedido} onMudar={setPedido} aberto />}
        </div>
        <FotoDaExpressao aberto={aberto} ids={fotosDaExpressao} onMudar={setFotosDaExpressao} guardar={guardarExpressao} onGuardar={setGuardarExpressao} bloqueado={bloqueado} />
      </div>

      {/* 2. Formato, quantidade, qualidade */}
      <GrupoDeCampos colunas={3} className="mt-4">
        <CampoDeEscolha rotulo="Formato">
          <Pilulas rotulo="Formato da variação" opcoes={FORMATOS_DO_CLONE.map((f) => ({ valor: f, rotulo: f }))} valor={formato} onEscolher={setFormato} />
        </CampoDeEscolha>
        {modo !== "contexto" && (
          <CampoDeEscolha rotulo="Quantas">
            <Pilulas rotulo="Quantidade de variações" opcoes={[1, 2, 4].map((n) => ({ valor: n, rotulo: String(n) }))} valor={quantidade} onEscolher={setQuantidade} />
          </CampoDeEscolha>
        )}
        <SeletorDeQualidade valor={qualidade} onChange={setQualidade} disabled={bloqueado} />
      </GrupoDeCampos>

      {/* 3. Gerar (custo antes) */}
      <BarraDeAcoes
        className="mt-3 border-t border-border pt-3"
        inicio={
          gerando > 0 ? (
            <span className="inline-flex items-center" role="status">
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> gerando {gerando}
            </span>
          ) : null
        }
      >
        <BotaoComCusto
          rotulo={
            <>
              <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Gerar {itensDoLote.length} {itensDoLote.length === 1 ? "variação" : "variações"}
            </>
          }
          titulo="Variações do clone"
          descricao={`Uma foto por chamada, ${motor ? motor.rotulo : "gerador do clone"}. Aparece aqui assim que sai; fica salva mesmo se você sair da aba.${typeof servidor.data === "number" ? ` Pela função: ~${usd(servidor.data)}.` : ""}`}
          className="h-9 text-[13px]"
          disabled={bloqueado || vazio || gerando > 0 || itensDoLote.length === 0}
          fecharAoConfirmar
          partes={() => partesDoClone(motor ? motor.modelo_imagem_id : null, qualidade, refs, Math.max(1, itensDoLote.length))}
          executar={() => {
            const expressao = fotosDaExpressao.length ? { ids: fotosDaExpressao, guardar: guardarExpressao } : null;
            void rodarVariacoes({ queryClient, clientId, cloneId: c.id, itens: itensDoLote, formato, qualidade, atualizar: atualizarCusto, expressao });
            // Guardar no clone vale uma vez (a próxima rodada já acha a foto guardada).
            if (guardarExpressao) setGuardarExpressao(false);
            return Promise.resolve({});
          }}
        />
      </BarraDeAcoes>
      {falhas.slice(0, 2).map((e, i) => (
        <p key={`${i}-${e}`} className="text-[12px] text-destructive [overflow-wrap:anywhere]" role="alert">
          {e}
        </p>
      ))}

      {/* Resultados */}
      {(aberto.variacoes.length > 0 || gerando > 0) && (
        <div className="mt-4 min-w-0 border-t border-border pt-3" data-resultados-do-clone="">
          <div className="mb-2 flex min-w-0 flex-wrap items-center text-[12px]">
            <span className="mr-2 font-medium">{aberto.variacoes.length} prontas</span>
            <button
              type="button"
              className={juntar("mr-2 rounded text-primary hover:underline", foco)}
              onClick={() => setEscolhidas(escolhidas.length === aberto.variacoes.length ? [] : aberto.variacoes.map((v) => v.id))}
            >
              {escolhidas.length === aberto.variacoes.length && escolhidas.length > 0 ? "Desmarcar todas" : "Marcar todas"}
            </button>
            {selecionadas.length > 0 && (
              <Button type="button" size="sm" variant="outline" className="ml-auto h-8 text-[12px]" disabled={!!baixando} onClick={() => void baixar(selecionadas)} title="Uma a uma, sem ZIP, no tamanho original">
                {baixando ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Download className="mr-1 h-3 w-3" />}
                {baixando ? `Baixando ${baixando.feitos} de ${baixando.total}` : `Baixar ${selecionadas.length} (sem ZIP)`}
              </Button>
            )}
          </div>
          {variacaoAberta && (
            <VariacaoAberta
              key={variacaoAberta.id}
              foto={variacaoAberta}
              clone={c}
              onFechar={() => setAberta(null)}
              onMudou={mudouVariacao}
              onRefazer={bloqueado ? null : () => setRefazendo(variacaoAberta)}
              onApagar={() => void apagarVariacao(variacaoAberta)}
            />
          )}
          <ul className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3" aria-label="Variações do clone">
            {Array.from({ length: gerando }, (_x, i) => (
              <li key={`gerando-${i}`} className="min-w-0 rounded-lg border border-dashed border-primary/40 p-1" data-variacao-gerando="">
                <Moldura proporcao={1} className="animate-pulse">
                  <span className="flex h-full w-full flex-col items-center justify-center text-[11px] text-muted-foreground">
                    <Loader2 className="mb-1 h-4 w-4 animate-spin text-primary" /> gerando
                  </span>
                </Moldura>
              </li>
            ))}
            {aberto.variacoes.map((f: FotoDoAcervo, i: number) => {
              const conf = conferencias[f.id] !== undefined ? conferencias[f.id] : null;
              const marcada = escolhidas.indexOf(f.id) >= 0;
              return (
                <li key={f.id} className={`relative min-w-0 rounded-lg border p-1 ${aberta === f.id ? "border-primary" : marcada ? "border-primary/60" : "border-transparent"}`} data-variacao-do-clone={f.id}>
                  <div className="relative">
                    <button type="button" className="block w-full" onClick={() => setAberta(f.id)} aria-label={`Abrir: ${f.nome}`}>
                      <MiniaturaDaFoto foto={f} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setAmpliada(i)}
                      aria-label={`Ver grande: ${f.nome}`}
                      className="absolute bottom-1 right-1 flex h-5 w-5 items-center justify-center rounded-md border border-border bg-card text-muted-foreground shadow-sm hover:text-foreground"
                    >
                      <Maximize2 className="h-3 w-3" />
                    </button>
                  </div>
                  <label className="absolute right-1.5 top-1.5 flex h-5 w-5 cursor-pointer items-center justify-center rounded-md border border-border bg-card shadow-sm">
                    <input type="checkbox" checked={marcada} onChange={() => marcar(f.id)} className="h-3.5 w-3.5 accent-[hsl(var(--primary))]" aria-label={`Marcar ${f.nome}`} />
                  </label>
                  <div className="mt-1 flex min-w-0 flex-wrap items-center">
                    <AprovarFoto foto={f} onMudou={mudouVariacao} />
                    <BotaoConferirClone cloneId={c.id} imagemId={f.id} origem="acervo" onConferencia={(x) => setConferencias({ ...conferencias, [f.id]: x })} />
                    <MenuDeUso foto={f} icone className="mb-1 ml-auto" />
                    <MenuDoItem rotulo={`Mais opções: ${f.nome}`} itens={menuDaVariacao(f)} className="mb-1" />
                  </div>
                  {conf && <NotasDaSemelhanca c={conf} />}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {aberto.variacoes_arquivadas.length > 0 && (
        <details className="mt-4 min-w-0 border-t border-border pt-3" data-variacoes-apagadas="">
          <summary className="cursor-pointer text-[12px] font-medium text-muted-foreground">Apagadas ({aberto.variacoes_arquivadas.length})</summary>
          <ul className="mt-2 grid min-w-0 grid-cols-3 gap-2 pb-1 sm:grid-cols-4">
            {aberto.variacoes_arquivadas.map((f) => (
              <li key={f.id} className="min-w-0" data-variacao-apagada={f.id}>
                <MiniaturaDaFoto foto={f} />
                <Button type="button" size="sm" variant="ghost" className="h-7 w-full px-1 text-[11px]" onClick={() => void restaurarVariacao(f)} aria-label={`Restaurar ${f.nome}`}>
                  <RotateCcw className="mr-1 h-3 w-3" /> Restaurar
                </Button>
              </li>
            ))}
          </ul>
        </details>
      )}
      {refazendo && (
        <DialogoDeFotosDaGeracao
          titulo="Gerar de novo esta variação"
          reais={aberto.reais}
          onFechar={() => setRefazendo(null)}
          partes={(n) => partesDoClone(motor ? motor.modelo_imagem_id : null, qualidade, Math.min(8, n + aberto.folha.aprovadas))}
          executar={(fotos) => refazer(refazendo, fotos)}
        />
      )}
      <Ampliar
        imagens={aberto.variacoes.map((f) => ({ caminho: f.storage_path, bucket: f.storage_bucket || "mesa", titulo: f.nome, legenda: "Pessoa real recriada por IA com autorização. Ao publicar, ligue o rótulo de IA.", proporcao: f.largura && f.altura ? f.largura / f.altura : undefined }))}
        indice={ampliada}
        onFechar={() => setAmpliada(null)}
      />
    </Secao>
  );
}


/**
 * Transferir o clone para outro cliente (pedido do dono, 26/09: "criei na
 * Stop por engano, era da Verzelo"). Só aparece para quem abre; a lista é a
 * dos clientes que a pessoa acessa (a função confere de novo os dois).
 */
function DialogoDeTransferir({ clone, aberto, onFechar }: { clone: Clone; aberto: boolean; onFechar: () => void }) {
  const { clientId, clientName } = useMesa();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const avisarErro = useAvisarErro();
  const clientes = useClients();
  const [destino, setDestino] = useState("");
  const [transferindo, setTransferindo] = useState(false);
  const lista = ((clientes.data || []) as any[])
    .map((x) => ({ id: String(x.id), nome: String(x.company_name || x.full_name || "Cliente") }))
    .filter((x) => x.id !== clientId)
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  const nomeDoDestino = (lista.find((x) => x.id === destino) || { nome: "" }).nome;
  const transferir = async () => {
    if (!destino || transferindo) return;
    setTransferindo(true);
    try {
      const r = await transferirClone(clone.id, destino);
      tirarCloneDaLista(queryClient, clientId, clone.id);
      invalidarClone(queryClient, clientId, clone.id);
      invalidarClone(queryClient, destino);
      invalidarFotos(queryClient, clientId);
      invalidarFotos(queryClient, destino);
      const res = r.resumo;
      toast.success(`${clone.nome} agora é de ${nomeDoDestino}`, {
        description: `${res ? `${res.movidas + res.copiadas + res.reaproveitadas} fotos do acervo e ${res.folha} da folha foram junto. ` : ""}${r.avisos.join(" ")}`,
        duration: 12000,
        action: { label: "Abrir lá", onClick: () => navigate(`/mesa-foto?client=${destino}&etapa=clones`) },
      });
      onFechar();
    } catch (e) {
      avisarErro(e, "Clone não transferido");
    } finally {
      setTransferindo(false);
    }
  };
  return (
    <Dialog open={aberto} onOpenChange={(v) => (!v ? onFechar() : undefined)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Transferir {clone.nome} para outro cliente</DialogTitle>
          <DialogDescription>
            Vai tudo junto: o clone, a folha de identidade, as fotos reais e as variações do acervo, com os arquivos. O clone sai de {clientName || "este cliente"}.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Select value={destino} onValueChange={setDestino}>
            <SelectTrigger className="h-9 text-[12.5px]" aria-label="Cliente de destino">
              <SelectValue placeholder={clientes.isLoading ? "Carregando clientes" : "Escolha o cliente certo"} />
            </SelectTrigger>
            <SelectContent>
              {lista.map((x) => (
                <SelectItem key={x.id} value={x.id}>
                  {x.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <ul className="space-y-1 text-[12px] leading-snug text-muted-foreground">
            <li>O custo e o uso de IA já cobrados continuam no cliente antigo (não voltam nem mudam de carteira).</li>
            <li>Foto que outra coisa do cliente antigo usa (kit, Canvas, outro clone) fica lá e entra uma cópia no novo.</li>
            <li>A autorização de uso de imagem vai junto; confira se ela vale para o cliente novo.</li>
          </ul>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onFechar} disabled={transferindo}>
            Cancelar
          </Button>
          <Button type="button" onClick={() => void transferir()} disabled={!destino || transferindo}>
            {transferindo ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <ArrowRightLeft className="mr-1.5 h-3.5 w-3.5" />}
            {destino ? `Transferir para ${nomeDoDestino}` : "Transferir"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Fotos de origem do clone aberto, editáveis a qualquer momento (pedido do
 * dono, 25/09 à noite). As mudanças ficam na tela até "Salvar fotos": dá
 * para tirar uma e pôr outra (trocar) mesmo com 4. Ao salvar, a folha fica
 * guardada e as vistas feitas com as fotos antigas ficam marcadas.
 */
function FaixaDeFotosDeOrigem({ aberto }: { aberto: CloneAberto }) {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const fotos = useFotos(clientId);
  const c = aberto.clone;
  const bloqueado = !c.autorizacao_valida.ok || c.status === "arquivada";
  const assinatura = c.identidade_real.map((r) => `${r.imagem_id}${r.principal ? "*" : ""}`).join(",");
  const [r, setR] = useState<FotosDeOrigem>(() => fotosDeOrigemDoClone(c));
  const [salvando, setSalvando] = useState(false);
  // O servidor mudou as fotos (salvar, outra aba, transferência): a tela segue.
  useEffect(() => {
    setR(fotosDeOrigemDoClone(c));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assinatura]);
  const m = mudancaNasFotos(c, r);
  const salvar = async () => {
    if (salvando || !r.ids.length) return;
    setSalvando(true);
    try {
      const res = await editarFotosDoClone(c.id, r);
      if (res.clone) {
        const conhecidas = (fotos.data || []).concat(aberto.reais);
        const principal = r.principal || r.ids[0];
        const reais = r.ids
          .map((id) => {
            const f = conhecidas.find((x) => x.id === id);
            return f ? { ...f, principal: id === principal } : null;
          })
          .filter(Boolean) as (FotoDoAcervo & { principal: boolean })[];
        marcarFotosNovas(queryClient, res.clone, res.desatualizadas, reais);
        guardarCloneNaLista(queryClient, clientId, res.clone);
      }
      invalidarClone(queryClient, clientId, c.id);
      const n = res.desatualizadas.length;
      toast.success("Fotos de origem salvas", {
        description: n ? `${n === 1 ? "1 vista ficou marcada" : `${n} vistas ficaram marcadas`} "fotos antigas". Gere de novo quando quiser (o custo aparece antes).` : "A folha continua valendo.",
      });
    } catch (e) {
      avisarErro(e, "Fotos não salvas");
    } finally {
      setSalvando(false);
    }
  };
  return (
    <div className="mt-4 min-w-0" data-fotos-de-origem="">
      <div className="mb-1.5 flex min-w-0 items-center">
        <span className={texto.rotulo}>
          Fotos de origem · {r.ids.length} de {MAX_FOTOS_DO_CLONE}
        </span>
        <AjudaRecolhida className="ml-1">A verdade sobre o rosto.{bloqueado ? "" : " O x tira, a seta troca, o + põe mais e a estrela marca a principal. As mudanças só valem depois de Salvar fotos."}</AjudaRecolhida>
      </div>
      <EditorDeFotosDeOrigem modo="faixa" ids={r.ids} principal={r.principal} onMudar={(ids, principal) => setR({ ids, principal })} bloqueado={bloqueado || salvando} conhecidas={aberto.reais} />
      {m.alguma && (
        <div className="mt-2 flex min-w-0 flex-wrap items-center rounded-lg border border-primary/40 bg-primary/5 p-2.5" role="status" data-fotos-mudadas="">
          <p className="mb-1 mr-auto min-w-0 text-[12px] leading-snug [overflow-wrap:anywhere]">
            {[m.entraram.length ? `${m.entraram.length} ${m.entraram.length === 1 ? "entra" : "entram"}` : "", m.sairam.length ? `${m.sairam.length} ${m.sairam.length === 1 ? "sai" : "saem"}` : "", m.principal ? "principal nova" : ""].filter(Boolean).join(", ")}.
            {m.entraram.length || m.sairam.length ? " A folha fica guardada; as vistas feitas com as fotos antigas ficam marcadas." : ""}
          </p>
          <Button type="button" size="sm" className="mb-1 mr-1.5 h-8 text-[12px]" disabled={salvando} onClick={() => void salvar()}>
            {salvando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1.5 h-3.5 w-3.5" />} Salvar fotos
          </Button>
          <Button type="button" size="sm" variant="ghost" className="mb-1 h-8 text-[12px]" disabled={salvando} onClick={() => setR(fotosDeOrigemDoClone(c))}>
            Descartar
          </Button>
        </div>
      )}
    </div>
  );
}

/** Apagar o clone = arquivar: some das listas e dos seletores; as fotos da pessoa ficam; dá para restaurar. */
function DialogoDeApagarClone({ clone, onFechar, onApagado }: { clone: Clone; onFechar: () => void; onApagado: (id: string) => void }) {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const [apagando, setApagando] = useState(false);
  const restaurar = async () => {
    try {
      const c = await editarClone(clone.id, { arquivar: false });
      if (c) guardarCloneNaLista(queryClient, clientId, c);
      invalidarClone(queryClient, clientId, clone.id);
      toast.success(`${clone.nome} voltou`);
    } catch (e) {
      avisarErro(e, "Clone não restaurado");
    }
  };
  const apagar = async () => {
    if (apagando) return;
    setApagando(true);
    try {
      await editarClone(clone.id, { arquivar: true });
      tirarCloneDaLista(queryClient, clientId, clone.id);
      invalidarClone(queryClient, clientId, clone.id);
      onApagado(clone.id);
      toast.success(`Clone de ${clone.nome} apagado`, { description: "Está em Arquivados, abaixo da lista. Dá para restaurar.", duration: 10000, action: { label: "Desfazer", onClick: () => void restaurar() } });
      onFechar();
    } catch (e) {
      avisarErro(e, "Clone não apagado");
    } finally {
      setApagando(false);
    }
  };
  return (
    <Dialog open onOpenChange={(v) => (!v ? onFechar() : undefined)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Apagar o clone de {clone.nome}?</DialogTitle>
          <DialogDescription>O clone sai da lista e dos seletores das mesas (Book e as outras). Nada é excluído de vez.</DialogDescription>
        </DialogHeader>
        <ul className="space-y-1 text-[12px] leading-snug text-muted-foreground">
          <li>As fotos originais de {clone.nome} continuam no acervo do cliente.</li>
          <li>A folha e as variações ficam guardadas; as variações já aprovadas continuam no acervo.</li>
          <li>Para voltar, abra Arquivados (abaixo da lista de clones) e clique em Restaurar.</li>
        </ul>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onFechar} disabled={apagando}>
            Cancelar
          </Button>
          <Button type="button" variant="destructive" onClick={() => void apagar()} disabled={apagando}>
            {apagando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Archive className="mr-1.5 h-3.5 w-3.5" />} Apagar {clone.nome}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Duplicar (clonar o clone): outro visual da MESMA pessoa, com as mesmas fotos de origem e a mesma autorização. */
function DialogoDeDuplicar({ clone, onFechar, onAbrir }: { clone: Clone; onFechar: () => void; onAbrir: (c: Clone) => void }) {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const [nome, setNome] = useState(() => nomeDaCopiaDoClone(clone.nome));
  const [levarFolha, setLevarFolha] = useState(true);
  const [duplicando, setDuplicando] = useState(false);
  const a = clone.autorizacao;
  const duplicar = async () => {
    if (duplicando || !nome.trim()) return;
    setDuplicando(true);
    try {
      const r = await duplicarClone(clone.id, nome, levarFolha);
      if (!r.clone) throw new Error("A função não devolveu o clone duplicado.");
      guardarCloneNaLista(queryClient, clientId, r.clone);
      toast.success(`${r.clone.nome} criado`, { description: `${r.copiadas ? `${r.copiadas} ${r.copiadas === 1 ? "vista aprovada foi" : "vistas aprovadas foram"} junto. ` : ""}${r.avisos.join(" ")}` });
      onAbrir(r.clone);
      onFechar();
    } catch (e) {
      avisarErro(e, "Clone não duplicado");
    } finally {
      setDuplicando(false);
    }
  };
  return (
    <Dialog open onOpenChange={(v) => (!v ? onFechar() : undefined)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Duplicar {clone.nome}</DialogTitle>
          <DialogDescription>Um clone novo da mesma pessoa (por exemplo, outro visual), com as mesmas fotos de origem. Sem custo.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <CampoDeFormulario rotulo="Nome do clone novo">
            <Input value={nome} onChange={(e) => setNome(e.target.value)} aria-label="Nome do clone duplicado" className="h-9 text-[13px]" />
          </CampoDeFormulario>

          <label className="flex min-w-0 items-start text-[12px] leading-snug">
            <input type="checkbox" className="mr-2 mt-0.5 h-4 w-4 shrink-0" checked={levarFolha} onChange={(e) => setLevarFolha(e.target.checked)} aria-label="Levar as vistas aprovadas" />
            <span className="min-w-0">Levar as vistas aprovadas da folha (cópia dos arquivos, sem gerar de novo).</span>
          </label>
          <p className="flex items-start text-[11.5px] leading-snug text-muted-foreground">
            <ShieldCheck className="mr-1.5 mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            <span className="min-w-0 [overflow-wrap:anywhere]">{a ? `Vale a mesma autorização de ${a.quem} (${a.data}): ${a.finalidade}. A função confere de novo antes de criar.` : "Sem autorização registrada: não dá para duplicar."}</span>
          </p>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onFechar} disabled={duplicando}>
            Cancelar
          </Button>
          <Button type="button" onClick={() => void duplicar()} disabled={duplicando || !nome.trim() || !clone.autorizacao_valida.ok}>
            {duplicando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <CopyPlus className="mr-1.5 h-3.5 w-3.5" />} Duplicar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CabecalhoDoClone({ aberto, onAbrir, onApagado }: { aberto: CloneAberto; onAbrir: (c: Clone) => void; onApagado: (id: string) => void }) {
  const avisarErro = useAvisarErro();
  const { irPara } = useMesaFoto();
  const [ocupado, setOcupado] = useState(false);
  const [dialogo, setDialogo] = useState<"transferir" | "apagar" | "duplicar" | null>(null);
  const c = aberto.clone;
  const st = statusDoClone(c.status);
  const a = c.autorizacao;
  const copiarPacote = async () => {
    setOcupado(true);
    try {
      const pacote = await pacoteDoClone(c.id);
      const txt = JSON.stringify(pacote, null, 2);
      if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") await navigator.clipboard.writeText(txt);
      toast.success("Pacote do clone copiado", { description: "Formato aceleriq.clone.v1, pronto para a mesa de vídeo (links valem 1 hora)." });
    } catch (e) {
      avisarErro(e, "Pacote não copiado");
    } finally {
      setOcupado(false);
    }
  };
  const autorizacao = a ? `Autorizado por ${a.quem} em ${a.data}: ${a.finalidade}.` : "Sem autorização registrada.";
  return (
    <div className="min-w-0" data-clone-aberto={c.id}>
      {/* Nome e selos à esquerda; as ações na mesma linha (no celular, só o ícone). */}
      <div className="flex min-w-0 items-start">
        <div className="mr-3 min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center">
            <h2 className={juntar(texto.tituloPagina, "mr-2 min-w-0 truncate text-[18px]")}>{c.nome}</h2>
            <span className={`mr-1.5 rounded-full px-1.5 py-px text-[11px] font-medium ${st.cor}`}>{st.rotulo}</span>
            <span className="inline-flex items-center rounded-full border border-primary/30 px-1.5 py-px text-[11px] font-semibold text-primary">
              <ShieldCheck className="mr-0.5 h-2.5 w-2.5" aria-hidden="true" /> pessoa real autorizada
            </span>
            <AjudaRecolhida className="ml-1" titulo="Pessoa real, com autorização">
              {autorizacao}
              {c.invariantes.length ? ` Não muda: ${c.invariantes.join("; ")}.` : ""} Pessoa real recriada por IA com autorização. Ao publicar, ligue o rótulo de IA; em anúncio, declare o conteúdo fotorrealista gerado. Se a pessoa revogar, apague o clone.
            </AjudaRecolhida>
          </div>
          <p className={juntar(texto.auxiliar, "mt-0.5 truncate")} title={autorizacao}>
            {autorizacao}
          </p>
          {!c.autorizacao_valida.ok && <p className="mt-0.5 text-[12px] font-medium text-warning [overflow-wrap:anywhere]">{c.autorizacao_valida.motivo || "Autorização inválida: nada novo pode ser gerado."}</p>}
        </div>
        <div className="flex shrink-0 items-center [&>*+*]:ml-1.5">
          <button
            type="button"
            className={juntar(botao.secundario, "h-8 px-2 text-[12px] sm:px-3")}
            disabled={ocupado || !c.autorizacao_valida.ok}
            onClick={() => setDialogo("duplicar")}
            title="Outro clone da mesma pessoa (outro visual), com as mesmas fotos e a mesma autorização"
            aria-label="Duplicar"
          >
            <CopyPlus className="h-3.5 w-3.5 sm:mr-1.5" aria-hidden="true" />
            <span className="hidden sm:inline">Duplicar</span>
          </button>
          <button
            type="button"
            className={juntar(botao.secundario, "h-8 px-2 text-[12px] sm:px-3")}
            disabled={ocupado}
            onClick={() => setDialogo("transferir")}
            title="Mover o clone, a folha e as fotos para o cliente certo"
            aria-label="Transferir para outro cliente"
          >
            <ArrowRightLeft className="h-3.5 w-3.5 sm:mr-1.5" aria-hidden="true" />
            <span className="hidden sm:inline">Transferir</span>
          </button>
          <MenuDoItem
            rotulo={`Mais opções do clone ${c.nome}`}
            itens={[
              { rotulo: "Usar no Book", icone: <BookOpen className="h-3.5 w-3.5" />, acao: () => irPara("book"), desativado: c.status === "arquivada" },
              { rotulo: "Pacote para vídeo", icone: <Copy className="h-3.5 w-3.5" />, acao: () => void copiarPacote(), desativado: ocupado },
              { rotulo: "Apagar o clone", icone: <Trash2 className="h-3.5 w-3.5" />, acao: () => setDialogo("apagar"), perigo: true, desativado: c.status === "arquivada" },
            ]}
          />
        </div>
      </div>
      <FaixaDeFotosDeOrigem aberto={aberto} />
      {dialogo === "transferir" && <DialogoDeTransferir clone={c} aberto onFechar={() => setDialogo(null)} />}
      {dialogo === "apagar" && <DialogoDeApagarClone clone={c} onFechar={() => setDialogo(null)} onApagado={onApagado} />}
      {dialogo === "duplicar" && <DialogoDeDuplicar clone={c} onFechar={() => setDialogo(null)} onAbrir={onAbrir} />}
    </div>
  );
}

function CloneAbertoNaTela({ id, provisorio, onAbrir, onApagado }: { id: string; provisorio: CloneAberto | null; onAbrir: (c: Clone) => void; onApagado: (id: string) => void }) {
  const q = useCloneAberto(id, provisorio);
  if (q.isError && !q.data) return <ErroNaRegiao titulo="Não foi possível abrir o clone." erro={q.error} onTentar={() => void q.refetch()} />;
  // Esqueleto só na primeira carga sem provisório; depois o que já está na tela fica enquanto relê.
  if (!q.data) return <Carregando forma="aba" rotulo="Abrindo o clone" />;
  const aberto = q.data;
  return (
    <div className="min-w-0 space-y-6">
      <CabecalhoDoClone aberto={aberto} onAbrir={onAbrir} onApagado={onApagado} />
      {q.isPlaceholderData && (
        <p className={juntar(texto.auxiliar, "flex items-center")} role="status">
          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Lendo a folha e as variações
        </p>
      )}
      <div className="grid min-w-0 grid-cols-1 gap-6 border-t border-border pt-5 min-[1600px]:grid-cols-2">
        <FolhaDeIdentidade aberto={aberto} />
        <Variacoes aberto={aberto} />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ arquivados

/** Clones apagados (arquivados): só aparecem aqui, com Restaurar (a função confere a autorização). */
function ClonesArquivados({ onRestaurado }: { onRestaurado: (c: Clone) => void }) {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const [aberto, setAberto] = useState(false);
  const [restaurando, setRestaurando] = useState<string | null>(null);
  const q = useClonesArquivados(clientId, aberto);
  const lista = q.data || [];
  const restaurar = async (c: Clone) => {
    setRestaurando(c.id);
    try {
      const novo = await editarClone(c.id, { arquivar: false });
      const volta = novo ? { ...c, ...novo, capa_url: c.capa_url } : c;
      queryClient.setQueryData<Clone[]>(chaveDosArquivados(clientId), (l) => (l || []).filter((x) => x.id !== c.id));
      guardarCloneNaLista(queryClient, clientId, volta);
      invalidarClone(queryClient, clientId, c.id);
      toast.success(`${c.nome} voltou para a lista`);
      onRestaurado(volta);
    } catch (e) {
      avisarErro(e, "Clone não restaurado");
    } finally {
      setRestaurando(null);
    }
  };
  return (
    <section className="mt-4 min-w-0 border-t border-border pt-3" aria-label="Clones arquivados" data-clones-arquivados="">
      <button type="button" className={juntar("flex w-full min-w-0 items-center rounded text-left text-[12px] font-medium text-muted-foreground hover:text-foreground", foco)} aria-expanded={aberto} onClick={() => setAberto(!aberto)}>
        <Archive className="mr-1.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="mr-auto truncate">Arquivados{q.data ? ` · ${lista.length}` : ""}</span>
        <span aria-hidden="true">{aberto ? "−" : "+"}</span>
      </button>
      {aberto && (
        <div className="mt-2 min-w-0">
          {q.isLoading && <Carregando forma="lista" linhas={2} rotulo="Lendo os arquivados" />}
          {q.isError && <ErroNaRegiao titulo="Não foi possível ler os arquivados." erro={q.error} onTentar={() => void q.refetch()} />}
          {q.isSuccess && lista.length === 0 && <EstadoVazio compacto titulo="Nenhum clone apagado." />}
          <ul className="divide-y divide-border">
            {lista.map((c) => (
              <li key={c.id} className="flex min-w-0 items-center py-1" data-clone-arquivado={c.id}>
                <span className="mr-auto min-w-0">
                  <span className="block truncate text-[13px] font-medium">{c.nome}</span>
                  {!c.autorizacao_valida.ok && <span className="block truncate text-[11px] text-warning">{c.autorizacao_valida.motivo || "autorização inválida"}</span>}
                </span>
                <Button type="button" size="sm" variant="ghost" className="h-8 shrink-0 px-2 text-[12px]" disabled={restaurando === c.id} onClick={() => void restaurar(c)} aria-label={`Restaurar ${c.nome}`}>
                  {restaurando === c.id ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RotateCcw className="mr-1 h-3 w-3" />} Restaurar
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ etapa

export default function EtapaClones() {
  const { clientId } = useMesa();
  const { imagemId } = useMesaFoto();
  const queryClient = useQueryClient();
  const clonesQ = useClones(clientId);
  const fotosQ = useFotos(clientId);
  const clones = useMemo(() => clonesQ.data || [], [clonesQ.data]);
  // O clone aberto e o "novo clone" aberto ficam lembrados por cliente (sair e voltar não perde).
  const [escolhido, setEscolhido] = useEstadoDaTela<string | null>(`mesa-foto:clones:aberto:${clientId}`, null, { validar: ehTextoOuNulo });
  const [novo, setNovo] = useEstadoDaTela<boolean>(`mesa-foto:clones:novo:${clientId}`, false, { validar: ehBooleano });
  const [fotoDoPedido, setFotoDoPedido] = useState<string | null>(null);
  // Recém-criado: fica aberto mesmo antes da lista reler (sem piscar para outro clone ou para o vazio).
  const [recemCriado, setRecemCriado] = useState<Clone | null>(null);

  // "Variações desta pessoa" no acervo: abre o clone que já usa a foto ou um novo com ela.
  useEffect(() => {
    if (!imagemId || !clonesQ.isSuccess) return;
    const ja = cloneComAFoto(clones, imagemId);
    if (ja) {
      setNovo(false);
      setEscolhido(ja.id);
    } else {
      setFotoDoPedido(imagemId);
      setNovo(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imagemId, clonesQ.isSuccess]);

  const aberto = clones.find((c) => c.id === escolhido) || (recemCriado && recemCriado.id === escolhido ? recemCriado : null) || (novo ? null : clones[0] || null);
  // O provisório do clone aberto: o da lista com as fotos reais e as variações que o acervo em cache já tem.
  const provisorio = useMemo(() => (aberto ? cloneAbertoProvisorio(aberto, fotosQ.data || []) : null), [aberto, fotosQ.data]);
  // Abrir um clone que acabou de nascer ou voltar (criado, duplicado, restaurado): já na lista e aberto, sem piscar.
  const abrirClone = (c: Clone) => {
    guardarCloneNaLista(queryClient, clientId, c);
    setRecemCriado(c);
    setEscolhido(c.id);
    setNovo(false);
    invalidarClone(queryClient, clientId, c.id);
  };
  // Apagado (arquivado): sai da tela e abre o próximo da lista.
  const esquecerClone = (id: string) => {
    if (recemCriado && recemCriado.id === id) setRecemCriado(null);
    setEscolhido(null);
  };

  return (
    <div className="min-w-0 pb-6">
      {clonesQ.isError && <ErroNaRegiao className="mb-4" titulo="Não foi possível ler os clones." erro={clonesQ.error} onTentar={() => void clonesQ.refetch()} />}
      <div className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-[250px_minmax(0,1fr)]" data-clones-layout="">
        <div className="min-w-0">
          {clonesQ.isLoading ? (
            <Carregando forma="lista" linhas={3} rotulo="Lendo os clones" />
          ) : (
            <ListaDeClones
              clones={clones}
              escolhido={aberto ? aberto.id : null}
              onEscolher={(id) => {
                setNovo(false);
                setEscolhido(id);
              }}
              onNovo={() => {
                setFotoDoPedido(null);
                setNovo(true);
              }}
              novoAberto={novo}
            />
          )}
          <ClonesArquivados onRestaurado={abrirClone} />
        </div>
        <div className="min-w-0">
          {novo ? (
            <NovoClone
              key={fotoDoPedido || "novo"}
              fotoInicial={fotoDoPedido}
              onCancelar={() => setNovo(false)}
              // Otimista: o clone novo entra na lista e abre já, com o provisório (sem esqueleto).
              onCriado={abrirClone}
            />
          ) : aberto ? (
            <CloneAbertoNaTela key={aberto.id} id={aberto.id} provisorio={provisorio} onAbrir={abrirClone} onApagado={esquecerClone} />
          ) : clonesQ.isLoading ? (
            <Carregando forma="aba" rotulo="Lendo os clones" />
          ) : (
            <EstadoVazio
              icone={<UserRound className="h-5 w-5" />}
              titulo="Crie o primeiro clone"
              descricao="De 1 a 4 fotos reais da pessoa e a autorização de uso de imagem."
              acao={
                <button type="button" className={botao.primario} onClick={() => setNovo(true)}>
                  <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Novo clone
                </button>
              }
            />
          )}
        </div>
      </div>
    </div>
  );
}
