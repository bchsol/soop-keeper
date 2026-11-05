export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');
    const { content } = req.body;
    const webhookUrl = process.env.DISCORD_CONTACT_WEBHOOK;

    try {
        await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                embeds: [{
                    title: '문의사항/요청사항',
                    color: 0x10b981,
                    description: content,
                    timestamp: new Date().toISOString()
                }]
            })
        });
        res.status(200).json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
}