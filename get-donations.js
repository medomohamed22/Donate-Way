const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405 };
  
  const { username } = JSON.parse(event.body || '{}');
  if (!username) return { statusCode: 400, body: JSON.stringify({ error: 'Missing username' }) };
  
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return { statusCode: 500, body: JSON.stringify({ error: 'DB config missing' }) };
  
  const supabase = createClient(databaseUrl, '');
  
  try {
    const { data: donations, error } = await supabase
      .from('donations')
      .select('*')
      .eq('username', username)
      .order('timestamp', { ascending: false });
    
    if (error) throw error;
    
    return {
      statusCode: 200,
      body: JSON.stringify({ donations: donations || [] })
    };
  } catch (err) {
    console.error("Get donations error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};