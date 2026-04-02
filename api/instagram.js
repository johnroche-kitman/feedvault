// Vercel serverless function — fetches Instagram posts server-side.
// Requires INSTAGRAM_SESSION_ID environment variable set in Vercel dashboard.

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');

    const { username } = req.query;
    if (!username || !/^[a-z0-9._]+$/i.test(username)) {
        return res.status(400).json({ error: 'Invalid username' });
    }

    // Accept session from query param (user-provided) or fall back to env var
    const sessionId = req.query.session || process.env.INSTAGRAM_SESSION_ID;
    if (!sessionId) {
        return res.status(503).json({
            error: 'No Instagram session provided',
            setup: true
        });
    }

    const headers = {
        'x-ig-app-id': '936619743392459',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': `https://www.instagram.com/${encodeURIComponent(username)}/`,
        'Origin': 'https://www.instagram.com',
        'sec-fetch-site': 'same-origin',
        'sec-fetch-mode': 'cors',
        'sec-fetch-dest': 'empty',
        'Cookie': `sessionid=${sessionId}`,
    };

    const url = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username.toLowerCase())}`;

    try {
        const igRes = await fetch(url, { headers });

        if (igRes.status === 302 || igRes.status === 401) {
            return res.status(401).json({ error: 'Session expired — update INSTAGRAM_SESSION_ID in Vercel', expired: true });
        }
        if (igRes.status === 404) {
            return res.status(404).json({ error: 'Account not found' });
        }
        if (!igRes.ok) {
            return res.status(igRes.status).json({ error: `Instagram returned ${igRes.status}` });
        }

        const json = await igRes.json();
        const userData = json?.data?.user;
        if (!userData) {
            return res.status(404).json({ error: 'Account not found or private' });
        }

        const media = userData.edge_owner_to_timeline_media || userData.edge_felix_video_timeline;
        const edges = media?.edges || [];
        const pageInfo = media?.page_info || {};

        const posts = edges.map(e => {
            const n = e.node;
            const caption = n.edge_media_to_caption?.edges?.[0]?.node?.text || '';
            const imageUrl = n.edge_sidecar_to_children?.edges?.[0]?.node?.display_url
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
