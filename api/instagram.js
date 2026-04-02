// Vercel serverless function — fetches Instagram profile + recent posts server-side.
// No CORS issues, proper headers, cached at Vercel edge for 20 minutes.

export default async function handler(req, res) {
    // CORS — allow calls from any origin (our static frontend)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');

    const { username } = req.query;
    if (!username || !/^[a-z0-9._]+$/i.test(username)) {
        return res.status(400).json({ error: 'Invalid username' });
    }

    const url = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username.toLowerCase())}`;

    try {
        const igRes = await fetch(url, {
            headers: {
                'x-ig-app-id': '936619743392459',
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
                'Accept': '*/*',
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer': 'https://www.instagram.com/',
                'Origin': 'https://www.instagram.com',
                'X-Requested-With': 'XMLHttpRequest',
            }
        });

        if (igRes.status === 404) return res.status(404).json({ error: 'Account not found' });
        if (igRes.status === 401) return res.status(401).json({ error: 'Instagram requires login for this account' });
        if (!igRes.ok) return res.status(igRes.status).json({ error: `Instagram returned ${igRes.status}` });

        const json = await igRes.json();
        const userData = json?.data?.user;
        if (!userData) return res.status(404).json({ error: 'Account not found or private' });

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

        // Cache at Vercel edge for 20 minutes
        res.setHeader('Cache-Control', 's-maxage=1200, stale-while-revalidate=600');

        return res.status(200).json({
            username:    userData.username,
            fullName:    userData.full_name,
            profilePic:  userData.profile_pic_url,
            bio:         userData.biography,
            postCount:   userData.edge_owner_to_timeline_media?.count ?? 0,
            hasMore:     pageInfo.has_next_page || false,
            nextCursor:  pageInfo.end_cursor || null,
            posts,
        });

    } catch (err) {
        console.error('Instagram fetch error:', err);
        return res.status(500).json({ error: 'Failed to fetch from Instagram' });
    }
}
