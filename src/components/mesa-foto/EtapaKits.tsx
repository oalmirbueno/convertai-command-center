import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowUp, Camera, Images, Loader2, Plus, ShieldCheck, Sparkles, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { AvisoDeErro, BotaoComCusto, useAvisarErro } from "@/components/mesa/Custo";
import { useMesa } from "@/components/mesa/MesaContexto";
import { Cartao, ListaCurta, MiniaturaDaFoto, Pilulas, SeloDaFoto, useMesaFoto, Vazio } from "./Comuns";
import SeletorDeFotos from "./SeletorDeFotos";
import {
  chaveDosKits,
  classeDaFoto,
  dataParaIso,
  faltaAutorizacao,
  kitVazio,
  listaDeTextos,
  MAX_FOTOS_NA_SUGESTAO,
  PAPEIS_DA_REF,
  partesDaSugestao,
  rotuloDoPapel,
  rotuloDoTipo,
  salvarKit,
  sugerirKit,
  TIPOS_DE_KIT,
  useFotos,
  useKits,
  VISTAS_DA_REF,
  type FotoDoAcervo,
  type KitDeFoto,
  type PapelDaRef,
  type PropostaDeKit,
  type RefDoKit,
} from "./fotoApi";

/**
 * Etapa 2, Kits: a identidade de cada assunto (produto, pessoa, alimento)
 * separada das referências de estilo e cenário. Cada foto do kit ganha um
 * papel; o que foi visto, o que o cliente informou e o que foi deduzido
 * ficam separados; o que não pode mudar e o que falta documentar ficam
 * escritos. Kit de pessoa só salva com a autorização confirmada.
 */

const SEM_VISTA = "sem-vista";
const PAPEIS_DE_EVIDENCIA: PapelDaRef[] = ["identidade", "detalhe", "embalagem", "verso", "rotulo", "rosto", "corpo"];

interface Textos {
  observado: string;
  informado: string;
  inferido: string;
  invariantes: string;
  lacunas: string;
}

const juntar = (l: string[]) => l.join("\n");
const textosDoKit = (k: KitDeFoto): Textos => ({
  observado: juntar(k.atributos.observado),
  informado: juntar(k.atributos.informado),
  inferido: juntar(k.atributos.inferido),
  invariantes: juntar(k.invariantes),
  lacunas: juntar(k.lacunas),
});

/** O kit do editor com as listas escritas (uma por linha). */
export function kitDoEditor(k: KitDeFoto, t: Textos): KitDeFoto {
  return {
    ...k,
    atributos: { observado: listaDeTextos(t.observado), informado: listaDeTextos(t.informado), inferido: listaDeTextos(t.inferido) },
    invariantes: listaDeTextos(t.invariantes),
    lacunas: listaDeTextos(t.lacunas),
  };
}

/** Avisos do kit antes de salvar (nada bloqueia, fora a autorização de pessoa). */
export function avisosDoKit(k: KitDeFoto, fotos: FotoDoAcervo[]): string[] {
  const avisos: string[] = [];
  const papeis = k.refs.map((r) => r.papel);
  const temIdentidade = papeis.indexOf("identidade") >= 0 || papeis.indexOf("rosto") >= 0;
  if (!k.refs.length) avisos.push("O kit ainda não tem fotos.");
  else if (!temIdentidade && papeis.indexOf("embalagem") >= 0) avisos.push("Só há embalagem: o objeto ainda não foi documentado. Embalagem não é o produto.");
  else if (!temIdentidade) avisos.push("Nenhuma foto marcada como identidade. A geração precisa saber qual foto prova como o assunto é.");
  // Mesma regra da função (gerada_sem_aprovacao): gerada sem aprovação não é evidência; só estilo, cenário ou pose.
  const geradas = k.refs.filter((r) => PAPEIS_DE_EVIDENCIA.indexOf(r.papel) >= 0 && fotos.some((f) => f.id === r.imagem_id && f.gerada && !f.aprovada));
  if (geradas.length) avisos.push("Imagem gerada sem aprovação não pode ser evidência do kit (identidade, detalhe, rótulo, verso, embalagem, rosto ou corpo). Use como estilo ou cenário, ou aprove antes.");
  if (faltaAutorizacao(k)) avisos.push("Kit de pessoa: confirme a autorização do cliente antes de salvar.");
  if (k.tipo === "pessoa" && k.autorizacao && k.autorizacao.data.trim() && !dataParaIso(k.autorizacao.data)) {
    avisos.push("Data da autorização em DD/MM/AAAA; do jeito que está ela não é guardada.");
  }
  return avisos;
}

function Autorizacao({ kit, onMudar }: { kit: KitDeFoto; onMudar: (k: KitDeFoto) => void }) {
  const a = kit.autorizacao || { confirmada: false, quem: "", data: "", finalidade: "", observacao: "" };
  const mudar = (campo: string, valor: string | boolean) => onMudar({ ...kit, autorizacao: { ...a, [campo]: valor } as any });
  return (
    <div className={`space-y-2 rounded-lg border p-3 ${a.confirmada ? "border-success/40" : "border-warning/50"}`} data-autorizacao="">
      <label className="flex items-start text-[12.5px]">
        <Switch checked={a.confirmada} onCheckedChange={(v) => mudar("confirmada", v)} className="mr-2 mt-0.5" aria-label="Autorização confirmada" />
        <span className="min-w-0">
          <span className="flex items-center font-medium">
            <ShieldCheck className="mr-1 h-3.5 w-3.5" /> O cliente autorizou o uso destas fotos da pessoa
          </span>
          <span className="block text-[11.5px] text-muted-foreground">Só fotos da própria pessoa, do cliente certo. O retoque não muda anatomia, idade ou rosto.</span>
        </span>
      </label>
      <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-3">
        <Input value={a.quem} onChange={(e) => mudar("quem", e.target.value)} placeholder="Quem autorizou" aria-label="Quem autorizou" className="h-8 text-[12px]" />
        <Input value={a.data} onChange={(e) => mudar("data", e.target.value)} placeholder="Data (DD/MM/AAAA)" aria-label="Data da autorização" inputMode="numeric" className="h-8 text-[12px]" />
        <Input value={a.finalidade} onChange={(e) => mudar("finalidade", e.target.value)} placeholder="Para quê (ex.: site e anúncios)" aria-label="Finalidade autorizada" className="h-8 text-[12px]" />
      </div>
    </div>
  );
}

function FonteDoKit({
  refDoKit,
  foto,
  indice,
  frente,
  onMudar,
  onTirar,
  onSubir,
  onFrente,
}: {
  refDoKit: RefDoKit;
  foto: FotoDoAcervo | null;
  indice: number;
  frente: boolean;
  onMudar: (r: RefDoKit) => void;
  onTirar: () => void;
  onSubir: () => void;
  onFrente: () => void;
}) {
  const papel = PAPEIS_DA_REF.find((p) => p.valor === refDoKit.papel);
  return (
    <li className="flex min-w-0 items-start rounded-lg border border-border bg-background p-2" data-ref={refDoKit.imagem_id}>
      <div className="w-16 shrink-0">{foto ? <MiniaturaDaFoto foto={foto} /> : <div className="h-16 w-16 animate-pulse rounded-lg bg-muted" />}</div>
      <div className="ml-2.5 min-w-0 flex-1 space-y-1.5">
        <div className="flex min-w-0 flex-wrap items-center">
          <Select value={refDoKit.papel} onValueChange={(v) => onMudar({ ...refDoKit, papel: v as PapelDaRef })}>
            <SelectTrigger className="mb-1 mr-1.5 h-8 w-[140px] text-[12px]" aria-label={`Papel da foto ${indice + 1}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAPEIS_DA_REF.map((p) => (
                <SelectItem key={p.valor} value={p.valor}>
                  {p.rotulo}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {/* Só as vistas que a função aceita: decidem novo ângulo e a ordem das fontes. */}
          <Select value={refDoKit.vista || SEM_VISTA} onValueChange={(v) => onMudar({ ...refDoKit, vista: v === SEM_VISTA ? "" : v })}>
            <SelectTrigger className="mb-1 h-8 min-w-0 flex-1 text-[12px]" aria-label={`Vista da foto ${indice + 1}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={SEM_VISTA}>Vista não marcada</SelectItem>
              {VISTAS_DA_REF.map((v) => (
                <SelectItem key={v.valor} value={v.valor}>
                  {v.rotulo}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="text-[11px] leading-snug text-muted-foreground">
          {papel ? papel.dica : ""}
          {foto && classeDaFoto(foto) === "gerada" ? " Esta foto é gerada." : ""}
        </p>
        <div className="flex flex-wrap items-center">
          <button
            type="button"
            onClick={onFrente}
            aria-pressed={frente}
            className={`mr-1 inline-flex h-7 items-center rounded-md px-1.5 text-[11.5px] ${frente ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted"}`}
            title="A frente comercial do assunto: os ângulos contam a partir dela"
          >
            <Star className="mr-1 h-3 w-3" /> {frente ? "Frente do assunto" : "Marcar como frente"}
          </button>
          {indice > 0 && (
            <button type="button" onClick={onSubir} className="mr-1 inline-flex h-7 items-center rounded-md px-1.5 text-[11.5px] text-muted-foreground hover:bg-muted" aria-label={`Subir a foto ${indice + 1}`}>
              <ArrowUp className="mr-1 h-3 w-3" /> Prioridade
            </button>
          )}
          <button type="button" onClick={onTirar} className="inline-flex h-7 items-center rounded-md px-1.5 text-[11.5px] text-muted-foreground hover:bg-muted hover:text-destructive" aria-label={`Tirar a foto ${indice + 1} do kit`}>
            <Trash2 className="mr-1 h-3 w-3" /> Tirar
          </button>
        </div>
      </div>
    </li>
  );
}

function CartaoDaProposta({ proposta, fotos, onUsar }: { proposta: PropostaDeKit; fotos: FotoDoAcervo[]; onUsar: () => void }) {
  return (
    <div className="min-w-0 space-y-2 rounded-xl border border-primary/30 bg-background p-3" data-proposta="">
      <div className="flex min-w-0 items-start">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold">{proposta.nome}</p>
          <p className="text-[11.5px] text-muted-foreground">
            {rotuloDoTipo(proposta.tipo)}
            {proposta.variante ? ` · ${proposta.variante}` : ""} · {proposta.refs.length} {proposta.refs.length === 1 ? "foto" : "fotos"}
          </p>
        </div>
        <Button type="button" size="sm" className="ml-2 h-8 shrink-0 text-[12px]" onClick={onUsar}>
          Usar esta proposta
        </Button>
      </div>
      <div className="flex min-w-0 flex-wrap">
        {proposta.refs.slice(0, 8).map((r) => {
          const f = fotos.find((x) => x.id === r.imagem_id);
          return (
            <div key={`${r.imagem_id}-${r.papel}`} className="mb-1 mr-1 w-14" title={rotuloDoPapel(r.papel)}>
              {f ? <MiniaturaDaFoto foto={f} selo={false} /> : <div className="h-14 w-14 rounded-lg bg-muted" />}
              <span className="block truncate text-center text-[10px] text-muted-foreground">{rotuloDoPapel(r.papel)}</span>
            </div>
          );
        })}
      </div>
      <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
        <ListaCurta titulo="Observado" itens={proposta.atributos.observado} />
        <ListaCurta titulo="Não pode mudar" itens={proposta.invariantes} />
        <ListaCurta titulo="Lacunas" itens={proposta.lacunas} tom="alerta" />
        <ListaCurta titulo="Confirmar com o cliente" itens={proposta.perguntas} tom="alerta" />
      </div>
    </div>
  );
}

export default function EtapaKits() {
  const { clientId, catalogo } = useMesa();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const { kitId, escolherKit, selecionadas, setSelecionadas, irPara } = useMesaFoto();
  const fotos = useFotos(clientId);
  const kits = useKits(clientId);
  const todas = useMemo(() => fotos.data || [], [fotos.data]);
  const lista = useMemo(() => kits.data || [], [kits.data]);
  const kitSalvo = kitId ? lista.find((k) => k.id === kitId) || null : null;

  const [editando, setEditando] = useState<KitDeFoto | null>(null);
  const [textos, setTextos] = useState<Textos>(textosDoKit(kitVazio(clientId)));
  const [propostas, setPropostas] = useState<PropostaDeKit[]>([]);
  const [escolhendo, setEscolhendo] = useState(false);
  const [salvando, setSalvando] = useState(false);

  // Kit escolhido na barra (ou pela URL): o editor abre nele.
  useEffect(() => {
    if (kitSalvo && (!editando || editando.id !== kitSalvo.id)) {
      setEditando(kitSalvo);
      setTextos(textosDoKit(kitSalvo));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kitSalvo ? kitSalvo.id : null, kitSalvo ? kitSalvo.atualizado_em : null]);

  const abrirNovo = (base?: KitDeFoto) => {
    const k = base ? { ...base, id: null, client_id: clientId } : kitVazio(clientId);
    setEditando(k);
    setTextos(textosDoKit(k));
    escolherKit(null);
  };

  const comFotos = (ids: string[]) => {
    if (!editando) return;
    const novas = editando.refs.slice();
    ids.forEach((id) => {
      if (!novas.some((r) => r.imagem_id === id)) novas.push({ imagem_id: id, papel: novas.length ? "detalhe" : "identidade", vista: "", prioridade: novas.length });
    });
    setEditando({ ...editando, refs: novas });
  };

  const salvar = async () => {
    if (!editando) return;
    const kit = kitDoEditor(editando, textos);
    if (!kit.nome.trim()) {
      toast.error("Dê um nome ao kit", { description: "Ex.: Mouse sem fio M720, Prato executivo, Dra. Ana." });
      return;
    }
    if (faltaAutorizacao(kit)) {
      toast.error("Falta a autorização", { description: "Kit de pessoa só salva com a autorização do cliente confirmada." });
      return;
    }
    setSalvando(true);
    try {
      const salvo = await salvarKit(clientId, kit);
      toast.success(kit.id ? "Kit atualizado" : "Kit criado");
      void queryClient.invalidateQueries({ queryKey: chaveDosKits(clientId) });
      setEditando(salvo);
      setTextos(textosDoKit(salvo));
      if (salvo.id) escolherKit(salvo.id);
    } catch (e) {
      avisarErro(e, "Kit não salvo");
    } finally {
      setSalvando(false);
    }
  };

  const avisos = editando ? avisosDoKit(kitDoEditor(editando, textos), todas) : [];
  const idsNoKit = editando ? editando.refs.map((r) => r.imagem_id) : [];
  const selecionadasFora = selecionadas.filter((id) => idsNoKit.indexOf(id) < 0);

  return (
    <div className="min-w-0 space-y-4 pb-24">
      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="min-w-0 space-y-3">
          <Cartao
            titulo="Kits do cliente"
            acao={
              <Button type="button" size="sm" variant="outline" className="h-8 text-[12px]" onClick={() => abrirNovo()}>
                <Plus className="mr-1 h-3.5 w-3.5" /> Novo
              </Button>
            }
          >
            {kits.isLoading && (
              <p className="flex items-center text-[12px] text-muted-foreground">
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Lendo os kits...
              </p>
            )}
            {kits.isError && <AvisoDeErro erro={kits.error} />}
            {kits.isSuccess && lista.length === 0 && <p className="text-[12px] text-muted-foreground">Nenhum kit ainda. Selecione fotos no Acervo e peça uma sugestão, ou crie um novo.</p>}
            <ul className="space-y-1.5">
              {lista.map((k) => {
                const capa = todas.find((f) => f.id === (k.frente_imagem_id || (k.refs[0] && k.refs[0].imagem_id)));
                const ativo = editando && editando.id === k.id;
                return (
                  <li key={String(k.id)}>
                    <button
                      type="button"
                      onClick={() => escolherKit(k.id)}
                      aria-current={ativo ? "true" : undefined}
                      className={`flex w-full min-w-0 items-center rounded-lg border p-1.5 text-left transition-colors ${ativo ? "border-primary bg-primary/5" : "border-transparent hover:bg-muted"}`}
                    >
                      <span className="w-10 shrink-0">{capa ? <MiniaturaDaFoto foto={capa} selo={false} /> : <span className="block h-10 w-10 rounded-lg bg-muted" />}</span>
                      <span className="ml-2 min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] font-medium">{k.nome}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {rotuloDoTipo(k.tipo)} · {k.refs.length} {k.refs.length === 1 ? "foto" : "fotos"}
                          {k.lacunas.length ? ` · ${k.lacunas.length} ${k.lacunas.length === 1 ? "lacuna" : "lacunas"}` : ""}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Cartao>

          <Cartao titulo="Sugerir kit" dica="A leitura olha as fotos marcadas, separa assunto de embalagem e estilo, e propõe papéis, atributos e lacunas. Nada é salvo sem você.">
            {selecionadas.length === 0 ? (
              <p className="text-[12px] text-muted-foreground">
                Marque as fotos no{" "}
                <button type="button" className="font-medium text-primary hover:underline" onClick={() => irPara("acervo")}>
                  Acervo
                </button>{" "}
                para pedir a sugestão.
              </p>
            ) : (
              <>
                <BotaoComCusto
                  rotulo={
                    <>
                      <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Sugerir com {selecionadas.length} {selecionadas.length === 1 ? "foto" : "fotos"}
                    </>
                  }
                  titulo="Kit sugerido"
                  className="h-8 w-full text-[12px]"
                  disabled={selecionadas.length > MAX_FOTOS_NA_SUGESTAO}
                  partes={() => partesDaSugestao(catalogo, selecionadas.length)}
                  executar={() => sugerirKit(clientId, selecionadas)}
                  aoConcluir={(data) => {
                    const p = (data && data.propostas) || [];
                    setPropostas(p);
                    if (!p.length) toast.info("A leitura não conseguiu propor um kit com estas fotos.");
                    const fora = (data && data.nao_agrupadas) || [];
                    if (fora.length) {
                      toast.info(`${fora.length} ${fora.length === 1 ? "foto ficou" : "fotos ficaram"} fora das propostas`, {
                        description: fora
                          .slice(0, 3)
                          .map((x) => {
                            const f = todas.find((y) => y.id === x.imagem_id);
                            return `${f ? f.nome : "foto"}: ${x.motivo || "não serve de evidência"}`;
                          })
                          .join(". "),
                        duration: 9000,
                      });
                    }
                  }}
                />
                {selecionadas.length > MAX_FOTOS_NA_SUGESTAO && (
                  <p className="mt-1.5 text-[11.5px] text-warning">A leitura olha até {MAX_FOTOS_NA_SUGESTAO} fotos por vez. Desmarque algumas no Acervo.</p>
                )}
              </>
            )}
          </Cartao>
        </aside>

        <div className="min-w-0 space-y-4">
          {propostas.length > 0 && (
            <Cartao
              titulo="Propostas da leitura"
              dica="Confira modelo e variante. O que a leitura não viu fica como lacuna."
              acao={
                <button type="button" className="text-[12px] text-muted-foreground hover:text-foreground" onClick={() => setPropostas([])}>
                  Dispensar
                </button>
              }
            >
              <div className="space-y-2">
                {propostas.map((p, i) => (
                  <CartaoDaProposta
                    key={i}
                    proposta={p}
                    fotos={todas}
                    onUsar={() => {
                      abrirNovo(p);
                      setPropostas([]);
                    }}
                  />
                ))}
              </div>
            </Cartao>
          )}

          {!editando ? (
            <Vazio
              titulo="Escolha um kit ou crie um novo"
              acao={
                <Button type="button" size="sm" className="h-8 text-[12px]" onClick={() => abrirNovo()}>
                  <Plus className="mr-1 h-3.5 w-3.5" /> Novo kit
                </Button>
              }
            >
              O kit guarda a identidade do assunto: quais fotos provam como ele é, o que não pode mudar e o que ainda falta fotografar.
            </Vazio>
          ) : (
            <Cartao
              titulo={editando.id ? "Editar kit" : "Novo kit"}
              acao={
                editando.id ? (
                  <Button type="button" size="sm" variant="outline" className="h-8 text-[12px]" onClick={() => irPara("ensaio", { kit: editando.id })}>
                    <Camera className="mr-1.5 h-3.5 w-3.5" /> Montar ensaio
                  </Button>
                ) : undefined
              }
            >
              <div className="space-y-4">
                <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="block min-w-0">
                    <span className="mb-1 block text-[11.5px] text-muted-foreground">Nome</span>
                    <Input value={editando.nome} onChange={(e) => setEditando({ ...editando, nome: e.target.value })} placeholder="Ex.: Mouse sem fio M720" className="h-9" aria-label="Nome do kit" />
                  </label>
                  <label className="block min-w-0">
                    <span className="mb-1 block text-[11.5px] text-muted-foreground">Variante (cor, tamanho, sabor)</span>
                    <Input value={editando.variante} onChange={(e) => setEditando({ ...editando, variante: e.target.value })} placeholder="Ex.: grafite" className="h-9" aria-label="Variante" />
                  </label>
                </div>
                <div>
                  <p className="mb-1 text-[11.5px] text-muted-foreground">Tipo</p>
                  <Pilulas rotulo="Tipo do kit" opcoes={TIPOS_DE_KIT} valor={editando.tipo} onEscolher={(t) => setEditando({ ...editando, tipo: t })} />
                </div>
                {editando.tipo === "pessoa" && <Autorizacao kit={editando} onMudar={setEditando} />}

                <div className="space-y-2">
                  <div className="flex min-w-0 flex-wrap items-center">
                    <p className="mr-auto text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Fontes do kit</p>
                    {selecionadasFora.length > 0 && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="mb-1 mr-1.5 h-8 text-[12px]"
                        onClick={() => {
                          comFotos(selecionadasFora);
                          setSelecionadas([]);
                        }}
                      >
                        <Plus className="mr-1 h-3.5 w-3.5" /> As {selecionadasFora.length} marcadas no Acervo
                      </Button>
                    )}
                    <Button type="button" size="sm" variant="outline" className="mb-1 h-8 text-[12px]" onClick={() => setEscolhendo(true)}>
                      <Images className="mr-1.5 h-3.5 w-3.5" /> Do acervo
                    </Button>
                  </div>
                  {escolhendo && (
                    <SeletorDeFotos
                      fotos={todas}
                      titulo="Fotos para o kit"
                      jaEscolhidas={idsNoKit}
                      filtroInicial="original"
                      onUsar={(ids) => {
                        comFotos(ids);
                        setEscolhendo(false);
                      }}
                      onFechar={() => setEscolhendo(false)}
                    />
                  )}
                  {editando.refs.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-border p-3 text-[12px] text-muted-foreground">
                      Nenhuma foto ainda. Produto: frente, três quartos, laterais, verso, detalhes e a embalagem em separado. Pessoa: frente, três quartos e expressão natural, só autorizadas.
                    </p>
                  ) : (
                    <ul className="grid min-w-0 grid-cols-1 gap-2 xl:grid-cols-2">
                      {editando.refs.map((r, i) => (
                        <FonteDoKit
                          key={`${r.imagem_id}-${i}`}
                          refDoKit={r}
                          foto={todas.find((f) => f.id === r.imagem_id) || null}
                          indice={i}
                          frente={editando.frente_imagem_id === r.imagem_id}
                          onMudar={(nova) => setEditando({ ...editando, refs: editando.refs.map((x, j) => (j === i ? nova : x)) })}
                          onTirar={() =>
                            setEditando({
                              ...editando,
                              refs: editando.refs.filter((_, j) => j !== i),
                              frente_imagem_id: editando.frente_imagem_id === r.imagem_id ? null : editando.frente_imagem_id,
                            })
                          }
                          onSubir={() => {
                            const nova = editando.refs.slice();
                            const [item] = nova.splice(i, 1);
                            nova.splice(i - 1, 0, item);
                            setEditando({ ...editando, refs: nova });
                          }}
                          onFrente={() => setEditando({ ...editando, frente_imagem_id: r.imagem_id })}
                        />
                      ))}
                    </ul>
                  )}
                </div>

                <div className="space-y-2">
                  <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Atributos (um por linha)</p>
                  <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-3">
                    {(
                      [
                        { campo: "observado", rotulo: "Observado", dica: "Visto nas fotos. Ex.: logo no topo, 2 botões laterais." },
                        { campo: "informado", rotulo: "Informado", dica: "O cliente disse. Ex.: 12 cm de comprimento." },
                        { campo: "inferido", rotulo: "Inferido", dica: "Deduzido, a confirmar. Não vira verdade na geração." },
                      ] as { campo: keyof Textos; rotulo: string; dica: string }[]
                    ).map((c) => (
                      <label key={c.campo} className="block min-w-0">
                        <span className="mb-1 block text-[11.5px] font-medium">{c.rotulo}</span>
                        <Textarea value={textos[c.campo]} onChange={(e) => setTextos({ ...textos, [c.campo]: e.target.value })} rows={4} placeholder={c.dica} aria-label={`Atributos ${c.rotulo.toLowerCase()}`} className="text-[12.5px]" />
                      </label>
                    ))}
                  </div>
                </div>

                <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2">
                  <label className="block min-w-0">
                    <span className="mb-1 block text-[11.5px] font-medium">Não pode mudar (invariantes)</span>
                    <Textarea value={textos.invariantes} onChange={(e) => setTextos({ ...textos, invariantes: e.target.value })} rows={4} placeholder={"Ex.: texto do rótulo\nquantidade de botões\ncor grafite"} aria-label="Invariantes" className="text-[12.5px]" />
                  </label>
                  <label className="block min-w-0">
                    <span className="mb-1 block text-[11.5px] font-medium text-warning">Lacunas (o que falta documentar)</span>
                    <Textarea value={textos.lacunas} onChange={(e) => setTextos({ ...textos, lacunas: e.target.value })} rows={4} placeholder={"Ex.: vista inferior não documentada\nverso sem foto"} aria-label="Lacunas" className="text-[12.5px]" />
                  </label>
                </div>

                {avisos.length > 0 && (
                  <ul className="space-y-1 rounded-lg bg-warning/10 p-3" data-avisos-do-kit="">
                    {avisos.map((a) => (
                      <li key={a} className="flex items-start text-[12px] leading-snug">
                        <AlertTriangle className="mr-1.5 mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" /> {a}
                      </li>
                    ))}
                  </ul>
                )}

                <div className="flex flex-wrap items-center justify-end">
                  {editando.refs.length > 0 && (
                    <span className="mb-1.5 mr-auto">
                      {todas
                        .filter((f) => idsNoKit.indexOf(f.id) >= 0 && classeDaFoto(f) === "gerada")
                        .slice(0, 1)
                        .map((f) => (
                          <SeloDaFoto key={f.id} foto={f} compacto />
                        ))}
                    </span>
                  )}
                  <Button type="button" size="sm" className="mb-1.5 h-9 text-[12.5px]" disabled={salvando || faltaAutorizacao(editando)} onClick={() => void salvar()}>
                    {salvando && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                    {editando.id ? "Salvar kit" : "Criar kit"}
                  </Button>
                </div>
              </div>
            </Cartao>
          )}
        </div>
      </div>
    </div>
  );
}
