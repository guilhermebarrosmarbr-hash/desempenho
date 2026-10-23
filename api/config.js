export default function handler(req, res) {
  // Retorna as credenciais anonimas/publicas do Supabase configuradas nas variaveis da Vercel
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
  return res.status(200).json({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'https://rdjdieirkjlyoooxtdfw.supabase.co',
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || 'sb_publishable_OSLZXYjeAk8dVmwAt5-QIQ_kkFxC-V_'
  });
}
