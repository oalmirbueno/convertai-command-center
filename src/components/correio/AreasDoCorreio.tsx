import { useQuery } from "@tanstack/react-query";
import { Check, FolderClosed, Megaphone } from "lucide-react";
import { correio, correioDesligado, type CaixaDoCorreio } from "@/lib/produto/email-central";
import { COLUNAS, agruparCaixa, colunaDaMensagem, fraseDoDia, hojeEmBrasilia, iniciais, listarCompromissos, listarTarefas, type EuNoCorreio, type MensagemDaCaixa } from "@/lib/produto/correio-dia";
import { diaLegivel } from "@/lib/produto/api";
import { Carregando, EstadoVazio, etiqueta, juntar, texto } from "@/components/sistema";
import { AgendaDeHoje, TarefasDoDia, chaveDaAgenda, chaveDasTarefas } from "./PainelDoDia";
import { CaixaEmPreparo } from "./CaixaPorPrioridade";

const cartao = "min-w-0 rounded-3xl bg-card p-5";

function Titulo({ titulo, frase }: { titulo: string; frase: string }) {
  return (
    <div className="min-w-0 px-1 pt-2">
      <h1 className={texto.tituloPagina}>{titulo}</h1>
      <p className={juntar(texto.auxiliar, "mt-1.5 max-w-[640px] leading-5")}>{frase}</p>
    </div>
  );
}

/** O quadro da caixa: cada conversa é um cartão que anda sozinho conforme o estado dela. */
export function QuadroDaCaixa({ caixa }: { caixa: CaixaDoCorreio }) {
  const mensagens = useQuery({ queryKey: ["produto", "correio", "mensagens", caixa.id, ""], queryFn: () => correio.listar(caixa.id, "INBOX") as Promise<MensagemDaCaixa[]>, enabled: caixa.ligado, retry: 0 });
  const emPreparo = !caixa.ligado || (mensagens.isError && correioDesligado(mensagens.error));
  const lista = mensagens.data || [];
  return (
    <div className="min-w-0 space-y-4" data-quadro-da-caixa="">
      <Titulo titulo="Quadro da caixa" frase="Cada conversa é um cartão. Ele anda sozinho quando você responde, quando alguém responde ou quando o assunto termina." />
      {emPreparo ? (
        <CaixaEmPreparo caixa={caixa} />
      ) : mensagens.isLoading ? (
        <div className={cartao}><Carregando linhas={5} rotulo="Montando o quadro" /></div>
      ) : (
        <div className="grid min-w-0 grid-cols-1 items-start gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {COLUNAS.map((c) => {
            const cartoes = lista.filter((m) => colunaDaMensagem(m) === c.id);
            return (
              <section key={c.id} className="min-w-0 space-y-2.5" aria-label={c.nome} data-coluna={c.id}>
                <div className="flex items-center rounded-full bg-card px-3.5 py-2">
                  <i className={juntar("mr-2 h-2 w-2 rounded-full", c.ponto)} aria-hidden="true" />
                  <h2 className={juntar(texto.corpo, "flex-1 font-semibold")}>{c.nome}</h2>
                  <span className={juntar(etiqueta, "bg-muted text-muted-foreground")}>{cartoes.length}</span>
                </div>
                {cartoes.map((m) => (
                  <article key={m.id} className="rounded-2xl bg-card p-3.5">
                    <h3 className={juntar(texto.corpo, "font-semibold leading-5")}>{m.assunto}</h3>
                    <p className={juntar(texto.auxiliar, "mt-1 truncate")}>{m.de}</p>
                    <div className="mt-2 flex items-center border-t border-border pt-2">
                      <span className={juntar(texto.auxiliar, "flex-1")}>{m.recebida_em ? diaLegivel(m.recebida_em) : ""}</span>
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[10px] font-semibold" aria-hidden="true">{iniciais(m.de)}</span>
                    </div>
                  </article>
                ))}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Meu dia: a agenda, as tarefas e o que a caixa pede, numa frase só. */
export function MeuDia({ caixa, eu, nome }: { caixa: CaixaDoCorreio | null; eu: EuNoCorreio; nome: string }) {
  const dia = hojeEmBrasilia();
  const tarefas = useQuery({ queryKey: chaveDasTarefas, queryFn: listarTarefas });
  const agenda = useQuery({ queryKey: chaveDaAgenda(dia), queryFn: () => listarCompromissos(dia) });
  const mensagens = useQuery({ queryKey: ["produto", "correio", "mensagens", caixa ? caixa.id : "", ""], queryFn: () => correio.listar(caixa!.id, "INBOX") as Promise<MensagemDaCaixa[]>, enabled: !!caixa && caixa.ligado, retry: 0 });
  const frase = fraseDoDia({
    responder: agruparCaixa(mensagens.data || []).responder.length,
    compromissos: (agenda.data || []).length,
    tarefasAbertas: (tarefas.data || []).filter((t) => !t.feita_em).length,
  });
  const primeiro = (nome || "").trim().split(/\s+/)[0];
  return (
    <div className="min-w-0 space-y-4" data-meu-dia="">
      <Titulo titulo={primeiro ? `Olá, ${primeiro}` : "Meu dia"} frase={frase} />
      <div className="flex min-w-0 flex-wrap items-start [&>*]:mb-4 [&>*]:mr-4">
        <div className="min-w-0 flex-1 basis-[320px]"><AgendaDeHoje eu={eu} /></div>
        <div className="min-w-0 flex-1 basis-[320px]"><TarefasDoDia eu={eu} /></div>
        <section className={juntar(cartao, "flex-1 basis-[280px]")} aria-label="Documentos">
          <h2 className={juntar(texto.corpo, "mb-2 font-semibold")}>Documentos</h2>
          <EstadoVazio compacto titulo="Em preparação." descricao="Os anexos vão sozinhos para a pasta da pessoa ou do assunto assim que a caixa for ligada." />
          <FolderClosed className="mt-3 h-5 w-5 text-muted-foreground" aria-hidden="true" />
        </section>
      </div>
    </div>
  );
}

/** Campanhas: e-mail marketing no mesmo lugar. A tela explica o caminho; o envio entra com o plano. */
export function CampanhasDoCorreio() {
  const passos = [
    { n: 1, t: "Para quem", d: "Uma lista sua ou os contatos com quem você já conversou." },
    { n: 2, t: "O que dizer", d: "Escreva ou peça ao copiloto um rascunho no tom da empresa." },
    { n: 3, t: "Quando", d: "Agora ou no melhor horário, respeitando o limite diário do plano." },
  ];
  return (
    <div className="min-w-0 space-y-4" data-campanhas-do-correio="">
      <Titulo titulo="Campanhas" frase="E-mail marketing no mesmo lugar da sua caixa. As respostas voltam para a caixa de quem enviou." />
      <div className="flex min-w-0 flex-wrap items-start [&>*]:mb-4 [&>*]:mr-4">
        <div className={juntar(cartao, "flex-[2] basis-[420px]")}>
          <EstadoVazio icone={<Megaphone className="h-5 w-5" aria-hidden="true" />} titulo="Campanhas entram com o plano Pro" descricao="Assim que estiver ligado para a sua empresa, as campanhas aparecem aqui com a lista, a situação e os resultados de cada envio." />
        </div>
        <div className={juntar(cartao, "flex-1 basis-[300px]")}>
          <h2 className={juntar(texto.corpo, "mb-3 font-semibold")}>Em três passos</h2>
          <ol className="space-y-3">
            {passos.map((p) => (
              <li key={p.n} className="flex min-w-0 items-start">
                <span className="mr-3 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-foreground text-[13px] font-semibold text-background">{p.n}</span>
                <span className="min-w-0"><span className={juntar(texto.corpo, "block font-semibold")}>{p.t}</span><span className={juntar(texto.auxiliar, "block leading-5")}>{p.d}</span></span>
              </li>
            ))}
          </ol>
          <p className={juntar(texto.auxiliar, "mt-4 leading-5")}>Só para quem autorizou receber. Todo e-mail sai com o link de descadastro.</p>
        </div>
      </div>
    </div>
  );
}

export const FERRAMENTAS: Array<{ nome: string; plano: "Essencial" | "Pro" | "Equipe"; texto: string; pronta: boolean }> = [
  { nome: "Caixa por prioridade", plano: "Essencial", texto: "Separa sozinha o que pede resposta, o que você acompanha e o que pode esperar.", pronta: true },
  { nome: "Quadro da caixa", plano: "Essencial", texto: "Cada conversa vira um cartão que anda conforme as respostas.", pronta: true },
  { nome: "Agenda e reuniões", plano: "Essencial", texto: "Marque a reunião direto do e-mail e veja o dia num lugar só.", pronta: true },
  { nome: "Tarefas do dia", plano: "Essencial", texto: "Um e-mail vira tarefa com um toque e aparece no seu dia.", pronta: true },
  { nome: "Documentos", plano: "Essencial", texto: "Anexos guardados sozinhos na pasta da pessoa ou do assunto.", pronta: false },
  { nome: "Copiloto", plano: "Pro", texto: "Resume a conversa e sugere a resposta no seu tom. Você revisa e envia.", pronta: false },
  { nome: "Resposta automática", plano: "Pro", texto: "Responde sozinho o que é repetido, só nas regras que você aprovar.", pronta: false },
  { nome: "Campanhas", plano: "Pro", texto: "E-mail marketing com listas, agendamento e descadastro.", pronta: false },
  { nome: "Caixas compartilhadas", plano: "Equipe", texto: "Contato, vendas e financeiro atendidos por várias pessoas.", pronta: false },
  { nome: "Visão do gestor", plano: "Equipe", texto: "Quem administra vê todas as caixas da empresa.", pronta: true },
];

const COR_DO_PLANO = { Essencial: "bg-muted text-muted-foreground", Pro: "bg-accent-soft text-primary", Equipe: "bg-info-soft text-info" } as const;

const PLANOS: Array<{ nome: "Essencial" | "Pro" | "Equipe"; para: string; destaque: boolean }> = [
  { nome: "Essencial", para: "Para quem quer a caixa organizada.", destaque: false },
  { nome: "Pro", para: "Para quem vive no e-mail todos os dias.", destaque: true },
  { nome: "Equipe", para: "Para a empresa inteira trabalhar junta.", destaque: false },
];

/** Ferramentas e planos: o que o correio tem, o que já funciona e o que entra em cada plano. */
export function FerramentasDoCorreio() {
  return (
    <div className="min-w-0 space-y-4" data-ferramentas-do-correio="">
      <Titulo titulo="Ferramentas" frase="Tudo o que o e-mail da empresa precisa, num lugar só." />
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {FERRAMENTAS.map((f) => (
          <article key={f.nome} className="min-w-0 rounded-3xl bg-card p-4">
            <div className="flex min-w-0 items-center">
              <h2 className={juntar(texto.corpo, "min-w-0 flex-1 truncate font-semibold")}>{f.nome}</h2>
              <span className={juntar(etiqueta, "ml-2", COR_DO_PLANO[f.plano])}>{f.plano}</span>
            </div>
            <p className={juntar(texto.auxiliar, "mt-1.5 leading-5")}>{f.texto}</p>
            <p className={juntar(texto.auxiliar, "mt-2")}>{f.pronta ? "No ar" : "Em breve"}</p>
          </article>
        ))}
      </div>
      <h2 className={juntar(texto.tituloSecao, "px-1 pt-3")}>Planos</h2>
      <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-3">
        {PLANOS.map((p) => (
          <article key={p.nome} className={juntar("flex min-w-0 flex-col rounded-3xl p-5", p.destaque ? "bg-foreground text-background" : "bg-card")} data-plano={p.nome}>
            <h3 className="text-[20px] font-semibold leading-7">{p.nome}</h3>
            <p className={juntar("mt-1 text-[13px] leading-5", p.destaque ? "opacity-80" : "text-muted-foreground")}>{p.para}</p>
            <ul className="mt-4 space-y-2">
              {FERRAMENTAS.filter((f) => f.plano === p.nome).map((f) => (
                <li key={f.nome} className="flex min-w-0 items-start text-[13px] leading-5">
                  <Check className={juntar("mr-2 mt-0.5 h-4 w-4 shrink-0", p.destaque ? "" : "text-primary")} aria-hidden="true" />
                  <span>{f.nome}</span>
                </li>
              ))}
              {p.nome !== "Essencial" && <li className="text-[13px] leading-5 opacity-80">Mais tudo do {p.nome === "Pro" ? "Essencial" : "Pro"}</li>}
            </ul>
            <p className={juntar("mt-4 text-[13px] leading-5", p.destaque ? "opacity-80" : "text-muted-foreground")}>Valor com a Aceleriq.</p>
          </article>
        ))}
      </div>
    </div>
  );
}
