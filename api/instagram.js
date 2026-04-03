// Vercel Edge Function — fetches post shortcodes from picuki.com.
// Images/captions are rendered client-side via Instagram's embed.js — no IP blocking.
export const config = { runtime: 'edge' };

const UA_BROWSER = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const UA_MOBILE  = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

export default async function handler(request) {
    const { searchParams } = new URL(request.url);
    const username   = searchParams.get('username') || '';
    const rawSession = searchParams.get('session')  || process.env.INSTAGRAM_SESSION_ID || '';
    const sessionId  = decodeURIComponent(rawSession);

    const baseHeaders = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET',
        'Cache-Control': 's-maxage=3600, stale-while-revalidate=3600',
    };
    const respond = (data, status = 200) =>
        new Response(JSON.stringify(data), { status, headers: baseHeaders });

    if (!username || !/^[a-z0-9._]+$/i.test(username)) {
        return respond({ error: 'Invalid username' }, 400);
    }
    if (!sessionId) {
        return respond({ error: 'No Instagram session provided', setup: true }, 503);
    }

    // Try Instagram's own API first (gives rich data when not rate-limited)
    const igResult = await tryInstagramAPI(username, sessionId);
    if (igResult) return respond(igResult);

    // Fall back to third-party viewers for shortcodes (and CDN images if in static HTML)
    const picukiResult = await tryPicuki(username);
    if (picukiResult) return respond(picukiResult);

    const imginnResult = await tryImginn(username);
    if (imginnResult) return respond(imginnResult);

    return respond({
        error: 'Could not fetch posts. Instagram may be temporarily blocking this server.',
        rateLimit: true,
    }, 429);
}

// ---- Instagram web API (full data) ---------------------------------------
async function tryInstagramAPI(username, sessionId) {
    try {
        const url = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username.toLowerCase())}`;
        const r   = await fetch(url, {
            headers: {
                'x-ig-app-id':     '936619743392459',
                'User-Agent':      UA_BROWSER,
                'Accept':          '*/*',
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer':         `https://www.instagram.com/${encodeURIComponent(username)}/`,
                'Origin':          'https://www.instagram.com',
                'sec-fetch-site':  'same-origin',
                'sec-fetch-mode':  'cors',
                'sec-fetch-dest':  'empty',
                'Cookie':          `sessionid=${sessionId}`,
            },
        });
        if (!r.ok) return null;
        const json = await r.json();
        const user = json?.data?.user;
        if (!user) return null;

        const media    = user.edge_owner_to_timeline_media || user.edge_felix_video_timeline;
        const edges    = media?.edges || [];
        const pageInfo = media?.page_info || {};

        const posts = edges.map(e => {
            const n       = e.node;
            const caption = n.edge_media_to_caption?.edges?.[0]?.node?.text || '';
            const imageUrl =
                n.edge_sidecar_to_children?.edges?.[0]?.node?.display_url ||
                n.display_url || n.thumbnail_src || null;
            return {
                id: n.shortcode,
                url: `https://www.instagram.com/p/${n.shortcode}/`,
                imageUrl, caption,
                likes:     n.edge_liked_by?.count ?? n.edge_media_preview_like?.count ?? null,
                timestamp: n.taken_at_timestamp ? n.taken_at_timestamp * 1000 : null,
                isVideo:   n.is_video || false,
                source:    'ig',
            };
        });

        return {
            username:  user.username,
            fullName:  user.full_name,
            postCount: media?.count ?? 0,
            hasMore:   pageInfo.has_next_page || false,
            posts,
        };
    } catch { return null; }
}

// ---- picuki.com — shortcodes + any CDN images in static HTML -------------
async function tryPicuki(username) {
    try {
        const url = `https://www.picuki.com/profile/${encodeURIComponent(username)}`;
        const r   = await fetch(url, {
            headers: {
                'User-Agent':      UA_MOBILE,
                'Accept':          'text/html,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
            },
        });
        if (!r.ok) return null;
        const html = await r.text();

        const shortcodes = [];
        let m;
        const scPat = /href="\/media\/([A-Za-z0-9_-]+)"/g;
        while ((m = scPat.exec(html)) !== null) {
            if (!shortcodes.includes(m[1])) shortcodes.push(m[1]);
        }
        if (!shortcodes.length) return null;

        // Pull any Instagram CDN image URLs present in static HTML (positionally matched)
        const imageUrls = [];
        const imgPat = /https:\/\/scontent[^"'\s]*\.cdninstagram\.com[^"'\s]*/g;
        while ((m = imgPat.exec(html)) !== null) {
            const u = m[0].replace(/&amp;/g, '&');
            if (!imageUrls.includes(u)) imageUrls.push(u);
        }

        const posts = shortcodes.slice(0, 12).map((sc, i) => ({
            id:        sc,
            url:       `https://www.instagram.com/p/${sc}/`,
            imageUrl:  imageUrls[i] || null,
            caption:   '',
            likes:     null,
            timestamp: null,
            isVideo:   false,
            source:    'picuki',
        }));

        const titleMatch = html.match(/<title>([^<]+)<\/title>/);
        const fullName   = titleMatch ? titleMatch[1].replace(/\s*[@(].*/, '').trim() : username;
        return { username, fullName, postCount: posts.length, hasMore: true, posts };
    } catch { return null; }
}

// ---- imginn.com — fallback for shortcodes + images -----------------------
async function tryImginn(username) {
    try {
        const url = `https://imginn.com/${encodeURIComponent(username)}/`;
        const r   = await fetch(url, {
            headers: {
                'User-Agent':      UA_MOBILE,
                'Accept':          'text/html,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
            },
        });
        if (!r.ok) return null;
        const html = await r.text();

        // imginn post links: href="/p/SHORTCODE/"
        const shortcodes = [];
        let m;
        const scPat = /href="\/p\/([A-Za-z0-9_-]+)\/?"/g;
        while ((m = scPat.exec(html)) !== null) {
            if (!shortcodes.includes(m[1])) shortcodes.push(m[1]);
        }
        if (!shortcodes.length) return null;

        // CDN image URLs in static HTML
        const imageUrls = [];
        const imgPat = /https:\/\/scontent[^"'\s]*\.cdninstagram\.com[^"'\s]*/g;
        while ((m = imgPat.exec(html)) !== null) {
            const u = m[0].replace(/&amp;/g, '&');
            if (!imageUrls.includes(u)) imageUrls.push(u);
        }

        const posts = shortcodes.slice(0, 12).map((sc, i) => ({
            id:        sc,
            url:       `https://www.instagram.com/p/${sc}/`,
            imageUrl:  imageUrls[i] || null,
            caption:   '',
            likes:     null,
            timestamp: null,
            isVideo:   false,
            source:    'imginn',
        }));

        return { username, fullName: username, postCount: posts.length, hasMore: true, posts };
    } catch { return null; }
}
