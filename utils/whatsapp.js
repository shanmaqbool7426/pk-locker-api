// ─────────────────────────────────────────────────────────────────────────────
//  WhatsApp Sender (UltraMsg gateway)
//  Env vars required (Vercel → Project → Settings → Environment Variables):
//    ULTRAMSG_INSTANCE_ID   e.g. "instance12345"
//    ULTRAMSG_TOKEN         e.g. "abc123token"
//  If either is missing, sendWhatsApp() logs and returns false — no crash,
//  callers just skip the WhatsApp leg (FCM push still fires).
//  Uses Node 18+ global fetch — no extra dependency needed.
// ─────────────────────────────────────────────────────────────────────────────

// Normalize Pakistani numbers to international format UltraMsg expects
// (923069829158). Accepts 0306..., 92306..., +92306..., 306...
const normalizePkPhone = (raw) => {
    if (!raw) return null;
    let p = String(raw).replace(/[^0-9+]/g, '');
    if (p.startsWith('+')) p = p.substring(1);
    if (p.startsWith('92')) return p;
    if (p.startsWith('0')) return '92' + p.substring(1);
    if (p.length === 10) return '92' + p; // bare 3xxxxxxxxx mobile
    return p; // already international or unknown — send as-is
};

const sendWhatsApp = async (toPhone, message) => {
    const instanceId = process.env.ULTRAMSG_INSTANCE_ID;
    const token = process.env.ULTRAMSG_TOKEN;
    const to = normalizePkPhone(toPhone);

    if (!instanceId || !token) {
        console.log(`[WhatsApp] Skipped — ULTRAMSG env vars not configured. Would send to ${to}: ${message}`);
        return false;
    }
    if (!to || to.length < 11) {
        console.log(`[WhatsApp] Skipped — invalid destination number: ${toPhone}`);
        return false;
    }

    try {
        const response = await fetch(`https://api.ultramsg.com/${instanceId}/messages/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, to, body: message })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            console.error(`[WhatsApp Error] HTTP ${response.status} sending to ${to}: ${JSON.stringify(data)}`);
            return false;
        }
        console.log(`[WhatsApp] Sent to ${to}: ${JSON.stringify(data)}`);
        return true;
    } catch (err) {
        console.error(`[WhatsApp Error] Failed sending to ${to}: ${err.message}`);
        return false;
    }
};

module.exports = { sendWhatsApp, normalizePkPhone };
