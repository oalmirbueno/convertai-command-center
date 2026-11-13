import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bot, Code2, Copy, Globe, KeyRound, MessageSquare, Plus, Trash2 } from "lucide-react";
import { criarChave, diaLegivel, enderecoDaApi, fraseDoErro, listarChaves, revogarChave, type ChaveDeApi } from "@/lib/produto/api";
import { CampoDeFormulario, Carregando, EstadoVazio, JanelaCentral, Secao, SeletorCompacto, botao, campo, etiqueta, juntar, lista, superficie, texto } from "@/components/sistema";

type Destino = "claude" | "chatgpt" | "site" | "api";

const DESTINOS: Array<{ valor: Destino; rotulo: string; icone: JSX.Element; linha: string }> = [
  { valor: "claude", rotulo: "Claude", icone: <Bot className="h-4 w-4" aria-hidden="true" />, linha: "Pergunte e peça para mexer no funil conversando" },
  { valor: "chatgpt", rotulo: "ChatGPT", icone: <MessageSquare className="h-4 w-4" aria-hidden="true" />, linha: "O mesmo, dentro do ChatGPT" },
  { valor: "site", rotulo: "Site e formulário", icone: <Globe className="h-4 w-4" aria-hidden="true" />, linha: "Quem preenche o formulário já cai no funil" },
  { valor: "api", rotulo: "API", icone: <Code2 className="h-4 w-4" aria-hidden="true" />, linha: "Para n8n, Make, Zapier ou o seu sistema" },
];

/** O endereço que o Claude e o ChatGPT pedem: a porta MCP com a chave no fim. */
export const enderecoDoAssistente = (api: string, chave: string) => `${api}/mcp/${chave}`;

/** O que copiar e onde colar, para cada destino. `chave` vazia mostra o lugar dela. */
export function instrucoes(destino: Destino, api: string, chave: string): { passos: string[]; copiar: Array<{ rotulo: string; valor: string }> } {
  const k = chave || "SUA_CHAVE";
  if (destino === "claude") {
    return {
      passos: ["No Claude, abra Configurações e depois Conectores.", "Escolha Adicionar conector personalizado.", "Dê o nome CRM e cole o endereço abaixo.", "Numa conversa nova, ligue o conector e peça: mostre o meu funil."],
      copiar: [{ rotulo: "Endereço do conector", valor: enderecoDoAssistente(api, k) }],
    };
  }
  if (destino === "chatgpt") {
    return {
      passos: ["No ChatGPT, abra Configurações e depois Conectores.", "Ative o modo de desenvolvedor, se ele pedir, e escolha Criar.", "Dê o nome CRM, cole o endereço abaixo e escolha sem autenticação.", "Numa conversa nova, ligue o conector e peça: liste os negócios em proposta."],
      copiar: [{ rotulo: "Endereço do servidor MCP", valor: enderecoDoAssistente(api, k) }],
    };
  }
  if (destino === "site") {
    return {
      passos: ["No envio do formulário, o seu site faz a chamada abaixo.", "Quem já está no funil com o mesmo e-mail ou WhatsApp não é duplicado.", "Guarde a chave no servidor do site, nunca no código que o visitante baixa."],
      copiar: [{
        rotulo: "Chamada ao enviar o formulário",
        valor: `curl -X POST "${api}/v1/negocios" \\\n  -H "Authorization: Bearer ${k}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"nome":"Maria Silva","empresa":"Padaria Sol","whatsapp":"41999990000","email":"maria@exemplo.com","origem":"site","notas":"Pediu orçamento pelo site"}'`,
      }],
    };
  }
  return {
    passos: ["Mande a chave no cabeçalho Authorization: Bearer.", "As respostas vêm em JSON, com os nomes em português.", "Cada chave pode fazer 120 chamadas por minuto."],
    copiar: [
      { rotulo: "Endereço base", valor: `${api}/v1` },
      { rotulo: "Listar os negócios abertos", valor: `curl "${api}/v1/negocios?abertos=true" -H "Authorization: Bearer ${k}"` },
      { rotulo: "Mover de etapa", valor: `curl -X PATCH "${api}/v1/negocios/ID_DO_NEGOCIO" \\\n  -H "Authorization: Bearer ${k}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"etapa":"proposta"}'` },
      { rotulo: "Rotas", valor: "GET /eu · GET /funil · GET e POST /negocios · GET e PATCH /negocios/:id · POST /negocios/:id/notas · GET /empresas · GET e POST /compromissos · POST /compromissos/:id/concluir" },
    ],
  };
}

const copiar = (valor: string, oQue: string) => void navigator.clipboard.writeText(valor).then(() => toast.success(`${oQue} copiado.`)).catch(() => toast.error("Não foi possível copiar."));

function Instrucoes({ destino, chave }: { destino: Destino; chave: string }) {
  const { passos, copiar: itens } = instrucoes(destino, enderecoDaApi(), chave);
  return (
    <div className="min-w-0 space-y-3" data-instrucoes={destino}>
      <ol className="min-w-0 space-y-1.5">
        {passos.map((p, i) => (
          <li key={p} className="flex min-w-0 items-start">
            <span className="mr-2.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">{i + 1}</span>
            <span className={juntar(texto.corpo, "min-w-0")}>{p}</span>
          </li>
        ))}
      </ol>
      {itens.map((c) => (
        <div key={c.rotulo} className="min-w-0">
          <div className="mb-1 flex min-w-0 items-center">
            <span className={juntar(texto.rotulo, "min-w-0 flex-1 truncate")}>{c.rotulo}</span>
            <button type="button" className={botao.icone} onClick={() => copiar(c.valor, c.rotulo)} aria-label={`Copiar: ${c.rotulo}`} title="Copiar">
              <Copy className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <pre className="min-w-0 overflow-x-auto whitespace-pre-wrap break-all rounded-md bg-muted/50 p-3 text-[12px] leading-5 text-foreground">{c.valor}</pre>
        </div>
      ))}
    </div>
  );
}

/**
 * Conexões da empresa: as chaves de API e o passo a passo para ligar o CRM ao
 * Claude, ao ChatGPT, ao site e a qualquer automação. A chave aparece inteira
 * uma vez só, ao criar; depois fica só o começo dela, para reconhecer.
 */
export default function ConexoesDaConta() {
  const qc = useQueryClient();
  const chaves = useQuery({ queryKey: ["produto", "chaves"], queryFn: listarChaves });
  const [destino, setDestino] = useState<Destino>("claude");
  const [criando, setCriando] = useState(false);
  const [nome, setNome] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [nova, setNova] = useState<{ nome: string; chave: string } | null>(null);
  const [saindo, setSaindo] = useState<ChaveDeApi | null>(null);
  const reler = () => qc.invalidateQueries({ queryKey: ["produto", "chaves"] });

  const abrirCriacao = (sugestao: string) => {
    setNome(sugestao);
    setCriando(true);
  };

  const criar = async () => {
    setEnviando(true);
    try {
      const r = await criarChave(nome.trim());
      await reler();
      setCriando(false);
      setNova({ nome: nome.trim(), chave: r.chave });
    } catch (e) {
      toast.error(fraseDoErro(e, "Não foi possível criar a chave."));
    } finally {
      setEnviando(false);
    }
  };

  const revogar = async (k: ChaveDeApi) => {
    try {
      await revogarChave(k.id);
      await reler();
      toast.success("Chave revogada. Ela parou de funcionar agora.");
    } catch (e) {
      toast.error(fraseDoErro(e, "Não foi possível revogar."));
    }
  };

  const ativas = (chaves.data || []).filter((k) => !k.revogada_em);
  const atual = DESTINOS.filter((d) => d.valor === destino)[0];

  return (
    <div className="grid min-w-0 grid-cols-1 items-start gap-x-10 gap-y-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,460px)]" data-conexoes-da-conta="">
      <div className="min-w-0 space-y-6">
        <Secao
          titulo="Conectar"
          ajuda="O CRM conversa com outros lugares por uma chave de API. Com ela o Claude e o ChatGPT leem e mexem no funil, o formulário do site cadastra negócios e as suas automações fazem o resto. Cada conexão merece a própria chave: se uma vazar, você revoga só ela."
        >
          <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Onde conectar">
            {DESTINOS.map((d) => (
              <button
                key={d.valor}
                type="button"
                role="radio"
                aria-checked={destino === d.valor}
                onClick={() => setDestino(d.valor)}
                data-destino={d.valor}
                className={juntar(superficie.painel, "flex min-w-0 items-center p-3 text-left transition-colors", destino === d.valor ? "border-primary" : "hover:border-muted-foreground/40")}
              >
                <span className={juntar("mr-3 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", destino === d.valor ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary")}>{d.icone}</span>
                <span className="min-w-0 flex-1">
                  <span className={juntar(texto.corpo, "block truncate font-medium")}>{d.rotulo}</span>
                  <span className={juntar(texto.auxiliar, "block truncate")}>{d.linha}</span>
                </span>
              </button>
            ))}
          </div>
        </Secao>

        <Secao
          titulo="Chaves"
          descricao={`${ativas.length} ${ativas.length === 1 ? "ativa" : "ativas"}`}
          acao={
            <button type="button" className={botao.icone} onClick={() => abrirCriacao("")} aria-label="Nova chave" title="Nova chave" data-nova-chave="">
              <Plus className="h-4 w-4 text-primary" aria-hidden="true" />
            </button>
          }
        >
          {chaves.isLoading ? (
            <Carregando linhas={2} rotulo="Carregando as chaves" />
          ) : (chaves.data || []).length === 0 ? (
            <EstadoVazio compacto icone={<KeyRound className="h-5 w-5" aria-hidden="true" />} titulo="Nenhuma chave ainda." descricao="Crie a primeira para conectar." />
          ) : (
            <ul className={juntar(lista.aberta, lista.divisoria)} data-chaves-de-api="">
              {(chaves.data || []).map((k) => (
                <li key={k.id} className={lista.linha}>
                  <span className="min-w-0 flex-1">
                    <span className={juntar(texto.corpo, "block truncate font-medium", k.revogada_em && "text-muted-foreground line-through")}>{k.nome}</span>
                    <span className={juntar(texto.auxiliar, "block truncate")}>
                      <span className="font-mono">{k.prefixo}…</span> · criada em {diaLegivel(k.criado_em)}
                      {k.ultimo_uso_em ? ` · usada em ${diaLegivel(k.ultimo_uso_em)}` : " · nunca usada"}
                    </span>
                  </span>
                  {k.revogada_em ? (
                    <span className={juntar(etiqueta, "ml-2 bg-muted text-muted-foreground")}>Revogada</span>
                  ) : (
                    <button type="button" className={juntar(botao.icone, "ml-1")} onClick={() => setSaindo(k)} aria-label={`Revogar a chave ${k.nome}`} title="Revogar">
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Secao>
      </div>

      <Secao
        titulo={atual.rotulo}
        recolher={false}
        acao={<button type="button" className={juntar(botao.primario, "h-8")} onClick={() => abrirCriacao(atual.rotulo)} data-criar-chave-do-destino="">Criar chave</button>}
      >
        <Instrucoes destino={destino} chave="" />
      </Secao>

      <JanelaCentral
        aberta={criando}
        onFechar={() => setCriando(false)}
        largura="sm"
        titulo="Nova chave"
        ajuda="O nome é só para você lembrar onde a chave é usada. Ela dá acesso de leitura e escrita ao CRM da empresa."
        rodape={<button type="button" className={botao.primario} onClick={() => void criar()} disabled={enviando || nome.trim().length < 2} data-confirmar-chave="">{enviando ? "Criando..." : "Criar chave"}</button>}
      >
        <CampoDeFormulario rotulo="Onde ela vai ser usada" obrigatorio>
          <input value={nome} onChange={(e) => setNome(e.target.value)} className={campo} maxLength={60} placeholder="Claude, site, n8n..." onKeyDown={(e) => { if (e.key === "Enter" && nome.trim().length >= 2) void criar(); }} />
        </CampoDeFormulario>
      </JanelaCentral>

      <JanelaCentral
        aberta={!!nova}
        onFechar={() => setNova(null)}
        largura="lg"
        fecharNoFundo={false}
        titulo="Chave criada"
        descricao="Copie agora: ela não aparece de novo"
        acoes={nova ? <SeletorCompacto rotulo="Onde conectar" modo="lista" opcoes={DESTINOS.map((d) => ({ valor: d.valor, rotulo: d.rotulo }))} valor={destino} onEscolher={(v) => setDestino(v as Destino)} /> : undefined}
        rodape={<button type="button" className={botao.primario} onClick={() => setNova(null)}>Já copiei</button>}
      >
        {nova && (
          <div className="min-w-0 space-y-4" data-chave-criada="">
            <div className="min-w-0">
              <div className="mb-1 flex min-w-0 items-center">
                <span className={juntar(texto.rotulo, "min-w-0 flex-1")}>Chave ({nova.nome})</span>
                <button type="button" className={botao.icone} onClick={() => copiar(nova.chave, "Chave")} aria-label="Copiar a chave" title="Copiar">
                  <Copy className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
              <pre className="min-w-0 overflow-x-auto whitespace-pre-wrap break-all rounded-md bg-muted/50 p-3 font-mono text-[12px] leading-5 text-foreground" data-texto-da-chave="">{nova.chave}</pre>
            </div>
            <Instrucoes destino={destino} chave={nova.chave} />
          </div>
        )}
      </JanelaCentral>

      <JanelaCentral
        aberta={!!saindo}
        onFechar={() => setSaindo(null)}
        largura="sm"
        titulo={saindo ? `Revogar a chave ${saindo.nome}?` : "Revogar"}
        rodape={
          <>
            <button type="button" className={juntar(botao.secundario, "mr-2")} onClick={() => setSaindo(null)}>Manter</button>
            <button
              type="button"
              className={botao.perigo}
              onClick={() => {
                const k = saindo;
                setSaindo(null);
                if (k) void revogar(k);
              }}
            >
              Revogar
            </button>
          </>
        }
      >
        <p className={texto.corpo}>O que usa essa chave para de funcionar na hora.</p>
      </JanelaCentral>
    </div>
  );
}
