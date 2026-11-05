export default async function handler(request, response) {
    const origin = request.headers.origin || request.headers.referer;
    if (origin && !origin.includes('soop-keeper') && !origin.includes('localhost') && !origin.includes('127.0.0.1')) {
        return response.status(403).json({ error: 'Access Denied' });
    }

    try {
        const R2_URL = process.env.R2_PUBLIC_URL;
        const res = await fetch(`${R2_URL}/maintenance.json?_=${Date.now()}`);
        
        let isMaintenance = false;
        if (res.ok) {
            isMaintenance = await res.json();
        }

        response.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        response.setHeader('Pragma', 'no-cache');
        response.setHeader('Expires', '0');
        response.setHeader('Content-Type', 'application/json');
        response.setHeader('Access-Control-Allow-Origin', origin ? origin : '*');

        return response.status(200).json({ maintenance: isMaintenance === true });
    } catch (error) {
        console.error('Maintenance API error:', error);
        return response.status(500).json({ maintenance: false });
    }
}
