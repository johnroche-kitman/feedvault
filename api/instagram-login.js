// Vercel serverless function — logs into Instagram and returns the session ID.
// Credentials are used only to authenticate; they are never stored or logged.

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { username, password, twoFactorCode, twoFactorId } = req.body || {};

    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
    }

    const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

    try {
        // ---- Step 1: get a fresh csrf token ----
        const initRes = await fetch('https://www.instagram.com/accounts/login/', {
            headers: {
                'User-Agent': UA,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
            },
            redirect: 'follow',
        });

        const setCookies = initRes.headers.get('set-cookie') || '';
        const csrfMatch  = setCookies.match(/csrftoken=([^;]+)/);
        const midMatch   = setCookies.match(/mid=([^;]+)/);
        const csrf       = csrfMatch?.[1] || 'missing';
        const mid        = midMatch?.[1] || '';

        // ---- Step 2: handle 2FA completion if code provided ----
        if (twoFactorCode && twoFactorId) {
            const tfRes = await fetch('https://www.instagram.com/api/v1/web/accounts/login/ajax/two_factor/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'x-csrftoken': csrf,
                    'x-ig-app-id': '936619743392459',
                    'User-Agent': UA,
                    'Referer': 'https://www.instagram.com/accounts/login/',
                    'Origin': 'https://www.instagram.com',
                    'Cookie': `csrftoken=${csrf}${mid ? '; mid=' + mid : ''}`,
                },
                body: new URLSearchParams({
                    username,
                    verificationCode: twoFactorCode,
                    identifier: twoFactorId,
                    queryParams: '{}',
                    trustSignal: 'true',
                }).toString(),
            });

            const tfCookies = tfRes.headers.get('set-cookie') || '';
            const sessionMatch = tfCookies.match(/sessionid=([^;]+)/);
            if (sessionMatch) {
                return res.status(200).json({ sessionId: sessionMatch[1] });
            }
            const tfJson = await tfRes.json().catch(() => ({}));
            return res.status(400).json({ error: tfJson.message || 'Invalid 2FA code' });
        }

        // ---- Step 3: submit login ----
        const timestamp  = Math.floor(Date.now() / 1000);
        const encPassword = `#PWD_INSTAGRAM_BROWSER:0:${timestamp}:${password}`;

        const loginRes = await fetch('https://www.instagram.com/api/v1/web/accounts/login/ajax/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'x-csrftoken': csrf,
                'x-ig-app-id': '936619743392459',
                'User-Agent': UA,
                'Referer': 'https://www.instagram.com/accounts/login/',
                'Origin': 'https://www.instagram.com',
                'sec-fetch-site': 'same-origin',
                'sec-fetch-mode': 'cors',
                'Cookie': `csrftoken=${csrf}${mid ? '; mid=' + mid : ''}`,
            },
            body: new URLSearchParams({
                username,
                enc_password: encPassword,
                queryParams: '{}',
                optIntoOneTap: 'false',
                stopDeletionNonce: '',
                trustedDeviceRecords: '{}',
            }).toString(),
        });

        const loginCookies = loginRes.headers.get('set-cookie') || '';
        const sessionMatch = loginCookies.match(/sessionid=([^;]+)/);

        if (sessionMatch) {
            return res.status(200).json({ sessionId: sessionMatch[1] });
        }

        const loginJson = await loginRes.json().catch(() => ({}));

        // 2FA required
        if (loginJson.two_factor_required) {
            return res.status(200).json({
                twoFactorRequired: true,
                twoFactorId: loginJson.two_factor_info?.two_factor_identifier,
                method: loginJson.two_factor_info?.totp_two_factor_on ? 'app' : 'sms',
            });
        }

        // Checkpoint (unusual activity)
        if (loginJson.checkpoint_url) {
            return res.status(400).json({ error: 'Instagram flagged this login as suspicious. Open Instagram in your browser to verify, then try again.' });
        }

        if (loginJson.user === false || loginJson.authenticated === false) {
            return res.status(401).json({ error: 'Incorrect username or password' });
        }

        return res.status(400).json({ error: loginJson.message || 'Login failed — try again or use the manual cookie method.' });

    } catch (err) {
        console.error('Login error:', err);
        return res.status(500).json({ error: 'Server error: ' + err.message });
    }
}
