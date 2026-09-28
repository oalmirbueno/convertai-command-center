import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Copy, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { botao, etiqueta, juntar, superficie, texto } from "@/components/sistema/estilos";
import { modelosAtivos, padraoPara, type ModeloIa } from "@/lib/mesa/api";
import { BotaoComCusto } from "../Custo";
import { SeletorDeModelo } from "../Seletores";
import { useMesa } from "../MesaContexto";
import {
  caracteres,
  LIMITES_DO_PERFIL,
  sinaisDaBio,
  type SugestaoDeBio,
  type SugestaoDeNome,
} from "../../../../supabase/functions/_shared/conhecimento-perfil-instagram";
import { chamarInstagram, copiarTexto, type AnaliseDaBio, type PerfilDaAba } from "./instagramApi";

/**
 * Bio e nome inteligentes. O Jev julga a bio de hoje contra o contexto do
 * cliente (diz o que faz, chamada, cidade, prova, se bate com o negócio). Se
 * está boa, a aba diz "a bio já está boa, sigo com ela" e não gasta com
 * sugestão; se precisa mudar, o modelo escreve 3 bios e 3 nomes de uma vez e
 * o Jev escolhe (a de hoje concorre). Antes e depois lado a lado, com Copiar:
 * a API do Instagram não edita bio nem nome, a troca é no app.
 */

/** Modelo de texto da aba: o rápido do estrategista, senão o estrategista. */
export function modeloDaAba(catalogo: ModeloIa[]): ModeloIa | null {
  const ativos = modelosAtivos(catalogo, "texto");
  return ativos.find((m) => (m.padrao_para || []).indexOf("estrategista_rapido") >= 0) || padraoPara(catalogo, "estrategista");
}

function Contador({ texto: t, limite }: { texto: string; limite: number }) {
  const n = caracteres(t);
  return <span className={juntar("text-[11.5px] tabular-nums", n > limite ? "text-destructive" : "text-muted-foreground")}>{n}/{limite}</span>;
}

function BotaoCopiar({ valor, rotulo }: { valor: string; rotulo: string }) {
  return (
    <button
      type="button"
      className={juntar(botao.secundario, "h-8 px-2.5 text-[12px]")}
      onClick={async () => {
        const ok = await copiarTexto(valor);
        if (ok) toast.success(`${rotulo} copiado`, { description: "Cole no app: Editar perfil." });
        else toast.error("Não deu para copiar. Selecione o texto e copie à mão.");
      }}
      aria-label={`Copiar ${rotulo.toLowerCase()}`}
    >
      <Copy className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
      Copiar
    </button>
  );
}

function Lado({ titulo, valor, limite, vazio, destaque }: { titulo: string; valor: string; limite: number; vazio: string; destaque?: boolean }) {
  return (
    <div className={juntar("min-w-0 rounded-md px-3 py-2", destaque ? "border border-primary/40 bg-primary/5" : superficie.poco)}>
      <div className="flex items-center justify-between">
        <span className={texto.rotulo}>{titulo}</span>
        <Contador texto={valor} limite={limite} />
      </div>
      <p className="mt-1 min-h-[20px] whitespace-pre-line text-[13px] leading-5 text-foreground [overflow-wrap:anywhere]">{valor || <span className="text-muted-foreground">{vazio}</span>}</p>
    </div>
  );
}

function Escolhas<T extends SugestaoDeBio | SugestaoDeNome>({
  itens,
  escolhido,
  doJev,
  probabilidades,
  onEscolher,
  rotulo,
}: {
  itens: T[];
  escolhido: string;
  doJev: string | null;
  probabilidades: Record<string, number>;
  onEscolher: (id: string) => void;
  rotulo: string;
}) {
  return (
    <ul className="grid min-w-0 grid-cols-1 gap-1.5" aria-label={rotulo}>
      {itens.map((s) => (
        <li key={s.id} className="min-w-0">
          <button
            type="button"
            onClick={() => onEscolher(s.id)}
            aria-pressed={escolhido === s.id}
            className={juntar(
              "w-full min-w-0 rounded-md border px-3 py-2 text-left transition-colors",
              escolhido === s.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted",
            )}
          >
            <span className="flex min-w-0 items-center">
              {doJev === s.id && <span className={juntar(etiqueta, "mr-1.5 bg-success/15 text-success")}>Escolha do Jev{typeof probabilidades[s.id] === "number" ? ` ${Math.round(probabilidades[s.id] * 100)}%` : ""}</span>}
              <span className="ml-auto text-[11.5px] tabular-nums text-muted-foreground">{s.caracteres}</span>
            </span>
            <span className="mt-0.5 block whitespace-pre-line text-[13px] leading-5 text-foreground [overflow-wrap:anywhere]">{s.texto}</span>
            {s.por_que && <span className="mt-0.5 block text-[12px] leading-4 text-muted-foreground">{s.por_que}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}

export default function BioENome({ perfil, analise, onAnalise }: { perfil: PerfilDaAba; analise: AnaliseDaBio | null; onAnalise: (a: AnaliseDaBio) => void }) {
  const { clientId, catalogo } = useMesa();
  const padrao = useMemo(() => modeloDaAba(catalogo), [catalogo]);
  const [modeloId, setModeloId] = useState<string>("");
  useEffect(() => {
    if (!modeloId && padrao) setModeloId(padrao.id);
  }, [padrao, modeloId]);

  const sugestoes = analise ? analise.sugestoes : { bios: [], nomes: [], observacao: "" };
  const jevBio = analise && analise.escolha.bio ? analise.escolha.bio.escolha : null;
  const jevNome = analise && analise.escolha.nome ? analise.escolha.nome.escolha : null;
  const primeiraBio = jevBio && jevBio !== "atual" ? jevBio : sugestoes.bios[0] ? sugestoes.bios[0].id : "";
  const primeiroNome = jevNome && jevNome !== "atual" ? jevNome : sugestoes.nomes[0] ? sugestoes.nomes[0].id : "";
  const [bioEscolhida, setBioEscolhida] = useState(primeiraBio);
  const [nomeEscolhido, setNomeEscolhido] = useState(primeiroNome);
  useEffect(() => {
    setBioEscolhida(primeiraBio);
    setNomeEscolhido(primeiroNome);
  }, [analise && analise.gerado_em]);

  const bioNova = sugestoes.bios.find((b) => b.id === bioEscolhida) || null;
  const nomeNovo = sugestoes.nomes.find((n) => n.id === nomeEscolhido) || null;
  const sinais = sinaisDaBio(perfil.bio);
  // A análise é de outra bio (trocaram no app depois): avisa para analisar de novo.
  const velha = !!analise && analise.bio_lida !== perfil.bio;
  const partes = () => [
    { modeloId: modeloId || (padrao ? padrao.id : null), tipo: "texto" as const, tokensEntrada: 3500, tokensSaida: 1200 },
  ];
  const analisar = (forcar: boolean) => chamarInstagram<{ analise: AnaliseDaBio; custo_usd: number }>("bio", clientId, { modelo_id: modeloId || undefined, forcar });

  const v = analise ? analise.veredito : null;
  const jevManteveBio = jevBio === "atual";

  return (
    <div className="min-w-0 space-y-3" data-bio-e-nome="">
      <div className="grid min-w-0 grid-cols-1 gap-2 md:grid-cols-2">
        <Lado titulo="Nome hoje" valor={perfil.nome} limite={LIMITES_DO_PERFIL.nome} vazio="Sem nome" />
        <Lado titulo="Bio hoje" valor={perfil.bio} limite={LIMITES_DO_PERFIL.bio} vazio="Sem bio" />
      </div>
      {(sinais.passouDoLimite || sinais.hashtags > 2) && (
        <p className="text-[12px] leading-4 text-destructive">
          {sinais.passouDoLimite ? `A bio tem ${sinais.caracteres} caracteres (limite ${LIMITES_DO_PERFIL.bio}). ` : ""}
          {sinais.hashtags > 2 ? "Hashtags na bio não trazem alcance." : ""}
        </p>
      )}

      <div className="flex min-w-0 flex-wrap items-end [&>*]:mb-1.5 [&>*]:mr-2">
        <div className="w-full min-w-0 sm:w-[260px]">
          <SeletorDeModelo catalogo={catalogo} tipo="texto" valor={modeloId} onChange={setModeloId} rotulo="Modelo de texto" />
        </div>
        <BotaoComCusto
          rotulo={analise ? "Analisar de novo" : "Analisar a bio"}
          titulo="Bio analisada"
          descricao="O Jev julga a bio de hoje; se precisar mudar, o modelo sugere 3 bios e 3 nomes e o Jev escolhe."
          partes={partes}
          executar={() => analisar(false)}
          aoConcluir={(d) => d && d.analise && onAnalise(d.analise)}
          disabled={!perfil.username && !perfil.bio}
        />
      </div>

      {!analise && <p className={juntar(texto.auxiliar, "leading-5")}>O Jev confere se a bio diz o que o negócio faz, tem chamada, cidade e prova, e se bate com o contexto do cliente. Só sugere quando precisa.</p>}
      {velha && <p className="text-[12px] leading-4 text-warning">A bio mudou desde a última análise. Analise de novo para valer a de hoje.</p>}

      {v && (
        <div className="min-w-0 space-y-3">
          {v.boa || jevManteveBio ? (
            <div className="flex min-w-0 items-start rounded-md border border-success/30 bg-success/5 px-3 py-2" data-bio-boa="">
              <CheckCircle2 className="mr-2 mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-foreground">A bio já está boa, sigo com ela.</p>
                {v.pontos_fortes.length > 0 && <p className={juntar(texto.auxiliar, "mt-0.5 leading-5")}>Ela já {v.pontos_fortes.join(", ")}.</p>}
              </div>
              {!sugestoes.bios.length && (
                <BotaoComCusto
                  rotulo="Sugerir mesmo assim"
                  titulo="Sugestões de bio"
                  partes={partes}
                  executar={() => analisar(true)}
                  aoConcluir={(d) => d && d.analise && onAnalise(d.analise)}
                  variant="ghost"
                  className="ml-2 shrink-0"
                />
              )}
            </div>
          ) : (
            <div className="min-w-0 rounded-md border border-warning/40 bg-warning/5 px-3 py-2" data-bio-precisa="">
              <p className="text-[13px] font-medium text-foreground">A bio precisa mudar</p>
              <ul className="mt-1 list-disc pl-5 text-[12.5px] leading-5 text-foreground">
                {v.motivos.map((m) => (
                  <li key={m.codigo}>{m.texto}</li>
                ))}
              </ul>
            </div>
          )}

          {sugestoes.bios.length > 0 && (
            <div className="min-w-0 space-y-2">
              <p className={texto.rotulo}>Bio: antes e depois</p>
              <div className="grid min-w-0 grid-cols-1 gap-2 md:grid-cols-2">
                <Lado titulo="Antes" valor={perfil.bio} limite={LIMITES_DO_PERFIL.bio} vazio="Sem bio" />
                <div className="min-w-0">
                  <Lado titulo="Depois" valor={bioNova ? bioNova.texto : ""} limite={LIMITES_DO_PERFIL.bio} vazio="Escolha uma sugestão" destaque />
                  {bioNova && (
                    <div className="mt-1.5 flex justify-end">
                      <BotaoCopiar valor={bioNova.texto} rotulo="Bio" />
                    </div>
                  )}
                </div>
              </div>
              <Escolhas itens={sugestoes.bios} escolhido={bioEscolhida} doJev={jevBio} probabilidades={analise && analise.escolha.bio ? analise.escolha.bio.probabilidades : {}} onEscolher={setBioEscolhida} rotulo="Sugestões de bio" />
            </div>
          )}

          {sugestoes.nomes.length > 0 && (
            <div className="min-w-0 space-y-2">
              <p className={texto.rotulo}>Nome: antes e depois</p>
              {(v.nome_pode_melhorar || (jevNome && jevNome !== "atual")) ? null : <p className={texto.auxiliar}>O Nome de hoje já ajuda a busca: troque só se preferir.</p>}
              <div className="grid min-w-0 grid-cols-1 gap-2 md:grid-cols-2">
                <Lado titulo="Antes" valor={perfil.nome} limite={LIMITES_DO_PERFIL.nome} vazio="Sem nome" />
                <div className="min-w-0">
                  <Lado titulo="Depois" valor={nomeNovo ? nomeNovo.texto : ""} limite={LIMITES_DO_PERFIL.nome} vazio="Escolha uma sugestão" destaque />
                  {nomeNovo && (
                    <div className="mt-1.5 flex justify-end">
                      <BotaoCopiar valor={nomeNovo.texto} rotulo="Nome" />
                    </div>
                  )}
                </div>
              </div>
              <Escolhas itens={sugestoes.nomes} escolhido={nomeEscolhido} doJev={jevNome} probabilidades={analise && analise.escolha.nome ? analise.escolha.nome.probabilidades : {}} onEscolher={setNomeEscolhido} rotulo="Sugestões de nome" />
              <p className={texto.auxiliar}>O Instagram deixa trocar o Nome 2 vezes a cada 14 dias.</p>
            </div>
          )}

          {sugestoes.observacao && (
            <p className={juntar(texto.auxiliar, "flex items-start leading-5")}>
              <Sparkles className="mr-1.5 mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {sugestoes.observacao}
            </p>
          )}
          {v.sem_jev && <p className="text-[12px] leading-4 text-warning">O Jev não respondeu agora: o veredito usou só as regras de tamanho e hashtag.</p>}
        </div>
      )}

      <p className={juntar(texto.auxiliar, "leading-5")}>A API do Instagram não edita bio nem nome: copie e cole no app, em Editar perfil.</p>
    </div>
  );
}
