/* Configuração da nuvem (Supabase).
   Preencha com os dados do seu projeto: Supabase → Project Settings → API Keys.
   - supabaseUrl: "Project URL", ex.: https://abcdefghijklmnop.supabase.co
   - supabaseChave: a chave PUBLICÁVEL ("publishable", começa com sb_publishable_) ou a "anon" legada.
     Ela é pública por natureza e pode ir no app: a proteção dos dados vem das regras RLS do banco.
   NUNCA coloque aqui a chave secreta ("secret" / "service_role") nem a senha do banco.
   Com os campos vazios, o app funciona normalmente, só que sem cópia na nuvem. */
window.CC_CONFIG = {
  supabaseUrl: '',
  supabaseChave: ''
};
