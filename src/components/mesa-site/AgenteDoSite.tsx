import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Globe, Loader2, Paperclip, Send, Square, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAvisarErro } from "@/components/mesa/Custo";
import { Ditado } from "@/components/mesa/Ditado";
import { useMarcaDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { chamarFuncao, modeloDoPapel, usd } from "@/lib/mesa/api";
import CartaoDeAcao, { CapacidadesDoAgente, OQuePossoFazer } from "@/components/agentes/CartaoDeAcao";
import ModeloDoAgente from "@/components/agentes/ModeloDoAgente";
import TextoDoAgente from "@/components/agentes/TextoDoAgente";
import { CaminhoDaMensagem } from "@/components/agentes/CaminhoPronto";
import AprendizadoDoAgente from "@/components/agentes/AprendizadoDoAgente";
import HistoricoDoAgente from "@/components/agentes/HistoricoDoAgente";
import BaseCitada from "./BaseCitada";
import { acoesDaMensagem, chamarAcaoDoAgente } from "@/lib/agentes/acoesDoAgente";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import CampoDoAgente, { focarNoFim } from "@/components/sistema/CampoDoAgente";
import { BotaoNovaConversa, useNovaConversa } from "@/components/sistema/NovaConversa";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import PainelDoAgente from "@/components/sistema/PainelDoAgente";
import { botao, conversa, etiqueta, juntar } from "@/components/sistema/estilos";
import { ehAberto, ROTULO_DO_ESTADO } from "../../../supabase/functions/_shared/motor-codigo";
import { CHAVES, chamarMotor, type LinhaDoSite, useGuardarSite, useTrabalhos } from "./siteApi";

/**
 * O diretor de site (papel `site`), fixo ao lado das etapas. Conversa com
 * anexos (prints, fotos, PDF de referência), conhece a marca, aprende o que a
 * equipe ensina e, quando a equipe pede uma mudança, monta o cartão com o
 * custo antes. Mudança de seção vira trabalho do motor de código: a conversa
 * mostra o estado ao vivo e o Parar.
 */

export const ATALHOS_DO_DIRETOR = [
  { rotulo: "Hero mais forte", texto: "Deixe o hero mais forte: título maior e mais contraste no botão." },
  { rotulo: "Construir o que falta", texto: "Construa as seções que ainda não foram construídas." },
  { rotulo: "Revisar", texto: "Revise o site (acessibilidade, celular e SEO)." },
  { rotulo: "Desfazer o último", texto: "Desfaça a última mudança do motor." },
  { rotulo: "Montar o mapa", texto: "Monte o mapa do site pelo briefing." },
  { rotulo: "Imagens que faltam", texto: "Gere as imagens que faltam nos slots do mapa." },
];

const CAPACIDADES = [
  "ajustar uma seção pelo motor de código (com Parar)",
  "construir as seções que faltam",
  "gerar outras 3 opções de conteúdo e escolher uma (na hora)",
  "gerar imagem com o GPT Image (nunca logo nem foto real)",
  "revisar acessibilidade, celular e SEO",
  "desfazer o último trabalho (volta o commit)",
  "montar o mapa do site pelo briefing (o Jev escolhe as seções)",
  "trocar, acrescentar ou tirar seção da biblioteca (hero, bento, prova social, pricing, FAQ, contato com mapa...)",
  "escolher o preset de estilo (na hora, com Desfazer)",
  "gerar as imagens que faltam nos slots do mapa",
  'aprender o que você ensinar ("nunca", "sempre", "não gostei")',
];

type Anexo = { path: string; nome: string; mime: string };

/** Anexos por mensagem (prints, fotos, PDF). */
const MAX_ANEXOS = 6;
/** O pedido que vai quando a mensagem é só o anexo. */
const TEXTO_SO_DE_ANEXOS = "Veja as referências anexas.";
/** Tamanho de uma mensagem ao diretor (a estimativa do chip do modelo). */
const PARTES_DA_CONVERSA = (modeloId: string) => [{ modeloId, tipo: "texto" as const, tokensEntrada: 9000, tokensSaida: 2500 }];
type Mensagem = { id: string | null; papel: "usuario" | "agente" | "sistema"; conteudo: string; anexos: unknown[]; custo_usd: number | null; nova?: boolean; aviso?: string | null; local?: string };

const nomeSeguro = (n: string) => n.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);

/** Trabalhos do motor que uma resposta criou (o Desfazer do item guarda o id). */
function trabalhosDaMensagem(anexos: unknown[]): string[] {
  const ids: string[] = [];
  acoesDaMensagem(anexos).forEach((a) =>
    (a.resultados || []).forEach((r: any) => {
      if (r && r.desfazer && r.desfazer.tipo === "trabalho" && typeof r.desfazer.trabalho_id === "string") ids.push(r.desfazer.trabalho_id);
    }),
  );
  return ids;
}

export default function AgenteDoSite({ site, rascunho, onRascunho, onIrPara }: { site: LinhaDoSite; rascunho: string; onRascunho: (v: string) => void; onIrPara: (etapa: string) => void }) {
  const { clientId, atualizarCusto, catalogo, catalogoCarregando } = useMesa();
  const { marca } = useMarcaDaMesa();
  const guardar = useGuardarSite(clientId, marca ? marca.id : null);
  // Modelo do agente escolhido na hora (vazio = o padrão do papel "site", como antes).
  const [modeloEscolhido, setModeloEscolhido] = useEstadoDaTela<string>("mesa-site:agente:modelo", "", { validar: (v) => typeof v === "string" });
  const modelo = modeloDoPapel(catalogo, "site", modeloEscolhido || null);
  const qc = useQueryClient();
  const avisarErro = useAvisarErro();
  const trabalhosQ = useTrabalhos(clientId, site.id);
  const trabalhos = trabalhosQ.data ? trabalhosQ.data.trabalhos : [];
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [lida, setLida] = useState(false);
  const [conversaId, setConversaId] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [nova, setNova] = useState(false);
  const [anexos, setAnexos] = useState<Anexo[]>([]);
  const [subindo, setSubindo] = useState(false);
  const listaRef = useRef<HTMLDivElement | null>(null);
  const arquivo = useRef<HTMLInputElement | null>(null);
  const campo = useRef<HTMLTextAreaElement | null>(null);
  // Histórico das conversas: trocar (nova, continuar uma antiga) relê a conversa ativa.
  const [releitura, setReleitura] = useState(0);
  const aoTrocarDeConversa = () => {
    setConversaId(null);
    setNova(false);
    setReleitura((n) => n + 1);
  };
  const novaConversa = useNovaConversa<Mensagem>({
    chave: `${clientId}:${site.id}`,
    enviando,
    mensagens,
    conversaId,
    limpar: () => {
      setMensagens([]);
      setConversaId(null);
      setNova(true);
    },
    restaurar: (c) => {
      setMensagens(c.mensagens);
      setConversaId(c.conversaId);
      setNova(false);
    },
  });

  useEffect(() => {
    let vivo = true;
    chamarFuncao<any>("mesa-site", { acao: "agente_historico", site_id: site.id })
      .then((d) => {
        if (!vivo) return;
        setConversaId(d && typeof d.conversa_id === "string" ? d.conversa_id : null);
        setMensagens((Array.isArray(d && d.mensagens) ? d.mensagens : []).map((m: any) => ({ id: m.id || null, papel: m.papel, conteudo: String(m.conteudo || ""), anexos: Array.isArray(m.anexos) ? m.anexos : [], custo_usd: null })));
        setLida(true);
      })
      .catch((e) => {
        if (!vivo) return;
        setLida(true);
        avisarErro(e, "A conversa anterior não foi lida");
      });
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site.id, releitura]);

  useEffect(() => {
    if (listaRef.current) listaRef.current.scrollTop = listaRef.current.scrollHeight;
  }, [mensagens.length, enviando]);

  const anexar = async (files: FileList | null) => {
    if (!files || !files.length) return;
    // Até 6 por mensagem: o que passar não sobe, e a tela diz quantos ficaram de fora (nada some calado).
    const cabem = Math.max(0, MAX_ANEXOS - anexos.length);
    const fora = files.length - cabem;
    if (fora > 0) toast.message(`Até ${MAX_ANEXOS} anexos por mensagem: ${fora} ${fora === 1 ? "ficou" : "ficaram"} de fora.`);
    if (!cabem) {
      if (arquivo.current) arquivo.current.value = "";
      return;
    }
    setSubindo(true);
    try {
      const novos: Anexo[] = [];
      for (const f of Array.from(files).slice(0, cabem)) {
        const path = `${clientId}/site/${site.id}/conversa/${Date.now().toString(36)}-${nomeSeguro(f.name)}`;
        const { error } = await supabase.storage.from("mesa").upload(path, f, { contentType: f.type || "application/octet-stream", upsert: false });
        if (error) throw error;
        novos.push({ path, nome: f.name, mime: f.type || "application/octet-stream" });
      }
      setAnexos((l) => l.concat(novos));
    } catch (e) {
      avisarErro(e, "O anexo não subiu");
    } finally {
      setSubindo(false);
      if (arquivo.current) arquivo.current.value = "";
    }
  };

  const reler = () => {
    void qc.invalidateQueries({ queryKey: CHAVES.trabalhos(site.id) });
    void qc.invalidateQueries({ queryKey: CHAVES.sites(clientId, marca ? marca.id : null) });
    atualizarCusto();
  };

  const enviar = async () => {
    const m = rascunho.trim();
    // Só o anexo também vai (um print de referência); o print que ainda sobe espera.
    if ((!m && !anexos.length) || enviando || subindo) return;
    const texto = m || TEXTO_SO_DE_ANEXOS;
    const local = `local-${Date.now()}`;
    const indo = anexos;
    setEnviando(true);
    setMensagens((l) => l.concat([{ id: null, papel: "usuario", conteudo: indo.length ? `${texto}\n(${indo.map((a) => a.nome).join(", ")})` : texto, anexos: [], custo_usd: null, local }]));
    onRascunho("");
    setAnexos([]);
    try {
      const d = await chamarFuncao<any>("mesa-site", {
        acao: "agente_conversar",
        site_id: site.id,
        mensagem: texto,
        conversa_id: conversaId || undefined,
        nova_conversa: nova || undefined,
        anexos: indo,
        // Só o escolhido vai: sem escolha, a função usa o padrão do papel (como antes).
        modelo_id: modeloEscolhido && modelo && modelo.id === modeloEscolhido ? modelo.id : undefined,
      });
      setNova(false);
      setConversaId(d && d.conversa_id ? String(d.conversa_id) : conversaId);
      if (d && acoesDaMensagem(Array.isArray(d.anexos) ? d.anexos : []).some((a) => !!a.executada_em)) reler();
      setMensagens((l) => l.concat([{ id: d && d.mensagem_id ? String(d.mensagem_id) : null, papel: "agente", conteudo: String((d && d.resposta) || ""), anexos: d && Array.isArray(d.anexos) ? d.anexos : [], custo_usd: d && typeof d.custo_usd === "number" ? d.custo_usd : null, nova: true, aviso: d && d.aviso_registro ? String(d.aviso_registro) : null }]));
      atualizarCusto();
    } catch (e) {
      // A mensagem que falha volta ao campo (com os anexos).
      setMensagens((l) => l.filter((x) => x.local !== local));
      avisarErro(e, "O diretor de site não respondeu");
      onRascunho(m);
      setAnexos(indo);
    } finally {
      setEnviando(false);
    }
  };

  const parar = async (id: string) => {
    try {
      await chamarMotor("parar", { trabalho_id: id });
      reler();
    } catch (e) {
      avisarErro(e, "Não foi possível parar");
    }
  };

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col" data-agente-do-site="">
      <PainelDoAgente
        titulo="Diretor de site"
        icone={<Globe className="h-4 w-4" />}
        descricao={site.nome}
        acoes={
          <>
            <HistoricoDoAgente chave={{ clientId, agente: "site", referenciaTipo: "mesa_site", referenciaId: site.id }} aoTrocar={aoTrocarDeConversa} />
            {mensagens.length > 0 && <BotaoNovaConversa onClick={novaConversa} desativado={enviando} />}
            <AjudaRecolhida rotulo="Como o diretor de site funciona">
              Peça em palavras simples e mande prints ou fotos de referência. Escolher a opção de conteúdo ele faz na hora, com Desfazer. Mudar ou construir seção, gerar conteúdo ou imagem vêm num cartão com o custo; depois de confirmar, o motor de código faz, com prévia ao vivo e o botão Parar. O que você ensinar vira regra.
              <CapacidadesDoAgente capacidades={CAPACIDADES} />
            </AjudaRecolhida>
          </>
        }
        rotuloDasMensagens="Conversa com o diretor de site"
        refDasMensagens={listaRef}
        compositor={
          <>
            <OQuePossoFazer
              capacidades={CAPACIDADES}
              mostrarCapacidades={false}
              atalhos={ATALHOS_DO_DIRETOR}
              onAtalho={(t) => {
                onRascunho(t);
                focarNoFim(campo, t);
              }}
            />
            {anexos.length > 0 && (
              <div className="flex flex-wrap" data-anexos="">
                {anexos.map((a) => (
                  <span key={a.path} className={juntar(etiqueta, "mb-1 mr-1 bg-muted")}>
                    <span className="max-w-[140px] truncate">{a.nome}</span>
                    <button type="button" className="ml-1" aria-label={`Tirar ${a.nome}`} onClick={() => setAnexos((l) => l.filter((x) => x.path !== a.path))}>
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <CampoDoAgente
              ref={campo}
              valor={rascunho}
              aoMudar={onRascunho}
              aoEnviar={() => void enviar()}
              maxLength={4000}
              placeholder="Ex.: o hero está fraco, deixa o título maior e o botão verde"
              aria-label="Mensagem ao diretor de site"
            />
            <div className="flex min-w-0 items-center justify-between">
              <div className="mr-2 min-w-0">
                <ModeloDoAgente catalogo={catalogo} modelo={modelo} escolhido={modeloEscolhido} onEscolher={setModeloEscolhido} partes={PARTES_DA_CONVERSA} carregando={catalogoCarregando} disabled={enviando} />
              </div>
              <div className="ml-auto flex min-w-0 items-center">
                <input ref={arquivo} type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={(e) => void anexar(e.target.files)} />
                <button type="button" className={juntar(botao.icone, "mr-1")} aria-label="Anexar arquivo" disabled={subindo || anexos.length >= MAX_ANEXOS} onClick={() => arquivo.current && arquivo.current.click()}>
                  {subindo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
                </button>
                <Ditado valor={rascunho} onChange={onRascunho} disabled={enviando} className="mr-1.5 min-w-0" />
                <button type="button" className={juntar(botao.primario, "h-9")} onClick={() => void enviar()} disabled={enviando || subindo || (!rascunho.trim() && !anexos.length)} aria-label="Enviar ao diretor de site">
                  {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </>
        }
      >
        {!mensagens.length && !lida && (
          <div className="space-y-2" aria-label="Lendo a conversa">
            <div className="mr-6 h-10 animate-pulse rounded-lg bg-muted" />
            <div className="ml-6 h-8 animate-pulse rounded-lg bg-muted" />
          </div>
        )}
        {!mensagens.length && lida && <p className={juntar(conversa.apoio, "leading-relaxed")}>Diga o que mudar no site. Quando custar, mostro o cartão com o custo antes.</p>}
        {mensagens.map((m, i) => {
          const acoes = acoesDaMensagem(m.anexos);
          const doMotor = m.papel === "agente" ? trabalhosDaMensagem(m.anexos) : [];
          return (
            <div key={m.id || m.local || `m-${i}`} className="min-w-0">
              <div className={juntar(conversa.balao, m.papel === "usuario" ? conversa.doUsuario : m.papel === "sistema" ? "bg-muted text-muted-foreground" : conversa.doAgente)}>
                <TextoDoAgente texto={m.conteudo} clientId={clientId} />
                {m.custo_usd !== null && <p className="mt-1 text-[12px] text-muted-foreground">Custo: {usd(m.custo_usd)}</p>}
              </div>
              {m.papel === "agente" && m.aviso && (
                <p className="mr-6 mt-1 flex min-w-0 items-start text-[12px] text-warning" role="alert">
                  <AlertTriangle className="mr-1.5 mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                  <span className="min-w-0">{m.aviso}</span>
                </p>
              )}
              {m.papel === "agente" && (
                <AprendizadoDoAgente
                  anexos={m.anexos}
                  onEsquecer={(id) => chamarFuncao("mesa-site", { acao: "aprendizado_esquecer", client_id: clientId, id, mensagem_id: m.id || undefined })}
                  onGuardar={(texto, tipo) => chamarFuncao("mesa-site", { acao: "aprendizado_guardar", client_id: clientId, texto, tipo, mensagem_id: m.id || undefined })}
                />
              )}
              {m.papel === "agente" && <BaseCitada anexos={m.anexos} />}
              {m.papel === "agente" && <CaminhoDaMensagem anexos={m.anexos} recente={!!m.nova} />}
              {m.id &&
                acoes.map((a) => (
                  <div key={a.id} className="mt-2">
                    <CartaoDeAcao
                      acao={a}
                      recemFeita={!!m.nova}
                      titulo="O diretor de site vai fazer"
                      observacao={typeof a.custo_estimado_usd === "number" && a.custo_estimado_usd > 0 ? `Custo até ${usd(a.custo_estimado_usd)} (teto reservado; sai só o real).` : "Sem custo."}
                      onPedido={(p) => chamarAcaoDoAgente("mesa-site", String(m.id), a.id, p)}
                      onFeito={(p, resposta) => {
                        if (p === "descartar") return;
                        reler();
                        const r = resposta && (resposta as any).anexo;
                        const ops = r && Array.isArray(r.itens) ? r.itens.map((x: any) => x.operacao) : [];
                        const mudamOSite = ["escolher_copy", "gerar_conteudo", "gerar_imagem", "montar_mapa", "escolher_preset", "trocar_secao", "adicionar_secao", "remover_secao", "gerar_imagens_dos_slots"];
                        if (ops.some((o: string) => mudamOSite.indexOf(o) >= 0)) {
                          void chamarFuncao<any>("mesa-site", { acao: "sites_listar", client_id: clientId, marca_id: marca ? marca.id : undefined }).then((d) => guardar((d.sites || []).find((s: LinhaDoSite) => s.id === site.id)));
                        }
                        if ((resposta as any) && (resposta as any).motor) onIrPara("construcao");
                      }}
                    />
                  </div>
                ))}
              {doMotor.map((id) => {
                const t = trabalhos.find((x) => x.id === id);
                if (!t) return null;
                return (
                  <div key={id} className="mt-1.5 flex min-w-0 items-center text-[12px] text-muted-foreground" data-trabalho-na-conversa={t.estado}>
                    {ehAberto(t.estado) ? <Loader2 className="mr-1.5 h-3 w-3 shrink-0 animate-spin" /> : null}
                    <span className="mr-2 min-w-0 flex-1 truncate">
                      Motor: {ROTULO_DO_ESTADO[t.estado]}
                      {t.custo_usd ? ` · ${usd(t.custo_usd)}` : ""}
                    </span>
                    {ehAberto(t.estado) && t.estado !== "parando" && (
                      <button type="button" className={juntar(botao.barra, "h-7")} onClick={() => void parar(t.id)}>
                        <Square className="mr-1 h-3 w-3" />
                        Parar
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
        {enviando && (
          <p className={juntar(conversa.apoio, "flex items-center")}>
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Pensando no site...
          </p>
        )}
      </PainelDoAgente>
    </div>
  );
}
