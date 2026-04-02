// Vercel serverless function — fetches Instagram posts server-side.

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');

    const { username } = req.query;
    if (!username || !/^[a-z0-9._]+$/i.test(username)) {
        return res.status(400).json({ error: 'Invalid username' });
    }

    const sessionId = req.query.session || process.env.INSTAGRAM_SESSION_ID;
    if (!sessionId) {
        return res.status(503).json({ error: 'No Instagram session provided', setup: true });
    }

    try {
        // Step 1: Hit instagram.com with the session to get a fresh csrftoken
        const initRes = await fetch(`https://www.instagram.com/${encodeURIComponent(username)}/`, {
            headers: {
                'User-Agent': UA,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Cookie': `sessionid=${sessionId}`,
            },
            redirect: 'follow',
        });

        // Extract csrftoken from response cookies
        const setCookies = initRes.headers.get('set-cookie') || '';
        const csrfMatch  = setCookies.match(/csrftoken=([^;,\s]+)/);
        const csrf       = csrfMatch?.[1] || 'missing';

        // If redirected to login page, session is expired
        const finalUrl = initRes.url || '';
        if (finalUrl.includes('/accounts/login') || initRes.status === 302) {
            return res.status(401).json({ error: 'Session expired — reconnect in Settings', expired: true });
        }

        // Step 2: Fetch profile + posts with both sessionid and csrftoken
        const apiUrl = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username.toLowerCase())}`;

        const apiRes = await fetch(apiUrl, {
            headers: {
                'x-ig-app-id': '936619743392459',
                'x-csrftoken': csrf,
                'User-Agent': UA,
                'Accept': '*/*',
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer': `https://www.instagram.com/${encodeURIComponent(username)}/`,
                'Origin': 'https://www.instagram.com',
                'sec-fetch-site': 'same-origin',
                'sec-fetch-mode': 'cors',
                'sec-fetch-dest': 'empty',
                'Cookie': `sessionid=${sessionId}; csrftoken=${csrf}`,
            },
        });

        if (apiRes.status === 404) {
            return res.status(404).json({ error: 'Account not found' });
        }
        if (apiRes.status === 401 || apiRes.status === 403) {
            return res.status(401).json({ error: 'Session expired — reconnect in Settings', expired: true });
        }
        if (!apiRes.ok) {
            // Try to get response body for debugging
            const body = await apiRes.text().catch(() => '');
            console.error(`Instagram API ${apiRes.status} for ${username}:`, body.slice(0, 300));
            return res.status(apiRes.status).json({ error: `Instagram returned ${apiRes.status}` });
        }

        const json     = await apiRes.json();
        const userData = json?.data?.user;

        if (!userData) {
            return res.status(404).json({ error: 'Account not found or private' });
        }

        const media    = userData.edge_owner_to_timeline_media || userData.edge_felix_video_timeline;
        const edges    = media?.edges || [];
        const pageInfo = media?.page_info || {};

        const posts = edges.map(e => {
            const n         = e.node;
            const caption   = n.edge_media_to_caption?.edges?.[0]?.node?.text || '';
            const imageUrl  = n.edge_sidecar_to_children?.edges?.[0]?.node?.display_url
                           || n.display_url
                           || n.thumbnail_src
                           || null;
            return {
                id:        n.shortcode,
                url:       `https://www.instagram.com/p/${n.shortcode}/`,
                imageUrl,
                caption,
                likes:     n.edge_liked_by?.count ?? n.edge_media_preview_like?.count ?? null,
                timestamp: n.taken_at_timestamp ? n.taken_at_timestamp * 1000 : null,
                isVideo:   n.is_video || false,
            };
        });

        res.setHeader('Cache-Control', 's-maxage=1200, stale-while-revalidate=600');

        return res.status(200).json({
            username:   userData.username,
            fullName:   userData.full_name,
            profilePic: userData.profile_pic_url,
            bio:        userData.biography,
            postCount:  media?.count ?? 0,
            hasMore:    pageInfo.has_next_page || false,
            nextCursor: pageInfo.end_cursor || null,
            posts,
        });

    } catch (err) {
        console.error('Instagram fetch error:', err);
        return res.status(500).json({ error: 'Fetch failed: ' + err.message });
    }
}
