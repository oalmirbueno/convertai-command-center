import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Plus, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AvisoDeErro, BotaoComCusto, useAvisarErro } from "@/components/mesa/Custo";
import { useMesa } from "@/components/mesa/MesaContexto";
import { dataEHora } from "@/lib/mesa/api";
import {
  ACOES_DO_OBJETIVO,
  briefingParaSalvar,
  briefingVazio,
  chamarAds,
  chavesAds,
  DESTINOS,
  ESTAGIOS,
  lerBriefing,
  normalizarBriefing,
  partesDoBriefing,
  TIPOS_DE_PROVA,
  type BriefingAds,
  type TipoDeProva,
} from "./adsApi";
import { Andamento, Campo, Cartao, useAndamento } from "./Comuns";

/**
 * Etapa 1, Oferta: o briefing de performance do cliente em cartões. "Sugerir
 * pelo contexto" lê kit, dossiê e métricas e propõe; campo sem dado aparece
 * como lacuna, nunca preenchido por suposição. A equipe edita e salva (nova
 * versão atual). Nada grava sozinho.
 */

const vazio = (v: string) => !v || !v.trim();

const campoPequeno = "h-9 text-[13px]";
const areaPequena = "min-h-[64px] text-[13px] leading-relaxed";

function SelecaoEmPilulas<T extends string>({
  valor,
  opcoes,
  onMudar,
  rotulo,
}: {
  valor: T | "";
  opcoes: { valor: T; rotulo: string }[];
  onMudar: (v: T | "") => void;
  rotulo: string;
}) {
  return (
    <div className="flex flex-wrap" role="radiogroup" aria-label={rotulo}>
      {opcoes.map((o) => {
        const ativa = valor === o.valor;
        return (
          <button
            key={o.valor}
            type="button"
            role="radio"
            aria-checked={ativa}
            onClick={() => onMudar(ativa ? "" : o.valor)}
            className={`mb-1.5 mr-1.5 rounded-full border px-2.5 py-1 text-[12px] transition-colors ${
              ativa ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground hover:text-foreground"
            }`}
          >
            {o.rotulo}
          </button>
        );
      })}
    </div>
  );
}

function BotaoRemover({ onClick, rotulo }: { onClick: () => void; rotulo: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={rotulo} title={rotulo} className="ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground">
      <X className="h-3.5 w-3.5" />
    </button>
  );
}

function BotaoAdicionar({ onClick, children }: { onClick: () => void; children: string }) {
  return (
    <Button type="button" size="sm" variant="ghost" className="h-8 px-2 text-[12px] text-muted-foreground" onClick={onClick}>
      <Plus className="mr-1 h-3.5 w-3.5" /> {children}
    </Button>
  );
}

export default function AbaOferta() {
  const { clientId, catalogo } = useMesa();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const salvo = useQuery({ queryKey: chavesAds.briefing(clientId), queryFn: () => lerBriefing(clientId) });
  const [rascunho, setRascunho] = useState<BriefingAds>(briefingVazio());
  const [lacunasSugeridas, setLacunasSugeridas] = useState<string[] | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [desde, rodar] = useAndamento();

  const base = useMemo(() => (salvo.data ? normalizarBriefing(salvo.data) : briefingVazio()), [salvo.data]);
  const idSalvo = salvo.data ? salvo.data.id : null;
  // Briefing lido (ou salvo de novo): o formulário volta ao que está no banco.
  useEffect(() => {
    setRascunho(base);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idSalvo, salvo.isSuccess]);

  const mudou = JSON.stringify(rascunho) !== JSON.stringify(base);
  const b = rascunho;
  const mudar = (fn: (b: BriefingAds) => BriefingAds) => setRascunho((atual) => fn(JSON.parse(JSON.stringify(atual))));

  const salvar = async () => {
    setSalvando(true);
    try {
      await chamarAds("briefing_salvar", { client_id: clientId, briefing: briefingParaSalvar(rascunho) });
      toast.success("Briefing salvo", { description: "Virou a versão atual do cliente." });
      setLacunasSugeridas(null);
      await queryClient.invalidateQueries({ queryKey: chavesAds.briefing(clientId) });
    } catch (e) {
      avisarErro(e, "Briefing não salvo");
    } finally {
      setSalvando(false);
    }
  };

  const contagemDeLacunas = [
    b.oferta.produto, b.oferta.promessa, b.oferta.condicao, b.oferta.preco_confirmado, b.oferta.garantia,
    b.publico.quem, b.publico.estagio_consciencia, b.destino.tipo, b.destino.primeira_mensagem, b.objetivo.acao, b.objetivo.metrica_principal,
  ].filter((v) => vazio(String(v))).length +
    (b.publico.situacoes.length ? 0 : 1) + (b.provas.length ? 0 : 1) + (b.objecoes.length ? 0 : 1);

  if (salvo.isLoading) {
    return (
      <p className="inline-flex items-center text-[12.5px] text-muted-foreground">
        <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Lendo o briefing…
      </p>
    );
  }

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex min-w-0 flex-wrap items-center rounded-xl border border-border bg-card px-4 py-3">
        <div className="mb-1 mr-3 mt-1 min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold">Briefing de performance</h2>
          <p className="text-[12px] text-muted-foreground">
            {salvo.data ? `Versão ${salvo.data.versao} · salva ${dataEHora(salvo.data.criado_em)}` : "Ainda sem briefing salvo"}
            {" · "}
            <span className={contagemDeLacunas ? "text-warning" : "text-success"}>
              {contagemDeLacunas ? `${contagemDeLacunas} lacuna${contagemDeLacunas === 1 ? "" : "s"}` : "sem lacunas"}
            </span>
          </p>
        </div>
        <div className="mb-1 mt-1 flex shrink-0 items-center">
          <Andamento desde={desde} rotulo="Lendo o contexto" />
          <BotaoComCusto
            rotulo={<><Sparkles className="mr-1 h-3.5 w-3.5" /> Sugerir pelo contexto</>}
            titulo="Sugerir o briefing"
            descricao="Lê o kit, o contexto, o dossiê e as métricas de anúncios do cliente e propõe o briefing. O que não tiver dado fica como lacuna. Nada é gravado sem você salvar."
            variant="outline"
            className="ml-2 h-9"
            partes={() => partesDoBriefing(catalogo)}
            executar={() => rodar(() => chamarAds<any>("briefing_sugerir", { client_id: clientId }))}
            aoConcluir={(data) => {
              const sugestao = data && (data.sugestao || data.briefing);
              if (sugestao) setRascunho(normalizarBriefing(sugestao));
              setLacunasSugeridas(Array.isArray(data?.lacunas) ? data.lacunas.map((l: unknown) => String(l)) : []);
            }}
          />
          <Button type="button" size="sm" className="ml-2 h-9" disabled={!mudou || salvando} onClick={() => void salvar()}>
            {salvando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1 h-3.5 w-3.5" />}
            Salvar briefing
          </Button>
        </div>
      </div>

      {salvo.isError && <AvisoDeErro erro={salvo.error} />}

      {lacunasSugeridas && (
        <div className="rounded-xl border border-warning/40 bg-warning/5 px-4 py-3" role="note">
          <p className="text-[12.5px] font-medium">Sugestão pelo contexto: confira, complete e salve.</p>
          {lacunasSugeridas.length > 0 ? (
            <>
              <p className="mt-0.5 text-[12px] text-muted-foreground">Sem dado real para:</p>
              <ul className="mt-1 flex flex-wrap">
                {lacunasSugeridas.map((l) => (
                  <li key={l} className="mb-1 mr-1.5 rounded-full bg-warning/15 px-2 py-0.5 text-[11.5px] text-warning">{l}</li>
                ))}
              </ul>
            </>
          ) : (
            <p className="mt-0.5 text-[12px] text-muted-foreground">O contexto cobriu os campos principais.</p>
          )}
        </div>
      )}

      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
        <Cartao titulo="Oferta" dica="O que se vende, a promessa e a condição. Preço só confirmado pelo cliente.">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Campo rotulo="Produto ou serviço" lacuna={vazio(b.oferta.produto)}>
              <Input aria-label="Produto ou serviço" className={campoPequeno} value={b.oferta.produto} onChange={(e) => { const v = e.target.value; mudar((x) => { x.oferta.produto = v; return x; }); }} />
            </Campo>
            <Campo rotulo="Preço confirmado" lacuna={vazio(b.oferta.preco_confirmado)}>
              <Input aria-label="Preço confirmado" className={campoPequeno} value={b.oferta.preco_confirmado} placeholder="Só o que o cliente confirmou" onChange={(e) => { const v = e.target.value; mudar((x) => { x.oferta.preco_confirmado = v; return x; }); }} />
            </Campo>
            <div className="sm:col-span-2">
              <Campo rotulo="Promessa" lacuna={vazio(b.oferta.promessa)}>
                <Textarea aria-label="Promessa" className={areaPequena} value={b.oferta.promessa} onChange={(e) => { const v = e.target.value; mudar((x) => { x.oferta.promessa = v; return x; }); }} />
              </Campo>
            </div>
            <Campo rotulo="Condição" lacuna={vazio(b.oferta.condicao)}>
              <Input aria-label="Condição" className={campoPequeno} value={b.oferta.condicao} onChange={(e) => { const v = e.target.value; mudar((x) => { x.oferta.condicao = v; return x; }); }} />
            </Campo>
            <Campo rotulo="Garantia" lacuna={vazio(b.oferta.garantia)}>
              <Input aria-label="Garantia" className={campoPequeno} value={b.oferta.garantia} onChange={(e) => { const v = e.target.value; mudar((x) => { x.oferta.garantia = v; return x; }); }} />
            </Campo>
          </div>
        </Cartao>

        <Cartao
          titulo="Público e situações"
          dica="Quem compra e as situações vividas, cada uma com a fonte (entrevista, avaliação, conversa, dado)."
          acao={<BotaoAdicionar onClick={() => mudar((x) => { x.publico.situacoes.push({ texto: "", fonte: "" }); return x; })}>Situação</BotaoAdicionar>}
        >
          <div className="space-y-3">
            <Campo rotulo="Quem" lacuna={vazio(b.publico.quem)}>
              <Textarea aria-label="Quem compra" className={areaPequena} value={b.publico.quem} onChange={(e) => { const v = e.target.value; mudar((x) => { x.publico.quem = v; return x; }); }} />
            </Campo>
            {b.publico.situacoes.length === 0 && (
              <p className="rounded-md border border-dashed border-warning/50 px-3 py-2 text-[12px] text-muted-foreground">Lacuna: nenhuma situação com fonte.</p>
            )}
            {b.publico.situacoes.map((s, i) => (
              <div key={i} className="flex min-w-0 items-start">
                <div className="grid min-w-0 flex-1 grid-cols-1 gap-1.5 sm:grid-cols-3">
                  <Input aria-label={`Situação ${i + 1}`} className={`${campoPequeno} sm:col-span-2`} placeholder="Situação vivida" value={s.texto} onChange={(e) => { const v = e.target.value; mudar((x) => { x.publico.situacoes[i].texto = v; return x; }); }} />
                  <Input aria-label={`Fonte da situação ${i + 1}`} className={`${campoPequeno} ${vazio(s.fonte) ? "border-warning/60" : ""}`} placeholder="Fonte" value={s.fonte} onChange={(e) => { const v = e.target.value; mudar((x) => { x.publico.situacoes[i].fonte = v; return x; }); }} />
                </div>
                <BotaoRemover rotulo={`Tirar a situação ${i + 1}`} onClick={() => mudar((x) => { x.publico.situacoes.splice(i, 1); return x; })} />
              </div>
            ))}
            <Campo rotulo="Motivações (separe por vírgula)" lacuna={b.publico.motivacoes.length === 0}>
              <Input
                aria-label="Motivações"
                className={campoPequeno}
                defaultValue={b.publico.motivacoes.join(", ")}
                key={b.publico.motivacoes.join("|")}
                onBlur={(e) => { const v = e.target.value; mudar((x) => { x.publico.motivacoes = v.split(",").map((m) => m.trim()).filter(Boolean); return x; }); }}
              />
            </Campo>
          </div>
        </Cartao>

        <Cartao titulo="Estágio de consciência" dica="Onde o comprador típico está. Decide por onde o anúncio começa.">
          <div className={`space-y-1.5 rounded-md ${b.publico.estagio_consciencia ? "" : "ring-1 ring-warning/50"}`} role="radiogroup" aria-label="Estágio de consciência">
            {ESTAGIOS.map((e) => {
              const ativo = b.publico.estagio_consciencia === e.valor;
              return (
                <button
                  key={e.valor}
                  type="button"
                  role="radio"
                  aria-checked={ativo}
                  onClick={() => mudar((x) => { x.publico.estagio_consciencia = ativo ? "" : e.valor; return x; })}
                  className={`flex w-full min-w-0 items-start rounded-lg border px-3 py-2 text-left transition-colors ${
                    ativo ? "border-primary bg-primary/5" : "border-border bg-background hover:border-primary/40"
                  }`}
                >
                  <span className={`mr-2.5 mt-1 h-2.5 w-2.5 shrink-0 rounded-full border ${ativo ? "border-primary bg-primary" : "border-muted-foreground/40"}`} />
                  <span className="min-w-0">
                    <span className="block text-[12.5px] font-medium">{e.rotulo}</span>
                    <span className="block text-[11.5px] leading-snug text-muted-foreground">{e.dica}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </Cartao>

        <Cartao
          titulo="Objeções"
          dica="O que trava a compra, a resposta e de onde veio."
          acao={<BotaoAdicionar onClick={() => mudar((x) => { x.objecoes.push({ texto: "", resposta: "", fonte: "" }); return x; })}>Objeção</BotaoAdicionar>}
        >
          <div className="space-y-2.5">
            {b.objecoes.length === 0 && <p className="rounded-md border border-dashed border-warning/50 px-3 py-2 text-[12px] text-muted-foreground">Lacuna: nenhuma objeção registrada.</p>}
            {b.objecoes.map((o, i) => (
              <div key={i} className="flex min-w-0 items-start rounded-lg border border-border p-2">
                <div className="grid min-w-0 flex-1 grid-cols-1 gap-1.5">
                  <Input aria-label={`Objeção ${i + 1}`} className={campoPequeno} placeholder="Objeção" value={o.texto} onChange={(e) => { const v = e.target.value; mudar((x) => { x.objecoes[i].texto = v; return x; }); }} />
                  <Input aria-label={`Resposta da objeção ${i + 1}`} className={`${campoPequeno} ${vazio(o.resposta) ? "border-warning/60" : ""}`} placeholder="Resposta" value={o.resposta} onChange={(e) => { const v = e.target.value; mudar((x) => { x.objecoes[i].resposta = v; return x; }); }} />
                  <Input aria-label={`Fonte da objeção ${i + 1}`} className={`${campoPequeno} ${vazio(o.fonte) ? "border-warning/60" : ""}`} placeholder="Fonte" value={o.fonte} onChange={(e) => { const v = e.target.value; mudar((x) => { x.objecoes[i].fonte = v; return x; }); }} />
                </div>
                <BotaoRemover rotulo={`Tirar a objeção ${i + 1}`} onClick={() => mudar((x) => { x.objecoes.splice(i, 1); return x; })} />
              </div>
            ))}
          </div>
        </Cartao>

        <Cartao
          titulo="Provas"
          dica="Só a prova que o cliente tem. Depoimento e número só entram no anúncio com autorização."
          acao={<BotaoAdicionar onClick={() => mudar((x) => { x.provas.push({ tipo: "depoimento", texto: "", fonte: "", autorizado: false, periodo: "" }); return x; })}>Prova</BotaoAdicionar>}
        >
          <div className="space-y-2.5">
            {b.provas.length === 0 && <p className="rounded-md border border-dashed border-warning/50 px-3 py-2 text-[12px] text-muted-foreground">Lacuna: nenhuma prova registrada.</p>}
            {b.provas.map((p, i) => (
              <div key={i} className="flex min-w-0 items-start rounded-lg border border-border p-2">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex min-w-0 flex-wrap items-center">
                    <select
                      aria-label={`Tipo da prova ${i + 1}`}
                      value={p.tipo}
                      onChange={(e) => { const v = e.target.value as TipoDeProva; mudar((x) => { x.provas[i].tipo = v; return x; }); }}
                      className="mb-1 mr-2 h-8 rounded-md border border-input bg-background px-2 text-[12.5px]"
                    >
                      {TIPOS_DE_PROVA.map((t) => <option key={t.valor} value={t.valor}>{t.rotulo}</option>)}
                    </select>
                    <label className="mb-1 inline-flex items-center text-[12px]">
                      <input
                        type="checkbox"
                        checked={p.autorizado}
                        onChange={(e) => { const v = e.target.checked; mudar((x) => { x.provas[i].autorizado = v; return x; }); }}
                        className="mr-1.5 h-3.5 w-3.5 accent-primary"
                      />
                      autorizado
                    </label>
                    {!p.autorizado && <span className="mb-1 ml-2 text-[11px] text-warning">não vai para o anúncio</span>}
                  </div>
                  <Textarea aria-label={`Prova ${i + 1}`} className="min-h-[52px] text-[13px]" placeholder="O que a prova mostra" value={p.texto} onChange={(e) => { const v = e.target.value; mudar((x) => { x.provas[i].texto = v; return x; }); }} />
                  <div className="grid grid-cols-2 gap-1.5">
                    <Input aria-label={`Fonte da prova ${i + 1}`} className={`${campoPequeno} ${vazio(p.fonte) ? "border-warning/60" : ""}`} placeholder="Fonte" value={p.fonte} onChange={(e) => { const v = e.target.value; mudar((x) => { x.provas[i].fonte = v; return x; }); }} />
                    <Input aria-label={`Período da prova ${i + 1}`} className={campoPequeno} placeholder="Período" value={p.periodo} onChange={(e) => { const v = e.target.value; mudar((x) => { x.provas[i].periodo = v; return x; }); }} />
                  </div>
                </div>
                <BotaoRemover rotulo={`Tirar a prova ${i + 1}`} onClick={() => mudar((x) => { x.provas.splice(i, 1); return x; })} />
              </div>
            ))}
          </div>
        </Cartao>

        <Cartao titulo="Destino" dica="Para onde o clique vai e a primeira mensagem que a pessoa manda.">
          <div className="space-y-3">
            <div className={`rounded-md ${b.destino.tipo ? "" : "ring-1 ring-warning/50"}`}>
              <SelecaoEmPilulas rotulo="Tipo de destino" valor={b.destino.tipo} opcoes={DESTINOS} onMudar={(v) => mudar((x) => { x.destino.tipo = v; return x; })} />
            </div>
            <Campo rotulo="Endereço" lacuna={vazio(b.destino.url) && b.destino.tipo !== "direct" && b.destino.tipo !== "ligacao"}>
              <Input aria-label="Endereço do destino" className={campoPequeno} value={b.destino.url} placeholder="https://" onChange={(e) => { const v = e.target.value; mudar((x) => { x.destino.url = v; return x; }); }} />
            </Campo>
            <Campo rotulo="Primeira mensagem" lacuna={vazio(b.destino.primeira_mensagem)} dica="O texto que já vem escrito no WhatsApp ou no Direct.">
              <Textarea aria-label="Primeira mensagem" className={areaPequena} value={b.destino.primeira_mensagem} onChange={(e) => { const v = e.target.value; mudar((x) => { x.destino.primeira_mensagem = v; return x; }); }} />
            </Campo>
          </div>
        </Cartao>

        <Cartao titulo="Objetivo e métrica" dica="A métrica que decide é a do negócio (lead qualificado, reunião, venda), não só o clique.">
          <div className="space-y-3">
            <div className={`rounded-md ${b.objetivo.acao ? "" : "ring-1 ring-warning/50"}`}>
              <SelecaoEmPilulas rotulo="Ação do objetivo" valor={b.objetivo.acao} opcoes={ACOES_DO_OBJETIVO} onMudar={(v) => mudar((x) => { x.objetivo.acao = v; return x; })} />
            </div>
            <Campo rotulo="Métrica principal" lacuna={vazio(b.objetivo.metrica_principal)}>
              <Input aria-label="Métrica principal" className={campoPequeno} value={b.objetivo.metrica_principal} placeholder="Ex.: conversa qualificada no WhatsApp" onChange={(e) => { const v = e.target.value; mudar((x) => { x.objetivo.metrica_principal = v; return x; }); }} />
            </Campo>
            <div className="grid grid-cols-2 gap-3">
              <Campo rotulo="Custo tolerável (R$)" lacuna={vazio(b.objetivo.custo_toleravel_brl)}>
                <Input aria-label="Custo tolerável" inputMode="decimal" className={campoPequeno} value={b.objetivo.custo_toleravel_brl} onChange={(e) => { const v = e.target.value; mudar((x) => { x.objetivo.custo_toleravel_brl = v; return x; }); }} />
              </Campo>
              <Campo rotulo="Verba diária (R$)" lacuna={vazio(b.objetivo.verba_diaria_brl)}>
                <Input aria-label="Verba diária" inputMode="decimal" className={campoPequeno} value={b.objetivo.verba_diaria_brl} onChange={(e) => { const v = e.target.value; mudar((x) => { x.objetivo.verba_diaria_brl = v; return x; }); }} />
              </Campo>
            </div>
          </div>
        </Cartao>

        <Cartao titulo="Restrições" dica="O que não pode aparecer: termos, promessas, pessoas, concorrentes, regras do setor.">
          <Textarea aria-label="Restrições" className="min-h-[120px] text-[13px] leading-relaxed" value={b.restricoes} onChange={(e) => { const v = e.target.value; mudar((x) => { x.restricoes = v; return x; }); }} />
        </Cartao>
      </div>

      {mudou && (
        <div className="sticky bottom-3 z-10 flex justify-end">
          <div className="flex items-center rounded-full border border-border bg-card px-3 py-1.5 shadow-md">
            <span className="mr-3 text-[12px] text-muted-foreground">Alterações não salvas</span>
            <Button type="button" size="sm" variant="ghost" className="h-8" onClick={() => { setRascunho(base); setLacunasSugeridas(null); }}>Descartar</Button>
            <Button type="button" size="sm" className="ml-1 h-8" disabled={salvando} onClick={() => void salvar()}>Salvar</Button>
          </div>
        </div>
      )}
    </div>
  );
}
