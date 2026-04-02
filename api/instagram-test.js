// Debug endpoint — tests the session and shows exactly what Instagram returns.
// Returns diagnostic info without exposing the full session ID.

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');

    const rawSession = req.query.session || process.env.INSTAGRAM_SESSION_ID || '';
    const sessionId  = decodeURIComponent(rawSession);
    const username   = req.query.username || 'instagram';

    if (!sessionId) {
        return res.status(200).json({ ok: false, step: 'setup', message: 'No session provided' });
    }

    const result = { sessionPreview: sessionId.slice(0, 8) + '…', steps: [] };

    try {
        // Step 1: hit profile page, get csrf
        result.steps.push('Fetching profile page…');
        const initRes = await fetch(`https://www.instagram.com/${username}/`, {
            headers: {
                'User-Agent': UA,
                'Accept': 'text/html',
                'Cookie': `sessionid=${sessionId}`,
            },
            redirect: 'follow',
        });
        result.initStatus  = initRes.status;
        result.initUrl     = initRes.url;
        result.isLoginPage = initRes.url?.includes('/accounts/login');

        const setCookies  = initRes.headers.get('set-cookie') || '';
        const csrfMatch   = setCookies.match(/csrftoken=([^;,\s]+)/);
        result.gotCsrf    = !!csrfMatch;
        const csrf        = csrfMatch?.[1] || '';

        if (result.isLoginPage) {
            result.ok      = false;
            result.message = 'Session is expired or invalid — Instagram redirected to login page';
            return res.status(200).json(result);
        }

        // Step 2: call web_profile_info
        result.steps.push('Calling web_profile_info API…');
        const apiRes = await fetch(
            `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`,
            {
                headers: {
                    'x-ig-app-id': '936619743392459',
                    'x-csrftoken':  csrf,
                    'User-Agent':   UA,
                    'Accept':       '*/*',
                    'Referer':      `https://www.instagram.com/${username}/`,
                    'Origin':       'https://www.instagram.com',
                    'sec-fetch-site': 'same-origin',
                    'sec-fetch-mode': 'cors',
                    'Cookie': `sessionid=${sessionId}; csrftoken=${csrf}`,
                },
            }
        );

        result.apiStatus = apiRes.status;
        const body = await apiRes.text();
        result.bodyPreview = body.slice(0, 400);

        if (apiRes.ok) {
            try {
                const json  = JSON.parse(body);
                const user  = json?.data?.user;
                result.ok   = !!user;
                result.message = user
                    ? `Session valid — found @${user.username}, ${user.edge_owner_to_timeline_media?.count ?? '?'} posts`
                    : 'API returned OK but no user data found';
                result.postCount = user?.edge_owner_to_timeline_media?.count ?? 0;
            } catch (e) {
                result.ok      = false;
                result.message = 'API returned 200 but response is not valid JSON';
            }
        } else {
            result.ok      = false;
            result.message = `API returned HTTP ${apiRes.status}`;
        }

    } catch (err) {
        result.ok      = false;
        result.message = 'Exception: ' + err.message;
    }

    return res.status(200).json(result);
}
