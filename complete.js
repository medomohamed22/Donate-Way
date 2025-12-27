exports.handler = async (event) => {
    console.log("=== COMPLETE FUNCTION CALLED ===");
    
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }
    
    const { paymentId, txid } = JSON.parse(event.body || '{}');
    if (!paymentId || !txid) {
        return { statusCode: 400, body: JSON.stringify({ status: 'error', message: 'Missing paymentId or txid' }) };
    }
    
    const apiKey = process.env.PI_API_KEY;
    
    if (!apiKey) {
        console.log("CRITICAL: PI_API_KEY IS MISSING");
        return { statusCode: 500, body: JSON.stringify({ status: 'error', message: 'PI_API_KEY missing' }) };
    }
    
    try {
        const response = await fetch(`https://api.minepi.com/v2/payments/${paymentId}/complete`, {
            method: 'POST',
            headers: {
                'Authorization': `Key ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ txid })
        });
        
        if (response.ok) {
            console.log("COMPLETION SUCCESS");
            return { statusCode: 200, body: JSON.stringify({ status: 'success' }) };
        } else {
            const errText = await response.text();
            console.log("COMPLETION FAILED:", errText);
            return { statusCode: 500, body: JSON.stringify({ status: 'error', message: errText }) };
        }
    } catch (err) {
        console.error("ERROR in complete:", err);
        return { statusCode: 500, body: JSON.stringify({ status: 'error', message: err.message }) };
    }
};