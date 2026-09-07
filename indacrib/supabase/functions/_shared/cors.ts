// Shared CORS headers for edge functions called directly from the browser
// (as opposed to admin/seed functions invoked via curl, which don't need
// this). Without these, the browser's preflight OPTIONS request gets
// rejected before the actual POST is ever sent — curl doesn't hit this
// because only browsers perform CORS preflight.
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
