/**
 * Cache do pré-voo CORS (FN-02, 30/09/2026).
 *
 * Sem Access-Control-Max-Age o navegador repetia o OPTIONS antes de quase
 * todo POST (786 pré-voos para 881 chamadas em 24 h), e cada OPTIONS sobe uma
 * instância nova da função. Com 7200 s o Chrome guarda por até 2 h, o Firefox
 * por até 24 h (aceita o valor) e o WebKit corta em 600 s.
 *
 * Só este cabeçalho mora aqui: as listas de Allow-Origin, Allow-Headers e
 * Allow-Methods continuam as de cada função (quem pode chamar o quê não muda).
 * Uso: `const corsHeaders = { ...listas da função, ...PREFLIGHT_CACHE };`
 */
export const PREFLIGHT_CACHE = { "Access-Control-Max-Age": "7200" } as const;
