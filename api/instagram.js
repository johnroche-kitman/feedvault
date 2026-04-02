// Vercel serverless function — fetches Instagram posts server-side.
// Strategy: try Instagram API first; fall back to picuki.com public viewer if blocked.

const UA_BROWSER = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const UA_MOBILE  = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');

    const { username } = req.query;
    if (!username || !/^[a-z0-9._]+$/i.test(username)) {
        return res.status(400).json({ error: 'Invalid username' });
    }

    const rawSession = req.query.session || process.env.INSTAGRAM_SESSION_ID || '';
    const sessionId  = decodeURIComponent(rawSession);
    if (!sessionId) {
        return res.status(503).json({ error: 'No Instagram session provided', setup: true });
    }

    // Cache for 1 hour on Vercel edge
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=3600');

    // --- Attempt 1: Instagram's own API ---
    const igResult = await tryInstagramAPI(username, sessionId);
    if (igResult) return res.status(200).json(igResult);

    // --- Attempt 2: Public viewer scrape ---
    const scrapedResult = await tryPublicScrape(username);
    if (scrapedResult) return res.status(200).json(scrapedResult);

    // Both failed
    return res.status(429).json({
        error: 'Instagram is blocking automated requests from this server. Try again later.',
        rateLimit: true
    });
}

// ---- Attempt 1: Instagram web API ----------------------------------------
async function tryInstagramAPI(username, sessionId) {
    try {
        const url    = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username.toLowerCase())}`;
        const apiRes = await fetch(url, {
            headers: {
                'x-ig-app-id':    '936619743392459',
                'User-Agent':     UA_BROWSER,
                'Accept':         '*/*',
                'Accept-Language':'en-US,en;q=0.9',
                'Referer':        `https://www.instagram.com/${encodeURIComponent(username)}/`,
                'Origin':         'https://www.instagram.com',
                'sec-fetch-site': 'same-origin',
                'sec-fetch-mode': 'cors',
                'sec-fetch-dest': 'empty',
                'Cookie':         `sessionid=${sessionId}`,
            },
        });

        if (!apiRes.ok) return null;

        const json     = await apiRes.json();
        const userData = json?.data?.user;
        if (!userData) return null;

        const media    = userData.edge_owner_to_timeline_media || userData.edge_felix_video_timeline;
        const edges    = media?.edges || [];
        const pageInfo = media?.page_info || {};

        const posts = edges.map(e => {
            const n        = e.node;
            const caption  = n.edge_media_to_caption?.edges?.[0]?.node?.text || '';
            const imageUrl = n.edge_sidecar_to_children?.edges?.[0]?.node?.display_url
                          || n.display_url || n.thumbnail_src || null;
            return {
                id:        n.shortcode,
                url:       `https://www.instagram.com/p/${n.shortcode}/`,
                imageUrl,
                caption,
                likes:     n.edge_liked_by?.count ?? n.edge_media_preview_like?.count ?? null,
                timestamp: n.taken_at_timestamp ? n.taken_at_timestamp * 1000 : null,
                isVideo:   n.is_video || false,
                source:    'ig',
            };
        });

        return {
            username:   userData.username,
            fullName:   userData.full_name,
            postCount:  media?.count ?? 0,
            hasMore:    pageInfo.has_next_page || false,
            posts,
        };
    } catch (e) {
        console.warn('IG API failed:', e.message);
        return null;
    }
}

// ---- Attempt 2: scrape picuki.com (public Instagram viewer) ---------------
async function tryPublicScrape(username) {
    try {
        const url = `https://www.picuki.com/profile/${encodeURIComponent(username)}`;
        const res = await fetch(url, {
            headers: {
                'User-Agent':      UA_MOBILE,
                'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
            },
        });

        if (!res.ok) return null;
        const html = await res.text();

        // Extract posts from the HTML
        const posts = [];

        // Find all media shortcodes — picuki links look like /media/SHORTCODE
        const mediaPattern = /href="\/media\/([A-Za-z0-9_-]+)"/g;
        const imgPattern   = /class="post-image"[^>]*src="([^"]+)"/g;
        const captionPat   = /<div class="photo-description">([\s\S]*?)<\/div>/g;
        const likesPat     = /<span class="likes">\s*([\d,KM.]+)\s*<\/span>/g;

        const shortcodes = [];
        let m;
        while ((m = mediaPattern.exec(html)) !== null) {
            if (!shortcodes.includes(m[1])) shortcodes.push(m[1]);
        }

        const images   = [];
        while ((m = imgPattern.exec(html))   !== null) images.push(m[1]);

        const captions = [];
        while ((m = captionPat.exec(html)) !== null) {
            const text = m[1].replace(/<[^>]+>/g, '').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#39;/g,"'").replace(/&quot;/g,'"').trim();
            captions.push(text);
        }

        const likes = [];
        while ((m = likesPat.exec(html)) !== null) likes.push(m[1].replace(/,/g, ''));

        // Zip together — take up to 12 posts
        const count = Math.min(shortcodes.length, 12);
        for (let i = 0; i < count; i++) {
            posts.push({
                id:        shortcodes[i],
                url:       `https://www.instagram.com/p/${shortcodes[i]}/`,
                imageUrl:  images[i] || null,
                caption:   captions[i] || '',
                likes:     likes[i] ? parseInt(likes[i]) || null : null,
                timestamp: null,
                isVideo:   false,
                source:    'picuki',
            });
        }

        if (!posts.length) return null;

        // Extract full name from page title or h1
        const titleMatch = html.match(/<title>([^<]+)<\/title>/);
        const fullName   = titleMatch ? titleMatch[1].replace(/\s*[@(].*/, '').trim() : username;

        return { username, fullName, postCount: posts.length, hasMore: true, posts };
    } catch (e) {
        console.warn('Picuki scrape failed:', e.message);
        return null;
    }
}
