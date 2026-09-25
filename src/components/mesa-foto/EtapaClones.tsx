import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { AlertTriangle, Archive, ArrowRightLeft, Check, Copy, Download, Images, Lightbulb, Loader2, Maximize2, Plus, ScanSearch, ShieldCheck, Shirt, Sparkles, Star, UserRound, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Ampliar } from "@/components/mesa/Ampliar";
import { AvisoDeErro, BotaoComCusto, useAvisarErro } from "@/components/mesa/Custo";
import { ImagemDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { SeletorDeQualidade } from "@/components/mesa/Seletores";
import { useClients } from "@/hooks/useSupabaseData";
import { padraoPara, textoDoErro, usd, type Qualidade } from "@/lib/mesa/api";
import { AprovarFoto, useAcoesDeUso } from "./AcoesDeUso";
import AcoesProDaFoto from "./AcoesProDaFoto";
import { Cartao, MiniaturaDaFoto, Moldura, Pilulas, useMesaFoto, Vazio } from "./Comuns";
import { ZonaDeEnvio } from "./EtapaAcervo";
import SeletorDeFotos from "./SeletorDeFotos";
import SeletorLateral, { type ItemDoSeletor } from "./SeletorLateral";
import { MenuDeUso } from "./UsoDaFoto";
import { acrescentarFotos, baixarDoStorage, baixarUmaAUma, classeDaFoto, invalidarFotos, subirOriginais, useFotos, type FotoDoAcervo } from "./fotoApi";
import { caminhoDaImagem, chaveDoAndamento, emParalelo, marcarAndamento, proporcaoDaImagem, useAndamentos, usePrecoNoServidor, type ImagemDaPersona } from "./modelosApi";
import {
  cloneAbertoProvisorio,
  cloneComAFoto,
  conferirClone,
  criarClone,
  decidirVistaDoClone,
  editarClone,
  FORMAS_DE_AUTORIZACAO,
  FORMATOS_DO_CLONE,
  gerarVariacaoDoClone,
  gerarVistaDoClone,
  guardarCloneNaLista,
  guardarVariacaoDoClone,
  guardarVistaDoClone,
  IDADE_MINIMA_CLONE,
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

const chaveDaEscolhida = (clientId: string) => `mesa-foto:clone:${clientId}`;
function lerEscolhida(clientId: string): string | null {
  try {
    return window.sessionStorage.getItem(chaveDaEscolhida(clientId));
  } catch {
    return null;
  }
}
function gravarEscolhida(clientId: string, id: string | null) {
  try {
    if (id) window.sessionStorage.setItem(chaveDaEscolhida(clientId), id);
    else window.sessionStorage.removeItem(chaveDaEscolhida(clientId));
  } catch {
    /* sem armazenamento: abre o primeiro */
  }
}

function SeloGerada({ texto = "gerada" }: { texto?: string }) {
  return (
    <span className="pointer-events-none absolute left-1 top-1 inline-flex items-center rounded-full border border-primary/30 bg-card px-1.5 py-px text-[9.5px] font-semibold text-primary" data-selo="gerada">
      <Sparkles className="mr-0.5 h-2.5 w-2.5" /> {texto}
    </span>
  );
}

function Campo({ rotulo, children, className = "" }: { rotulo: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block min-w-0 ${className}`}>
      <span className="mb-1 block text-[11.5px] text-muted-foreground">{rotulo}</span>
      {children}
    </label>
  );
}

function NotasDaSemelhanca({ c }: { c: ConferenciaDoClone }) {
  return (
    <div className="mt-1.5 min-w-0 rounded-md border border-border bg-background p-1.5 text-[10.5px] leading-snug" data-conferencia-do-clone="">
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

async function rodarVistas(p: { queryClient: QueryClient; clientId: string; cloneId: string; vistas: string[]; qualidade: Qualidade; atualizar: () => void }) {
  let feitas = 0;
  let falhas = 0;
  let custo = 0;
  p.vistas.forEach((v) => marcarAndamento(chaveDoAndamento(p.cloneId, "clone-vista", v), { estado: "gerando", erro: "" }));
  await emParalelo(p.vistas, 3, async (v) => {
    const chave = chaveDoAndamento(p.cloneId, "clone-vista", v);
    try {
      const r = await gerarVistaDoClone({ modeloId: p.cloneId, vista: v, qualidade: p.qualidade });
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

async function rodarVariacoes(p: { queryClient: QueryClient; clientId: string; cloneId: string; itens: ItemDoLote[]; formato: string; qualidade: Qualidade; atualizar: () => void }) {
  let feitas = 0;
  let falhas = 0;
  let custo = 0;
  const avisos: string[] = [];
  const rodada = String(Date.now());
  const chaves = p.itens.map((it, i) => ({ chave: chaveDoAndamento(p.cloneId, "clone-variacao", rodada, String(i)), item: it }));
  chaves.forEach((k) => marcarAndamento(k.chave, { estado: "gerando", erro: "" }));
  await emParalelo(chaves, 2, async ({ chave, item }) => {
    try {
      const r = await gerarVariacaoDoClone({ modeloId: p.cloneId, pedido: item.pedido, formato: p.formato, qualidade: p.qualidade });
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
      vazio="Nenhum clone ainda. Escolha fotos reais de uma pessoa do cliente e registre a autorização."
    />
  );
}

// ------------------------------------------------------------------ novo clone

function FotosReaisDoRascunho({ r, onMudar }: { r: RascunhoDoClone; onMudar: (r: RascunhoDoClone) => void }) {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const fotos = useFotos(clientId);
  const todas = fotos.data || [];
  const reais = todas.filter((f) => classeDaFoto(f) === "original" && !f.referencia_web);
  const [doAcervo, setDoAcervo] = useState(false);
  const [andamento, setAndamento] = useState<string | null>(null);
  const cheio = r.imagem_ids.length >= MAX_FOTOS_DO_CLONE;
  const somar = (ids: string[]) => {
    const saida = r.imagem_ids.slice();
    ids.forEach((id) => {
      if (saida.length < MAX_FOTOS_DO_CLONE && saida.indexOf(id) < 0) saida.push(id);
    });
    onMudar({ ...r, imagem_ids: saida, principal_id: r.principal_id && saida.indexOf(r.principal_id) >= 0 ? r.principal_id : saida[0] || null });
  };
  const subir = async (arquivos: File[]) => {
    if (!arquivos.length || andamento) return;
    setAndamento("Subindo fotos");
    try {
      const res = await subirOriginais(clientId, arquivos.slice(0, MAX_FOTOS_DO_CLONE - r.imagem_ids.length), (feitos, total) => setAndamento(feitos < total ? `Subindo ${feitos} de ${total}` : "Registrando"));
      acrescentarFotos(queryClient, clientId, res.registradas);
      invalidarFotos(queryClient, clientId);
      somar(res.registradas.map((f) => f.id));
    } catch (e) {
      avisarErro(e, "Fotos não subiram");
    } finally {
      setAndamento(null);
    }
  };
  return (
    <div className="min-w-0" data-fotos-reais="">
      <p className="mb-1 text-[11.5px] text-muted-foreground">
        Fotos reais da mesma pessoa ({r.imagem_ids.length} de {MAX_FOTOS_DO_CLONE}): de preferência uma de frente com luz uniforme, uma de 3/4 e uma de corpo inteiro, sem filtro e sem óculos escuros. A estrela marca a principal.
      </p>
      {r.imagem_ids.length > 0 && (
        <ul className="mb-2 grid min-w-0 grid-cols-4 gap-1.5">
          {r.imagem_ids.map((id) => {
            const f = todas.find((x) => x.id === id);
            const principal = r.principal_id === id;
            return (
              <li key={id} className="relative min-w-0" data-foto-real={id}>
                {f ? <MiniaturaDaFoto foto={f} selo={false} className={principal ? "ring-2 ring-primary" : ""} /> : <span className="block h-16 rounded-lg bg-muted" />}
                <button type="button" aria-label="Foto principal" aria-pressed={principal} onClick={() => onMudar({ ...r, principal_id: id })} className="absolute left-1 top-1 flex h-6 w-6 items-center justify-center rounded-md border border-border bg-card">
                  <Star className={`h-3 w-3 ${principal ? "fill-primary text-primary" : "text-muted-foreground"}`} />
                </button>
                <button
                  type="button"
                  aria-label="Tirar a foto"
                  onClick={() => {
                    const ids = r.imagem_ids.filter((x) => x !== id);
                    onMudar({ ...r, imagem_ids: ids, principal_id: principal ? ids[0] || null : r.principal_id });
                  }}
                  className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-md border border-border bg-card text-muted-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {!cheio && <ZonaDeEnvio compacta onArquivos={(a) => void subir(a)} andamento={andamento} />}
      <Button type="button" size="sm" variant="outline" className="mt-2 h-8 text-[12px]" disabled={cheio} onClick={() => setDoAcervo(true)}>
        <Images className="mr-1.5 h-3.5 w-3.5" /> Escolher do acervo
      </Button>
      {doAcervo && (
        <div className="mt-2">
          <SeletorDeFotos
            fotos={reais}
            titulo="Fotos reais da pessoa"
            filtroInicial="original"
            jaEscolhidas={r.imagem_ids}
            onUsar={(ids) => {
              somar(ids);
              setDoAcervo(false);
            }}
            onFechar={() => setDoAcervo(false)}
          />
        </div>
      )}
    </div>
  );
}

function NovoClone({ fotoInicial, onCriado, onCancelar }: { fotoInicial: string | null; onCriado: (c: Clone) => void; onCancelar: () => void }) {
  const { clientId } = useMesa();
  const avisarErro = useAvisarErro();
  const [r, setR] = useState<RascunhoDoClone>(() => rascunhoDoClone(fotoInicial ? [fotoInicial] : []));
  const [tentou, setTentou] = useState(false);
  const [criando, setCriando] = useState(false);
  const problemas = problemasDoClone(r);
  const a = r.autorizacao;
  const aut = (campo: keyof RascunhoDoClone["autorizacao"], valor: string | boolean) => setR({ ...r, autorizacao: { ...a, [campo]: valor } });

  const criar = async () => {
    setTentou(true);
    if (problemas.length || criando) return;
    setCriando(true);
    try {
      const c = await criarClone(clientId, r);
      if (!c) throw new Error("A função não devolveu o clone criado.");
      toast.success(`Clone de ${c.nome} criado`, { description: "Agora a folha de identidade: frente, 3/4, perfil e corpo com o mesmo rosto." });
      onCriado(c);
    } catch (e) {
      avisarErro(e, "Clone não criado");
    } finally {
      setCriando(false);
    }
  };

  return (
    <Cartao titulo="Novo clone" dica="Uma pessoa REAL do cliente. Sem a autorização dela registrada aqui, nada é gerado.">
      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="min-w-0 space-y-3">
          <Campo rotulo="Nome da pessoa (como a equipe chama)">
            <Input value={r.nome} onChange={(e) => setR({ ...r, nome: e.target.value })} placeholder="Ex.: Dra. Paula" aria-label="Nome do clone" className="h-9 text-[12.5px]" />
          </Campo>
          <FotosReaisDoRascunho r={r} onMudar={setR} />
          <Campo rotulo="Traços que nunca mudam (um por linha, opcional)">
            <Textarea value={r.invariantes} onChange={(e) => setR({ ...r, invariantes: e.target.value })} rows={2} placeholder={"Ex.: pinta acima do lábio, à esquerda dela\ncabelo cacheado na altura do ombro"} aria-label="Traços que nunca mudam" className="text-[12.5px]" />
          </Campo>
        </div>
        <div className={`min-w-0 space-y-2 rounded-lg border p-3 ${a.confirmada ? "border-success/40" : "border-warning/50"}`} data-autorizacao-do-clone="">
          <p className="flex items-center text-[12.5px] font-semibold">
            <ShieldCheck className="mr-1.5 h-4 w-4 text-primary" /> Autorização de uso de imagem
          </p>
          <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
            <Campo rotulo="Quem autorizou">
              <Input value={a.quem} onChange={(e) => aut("quem", e.target.value)} placeholder="A própria pessoa" aria-label="Quem autorizou" className="h-9 text-[12.5px]" />
            </Campo>
            <Campo rotulo="Data (DD/MM/AAAA)">
              <Input value={a.data} onChange={(e) => aut("data", e.target.value)} placeholder="25/09/2026" aria-label="Data da autorização" className="h-9 text-[12.5px]" />
            </Campo>
            <Campo rotulo="Finalidade" className="sm:col-span-2">
              <Input value={a.finalidade} onChange={(e) => aut("finalidade", e.target.value)} placeholder="Ex.: posts e anúncios da clínica no Instagram" aria-label="Finalidade" className="h-9 text-[12.5px]" />
            </Campo>
            <Campo rotulo="Validade (opcional)">
              <Input value={a.validade} onChange={(e) => aut("validade", e.target.value)} placeholder="Até revogar" aria-label="Validade" className="h-9 text-[12.5px]" />
            </Campo>
            <div className="min-w-0">
              <p className="mb-1 text-[11.5px] text-muted-foreground">Como</p>
              <Pilulas rotulo="Forma da autorização" opcoes={FORMAS_DE_AUTORIZACAO} valor={a.forma} onEscolher={(v) => aut("forma", v)} />
            </div>
          </div>
          {[
            { campo: "sabe_que_e_ia" as const, texto: "A pessoa sabe que as fotos dela serão recriadas por IA (roupa, cenário e pose novos, o mesmo rosto)." },
            { campo: "adulta" as const, texto: `A pessoa tem ${IDADE_MINIMA_CLONE} anos ou mais.` },
            { campo: "confirmada" as const, texto: "Confirmo a autorização de uso de imagem para a finalidade acima. As imagens saem marcadas como geradas." },
          ].map((x) => (
            <label key={x.campo} className="flex min-w-0 items-start text-[12px] leading-snug">
              <input type="checkbox" className="mr-2 mt-0.5 h-4 w-4 shrink-0" checked={a[x.campo] as boolean} onChange={(e) => aut(x.campo, e.target.checked)} aria-label={x.texto} />
              <span className="min-w-0">{x.texto}</span>
            </label>
          ))}
        </div>
      </div>
      {tentou && problemas.length > 0 && (
        <ul className="mt-2 space-y-0.5" role="alert">
          {problemas.map((p) => (
            <li key={p} className="text-[11.5px] text-warning">
              {p}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex min-w-0 flex-wrap items-center">
        <Button type="button" size="sm" className="mb-1 mr-1.5 h-9 text-[12.5px]" onClick={() => void criar()} disabled={criando}>
          {criando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1.5 h-3.5 w-3.5" />} Criar clone
        </Button>
        <Button type="button" size="sm" variant="ghost" className="mb-1 h-9 text-[12.5px]" onClick={onCancelar}>
          Cancelar
        </Button>
        <span className="mb-1 ml-auto text-[11px] text-muted-foreground">Criar não gasta. O custo aparece antes de cada geração.</span>
      </div>
    </Cartao>
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
  const c = aberto.clone;
  const bloqueado = !c.autorizacao_valida.ok || c.status === "arquivada";
  const motor = aberto.motores.find((m) => m.modelo_imagem_id === c.motor_preferido_id) || aberto.motores.find((m) => m.padrao) || null;
  const motorId = motor ? motor.modelo_imagem_id : null;
  const refs = Math.min(5, aberto.reais.length + aberto.folha.aprovadas);
  const servidor = usePrecoNoServidor(clientId, "clone_folha", { modelo_id: c.id }, !bloqueado);
  const porVista = typeof servidor.data === "number" ? servidor.data : null;
  const ultimaDe = (v: string) => aberto.imagens.filter((i) => i.papel === "vista" && i.vista === v).pop() || null;
  const aprovadaDe = (v: string) => aberto.imagens.find((i) => i.papel === "vista" && i.vista === v && i.aprovada === true) || null;
  const naTela = VISTAS_DO_CLONE.map((v) => aprovadaDe(v.valor) || ultimaDe(v.valor));
  const prontas = naTela.filter((x): x is ImagemDaPersona => !!x);
  const faltam = VISTAS_DO_CLONE.filter((v) => !ultimaDe(v.valor)).map((v) => v.valor);
  const gerandoAlguma = VISTAS_DO_CLONE.some((v) => {
    const a = andamentos[chaveDoAndamento(c.id, "clone-vista", v.valor)];
    return !!a && a.estado === "gerando";
  });
  const rodar = (vistas: string[]) => {
    void rodarVistas({ queryClient, clientId, cloneId: c.id, vistas, qualidade, atualizar: atualizarCusto });
    return Promise.resolve({});
  };
  /**
   * Aprovar na hora (pedido do dono, 26/09: "aprovar demora, fica
   * carregando"): a vista fica aprovada na tela antes da função responder
   * (e a anterior da mesma vista perde a aprovação, como no servidor); se a
   * função recusar, volta como estava.
   */
  const decidir = async (img: ImagemDaPersona, decisao: "aprovar" | "rejeitar") => {
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

  return (
    <Cartao
      titulo={`Folha de identidade · ${aberto.folha.aprovadas} de ${aberto.folha.total} aprovadas`}
      dica={`A mesma pessoa em 6 vistas, fundo neutro e luz uniforme: é a identidade das variações (todas as vistas aprovadas vão em cada variação) e, depois, do vídeo. Gerador: ${motor ? motor.rotulo : "padrão"}.${aberto.folha.pronto ? " Pronto." : " Aprove a frente e mais 2 para ficar pronto."}`}
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
            className="h-8 text-[12px]"
            disabled={gerandoAlguma}
            fecharAoConfirmar
            partes={() => partesDoClone(motorId, qualidade, refs, faltam.length)}
            executar={() => rodar(faltam)}
          />
        ) : undefined
      }
      className="h-full"
    >
      <div className="mb-2 w-full sm:w-56">
        <SeletorDeQualidade valor={qualidade} onChange={setQualidade} disabled={bloqueado} />
      </div>
      <ul className="grid min-w-0 grid-cols-3 gap-2" aria-label="Vistas da folha do clone">
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
                {img && gerando && (
                  <span className="pointer-events-none absolute bottom-1 left-1 inline-flex items-center rounded-full border border-border bg-card px-1.5 py-px text-[9.5px] text-muted-foreground">
                    <Loader2 className="mr-0.5 h-2.5 w-2.5 animate-spin" /> refazendo
                  </span>
                )}
              </Moldura>
              <div className="mt-1 flex min-w-0 items-center">
                <p className="mr-auto truncate text-[11px] font-medium">{v.rotulo}</p>
                {img && <BotaoBaixarOriginal rotulo={`Baixar ${v.rotulo}`} baixar={() => baixarDoStorage(img.storage_bucket || "mesa", img.storage_path, `${c.nome} ${v.rotulo} gerada`)} />}
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
                  rotulo={img ? "Refazer" : "Gerar"}
                  titulo={`Vista ${v.rotulo}`}
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
      <Ampliar
        imagens={prontas.map((i) => ({ caminho: caminhoDaImagem(i), bucket: i.storage_bucket || "mesa", titulo: `${c.nome} (gerada)`, legenda: "Pessoa real recriada por IA com autorização.", proporcao: proporcaoDaImagem(i) }))}
        indice={ampliada !== null && ampliada >= 0 ? ampliada : null}
        onFechar={() => setAmpliada(null)}
      />
    </Cartao>
  );
}

const PEDIDO_VAZIO: PedidoDaVariacao = { preset: null, roupa: "", cenario: "", pose: "", expressao: "", livre: "" };

type ModoDaVariacao = "prontas" | "contexto" | "uniforme" | "livre";
const MODOS_DA_VARIACAO: { valor: ModoDaVariacao; rotulo: string; dica: string }[] = [
  { valor: "prontas", rotulo: "Prontas", dica: "Estilos prontos: editorial, rua, café, casa, estúdio, UGC." },
  { valor: "contexto", rotulo: "Pelo contexto do cliente", dica: "O diretor lê o negócio do cliente e sugere fotos do trabalho da pessoa." },
  { valor: "uniforme", rotulo: "Uniforme da marca", dica: "Roupa profissional com a logo oficial do kit da marca aplicada." },
  { valor: "livre", rotulo: "Do meu jeito", dica: "Roupa, cenário, pose e expressão escritos pela equipe." },
];

/** Campos do pedido (roupa, cenário, pose, expressão, livre), recolhíveis para a tela ficar limpa. */
function CamposDoPedido({ pedido, onMudar, aberto }: { pedido: PedidoDaVariacao; onMudar: (p: PedidoDaVariacao) => void; aberto: boolean }) {
  return (
    <details className="mt-2 min-w-0 rounded-lg border border-border bg-background px-2.5 py-1.5" open={aberto} data-campos-do-pedido="">
      <summary className="cursor-pointer text-[12px] font-medium text-muted-foreground">Ajustar roupa, cenário, pose e expressão</summary>
      <div className="mt-2 grid min-w-0 grid-cols-1 gap-2 pb-1 sm:grid-cols-2">
        {(
          [
            ["roupa", "Roupa", "Ex.: blazer bege sobre camiseta branca"],
            ["cenario", "Cenário", "Ex.: consultório claro com plantas"],
            ["pose", "Pose", "Ex.: braços cruzados, meio sorriso"],
            ["expressao", "Expressão", "Ex.: confiante, olhando para a câmera"],
          ] as const
        ).map(([campo, rotulo, dica]) => (
          <Campo key={campo} rotulo={rotulo}>
            <Input value={pedido[campo]} onChange={(e) => onMudar({ ...pedido, [campo]: e.target.value })} placeholder={dica} aria-label={rotulo} className="h-9 text-[12.5px]" />
          </Campo>
        ))}
        <Campo rotulo="Pedido livre (opcional)" className="sm:col-span-2">
          <Input value={pedido.livre} onChange={(e) => onMudar({ ...pedido, livre: e.target.value })} placeholder="O rosto, a idade e o corpo não mudam" aria-label="Pedido livre da variação" className="h-9 text-[12.5px]" />
        </Campo>
      </div>
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
      {negocio && <p className="mb-1.5 text-[11.5px] leading-snug text-muted-foreground [overflow-wrap:anywhere]">{negocio}</p>}
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
        <p className="text-[11.5px] text-muted-foreground">O diretor já sabe o trabalho do cliente (ex.: paisagismo) e monta as fotos da pessoa em cima disso. Marque as que quiser: sai uma foto por sugestão.</p>
      )}
    </div>
  );
}

/** A variação aberta: grande, com aprovar, baixar o original, usar e as ferramentas pro (ampliar para o cliente). */
function VariacaoAberta({ foto, clone, onFechar, onMudou }: { foto: FotoDoAcervo; clone: Clone; onFechar: () => void; onMudou: (f: FotoDoAcervo) => void }) {
  const { clientId } = useMesa();
  const [conferencia, setConferencia] = useState<ConferenciaDoClone | null>(null);
  return (
    <section className="mb-3 grid min-w-0 grid-cols-1 gap-3 rounded-xl border border-primary/40 bg-card p-2.5 sm:grid-cols-[180px_minmax(0,1fr)]" aria-label={`Variação ${foto.nome}`} data-variacao-aberta={foto.id}>
      <div className="min-w-0">
        <Moldura proporcao={foto.largura && foto.altura ? foto.largura / foto.altura : 0.8} className="border border-border">
          <ImagemDaMesa caminho={foto.storage_path} bucket={foto.storage_bucket || "mesa"} alt={foto.nome} className="h-full w-full !object-contain" />
          <SeloGerada />
        </Moldura>
      </div>
      <div className="min-w-0 space-y-2">
        <div className="flex min-w-0 items-start">
          <p className="mr-auto min-w-0 truncate text-[12.5px] font-semibold" title={foto.nome}>
            {foto.nome}
          </p>
          <button type="button" onClick={onFechar} aria-label="Fechar a variação" className="ml-2 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted">
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
          <BotaoConferirClone cloneId={clone.id} imagemId={foto.id} origem="acervo" onConferencia={setConferencia} />
        </div>
        {conferencia && <NotasDaSemelhanca c={conferencia} />}
        {foto.tags.indexOf("uniforme_da_marca") >= 0 && <p className="text-[11px] text-warning">Uniforme com a logo oficial: confira letras, cores e proporção da logo antes de aprovar.</p>}
        {foto.aprovada ? (
          <div className="min-w-0 border-t border-border pt-2">
            <p className="mb-1 text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">Ampliar para enviar ao cliente</p>
            <AcoesProDaFoto foto={foto} mostrarCriativo={false} />
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground">Aprove para ampliar (fiel) e mandar ao cliente em alta.</p>
        )}
      </div>
    </section>
  );
}

function Variacoes({ aberto }: { aberto: CloneAberto }) {
  const { clientId, atualizarCusto } = useMesa();
  const queryClient = useQueryClient();
  const andamentos = useAndamentos();
  const { baixar, baixando } = useAcoesDeUso();
  const c = aberto.clone;
  const bloqueado = !c.autorizacao_valida.ok || c.status === "arquivada";
  const [modo, setModo] = useState<ModoDaVariacao>("prontas");
  const [pedido, setPedido] = useState<PedidoDaVariacao>(PEDIDO_VAZIO);
  const [sugestoes, setSugestoes] = useState<SugestaoDoClone[] | null>(null);
  const [marcadasSug, setMarcadasSug] = useState<number[]>([]);
  const [formato, setFormato] = useState("4:5");
  const [quantidade, setQuantidade] = useState(2);
  const [qualidade, setQualidade] = useState<Qualidade>("alta");
  const [conferencias, setConferencias] = useState<Record<string, ConferenciaDoClone | null>>({});
  const [ampliada, setAmpliada] = useState<number | null>(null);
  const [aberta, setAberta] = useState<string | null>(null);
  const [escolhidas, setEscolhidas] = useState<string[]>([]);
  const motor = aberto.motores.find((m) => m.modelo_imagem_id === c.motor_preferido_id) || aberto.motores.find((m) => m.padrao) || null;
  // Identidade que vai em cada variação: a foto real principal e TODAS as vistas aprovadas (até 8).
  const refs = Math.min(8, 1 + aberto.folha.aprovadas + (modo === "uniforme" ? 1 : 0));
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

  return (
    <Cartao
      titulo={`Variações · ${aberto.variacoes.length}`}
      dica={
        aberto.folha.aprovadas
          ? `Mesmo rosto em outra roupa, cenário, pose ou expressão. Cada variação leva a foto real e as ${aberto.folha.aprovadas} ${aberto.folha.aprovadas === 1 ? "vista aprovada" : "vistas aprovadas"} da folha, com os traços repetidos no pedido.`
          : "Dá para gerar já com as fotos reais; com a folha aprovada o rosto fica mais estável (as vistas aprovadas vão em toda variação)."
      }
      className="h-full"
    >
      {/* 1. O que muda */}
      <div className="min-w-0" data-plano-da-variacao="">
        <p className="mb-1 text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">1. O que muda</p>
        <Pilulas rotulo="Como montar a variação" opcoes={MODOS_DA_VARIACAO.map((m) => ({ valor: m.valor, rotulo: m.rotulo, dica: m.dica }))} valor={modo} onEscolher={trocarModo} />
        <div className="rounded-lg bg-muted/40 p-2.5">
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
              <p className="flex items-start text-[12px] leading-snug">
                <Shirt className="mr-1.5 mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                <span className="min-w-0">
                  Uniforme profissional nas cores da marca, com a <strong>logo oficial do kit da marca</strong> anexada ao gerador (aplicada sem redesenhar). Sem logo no kit, a função avisa antes de gastar. Confira a logo em cada foto antes de aprovar.
                </span>
              </p>
              {!uniforme && <p className="mt-1 text-[11px] text-warning">A função ainda não oferece o uniforme (publique a versão nova da função mesa-foto).</p>}
              <CamposDoPedido pedido={pedido} onMudar={setPedido} aberto={false} />
            </div>
          )}
          {modo === "livre" && <CamposDoPedido pedido={pedido} onMudar={setPedido} aberto />}
        </div>
      </div>

      {/* 2. Formato, quantidade, qualidade */}
      <div className="mt-3 grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="min-w-0">
          <p className="mb-1 text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">2. Formato</p>
          <Pilulas rotulo="Formato da variação" opcoes={FORMATOS_DO_CLONE.map((f) => ({ valor: f, rotulo: f }))} valor={formato} onEscolher={setFormato} />
        </div>
        {modo !== "contexto" && (
          <div className="min-w-0">
            <p className="mb-1 text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">Quantas</p>
            <Pilulas rotulo="Quantidade de variações" opcoes={[1, 2, 4].map((n) => ({ valor: n, rotulo: String(n) }))} valor={quantidade} onEscolher={setQuantidade} />
          </div>
        )}
        <SeletorDeQualidade valor={qualidade} onChange={setQualidade} disabled={bloqueado} />
      </div>

      {/* 3. Gerar (custo antes) */}
      <div className="mt-2 flex min-w-0 flex-wrap items-center border-t border-border pt-2.5">
        <BotaoComCusto
          rotulo={
            <>
              <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Gerar {itensDoLote.length} {itensDoLote.length === 1 ? "variação" : "variações"}
            </>
          }
          titulo="Variações do clone"
          descricao={`Uma foto por chamada, ${motor ? motor.rotulo : "gerador do clone"}. Aparece aqui assim que sai; fica salva mesmo se você sair da aba.${typeof servidor.data === "number" ? ` Pela função: ~${usd(servidor.data)}.` : ""}`}
          className="mb-1.5 mr-2 h-9 text-[12.5px]"
          disabled={bloqueado || vazio || gerando > 0 || itensDoLote.length === 0}
          fecharAoConfirmar
          partes={() => partesDoClone(motor ? motor.modelo_imagem_id : null, qualidade, refs, Math.max(1, itensDoLote.length))}
          executar={() => {
            void rodarVariacoes({ queryClient, clientId, cloneId: c.id, itens: itensDoLote, formato, qualidade, atualizar: atualizarCusto });
            return Promise.resolve({});
          }}
        />
        {gerando > 0 && (
          <span className="mb-1.5 inline-flex items-center text-[12px] text-muted-foreground" role="status">
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> gerando {gerando}
          </span>
        )}
      </div>
      {falhas.slice(0, 2).map((e, i) => (
        <p key={`${i}-${e}`} className="text-[11px] text-destructive [overflow-wrap:anywhere]" role="alert">
          {e}
        </p>
      ))}

      {/* Resultados */}
      {(aberto.variacoes.length > 0 || gerando > 0) && (
        <div className="mt-3 min-w-0 border-t border-border pt-2.5" data-resultados-do-clone="">
          <div className="mb-2 flex min-w-0 flex-wrap items-center text-[12px]">
            <span className="mr-2 font-medium">{aberto.variacoes.length} prontas</span>
            <button
              type="button"
              className="mr-2 text-primary hover:underline"
              onClick={() => setEscolhidas(escolhidas.length === aberto.variacoes.length ? [] : aberto.variacoes.map((v) => v.id))}
            >
              {escolhidas.length === aberto.variacoes.length && escolhidas.length > 0 ? "Desmarcar todas" : "Marcar todas"}
            </button>
            {selecionadas.length > 0 && (
              <Button type="button" size="sm" variant="outline" className="h-7 text-[11.5px]" disabled={!!baixando} onClick={() => void baixar(selecionadas)} title="Uma a uma, sem ZIP, no tamanho original">
                {baixando ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Download className="mr-1 h-3 w-3" />}
                {baixando ? `Baixando ${baixando.feitos} de ${baixando.total}` : `Baixar ${selecionadas.length} (sem ZIP)`}
              </Button>
            )}
          </div>
          {variacaoAberta && <VariacaoAberta key={variacaoAberta.id} foto={variacaoAberta} clone={c} onFechar={() => setAberta(null)} onMudou={mudouVariacao} />}
          <ul className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3" aria-label="Variações do clone">
            {Array.from({ length: gerando }, (_x, i) => (
              <li key={`gerando-${i}`} className="min-w-0 rounded-lg border border-dashed border-primary/40 bg-card p-1" data-variacao-gerando="">
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
                <li key={f.id} className={`relative min-w-0 rounded-lg border bg-card p-1 ${aberta === f.id ? "border-primary" : marcada ? "border-primary/60" : "border-border"}`} data-variacao-do-clone={f.id}>
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
                  </div>
                  {conf && <NotasDaSemelhanca c={conf} />}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <Ampliar
        imagens={aberto.variacoes.map((f) => ({ caminho: f.storage_path, bucket: f.storage_bucket || "mesa", titulo: f.nome, legenda: "Pessoa real recriada por IA com autorização. Ao publicar, ligue o rótulo de IA.", proporcao: f.largura && f.altura ? f.largura / f.altura : undefined }))}
        indice={ampliada}
        onFechar={() => setAmpliada(null)}
      />
    </Cartao>
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

function CabecalhoDoClone({ aberto }: { aberto: CloneAberto }) {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const [ocupado, setOcupado] = useState(false);
  const [transferir, setTransferir] = useState(false);
  const c = aberto.clone;
  const st = statusDoClone(c.status);
  const a = c.autorizacao;
  const arquivar = async () => {
    setOcupado(true);
    try {
      await editarClone(c.id, { arquivar: true });
      invalidarClone(queryClient, clientId, c.id);
      toast.success("Clone arquivado");
    } catch (e) {
      avisarErro(e, "Clone não arquivado");
    } finally {
      setOcupado(false);
    }
  };
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
  return (
    <div className="min-w-0 rounded-xl border border-border bg-card p-3" data-clone-aberto={c.id}>
      <div className="flex min-w-0 flex-wrap items-center">
        <div className="mr-auto min-w-0">
          <div className="flex min-w-0 flex-wrap items-center">
            <p className="mr-2 truncate text-[15px] font-semibold">{c.nome}</p>
            <span className={`mr-1.5 rounded-full px-1.5 py-px text-[10.5px] font-medium ${st.cor}`}>{st.rotulo}</span>
            <span className="inline-flex items-center rounded-full border border-primary/30 bg-card px-1.5 py-px text-[10.5px] font-semibold text-primary">
              <ShieldCheck className="mr-0.5 h-2.5 w-2.5" /> pessoa real autorizada
            </span>
          </div>
          <p className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground [overflow-wrap:anywhere]">
            {a ? `Autorizado por ${a.quem} em ${a.data}: ${a.finalidade}.` : "Sem autorização registrada."}
            {c.invariantes.length ? ` Não muda: ${c.invariantes.join("; ")}.` : ""}
          </p>
          {!c.autorizacao_valida.ok && <p className="text-[11.5px] font-medium text-warning">{c.autorizacao_valida.motivo || "Autorização inválida: nada novo pode ser gerado."}</p>}
        </div>
        <div className="mt-2 flex flex-wrap items-center sm:mt-0">
          <Button type="button" size="sm" variant="outline" className="mb-1 mr-1.5 h-8 text-[12px]" disabled={ocupado} onClick={() => void copiarPacote()} title="Pacote de referência para a futura mesa de vídeo">
            <Copy className="mr-1.5 h-3.5 w-3.5" /> Pacote para vídeo
          </Button>
          <Button type="button" size="sm" variant="outline" className="mb-1 mr-1.5 h-8 text-[12px]" disabled={ocupado} onClick={() => setTransferir(true)} title="Mover o clone, a folha e as fotos para o cliente certo">
            <ArrowRightLeft className="mr-1.5 h-3.5 w-3.5" /> Transferir para outro cliente
          </Button>
          {c.status !== "arquivada" && (
            <Button type="button" size="sm" variant="ghost" className="mb-1 h-8 text-[12px]" disabled={ocupado} onClick={() => void arquivar()}>
              <Archive className="mr-1.5 h-3.5 w-3.5" /> Arquivar
            </Button>
          )}
        </div>
      </div>
      <p className="mb-1 mt-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Fotos reais (a verdade sobre o rosto)</p>
      <ul className="grid min-w-0 grid-cols-4 gap-1.5 sm:grid-cols-8" aria-label="Fotos reais do clone">
        {aberto.reais.map((r) => (
          <li key={r.id} className={`min-w-0 rounded-lg ${r.principal ? "ring-2 ring-primary" : ""}`}>
            <MiniaturaDaFoto foto={r} selo={false} />
          </li>
        ))}
      </ul>
      {transferir && <DialogoDeTransferir clone={c} aberto={transferir} onFechar={() => setTransferir(false)} />}
    </div>
  );
}

function CloneAbertoNaTela({ id, provisorio }: { id: string; provisorio: CloneAberto | null }) {
  const q = useCloneAberto(id, provisorio);
  if (q.isError && !q.data) return <AvisoDeErro erro={q.error} />;
  if (!q.data) {
    return (
      <div aria-busy="true" className="space-y-3">
        <div className="h-24 animate-pulse rounded-xl bg-muted" />
        <div className="h-[40vh] animate-pulse rounded-xl bg-muted/70" />
      </div>
    );
  }
  const aberto = q.data;
  return (
    <div className="min-w-0 space-y-4">
      <CabecalhoDoClone aberto={aberto} />
      {q.isPlaceholderData && (
        <p className="flex items-center text-[11.5px] text-muted-foreground" role="status">
          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Lendo a folha e as variações
        </p>
      )}
      <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
        <FolhaDeIdentidade aberto={aberto} />
        <Variacoes aberto={aberto} />
      </div>
      <p className="text-[11px] leading-snug text-muted-foreground">
        Pessoa real recriada por IA com autorização. Ao publicar, ligue o rótulo de IA; em anúncio, declare o conteúdo fotorrealista gerado. Se a pessoa revogar, arquive o clone.
      </p>
    </div>
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
  const [escolhido, setEscolhido] = useState<string | null>(() => lerEscolhida(clientId));
  const [novo, setNovo] = useState(false);
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
  useEffect(() => {
    gravarEscolhida(clientId, aberto ? aberto.id : null);
  }, [clientId, aberto]);
  // O provisório do clone aberto: o da lista com as fotos reais e as variações que o acervo em cache já tem.
  const provisorio = useMemo(() => (aberto ? cloneAbertoProvisorio(aberto, fotosQ.data || []) : null), [aberto, fotosQ.data]);

  return (
    <div className="min-w-0 pb-24">
      {clonesQ.isError && <AvisoDeErro erro={clonesQ.error} className="mb-3" />}
      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[250px_minmax(0,1fr)]" data-clones-layout="">
        <div className="min-w-0">
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
        </div>
        <div className="min-w-0">
          {novo ? (
            <NovoClone
              key={fotoDoPedido || "novo"}
              fotoInicial={fotoDoPedido}
              onCancelar={() => setNovo(false)}
              onCriado={(c) => {
                // Otimista: o clone novo entra na lista e abre já, com o provisório (sem esqueleto).
                guardarCloneNaLista(queryClient, clientId, c);
                setRecemCriado(c);
                setEscolhido(c.id);
                setNovo(false);
                invalidarClone(queryClient, clientId, c.id);
              }}
            />
          ) : aberto ? (
            <CloneAbertoNaTela key={aberto.id} id={aberto.id} provisorio={provisorio} />
          ) : (
            <Vazio
              titulo="Crie o primeiro clone"
              acao={
                <Button type="button" size="sm" className="h-8 text-[12px]" onClick={() => setNovo(true)}>
                  <Plus className="mr-1 h-3.5 w-3.5" /> Novo clone
                </Button>
              }
            >
              Escolha de 1 a 4 fotos reais da mesma pessoa do cliente e registre a autorização de uso de imagem. Depois vem a folha de identidade (frente, 3/4, perfil e corpo) e as variações com o mesmo rosto.
            </Vazio>
          )}
        </div>
      </div>
    </div>
  );
}
