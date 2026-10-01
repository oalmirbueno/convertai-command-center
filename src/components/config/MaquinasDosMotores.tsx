import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronRight, Copy, Download, MonitorDown, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Carregando, EstadoDeErro, JanelaCentral, Secao, botao, campo, foco, juntar, lista, superficie, texto } from "@/components/sistema";
import {
  CHAVE_DAS_MAQUINAS,
  type CodigoGerado,
  gerarCodigoDePareamento,
  type IdDoMotorNaMaquina,
  lerMaquina,
  lerMaquinas,
  type MaquinaDosMotores,
  MOTORES_DA_MAQUINA,
  NOME_CURTO_DO_MOTOR,
  NOME_DO_MOTOR_NA_MAQUINA,
  relogio,
  removerMaquina,
  revogarCodigo,
  segundosAte,
  type SituacaoDaMaquina,
  textoDoMotor,
  trocarMotoresDaMaquina,
} from "@/lib/motores/maquinasDosMotores";

/**
 * Configurações › Estado dos motores › Máquinas (frente SUP, 01/10/2026), só admin.
 *
 * Pedido do dono: "sempre que eu abrir o painel, dê para instalar as
 * dependências em qualquer computador... e este tem que abrir junto, mas sem
 * ficar com os terminais abertos". Aqui: a lista de máquinas com o Aceleriq
 * Motores (nome, motores, versão, último sinal, desatualizada, Remover) e o
 * "Instalar os motores neste computador" (baixa o instalador e gera o código
 * de pareamento de 10 min, uso único).
 */

export const AJUDA_DAS_MAQUINAS =
  "Cada computador com o Aceleriq Motores aparece aqui. O supervisor roda sem janela, abre junto com o Windows, sobe de novo o motor que cair " +
  "e mostra um ícone perto do relógio (verde ligado, amarelo atenção, vermelho parado). Marque quais motores rodam em cada máquina: numa " +
  "máquina fraca, só o navegador, por exemplo. A fila distribui o trabalho entre as máquinas. Versão nova publicada é trocada sozinha quando " +
  "os motores da máquina estão livres, e volta para a anterior se falhar. Remover a máquina desliga os motores dela na próxima batida (até 30 s) " +
  "e apaga a chave guardada lá. Passo a passo em docs/motores/ACELERIQ-MOTORES.md.";

export const AJUDA_DO_INSTALADOR =
  "O instalador confere ou instala o Node, o ffmpeg e o Git (o Windows pede para confirmar), baixa o código dos motores do painel e confere o " +
  "sha256, instala as dependências e o navegador do agente, e deixa tudo abrindo com o Windows, sem janela. Não há chave no arquivo: a chave " +
  "de serviço chega pelo código de pareamento (vale 10 minutos, uma vez) e fica no cofre do Windows do usuário (DPAPI), nunca em texto. " +
  "Para conferir o arquivo: certutil -hashfile instalar-aceleriq-motores.cmd SHA256.";

const COR: Record<SituacaoDaMaquina, { ponto: string; texto: string }> = {
  ok: { ponto: "bg-primary", texto: "text-primary" },
  atencao: { ponto: "bg-warning", texto: "text-warning" },
  parado: { ponto: "bg-destructive", texto: "text-destructive" },
};

function useAgora(ligado: boolean, passoMs = 1000): number {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    if (!ligado) return;
    const t = setInterval(() => setAgora(Date.now()), passoMs);
    return () => clearInterval(t);
  }, [ligado, passoMs]);
  return agora;
}

function SeletorDeMotores({ valor, onMudar, desligado, rotulo }: { valor: IdDoMotorNaMaquina[]; onMudar: (v: IdDoMotorNaMaquina[]) => void; desligado?: boolean; rotulo: string }) {
  return (
    <div role="group" aria-label={rotulo} className="-m-1 flex min-w-0 flex-wrap items-center">
      {MOTORES_DA_MAQUINA.map((id) => {
        const ligado = valor.indexOf(id) >= 0;
        return (
          <button
            key={id}
            type="button"
            aria-pressed={ligado}
            disabled={desligado}
            title={NOME_DO_MOTOR_NA_MAQUINA[id]}
            onClick={() => onMudar(ligado ? valor.filter((x) => x !== id) : MOTORES_DA_MAQUINA.filter((x) => x === id || valor.indexOf(x) >= 0))}
            className={juntar(botao.secundario, "m-1 h-8 px-3", ligado && "border-primary/60 text-primary")}
            data-motor-da-maquina={id}
          >
            {ligado && <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
            {NOME_CURTO_DO_MOTOR[id]}
          </button>
        );
      })}
    </div>
  );
}

function LinhaDaMaquina({ m, agora, versaoPublicada, aberta, onAlternar, onRemover }: { m: MaquinaDosMotores; agora: number; versaoPublicada: string | null; aberta: boolean; onAlternar: () => void; onRemover: () => void }) {
  const qc = useQueryClient();
  const leitura = lerMaquina(m, agora, versaoPublicada);
  const cor = COR[leitura.situacao];
  const corpo = `maquina-${m.id}-detalhes`;
  const trocar = useMutation({
    mutationFn: (motores: IdDoMotorNaMaquina[]) => trocarMotoresDaMaquina(m.id, motores),
    onSuccess: () => {
      toast.success("Motores desta máquina atualizados. Ela troca em até 30 s.");
      void qc.invalidateQueries({ queryKey: CHAVE_DAS_MAQUINAS });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível mudar os motores."),
  });
  return (
    <li className="min-w-0" data-maquina={m.id} data-situacao={leitura.situacao} data-desatualizada={leitura.desatualizada ? "sim" : "nao"}>
      <button type="button" onClick={onAlternar} aria-expanded={aberta} aria-controls={corpo} className={juntar(lista.linha, "w-full text-left", foco)}>
        <span className={juntar("mr-3 h-2 w-2 shrink-0 rounded-full", cor.ponto)} aria-hidden="true" />
        <span className="mr-3 min-w-0 flex-1">
          <span className={juntar(texto.corpo, "block truncate font-medium")}>{m.nome}</span>
          <span className={juntar(texto.auxiliar, "block truncate")}>{leitura.resumo}</span>
        </span>
        {leitura.desatualizada && <span className={juntar(texto.etiqueta, "mr-2 shrink-0 text-warning")}>desatualizada</span>}
        <span className={juntar(texto.etiqueta, "mr-2 shrink-0", cor.texto)}>{leitura.rotulo}</span>
        <ChevronRight className={juntar("h-4 w-4 shrink-0 text-muted-foreground transition-transform", aberta && "rotate-90")} aria-hidden="true" />
      </button>
      {aberta && (
        <div id={corpo} className="min-w-0 pb-3 pl-7 pr-2">
          <p className={juntar(texto.rotulo, "mb-1")}>Motores desta máquina</p>
          <SeletorDeMotores rotulo={`Motores de ${m.nome}`} valor={m.motores} desligado={trocar.isPending} onMudar={(v) => trocar.mutate(v)} />
          <dl className={juntar(texto.auxiliar, "mt-3 min-w-0")}>
            {MOTORES_DA_MAQUINA.filter((id) => m.motores.indexOf(id) >= 0).map((id) => {
              const e = m.estado.motores?.[id];
              return (
                <div key={id} className="flex min-w-0 py-0.5" data-estado-do-motor={id}>
                  <dt className="mr-2 shrink-0">{NOME_DO_MOTOR_NA_MAQUINA[id]}</dt>
                  <dd className="min-w-0 break-words text-foreground">
                    {textoDoMotor(e?.situacao)}
                    {e?.reinicios ? ` · ${e.reinicios} reinício${e.reinicios === 1 ? "" : "s"}` : ""}
                    {e?.ultimo_erro && e.situacao !== "ligado" && e.situacao !== "trabalhando" ? ` · ${e.ultimo_erro}` : ""}
                  </dd>
                </div>
              );
            })}
          </dl>
          {leitura.desatualizada && (
            <p className={juntar(texto.auxiliar, "mt-2 text-warning")} data-aviso-desatualizada="">
              Na versão {m.versao}; a publicada é {versaoPublicada}. Ela troca sozinha quando os motores estiverem livres.
            </p>
          )}
          {m.estado.atualizacao?.erro && <p className={juntar(texto.auxiliar, "mt-1 break-words")}>Última atualização: {m.estado.atualizacao.erro}</p>}
          <div className="mt-3 flex min-w-0 items-center">
            <button type="button" onClick={onRemover} className={juntar(botao.perigo, "h-8 px-3")} data-remover-maquina="">
              <Trash2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              Remover máquina
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

/** Janela do "Instalar os motores neste computador": baixar, gerar o código, os códigos abertos. */
export function JanelaDeInstalar({ aberta, onFechar, versaoPublicada, codigosAbertos }: { aberta: boolean; onFechar: () => void; versaoPublicada: string | null; codigosAbertos: Array<{ id: string; expira_em: string; nome_sugerido: string | null }> }) {
  const qc = useQueryClient();
  const [nome, setNome] = useState("");
  const [motores, setMotores] = useState<IdDoMotorNaMaquina[]>([...MOTORES_DA_MAQUINA]);
  const [codigo, setCodigo] = useState<CodigoGerado | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [baixado, setBaixado] = useState<string | null>(null);
  const agora = useAgora(aberta);
  const restante = codigo ? segundosAte(codigo.expira_em, agora) : 0;

  const gerar = useMutation({
    mutationFn: () => gerarCodigoDePareamento(nome.trim() || null, motores),
    onSuccess: (c) => {
      setCodigo(c);
      setCopiado(false);
      void qc.invalidateQueries({ queryKey: CHAVE_DAS_MAQUINAS });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível gerar o código."),
  });
  const revogar = useMutation({
    mutationFn: (id: string) => revogarCodigo(id),
    onSuccess: (_r, id) => {
      if (codigo && codigo.id === id) setCodigo(null);
      toast.success("Código revogado.");
      void qc.invalidateQueries({ queryKey: CHAVE_DAS_MAQUINAS });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível revogar."),
  });
  const baixar = useMutation({
    mutationFn: async () => {
      const m = await import("@/lib/motores/instaladorDosMotores");
      const i = await m.montarInstalador({
        supabaseUrl: String(import.meta.env.VITE_SUPABASE_URL || ""),
        chavePublica: String(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || ""),
        painelUrl: typeof window !== "undefined" ? window.location.origin : "https://aceleriq.online",
      });
      m.baixarArquivo(i.nome, i.conteudo);
      return i.sha256DoArquivo;
    },
    onSuccess: (sha) => setBaixado(sha),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível montar o instalador."),
  });

  const copiar = async () => {
    if (!codigo) return;
    try {
      await navigator.clipboard.writeText(codigo.codigo);
      setCopiado(true);
    } catch {
      toast.error("Não consegui copiar. Digite o código no instalador.");
    }
  };

  const outrosAbertos = codigosAbertos.filter((c) => !codigo || c.id !== codigo.id);

  return (
    <JanelaCentral
      aberta={aberta}
      onFechar={onFechar}
      titulo="Instalar os motores neste computador"
      icone={<MonitorDown className="h-4 w-4" />}
      descricao={versaoPublicada ? `Versão ${versaoPublicada}` : "Nenhuma versão publicada"}
      ajuda={AJUDA_DO_INSTALADOR}
      rotuloDaAjuda="Como funciona o instalador"
      largura="md"
      data-janela-instalar=""
    >
      <ol className={juntar(texto.corpo, "min-w-0 list-decimal pl-5")} data-passos-do-instalador="">
        <li className="py-0.5">Baixe o instalador e abra com dois cliques (o Windows pede para confirmar).</li>
        <li className="py-0.5">Quando ele pedir, digite o código abaixo. Vale 10 minutos, uma vez.</li>
        <li className="py-0.5">Pronto: o ícone da Aceleriq aparece perto do relógio e a máquina surge na lista.</li>
      </ol>
      {!versaoPublicada && (
        <p className={juntar(texto.auxiliar, "mt-3 text-warning")} data-sem-versao="">
          Ainda não há versão dos motores publicada: rode npm run publicar:motores no repositório.
        </p>
      )}
      <div className="mt-4 flex min-w-0 flex-wrap items-center">
        <button type="button" onClick={() => baixar.mutate()} disabled={baixar.isPending} className={juntar(botao.primario, "mb-2 mr-2")} data-baixar-instalador="">
          <Download className="mr-1.5 h-4 w-4" aria-hidden="true" />
          {baixar.isPending ? "Montando..." : "Baixar o instalador"}
        </button>
        {baixado && (
          <span className={juntar(texto.auxiliar, "mb-2 min-w-0 truncate")} title={baixado} data-sha-do-instalador="">
            sha256 {baixado.slice(0, 16)}…
          </span>
        )}
      </div>

      <div className={juntar(superficie.divisoria, "mt-3 pt-4")}>
        <p className={juntar(texto.rotulo, "mb-2")}>Código de pareamento</p>
        {codigo && restante > 0 ? (
          <div className="min-w-0" data-codigo-gerado="">
            <div className="flex min-w-0 flex-wrap items-center">
              <span className={juntar(texto.numero, "mr-3 font-mono tracking-[0.12em]")} data-codigo="">
                {codigo.codigo}
              </span>
              <button type="button" onClick={() => void copiar()} className={juntar(botao.secundario, "mr-2 h-8 px-3")} data-copiar-codigo="">
                {copiado ? <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
                {copiado ? "Copiado" : "Copiar"}
              </button>
              <button type="button" onClick={() => revogar.mutate(codigo.id)} disabled={revogar.isPending} className={juntar(botao.discreto, "h-8 px-3")} data-revogar-codigo="">
                Revogar
              </button>
            </div>
            <p className={juntar(texto.auxiliar, "mt-1")} data-validade="">
              Vale por {relogio(restante)} · {codigo.motores.map((x) => NOME_CURTO_DO_MOTOR[x]).join(", ")}
            </p>
          </div>
        ) : (
          <div className="min-w-0">
            {codigo && restante === 0 && <p className={juntar(texto.auxiliar, "mb-2 text-warning")}>O código venceu. Gere outro.</p>}
            <label className={juntar(texto.auxiliar, "mb-1 block")} htmlFor="nome-da-maquina">
              Nome desta máquina (opcional)
            </label>
            <input id="nome-da-maquina" value={nome} maxLength={80} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Notebook da Ana" className={juntar(campo, "mb-3 sm:max-w-[320px]")} />
            <p className={juntar(texto.auxiliar, "mb-1")}>Motores que ela vai rodar</p>
            <SeletorDeMotores rotulo="Motores da máquina nova" valor={motores} onMudar={setMotores} />
            <button type="button" onClick={() => gerar.mutate()} disabled={gerar.isPending || !motores.length} className={juntar(botao.secundario, "mt-3")} data-gerar-codigo="">
              {gerar.isPending ? "Gerando..." : "Gerar código"}
            </button>
          </div>
        )}
      </div>

      {outrosAbertos.length > 0 && (
        <div className={juntar(superficie.divisoria, "mt-4 pt-3")} data-codigos-abertos="">
          <p className={juntar(texto.rotulo, "mb-1")}>Outros códigos abertos</p>
          <ul className="min-w-0">
            {outrosAbertos.map((c) => (
              <li key={c.id} className="flex min-w-0 items-center py-1">
                <span className={juntar(texto.auxiliar, "mr-2 min-w-0 flex-1 truncate")}>
                  {c.nome_sugerido || "Sem nome"} · vence em {relogio(segundosAte(c.expira_em, agora))}
                </span>
                <button type="button" onClick={() => revogar.mutate(c.id)} disabled={revogar.isPending} className={juntar(botao.discreto, "h-8 px-3")}>
                  Revogar
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </JanelaCentral>
  );
}

export default function MaquinasDosMotores() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: CHAVE_DAS_MAQUINAS, queryFn: lerMaquinas, staleTime: 20_000, refetchInterval: 30_000, refetchOnWindowFocus: false });
  const [abertas, setAbertas] = useState<Record<string, boolean>>({});
  const [instalar, setInstalar] = useState(false);
  const [remover, setRemover] = useState<MaquinaDosMotores | null>(null);
  const agora = useAgora(true, 15_000);
  const remocao = useMutation({
    mutationFn: (id: string) => removerMaquina(id),
    onSuccess: () => {
      toast.success("Máquina removida. Os motores dela param em até 30 s.");
      setRemover(null);
      void qc.invalidateQueries({ queryKey: CHAVE_DAS_MAQUINAS });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível remover."),
  });

  const d = q.data;
  const versao = d?.versao?.versao || null;
  const leituras = (d?.maquinas || []).map((m) => lerMaquina(m, agora, versao));
  const ligadas = leituras.filter((l) => l.situacao !== "parado").length;
  const desatualizadas = leituras.filter((l) => l.desatualizada).length;
  const descricao = d
    ? `${d.maquinas.length} ${d.maquinas.length === 1 ? "máquina" : "máquinas"}, ${ligadas} ${ligadas === 1 ? "ligada" : "ligadas"}${desatualizadas ? `, ${desatualizadas} desatualizada${desatualizadas === 1 ? "" : "s"}` : ""}`
    : undefined;

  return (
    <Secao
      titulo="Máquinas"
      descricao={descricao}
      ajuda={AJUDA_DAS_MAQUINAS}
      recolher="config:motores-maquinas"
      className="mt-6"
      acao={
        <button type="button" onClick={() => setInstalar(true)} aria-label="Instalar os motores neste computador" title="Instalar os motores neste computador" className={juntar(botao.primario, "h-8 px-3")} data-instalar-motores="">
          <MonitorDown className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          {/* No celular, o rótulo curto (o título da seção não some). */}
          <span className="sm:hidden">Instalar</span>
          <span className="hidden sm:inline">Instalar os motores neste computador</span>
        </button>
      }
      data-maquinas-dos-motores=""
    >
      {q.isLoading ? (
        <Carregando rotulo="Lendo as máquinas" linhas={2} />
      ) : q.isError ? (
        <EstadoDeErro titulo="Não foi possível ler as máquinas." descricao={q.error instanceof Error ? q.error.message : undefined} />
      ) : d && d.maquinas.length ? (
        <ul className={juntar(lista.aberta, lista.divisoria)}>
          {d.maquinas.map((m) => (
            <LinhaDaMaquina key={m.id} m={m} agora={agora} versaoPublicada={versao} aberta={!!abertas[m.id]} onAlternar={() => setAbertas((a) => ({ ...a, [m.id]: !a[m.id] }))} onRemover={() => setRemover(m)} />
          ))}
        </ul>
      ) : (
        <p className={texto.auxiliar} data-sem-maquinas="">
          Nenhuma máquina com o Aceleriq Motores ainda.
        </p>
      )}
      <JanelaDeInstalar aberta={instalar} onFechar={() => setInstalar(false)} versaoPublicada={versao} codigosAbertos={d?.codigos || []} />
      <JanelaCentral
        aberta={!!remover}
        onFechar={() => setRemover(null)}
        titulo={remover ? `Remover ${remover.nome}?` : "Remover máquina"}
        icone={<Trash2 className="h-4 w-4" />}
        largura="sm"
        rodape={
          <div className="flex min-w-0 items-center justify-end">
            <button type="button" onClick={() => setRemover(null)} className={juntar(botao.secundario, "mr-2")}>
              Cancelar
            </button>
            <button type="button" onClick={() => remover && remocao.mutate(remover.id)} disabled={remocao.isPending} className={botao.perigo} data-confirmar-remocao="">
              {remocao.isPending ? "Removendo..." : "Remover"}
            </button>
          </div>
        }
        data-janela-remover=""
      >
        <p className={texto.corpo}>Os motores dela param com calma na próxima batida (até 30 s) e a chave guardada nela é apagada.</p>
        <p className={juntar(texto.auxiliar, "mt-2")}>Para instalar de novo, gere outro código.</p>
      </JanelaCentral>
    </Secao>
  );
}
