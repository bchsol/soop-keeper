export default async function handler(request, response) {
    const origin = request.headers.origin || request.headers.referer;
    if (!origin || (!origin.includes('soop-keeper') && !origin.includes('localhost') && !origin.includes('127.0.0.1'))) {
        return response.status(403).json({ error: 'Access Denied' });
    }

    try {
        const R2_URL = process.env.R2_PUBLIC_URL;
        const { type, streamerId } = request.query;

        if (type === 'deletions') {
            const reportRes = await fetch(`${R2_URL}/deletion_report.json`).catch(() => null);
            if (reportRes && reportRes.ok) {
                const reportData = await reportRes.json();
                response.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=600');
                response.setHeader('Content-Type', 'application/json');
                response.setHeader('Access-Control-Allow-Origin', origin);
                return response.status(200).json(reportData);
            }
            throw new Error('Failed to fetch deletion report');
        }

        if (type === 'summary') {
            const [summary1Res, summary2Res, maintRes] = await Promise.all([
                fetch(`${R2_URL}/summary_1.json`).catch(() => null),
                fetch(`${R2_URL}/summary_2.json`).catch(() => null),
                fetch(`${R2_URL}/maintenance.json`).catch(() => null)
            ]);

            let streamers = [];
            
            if (summary1Res && summary1Res.ok) {
                const data1 = await summary1Res.json();
                streamers.push(...(data1.streamers || []));
            }
            if (summary2Res && summary2Res.ok) {
                const data2 = await summary2Res.json();
                streamers.push(...(data2.streamers || []));
            }

            if (streamers.length === 0) {
                const fallbackRes = await fetch(`${R2_URL}/summary.json`).catch(() => null);
                if (fallbackRes && fallbackRes.ok) {
                    const fallbackData = await fallbackRes.json();
                    streamers = fallbackData.streamers || [];
                }
            }

            if (streamers.length === 0) throw new Error('R2 summary fetch failed (No data)');

            const summaryData = { streamers };
            const maintenance = (maintRes && maintRes.ok) ? await maintRes.json() : false;

            response.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');
            response.setHeader('Content-Type', 'application/json');
            response.setHeader('Access-Control-Allow-Origin', origin);

            return response.status(200).json({ ...summaryData, maintenance });
        }

        if (streamerId) {
            const [dataRes, maintRes] = await Promise.all([
                fetch(`${R2_URL}/data/${streamerId}.json`),
                fetch(`${R2_URL}/maintenance.json`)
            ]);

            if (!dataRes.ok) throw new Error('R2 streamer data fetch failed');

            const data = await dataRes.json();
            const maintenance = maintRes.ok ? await maintRes.json() : false;

            response.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');
            response.setHeader('Content-Type', 'application/json');
            response.setHeader('Access-Control-Allow-Origin', origin);

            return response.status(200).json({ ...data, maintenance });
        }

        return response.status(400).json({ error: 'Invalid request' });
    } catch (error) {
        console.error('Vercel API error:', error);
        return response.status(500).json({ error: 'Failed to fetch data' });
    }
}
