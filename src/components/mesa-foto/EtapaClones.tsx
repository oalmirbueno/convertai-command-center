import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { AlertTriangle, Archive, Check, Copy, Images, Loader2, Plus, ScanSearch, ShieldCheck, Sparkles, Star, UserRound, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Ampliar } from "@/components/mesa/Ampliar";
import { AvisoDeErro, BotaoComCusto, useAvisarErro } from "@/components/mesa/Custo";
import { ImagemDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { SeletorDeQualidade } from "@/components/mesa/Seletores";
import { padraoPara, textoDoErro, usd, type Qualidade } from "@/lib/mesa/api";
import { AprovarFoto } from "./AcoesDeUso";
import { Cartao, MiniaturaDaFoto, Moldura, Pilulas, useMesaFoto, Vazio } from "./Comuns";
import { ZonaDeEnvio } from "./EtapaAcervo";
import SeletorDeFotos from "./SeletorDeFotos";
import { MenuDeUso } from "./UsoDaFoto";
import { acrescentarFotos, classeDaFoto, invalidarFotos, subirOriginais, useFotos, type FotoDoAcervo } from "./fotoApi";
import { caminhoDaImagem, chaveDoAndamento, emParalelo, marcarAndamento, proporcaoDaImagem, useAndamentos, usePrecoNoServidor, type ImagemDaPersona } from "./modelosApi";
import {
  cloneComAFoto,
  conferirClone,
  criarClone,
  decidirVistaDoClone,
  editarClone,
  FORMAS_DE_AUTORIZACAO,
  FORMATOS_DO_CLONE,
  gerarVariacaoDoClone,
  gerarVistaDoClone,
  IDADE_MINIMA_CLONE,
  invalidarClone,
  MAX_FOTOS_DO_CLONE,
  pacoteDoClone,
  partesDaConferenciaDoClone,
  partesDoClone,
  problemasDoClone,
  rascunhoDoClone,
  statusDoClone,
  useCloneAberto,
  useClones,
  VISTAS_DO_CLONE,
  type Clone,
  type CloneAberto,
  type ConferenciaDoClone,
  type PedidoDaVariacao,
  type RascunhoDoClone,
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

function avisarFim(rotulo: string, feitas: number, falhas: number, custo: number, atualizar: () => void) {
  atualizar();
  if (feitas) toast.success(`${feitas} ${rotulo}${feitas === 1 ? "" : "s"} pronta${feitas === 1 ? "" : "s"}`, { description: `Custo real: ${usd(custo)}.${falhas ? ` ${falhas} não saiu.` : ""}` });
  else if (falhas) toast.error("Nenhuma imagem saiu", { description: "Veja o erro em cada item e tente de novo." });
}

async function rodarVistas(p: { queryClient: QueryClient; clientId: string; cloneId: string; vistas: string[]; qualidade: Qualidade; atualizar: () => void }) {
  let feitas = 0;
  let falhas = 0;
  let custo = 0;
  p.vistas.forEach((v) => marcarAndamento(chaveDoAndamento(p.cloneId, "clone-vista", v), { estado: "gerando", erro: "" }));
  // A frente primeiro (as outras vistas usam a frente aprovada quando houver); depois até 3 juntas.
  await emParalelo(p.vistas, 3, async (v) => {
    const chave = chaveDoAndamento(p.cloneId, "clone-vista", v);
    try {
      const r = await gerarVistaDoClone({ modeloId: p.cloneId, vista: v, qualidade: p.qualidade });
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

async function rodarVariacoes(p: { queryClient: QueryClient; clientId: string; cloneId: string; pedido: PedidoDaVariacao; formato: string; quantidade: number; qualidade: Qualidade; atualizar: () => void }) {
  let feitas = 0;
  let falhas = 0;
  let custo = 0;
  const chaves = Array.from({ length: p.quantidade }, (_x, i) => chaveDoAndamento(p.cloneId, "clone-variacao", String(Date.now()), String(i)));
  chaves.forEach((k) => marcarAndamento(k, { estado: "gerando", erro: "" }));
  await emParalelo(chaves, 2, async (chave) => {
    try {
      const r = await gerarVariacaoDoClone({ modeloId: p.cloneId, pedido: p.pedido, formato: p.formato, qualidade: p.qualidade });
      if (r.imagem) acrescentarFotos(p.queryClient, p.clientId, [r.imagem]);
      custo += Number(r.custo_usd || 0);
      feitas++;
      marcarAndamento(chave, null);
    } catch (e) {
      falhas++;
      marcarAndamento(chave, { estado: "falhou", erro: textoDoErro(e) });
    }
  });
  invalidarClone(p.queryClient, p.clientId, p.cloneId);
  invalidarFotos(p.queryClient, p.clientId);
  avisarFim("variação", feitas, falhas, custo, p.atualizar);
}

// ------------------------------------------------------------------ lista

function ListaDeClones({ clones, escolhido, onEscolher, onNovo, novoAberto }: { clones: Clone[]; escolhido: string | null; onEscolher: (id: string) => void; onNovo: () => void; novoAberto: boolean }) {
  return (
    <Cartao
      titulo={`Clones · ${clones.length}`}
      dica="Pessoas reais do cliente, com autorização, recriadas com o mesmo rosto em outras roupas, cenários e poses."
      acao={
        <Button type="button" size="sm" className="h-8 text-[12px]" onClick={onNovo} disabled={novoAberto}>
          <Plus className="mr-1 h-3.5 w-3.5" /> Novo clone
        </Button>
      }
    >
      {clones.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">Nenhum clone ainda. Escolha fotos reais de uma pessoa do cliente e registre a autorização.</p>
      ) : (
        <ul className="grid min-w-0 grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-2" aria-label="Clones do cliente">
          {clones.map((c) => {
            const st = statusDoClone(c.status);
            return (
              <li key={c.id} className="min-w-0" data-clone={c.id}>
                <button
                  type="button"
                  onClick={() => onEscolher(c.id)}
                  aria-pressed={c.id === escolhido}
                  className={`block w-full min-w-0 rounded-xl border p-1.5 text-left transition-colors ${c.id === escolhido ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary/40"}`}
                >
                  <Moldura proporcao={0.8}>
                    {c.capa_url ? (
                      <img src={c.capa_url} alt={c.nome} className="h-full w-full object-cover" loading="lazy" />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center text-muted-foreground">
                        <UserRound className="h-6 w-6" />
                      </span>
                    )}
                    {c.capa_url && !c.capa_e_real && <SeloGerada />}
                  </Moldura>
                  <p className="mt-1.5 truncate px-0.5 text-[12.5px] font-semibold">{c.nome}</p>
                  <span className={`mb-0.5 ml-0.5 inline-block rounded-full px-1.5 py-px text-[10px] font-medium ${st.cor}`}>{st.rotulo}</span>
                  {!c.autorizacao_valida.ok && <p className="px-0.5 text-[10px] text-warning">autorização inválida</p>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Cartao>
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

function FolhaDeIdentidade({ aberto }: { aberto: CloneAberto }) {
  const { clientId, atualizarCusto } = useMesa();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const andamentos = useAndamentos();
  const [qualidade, setQualidade] = useState<Qualidade>("alta");
  const [conferencias, setConferencias] = useState<Record<string, ConferenciaDoClone | null>>({});
  const [decidindo, setDecidindo] = useState<string | null>(null);
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
  const decidir = async (img: ImagemDaPersona, decisao: "aprovar" | "rejeitar") => {
    setDecidindo(img.id);
    try {
      await decidirVistaDoClone(img.id, decisao);
      invalidarClone(queryClient, clientId, c.id);
    } catch (e) {
      avisarErro(e, "Decisão não gravada");
    } finally {
      setDecidindo(null);
    }
  };

  return (
    <Cartao
      titulo={`Folha de identidade · ${aberto.folha.aprovadas} de ${aberto.folha.total} aprovadas`}
      dica={`A mesma pessoa em 6 vistas separadas, fundo neutro e luz uniforme: é a referência de rosto das variações e, depois, do vídeo. Gerador: ${motor ? motor.rotulo : "padrão"}.${aberto.folha.pronto ? " Pronto." : " Aprove a frente e mais 2 para ficar pronto."}`}
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
          const conf = img ? (conferencias[img.id] !== undefined ? conferencias[img.id] : null) : null;
          return (
            <li key={v.valor} className="min-w-0" data-vista-do-clone={v.valor}>
              <Moldura proporcao={img ? proporcaoDaImagem(img) : 0.8} className="border border-border">
                {img ? (
                  <button type="button" className="block h-full w-full cursor-zoom-in" aria-label={`Ver grande: ${v.rotulo}`} onClick={() => setAmpliada(prontas.indexOf(img))}>
                    <ImagemDaFolhaNaTela imagem={img} alt={`${c.nome}, ${v.rotulo}`} />
                  </button>
                ) : (
                  <span className={`flex h-full w-full items-center justify-center text-[10.5px] text-muted-foreground ${a && a.estado === "gerando" ? "animate-pulse bg-muted" : ""}`}>
                    {a && a.estado === "gerando" ? "gerando" : "vazia"}
                  </span>
                )}
                {img && <SeloGerada />}
              </Moldura>
              <p className="mt-1 truncate text-[11px] font-medium">{v.rotulo}</p>
              {img && img.aprovada === true && (
                <p className="inline-flex items-center text-[10.5px] font-medium text-success">
                  <Check className="mr-0.5 h-3 w-3" /> aprovada
                </p>
              )}
              {img && img.aprovada !== true && (
                <div className="flex min-w-0 flex-wrap">
                  <Button type="button" size="sm" variant="outline" className="mb-1 mr-1 h-7 px-1.5 text-[11px]" disabled={!!decidindo} onClick={() => void decidir(img, "aprovar")}>
                    {decidindo === img.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} <span className="ml-0.5">Aprovar</span>
                  </Button>
                </div>
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
                  disabled={!!a && a.estado === "gerando"}
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

function Variacoes({ aberto }: { aberto: CloneAberto }) {
  const { clientId, atualizarCusto } = useMesa();
  const queryClient = useQueryClient();
  const andamentos = useAndamentos();
  const c = aberto.clone;
  const bloqueado = !c.autorizacao_valida.ok || c.status === "arquivada";
  const [pedido, setPedido] = useState<PedidoDaVariacao>(PEDIDO_VAZIO);
  const [formato, setFormato] = useState("4:5");
  const [quantidade, setQuantidade] = useState(2);
  const [qualidade, setQualidade] = useState<Qualidade>("alta");
  const [conferencias, setConferencias] = useState<Record<string, ConferenciaDoClone | null>>({});
  const [ampliada, setAmpliada] = useState<number | null>(null);
  const motor = aberto.motores.find((m) => m.modelo_imagem_id === c.motor_preferido_id) || aberto.motores.find((m) => m.padrao) || null;
  const refs = Math.min(5, aberto.reais.length + aberto.folha.aprovadas);
  const servidor = usePrecoNoServidor(clientId, "clone_variacao", { modelo_id: c.id, quantidade }, !bloqueado);
  const gerando = Object.keys(andamentos).filter((k) => k.indexOf(`${c.id}|clone-variacao|`) === 0 && andamentos[k].estado === "gerando").length;
  const falhas = Object.keys(andamentos).filter((k) => k.indexOf(`${c.id}|clone-variacao|`) === 0 && andamentos[k].estado === "falhou").map((k) => andamentos[k].erro);
  const vazio = !pedido.preset && !pedido.roupa.trim() && !pedido.cenario.trim() && !pedido.pose.trim() && !pedido.expressao.trim() && !pedido.livre.trim();
  const escolherPreset = (id: string) => {
    const p = aberto.presets.find((x) => x.id === id);
    if (!p) return;
    setPedido({ preset: p.id, roupa: p.roupa, cenario: p.cenario, pose: p.pose, expressao: p.expressao, livre: pedido.livre });
  };

  return (
    <Cartao
      titulo={`Variações · ${aberto.variacoes.length}`}
      dica={aberto.folha.pronto ? "Mesmo rosto em outra roupa, cenário, pose ou expressão. Vão para o acervo marcadas como geradas." : "Dá para gerar já com as fotos reais; com a folha aprovada o rosto fica mais estável."}
      className="h-full"
    >
      <p className="mb-1 text-[11.5px] text-muted-foreground">Variações prontas</p>
      <Pilulas rotulo="Variação pronta" opcoes={aberto.presets.map((p) => ({ valor: p.id, rotulo: p.rotulo }))} valor={pedido.preset} onEscolher={escolherPreset} />
      <div className="mt-1 grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
        {(
          [
            ["roupa", "Roupa", "Ex.: blazer bege sobre camiseta branca"],
            ["cenario", "Cenário", "Ex.: consultório claro com plantas"],
            ["pose", "Pose", "Ex.: braços cruzados, meio sorriso"],
            ["expressao", "Expressão", "Ex.: confiante, olhando para a câmera"],
          ] as const
        ).map(([campo, rotulo, dica]) => (
          <Campo key={campo} rotulo={rotulo}>
            <Input value={pedido[campo]} onChange={(e) => setPedido({ ...pedido, [campo]: e.target.value })} placeholder={dica} aria-label={rotulo} className="h-9 text-[12.5px]" />
          </Campo>
        ))}
        <Campo rotulo="Pedido livre (opcional)" className="sm:col-span-2">
          <Input value={pedido.livre} onChange={(e) => setPedido({ ...pedido, livre: e.target.value })} placeholder="O rosto, a idade e o corpo não mudam" aria-label="Pedido livre da variação" className="h-9 text-[12.5px]" />
        </Campo>
      </div>
      <div className="mt-2 grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="min-w-0">
          <p className="mb-1 text-[11.5px] text-muted-foreground">Formato</p>
          <Pilulas rotulo="Formato da variação" opcoes={FORMATOS_DO_CLONE.map((f) => ({ valor: f, rotulo: f }))} valor={formato} onEscolher={setFormato} />
        </div>
        <div className="min-w-0">
          <p className="mb-1 text-[11.5px] text-muted-foreground">Quantas</p>
          <Pilulas rotulo="Quantidade de variações" opcoes={[1, 2, 4].map((n) => ({ valor: n, rotulo: String(n) }))} valor={quantidade} onEscolher={setQuantidade} />
        </div>
        <SeletorDeQualidade valor={qualidade} onChange={setQualidade} disabled={bloqueado} />
      </div>
      <div className="mt-2 flex min-w-0 flex-wrap items-center">
        <BotaoComCusto
          rotulo={
            <>
              <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Gerar {quantidade} {quantidade === 1 ? "variação" : "variações"}
            </>
          }
          titulo="Variações do clone"
          descricao={`Uma foto por chamada, ${motor ? motor.rotulo : "gerador do clone"}. O que sair fica salvo mesmo se você sair da aba.${typeof servidor.data === "number" ? ` Pela função: ~${usd(servidor.data)}.` : ""}`}
          className="mb-1.5 mr-2 h-9 text-[12.5px]"
          disabled={bloqueado || vazio || gerando > 0}
          fecharAoConfirmar
          partes={() => partesDoClone(motor ? motor.modelo_imagem_id : null, qualidade, refs, quantidade)}
          executar={() => {
            void rodarVariacoes({ queryClient, clientId, cloneId: c.id, pedido, formato, quantidade, qualidade, atualizar: atualizarCusto });
            return Promise.resolve({});
          }}
        />
        {gerando > 0 && (
          <span className="mb-1.5 inline-flex items-center text-[12px] text-muted-foreground">
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> gerando {gerando}
          </span>
        )}
      </div>
      {falhas.slice(0, 2).map((e, i) => (
        <p key={`${i}-${e}`} className="text-[11px] text-destructive [overflow-wrap:anywhere]" role="alert">
          {e}
        </p>
      ))}
      {aberto.variacoes.length > 0 && (
        <ul className="mt-2 grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3" aria-label="Variações do clone">
          {aberto.variacoes.map((f: FotoDoAcervo, i: number) => {
            const conf = conferencias[f.id] !== undefined ? conferencias[f.id] : null;
            return (
              <li key={f.id} className="min-w-0 rounded-lg border border-border bg-card p-1" data-variacao-do-clone={f.id}>
                <button type="button" className="block w-full cursor-zoom-in" onClick={() => setAmpliada(i)} aria-label={`Ver grande: ${f.nome}`}>
                  <MiniaturaDaFoto foto={f} />
                </button>
                <div className="mt-1 flex min-w-0 flex-wrap items-center">
                  <AprovarFoto foto={f} />
                  <BotaoConferirClone cloneId={c.id} imagemId={f.id} origem="acervo" onConferencia={(x) => setConferencias({ ...conferencias, [f.id]: x })} />
                  <MenuDeUso foto={f} icone className="mb-1 ml-auto" />
                </div>
                {conf && <NotasDaSemelhanca c={conf} />}
              </li>
            );
          })}
        </ul>
      )}
      <Ampliar
        imagens={aberto.variacoes.map((f) => ({ caminho: f.storage_path, bucket: f.storage_bucket || "mesa", titulo: f.nome, legenda: "Pessoa real recriada por IA com autorização. Ao publicar, ligue o rótulo de IA.", proporcao: f.largura && f.altura ? f.largura / f.altura : undefined }))}
        indice={ampliada}
        onFechar={() => setAmpliada(null)}
      />
    </Cartao>
  );
}

function CabecalhoDoClone({ aberto }: { aberto: CloneAberto }) {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const [ocupado, setOcupado] = useState(false);
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
    </div>
  );
}

function CloneAbertoNaTela({ id }: { id: string }) {
  const q = useCloneAberto(id);
  if (q.isError) return <AvisoDeErro erro={q.error} />;
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
  const clones = useMemo(() => clonesQ.data || [], [clonesQ.data]);
  const [escolhido, setEscolhido] = useState<string | null>(() => lerEscolhida(clientId));
  const [novo, setNovo] = useState(false);
  const [fotoDoPedido, setFotoDoPedido] = useState<string | null>(null);

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

  const aberto = clones.find((c) => c.id === escolhido) || (novo ? null : clones[0] || null);
  useEffect(() => {
    gravarEscolhida(clientId, aberto ? aberto.id : null);
  }, [clientId, aberto]);

  return (
    <div className="min-w-0 pb-24">
      {clonesQ.isError && <AvisoDeErro erro={clonesQ.error} className="mb-3" />}
      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="min-w-0 lg:col-span-3">
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
        <div className="min-w-0 lg:col-span-9">
          {novo ? (
            <NovoClone
              key={fotoDoPedido || "novo"}
              fotoInicial={fotoDoPedido}
              onCancelar={() => setNovo(false)}
              onCriado={(c) => {
                invalidarClone(queryClient, clientId, c.id);
                setNovo(false);
                setEscolhido(c.id);
              }}
            />
          ) : aberto ? (
            <CloneAbertoNaTela key={aberto.id} id={aberto.id} />
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
