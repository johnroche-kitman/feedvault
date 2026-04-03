// Vercel Edge Function — runs on Vercel's edge network (different IPs than standard serverless).
// Strategy chain: IG web API → IG mobile endpoint → imginn.com → picuki.com
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

    const log = [];

    let result =
        await tryInstagramAPI(username, sessionId, log) ||
        await tryInstagramMobile(username, sessionId, log) ||
        await tryImginn(username, log) ||
        await tryPicuki(username, log);

    // If we have posts but images are null, try filling them from Instagram embed pages
    if (result && result.posts.some(p => !p.imageUrl)) {
        await fillImagesFromEmbeds(result.posts, log);
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

// ---- Attempt 1: Instagram web API (x-ig-app-id) ----------------------------
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
        const user = json?.data?.user;
        if (!user) return null;
        return shapeIGUser(user);
    } catch (e) {
        log.push({ source: 'ig-web-api', error: e.message });
        return null;
    }
}

// ---- Attempt 2: Instagram mobile i.instagram.com endpoint ------------------
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
        const user = json?.data?.user;
        if (!user) return null;
        return shapeIGUser(user);
    } catch (e) {
        log.push({ source: 'ig-mobile-api', error: e.message });
        return null;
    }
}

function shapeIGUser(userData) {
    const media    = userData.edge_owner_to_timeline_media || userData.edge_felix_video_timeline;
    const edges    = media?.edges || [];
    const pageInfo = media?.page_info || {};
    const posts = edges.map(e => {
        const n       = e.node;
        const caption = n.edge_media_to_caption?.edges?.[0]?.node?.text || '';
        // Try every known location Instagram uses for the image URL
        const imageUrl =
            n.edge_sidecar_to_children?.edges?.[0]?.node?.display_url ||
            n.display_url ||
            n.thumbnail_src ||
            n.display_resources?.[n.display_resources.length - 1]?.src ||
            n.thumbnail_resources?.[n.thumbnail_resources.length - 1]?.src ||
            n.image_versions2?.candidates?.[0]?.url ||
            null;
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
        username:  userData.username,
        fullName:  userData.full_name,
        postCount: media?.count ?? 0,
        hasMore:   pageInfo.has_next_page || false,
        posts,
    };
}

// ---- Attempt 3: imginn.com --------------------------------------------------
async function tryImginn(username, log) {
    try {
        const url = `https://imginn.com/${encodeURIComponent(username)}/`;
        const r   = await fetch(url, {
            headers: {
                'User-Agent':      UA_BROWSER,
                'Accept':          'text/html,application/xhtml+xml,*/*;q=0.9',
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer':         'https://imginn.com/',
            },
        });
        log.push({ source: 'imginn', status: r.status });
        if (!r.ok) return null;
        const html = await r.text();

        // Extract shortcode positions so we can pair images spatially
        const scPositions = [];
        let m;
        const scPat = /href="\/p\/([A-Za-z0-9_-]+)\/"/g;
        while ((m = scPat.exec(html)) !== null) {
            if (!scPositions.find(s => s.code === m[1]))
                scPositions.push({ code: m[1], pos: m.index });
        }

        // Extract all CDN image positions (any https image URL)
        const imgPositions = [];
        const imgPat = /(?:src|data-src)="(https:\/\/[^"]{20,}\.(?:jpg|jpeg|png|webp)[^"]*)"/gi;
        while ((m = imgPat.exec(html)) !== null) imgPositions.push({ url: m[1], pos: m.index });

        const capPat = /<p class="desc">([\s\S]*?)<\/p>/g;
        const captions = [];
        while ((m = capPat.exec(html)) !== null) captions.push(decodeEntities(m[1].replace(/<[^>]+>/g, '')));

        log.push({ source: 'imginn', shortcodes: scPositions.length, images: imgPositions.length });
        if (!scPositions.length) return null;

        const count = Math.min(scPositions.length, 12);
        const posts = scPositions.slice(0, count).map((sc, i) => {
            // Find the nearest image that appears after this shortcode link
            const img = imgPositions.find(im => im.pos > sc.pos);
            // Remove it so the next post gets the next image
            if (img) imgPositions.splice(imgPositions.indexOf(img), 1);
            return {
                id: sc.code, url: `https://www.instagram.com/p/${sc.code}/`,
                imageUrl: img?.url || null, caption: captions[i] || '',
                likes: null, timestamp: null, isVideo: false, source: 'imginn',
            };
        });

        const titleMatch = html.match(/<title>([^<]+)<\/title>/);
        const fullName   = titleMatch ? titleMatch[1].replace(/\s*[@(|].*/, '').trim() : username;
        return { username, fullName, postCount: posts.length, hasMore: true, posts };
    } catch (e) {
        log.push({ source: 'imginn', error: e.message });
        return null;
    }
}

// ---- Attempt 4: picuki.com --------------------------------------------------
async function tryPicuki(username, log) {
    try {
        const url = `https://www.picuki.com/profile/${encodeURIComponent(username)}`;
        const r   = await fetch(url, {
            headers: {
                'User-Agent':      UA_MOBILE,
                'Accept':          'text/html,application/xhtml+xml,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
            },
        });
        log.push({ source: 'picuki', status: r.status });
        if (!r.ok) return null;
        const html = await r.text();

        // Extract shortcodes with positions
        const scPositions = [];
        let m;
        const scPat = /href="\/media\/([A-Za-z0-9_-]+)"/g;
        while ((m = scPat.exec(html)) !== null) {
            if (!scPositions.find(s => s.code === m[1]))
                scPositions.push({ code: m[1], pos: m.index });
        }

        // Extract all image URLs with positions — try specific class first, then any CDN URL
        const imgPositions = [];
        const specificPat = /class="post-image"[^>]*src="([^"]+)"/g;
        while ((m = specificPat.exec(html)) !== null) imgPositions.push({ url: m[1], pos: m.index });

        if (!imgPositions.length) {
            // Fallback: any CDN image URL
            const cdnPat = /src="(https:\/\/(?:scontent|[a-z0-9-]+\.cdninstagram)[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/gi;
            while ((m = cdnPat.exec(html)) !== null) imgPositions.push({ url: m[1], pos: m.index });
        }

        const capPat  = /<div class="photo-description">([\s\S]*?)<\/div>/g;
        const lkPat   = /<span class="likes">\s*([\d,KM.]+)\s*<\/span>/g;
        const captions = [], likes = [];
        while ((m = capPat.exec(html)) !== null) captions.push(decodeEntities(m[1].replace(/<[^>]+>/g, '')));
        while ((m = lkPat.exec(html))  !== null) likes.push(m[1].replace(/,/g, ''));

        log.push({ source: 'picuki', shortcodes: scPositions.length, images: imgPositions.length });
        const count = Math.min(scPositions.length, 12);
        if (!count) return null;

        const posts = scPositions.slice(0, count).map((sc, i) => {
            const img = imgPositions.find(im => im.pos > sc.pos);
            if (img) imgPositions.splice(imgPositions.indexOf(img), 1);
            return {
                id: sc.code, url: `https://www.instagram.com/p/${sc.code}/`,
                imageUrl: img?.url || null,
                caption: captions[i] || '',
                likes: likes[i] ? parseInt(likes[i]) || null : null,
                timestamp: null, isVideo: false, source: 'picuki',
            };
        });

        const titleMatch = html.match(/<title>([^<]+)<\/title>/);
        const fullName   = titleMatch ? titleMatch[1].replace(/\s*[@(].*/, '').trim() : username;
        return { username, fullName, postCount: posts.length, hasMore: true, posts };
    } catch (e) {
        log.push({ source: 'picuki', error: e.message });
        return null;
    }
}

// ---- Fill missing image URLs from Instagram embed pages --------------------
// Instagram's /p/SHORTCODE/embed/ is public, no auth needed, contains the image.
async function fillImagesFromEmbeds(posts, log) {
    const missing = posts.filter(p => !p.imageUrl).slice(0, 12);
    if (!missing.length) return;

    const results = await Promise.allSettled(
        missing.map(async post => {
            const r = await fetch(`https://www.instagram.com/p/${post.id}/embed/`, {
                headers: {
                    'User-Agent': UA_BROWSER,
                    'Accept':     'text/html,*/*',
                    'Referer':    'https://www.instagram.com/',
                },
            });
            if (!r.ok) return;
            const html = await r.text();
            // Embed page has the image in an <img> tag with class EmbeddedMediaImage
            // or just any scontent CDN URL
            const m = html.match(/src="(https:\/\/scontent[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/i)
                   || html.match(/"thumbnail_src":"([^"]+)"/i)
                   || html.match(/"display_url":"([^"]+)"/i);
            if (m) post.imageUrl = m[1].replace(/\\u0026/g, '&');
        })
    );

    const filled = results.filter(r => r.status === 'fulfilled').length;
    log.push({ source: 'embed-fill', attempted: missing.length, filled });
}

function decodeEntities(str) {
    return str.trim()
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&#39;/g, "'").replace(/&quot;/g, '"');
}
