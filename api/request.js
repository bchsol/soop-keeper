export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');
    const { streamerId, reason } = req.body;

    // Vercel Dashboard의 Settings -> Environment Variables에 등록해둘 실시간 환경변수 키 이름
    const webhookUrl = process.env.DISCORD_REQUEST_WEBHOOK;

    try {
        await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                embeds: [{
                    title: '스트리머 신청',
                    color: 0x3b82f6,
                    fields: [
                        { name: '스트리머 ID', value: streamerId, inline: true },
                        { name: '사유', value: reason, inline: true }
                    ],
                    timestamp: new Date().toISOString()
                }]
            })
        });
        res.status(200).json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
}