const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
    console.log("=== COMPLETE FUNCTION CALLED ===");
    console.log("Time:", new Date().toISOString());
    console.log("Body:", event.body);
    
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }
    
    let payload;
    try {
        payload = JSON.parse(event.body || '{}');
    } catch (e) {
        console.log("JSON parse error:", e.message);
        return { statusCode: 400, body: JSON.stringify({ status: 'error', message: 'Invalid JSON' }) };
    }
    
    const { paymentId, txid, campaign_id, amount, username } = payload;
    
    if (!paymentId || !txid) {
        console.log("Missing paymentId or txid");
        return { statusCode: 400, body: JSON.stringify({ status: 'error', message: 'Missing data' }) };
    }
    
    const piApiKey = process.env.API_KEY;
    const databaseUrl = process.env.DATABASE_URL; // ← DATABASE_URL كما طلبت
    
    if (!piApiKey || !databaseUrl) {
        console.log("Missing PI_API_KEY or DATABASE_URL");
        return { statusCode: 500, body: JSON.stringify({ status: 'error', message: 'Server configuration error' }) };
    }
    
    try {
        // إكمال الدفع مع Pi Network
        const piResponse = await fetch(`https://api.minepi.com/v2/payments/${paymentId}/complete`, {
            method: 'POST',
            headers: {
                'Authorization': `Key ${piApiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ txid })
        });
        
        if (!piResponse.ok) {
            const errText = await piResponse.text();
            console.log("Pi Completion Failed:", errText);
            return { statusCode: 500, body: JSON.stringify({ status: 'error', message: errText }) };
        }
        
        console.log("Pi COMPLETION SUCCESS");
        
        // ربط Supabase باستخدام DATABASE_URL
        const supabase = createClient(databaseUrl, '');
        
        // تسجيل التبرع في جدول donations مع username
        const { data, error } = await supabase
            .from('donations')
            .insert({
                payment_id: paymentId,
                txid: txid,
                campaign_id: campaign_id,
                amount: amount || null,
                username: username || null, // ← إضافة اسم المستخدم
                timestamp: new Date().toISOString(),
                status: 'completed'
            });
        
        if (error) {
            console.log("Supabase Insert Error:", error);
            throw error;
        }
        
        console.log("Donation saved to Supabase:", data);
        
        return { statusCode: 200, body: JSON.stringify({ status: 'success' }) };
    } catch (err) {
        console.error("Unexpected Error:", err);
        return { statusCode: 500, body: JSON.stringify({ status: 'error', message: err.message }) };
    }
};