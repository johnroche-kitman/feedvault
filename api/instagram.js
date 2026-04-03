// Vercel Edge Function — runs on Vercel's edge network (different IPs than standard serverless).
export const config = { runtime: 'edge' };

const UA_BROWSER = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const UA_MOBILE  = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

export default async function handler(request) {
    const { searchParams } = new URL(request.url);
    const username   = searchParams.get('username') || '';
    const rawSession = searchParams.get('session')  || process.env.INSTAGRAM_SESSION_ID || '';
    const sessionId  = decodeURIComponent(rawSession);
    const debug      = searchParams.get('debug') === '1';

    const baseHeaders = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET',
        'Cache-Control': 'no-store',
    };
    const respond = (data, status = 200) =>
        new Response(JSON.stringify(data), { status, headers: baseHeaders });

    if (!username || !/^[a-z0-9._]+$/i.test(username)) {
        return respond({ error: 'Invalid username' }, 400);
    }
    if (!sessionId) {
        return respond({ error: 'No Instagram session provided', setup: true }, 503);
    }

    const log = [];

    let result =
        await tryInstagramAPI(username, sessionId, log) ||
        await tryInstagramMobile(username, sessionId, log) ||
        await tryPicuki(username, log);

    // If posts came back with null imageUrls, fill them in parallel
    if (result && result.posts.some(p => !p.imageUrl)) {
        await fillImages(result.posts, sessionId, log);
    }

    if (result) {
        if (debug) result._debug = log;
        return respond(result);
    }

    return respond({
        error: 'Instagram is blocking automated requests from this server. Try again later.',
        rateLimit: true,
        ...(debug ? { _debug: log } : {}),
    }, 429);
}

// ---- Attempt 1: Instagram web API ----------------------------------------
async function tryInstagramAPI(username, sessionId, log) {
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
        log.push({ source: 'ig-web-api', status: r.status });
        if (!r.ok) return null;
        const json = await r.json();
        return shapeIGUser(json?.data?.user);
    } catch (e) {
        log.push({ source: 'ig-web-api', error: e.message });
        return null;
    }
}

// ---- Attempt 2: i.instagram.com mobile endpoint --------------------------
async function tryInstagramMobile(username, sessionId, log) {
    try {
        const url = `https://i.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username.toLowerCase())}`;
        const r   = await fetch(url, {
            headers: {
                'x-ig-app-id':     '936619743392459',
                'User-Agent':      UA_MOBILE,
                'Accept':          '*/*',
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer':         `https://www.instagram.com/${encodeURIComponent(username)}/`,
                'Origin':          'https://www.instagram.com',
                'Cookie':          `sessionid=${sessionId}`,
            },
        });
        log.push({ source: 'ig-mobile-api', status: r.status });
        if (!r.ok) return null;
        const json = await r.json();
        return shapeIGUser(json?.data?.user);
    } catch (e) {
        log.push({ source: 'ig-mobile-api', error: e.message });
        return null;
    }
}

function shapeIGUser(userData) {
    if (!userData) return null;
    const media    = userData.edge_owner_to_timeline_media || userData.edge_felix_video_timeline;
    const edges    = media?.edges || [];
    const pageInfo = media?.page_info || {};
    const posts = edges.map(e => {
        const n       = e.node;
        const caption = n.edge_media_to_caption?.edges?.[0]?.node?.text || '';
        const imageUrl =
            n.edge_sidecar_to_children?.edges?.[0]?.node?.display_url ||
            n.display_url ||
            n.thumbnail_src ||
            n.display_resources?.[n.display_resources?.length - 1]?.src ||
            n.thumbnail_resources?.[n.thumbnail_resources?.length - 1]?.src ||
            null;
        return {
            id: n.shortcode, url: `https://www.instagram.com/p/${n.shortcode}/`,
            imageUrl, caption,
            likes:     n.edge_liked_by?.count ?? n.edge_media_preview_like?.count ?? null,
            timestamp: n.taken_at_timestamp ? n.taken_at_timestamp * 1000 : null,
            isVideo:   n.is_video || false,
            source:    'ig',
        };
    });
    return {
        username:  userData.username,
        fullName:  userData.full_name,
        postCount: media?.count ?? 0,
        hasMore:   pageInfo.has_next_page || false,
        posts,
    };
}

// ---- Attempt 3: picuki.com (gets shortcodes reliably) --------------------
async function tryPicuki(username, log) {
    try {
        const url = `https://www.picuki.com/profile/${encodeURIComponent(username)}`;
        const r   = await fetch(url, {
            headers: {
                'User-Agent':      UA_MOBILE,
                'Accept':          'text/html,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
            },
        });
        log.push({ source: 'picuki', status: r.status });
        if (!r.ok) return null;
        const html = await r.text();

        const scPositions = [];
        let m;
        const scPat = /href="\/media\/([A-Za-z0-9_-]+)"/g;
        while ((m = scPat.exec(html)) !== null) {
            if (!scPositions.find(s => s.code === m[1]))
                scPositions.push({ code: m[1], pos: m.index });
        }

        const capPat = /<div class="photo-description">([\s\S]*?)<\/div>/g;
        const captions = [];
        while ((m = capPat.exec(html)) !== null)
            captions.push(decodeEntities(m[1].replace(/<[^>]+>/g, '')));

        log.push({ source: 'picuki', shortcodes: scPositions.length });
        const count = Math.min(scPositions.length, 12);
        if (!count) return null;

        const posts = scPositions.slice(0, count).map((sc, i) => ({
            id: sc.code, url: `https://www.instagram.com/p/${sc.code}/`,
            imageUrl: null, caption: captions[i] || '',
            likes: null, timestamp: null, isVideo: false, source: 'picuki',
        }));

        const titleMatch = html.match(/<title>([^<]+)<\/title>/);
        const fullName   = titleMatch ? titleMatch[1].replace(/\s*[@(].*/, '').trim() : username;
        return { username, fullName, postCount: posts.length, hasMore: true, posts };
    } catch (e) {
        log.push({ source: 'picuki', error: e.message });
        return null;
    }
}

// ---- Fill missing image URLs -----------------------------------------------
// Three strategies run in parallel per post:
// 1. Instagram media/info API (different endpoint, may have separate rate limit)
// 2. Instagram post page og:image (server-side rendered meta tag)
// 3. Picuki individual media page
async function fillImages(posts, sessionId, log) {
    const missing = posts.filter(p => !p.imageUrl).slice(0, 12);
    if (!missing.length) return;

    let filled = 0;
    await Promise.allSettled(missing.map(async post => {
        const url =
            await getFromMediaInfoAPI(post.id, sessionId) ||
            await getFromIGPostOG(post.id, sessionId)     ||
            await getFromPicukiMedia(post.id);
        if (url) { post.imageUrl = url; filled++; }
    }));

    log.push({ source: 'fill', attempted: missing.length, filled });
}

// Strategy A: Instagram's per-media info API (mobile endpoint)
// Decodes the shortcode to a numeric media ID, then calls the info endpoint.
async function getFromMediaInfoAPI(shortcode, sessionId) {
    try {
        const mediaId = shortcodeToId(shortcode);
        const r = await fetch(`https://i.instagram.com/api/v1/media/${mediaId}/info/`, {
            headers: {
                'User-Agent':  UA_MOBILE,
                'Accept':      '*/*',
                'x-ig-app-id': '936619743392459',
                'Cookie':      `sessionid=${sessionId}`,
            },
        });
        if (!r.ok) return null;
        const json = await r.json();
        const item = json?.items?.[0];
        if (!item) return null;
        return item.image_versions2?.candidates?.[0]?.url
            || item.carousel_media?.[0]?.image_versions2?.candidates?.[0]?.url
            || null;
    } catch { return null; }
}

// Decode Instagram shortcode → numeric media ID
function shortcodeToId(shortcode) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    let id = 0n;
    for (const c of shortcode) id = id * 64n + BigInt(chars.indexOf(c));
    return id.toString();
}

// Strategy B: Instagram post page og:image (server-side rendered by Instagram for sharing)
async function getFromIGPostOG(shortcode, sessionId) {
    try {
        const r = await fetch(`https://www.instagram.com/p/${shortcode}/`, {
            headers: {
                'User-Agent': UA_BROWSER,
                'Accept':     'text/html',
                'Referer':    'https://www.instagram.com/',
                'Cookie':     `sessionid=${sessionId}`,
            },
        });
        if (!r.ok) return null;
        const html = await r.text();
        const m = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i)
               || html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:image"/i)
               || html.match(/"display_url":"([^"]+)"/i);
        return m ? cleanUrl(m[1]) : null;
    } catch { return null; }
}

// Strategy C: Picuki individual post page (server-side rendered, not lazy-loaded)
async function getFromPicukiMedia(shortcode) {
    try {
        const r = await fetch(`https://www.picuki.com/media/${shortcode}`, {
            headers: {
                'User-Agent': UA_BROWSER,
                'Accept':     'text/html',
                'Referer':    'https://www.picuki.com/',
            },
        });
        if (!r.ok) return null;
        const html = await r.text();
        const m = html.match(/class="post-image"[^>]*src="([^"]+)"/i)
               || html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i)
               || html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:image"/i)
               || html.match(/src="(https:\/\/(?:scontent|[a-z0-9-]+\.cdninstagram)[^"]+)"/i);
        return m ? cleanUrl(m[1]) : null;
    } catch { return null; }
}

function cleanUrl(url) {
    return url.replace(/\\u0026/g, '&').replace(/\\\//g, '/').replace(/\\u003d/g, '=');
}

function decodeEntities(str) {
    return str.trim()
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&#39;/g, "'").replace(/&quot;/g, '"');
}
