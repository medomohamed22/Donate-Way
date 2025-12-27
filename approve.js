exports.handler = async (event) => {
    console.log("=== APPROVE FUNCTION CALLED ===");
    
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }
    
    const { paymentId } = JSON.parse(event.body || '{}');
    if (!paymentId) {
        return { statusCode: 400, body: JSON.stringify({ status: 'error', message: 'Missing paymentId' }) };
    }
    
    const apiKey = process.env.PI_API_KEY;
    
    if (!apiKey) {
        console.log("CRITICAL: PI_API_KEY IS MISSING");
        return { statusCode: 500, body: JSON.stringify({ status: 'error', message: 'PI_API_KEY missing' }) };
    }
    
    try {
        const response = await fetch(`https://api.minepi.com/v2/payments/${paymentId}/approve`, {
            method: 'POST',
            headers: {
                'Authorization': `Key ${apiKey}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (response.ok) {
            console.log("APPROVAL SUCCESS");
            return { statusCode: 200, body: JSON.stringify({ status: 'success' }) };
        } else {
            const errText = await response.text();
            console.log("APPROVAL FAILED:", errText);
            return { statusCode: 500, body: JSON.stringify({ status: 'error', message: errText }) };
        }
    } catch (err) {
        console.error("ERROR in approve:", err);
        return { statusCode: 500, body: JSON.stringify({ status: 'error', message: err.message }) };
    }
};