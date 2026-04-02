// ============================================================
// MyFeed — Main Application Logic
// ============================================================

const DB_USERS   = 'fv_users';
const DB_CURRENT = 'fv_current_user';
const IG_CACHE   = 'fv_ig_cache';   // { username: { posts, nextCursor, fetchedAt } }
const CACHE_TTL  = 20 * 60 * 1000; // 20 minutes

// ---- Storage -----------------------------------------------
function getUsers()            { return JSON.parse(localStorage.getItem(DB_USERS)   || '{}'); }
function saveUsers(u)          { localStorage.setItem(DB_USERS, JSON.stringify(u)); }
function getIGCache()          { return JSON.parse(localStorage.getItem(IG_CACHE)   || '{}'); }
function saveIGCache(c)        { localStorage.setItem(IG_CACHE, JSON.stringify(c)); }

function getCurrentUser() {
    const u = localStorage.getItem(DB_CURRENT);
    return u ? (getUsers()[u] || null) : null;
}
function saveCurrentUser(user) {
    const users = getUsers();
    users[user.username] = user;
    saveUsers(users);
}

// ---- Toast -------------------------------------------------
function showToast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2600);
}

// ---- Auth --------------------------------------------------
function showLogin()  { document.getElementById('login-form').style.display  = ''; document.getElementById('signup-form').style.display = 'none'; clearAuthErrors(); }
function showSignup() { document.getElementById('login-form').style.display  = 'none'; document.getElementById('signup-form').style.display = ''; clearAuthErrors(); }
function clearAuthErrors() { document.getElementById('login-error').textContent = ''; document.getElementById('signup-error').textContent = ''; }

function handleLogin() {
    const username = document.getElementById('login-username').value.trim().toLowerCase();
    const password = document.getElementById('login-password').value;
    const err = document.getElementById('login-error');
    if (!username || !password) { err.textContent = 'Please fill in all fields.'; return; }
    const users = getUsers();
    if (!users[username])                        { err.textContent = 'Account not found.';    return; }
    if (users[username].password !== password)   { err.textContent = 'Incorrect password.';   return; }
    localStorage.setItem(DB_CURRENT, username);
    enterApp();
}

function handleSignup() {
    const displayName = document.getElementById('signup-displayname').value.trim();
    const username    = document.getElementById('signup-username').value.trim().toLowerCase();
    const password    = document.getElementById('signup-password').value;
    const confirm     = document.getElementById('signup-password-confirm').value;
    const err         = document.getElementById('signup-error');
    if (!displayName || !username || !password)  { err.textContent = 'Please fill in all fields.'; return; }
    if (password.length < 6)                     { err.textContent = 'Password must be at least 6 characters.'; return; }
    if (password !== confirm)                    { err.textContent = 'Passwords do not match.'; return; }
    if (!/^[a-z0-9_]+$/.test(username))          { err.textContent = 'Username: letters, numbers, underscores only.'; return; }
    const users = getUsers();
    if (users[username])                         { err.textContent = 'Username already taken.'; return; }
    users[username] = { username, displayName, password, bio: '', igLinked: null, following: [], posts: [], createdAt: new Date().toISOString() };
    saveUsers(users);
    localStorage.setItem(DB_CURRENT, username);
    enterApp();
    showToast('Welcome to MyFeed!');
}

function handleLogout() {
    localStorage.removeItem(DB_CURRENT);
    document.getElementById('app-screen').classList.remove('active');
    document.getElementById('auth-screen').classList.add('active');
    document.getElementById('login-username').value = '';
    document.getElementById('login-password').value = '';
    showLogin();
}

function handleDeleteAccount() {
    if (!confirm('Delete your account? This cannot be undone.')) return;
    const user = getCurrentUser();
    const users = getUsers();
    delete users[user.username];
    saveUsers(users);
    localStorage.removeItem(DB_CURRENT);
    handleLogout();
    showToast('Account deleted.');
}

// ---- App entry ---------------------------------------------
function enterApp() {
    const user = getCurrentUser();
    if (!user) return;
    document.getElementById('auth-screen').classList.remove('active');
    document.getElementById('app-screen').classList.add('active');
    document.getElementById('nav-avatar').textContent   = user.displayName.charAt(0).toUpperCase();
    document.getElementById('nav-username').textContent = user.username;
    document.getElementById('settings-displayname').value = user.displayName;
    document.getElementById('settings-bio').value         = user.bio || '';
    const dark = localStorage.getItem('fv_dark_mode') === 'true';
    document.getElementById('dark-mode-toggle').checked = dark;
    if (dark) document.documentElement.setAttribute('data-theme', 'dark');
    updateIGLinkUI();
    updateCrosspostToggle();
    updateIGSessionUI();
    showSection('feed');
}

// ---- Navigation --------------------------------------------
function showSection(name) {
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.getElementById('section-' + name).classList.add('active');
    document.querySelectorAll('.nav-btn[data-section]').forEach(b =>
        b.classList.toggle('active', b.dataset.section === name));
    if (name === 'feed')   renderFeed();
    if (name === 'manage') renderFollowing();
}

// ---- Instagram fetch ---------------------------------------
// Uses Instagram's own web API (same endpoint their site uses).
// Works for public accounts — Instagram may block it for some.

// ---- Instagram Session Management -------------------------
function getIGSession() {
    const user = getCurrentUser();
    return user?.igSession || null;
}

function saveIGSession() {
    const input = document.getElementById('ig-session-input');
    const value = input.value.trim();
    if (!value) { showToast('Please paste your sessionid value.'); return; }
    if (value.length < 20) { showToast('That doesn\'t look like a valid session key.'); return; }

    const user = getCurrentUser();
    user.igSession = value;
    saveCurrentUser(user);
    input.value = '';

    // Clear cache so feed re-fetches with new session
    const cache = getIGCache();
    (user.following || []).forEach(f => delete cache[f.username]);
    saveIGCache(cache);

    updateIGSessionUI();
    showToast('Instagram connected! Refreshing feed…');
    // Re-render feed with new session
    setTimeout(() => showSection('feed'), 400);
}

function disconnectIGSession() {
    if (!confirm('Disconnect your Instagram session? Posts will stop loading.')) return;
    const user = getCurrentUser();
    user.igSession = null;
    saveCurrentUser(user);
    const cache = getIGCache();
    (user.following || []).forEach(f => delete cache[f.username]);
    saveIGCache(cache);
    updateIGSessionUI();
    showToast('Instagram disconnected.');
}

function toggleSessionVisibility() {
    const input = document.getElementById('ig-session-input');
    const icon  = document.getElementById('session-eye-icon');
    if (input.type === 'password') {
        input.type = 'text';
        icon.textContent = 'visibility_off';
    } else {
        input.type = 'password';
        icon.textContent = 'visibility';
    }
}

function switchConnectTab(tab) {
    document.getElementById('connect-tab-login').style.display  = tab === 'login'  ? '' : 'none';
    document.getElementById('connect-tab-manual').style.display = tab === 'manual' ? '' : 'none';
    document.getElementById('tab-login').classList.toggle('active',  tab === 'login');
    document.getElementById('tab-manual').classList.toggle('active', tab === 'manual');
}

let igLoginTwoFactorId = null;

async function handleIGLogin() {
    const username = document.getElementById('ig-login-username').value.trim();
    const password = document.getElementById('ig-login-password').value;
    const errEl    = document.getElementById('ig-login-error');
    const btn      = document.getElementById('ig-login-btn');

    if (!username || !password) { errEl.textContent = 'Enter your Instagram username and password.'; return; }

    errEl.textContent  = '';
    btn.disabled       = true;
    btn.innerHTML      = '<span class="material-icons-outlined">hourglass_top</span> Connecting…';

    try {
        const res  = await fetch('/api/instagram-login', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ username, password }),
        });
        const data = await res.json();

        if (data.sessionId) {
            applyIGSession(data.sessionId);
            return;
        }

        if (data.twoFactorRequired) {
            igLoginTwoFactorId = data.twoFactorId;
            const method = data.method === 'app' ? 'authenticator app' : 'SMS';
            document.getElementById('ig-2fa-prompt').textContent =
                `Enter the 6-digit code sent to your ${method}.`;
            document.getElementById('ig-2fa-step').style.display = '';
            document.getElementById('ig-login-btn').style.display = 'none';
            errEl.textContent = '';
            return;
        }

        errEl.textContent = data.error || 'Login failed. Please try again.';
    } catch (e) {
        errEl.textContent = 'Connection error. Make sure you\'re on the deployed Vercel site.';
    } finally {
        btn.disabled  = false;
        btn.innerHTML = '<span class="material-icons-outlined">login</span> Connect Instagram';
    }
}

async function handleIG2FA() {
    const code  = document.getElementById('ig-2fa-code').value.trim();
    const errEl = document.getElementById('ig-login-error');
    if (!code || code.length < 6) { errEl.textContent = 'Enter the 6-digit code.'; return; }

    const username = document.getElementById('ig-login-username').value.trim();
    const password = document.getElementById('ig-login-password').value;

    errEl.textContent = '';

    try {
        const res  = await fetch('/api/instagram-login', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ username, password, twoFactorCode: code, twoFactorId: igLoginTwoFactorId }),
        });
        const data = await res.json();

        if (data.sessionId) {
            applyIGSession(data.sessionId);
            return;
        }
        errEl.textContent = data.error || 'Incorrect code. Try again.';
    } catch (e) {
        errEl.textContent = 'Connection error.';
    }
}

async function testIGSession() {
    const session  = getIGSession();
    const resultEl = document.getElementById('ig-test-result');
    const user     = getCurrentUser();
    const testUser = user?.following?.[0]?.username || 'instagram';

    resultEl.innerHTML = `<div class="test-result testing">
        <span class="material-icons-outlined">hourglass_top</span> Testing connection with @${testUser}…
    </div>`;

    try {
        const params = new URLSearchParams({ username: testUser, session });
        const res    = await fetch(`/api/instagram-test?${params}`);
        const data   = await res.json();

        if (data.ok) {
            resultEl.innerHTML = `<div class="test-result success">
                <span class="material-icons-outlined">check_circle</span>
                <strong>Working!</strong> ${escapeHtml(data.message)}
            </div>`;
            // Clear cache and reload feed
            const cache = getIGCache();
            (user.following || []).forEach(f => delete cache[f.username]);
            saveIGCache(cache);
            setTimeout(() => showSection('feed'), 800);
        } else {
            resultEl.innerHTML = `<div class="test-result fail">
                <span class="material-icons-outlined">error_outline</span>
                <div>
                    <strong>Not working:</strong> ${escapeHtml(data.message)}
                    ${data.isLoginPage ? '<br><small>Your session has expired. Please disconnect and reconnect.</small>' : ''}
                    ${data.bodyPreview ? `<br><small style="word-break:break-all;color:var(--text-muted)">${escapeHtml(data.bodyPreview.slice(0,200))}</small>` : ''}
                </div>
            </div>`;
        }
    } catch (e) {
        resultEl.innerHTML = `<div class="test-result fail">
            <span class="material-icons-outlined">error_outline</span>
            Connection error — make sure you're on the Vercel deployment, not GitHub Pages.
        </div>`;
    }
}

function applyIGSession(sessionId) {
    const user = getCurrentUser();
    user.igSession = sessionId;
    saveCurrentUser(user);

    // Clear cache so feed re-fetches
    const cache = getIGCache();
    (user.following || []).forEach(f => delete cache[f.username]);
    saveIGCache(cache);

    updateIGSessionUI();
    showToast('Instagram connected! Loading your feed…');
    setTimeout(() => showSection('feed'), 500);
}

function updateIGSessionUI() {
    const user       = getCurrentUser();
    const statusEl   = document.getElementById('ig-session-status');
    const formEl     = document.getElementById('ig-session-form');
    const stepsEl    = document.getElementById('cookie-setup-steps');
    if (!statusEl) return;

    if (user.igSession) {
        statusEl.innerHTML = `
            <div class="ig-linked" style="margin-bottom:12px">
                <span class="material-icons-outlined">check_circle</span>
                <span>Instagram connected</span>
                <button class="btn-sm" style="margin-left:auto;margin-right:6px" onclick="testIGSession()">Test</button>
                <button class="btn-unlink" onclick="disconnectIGSession()">Disconnect</button>
            </div>`;
        formEl.style.display  = 'none';
        stepsEl.style.display = 'none';
    } else {
        statusEl.innerHTML    = '';
        formEl.style.display  = '';
        stepsEl.style.display = '';
    }
}

// ---- Instagram API fetch -----------------------------------
async function fetchIGPosts(username) {
    const session = getIGSession();
    const params  = new URLSearchParams({ username });
    if (session) params.set('session', session);

    try {
        const res  = await fetch(`/api/instagram?${params}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            // Pass ALL error flags through so the feed can show the right message
            return { error: data.error || 'HTTP ' + res.status, setup: data.setup, expired: data.expired, rateLimit: data.rateLimit, httpStatus: res.status };
        }
        data.posts = (data.posts || []).map(p => ({ ...p, username }));
        return data;
    } catch (err) {
        console.warn('IG fetch failed for', username, err.message);
        return null;
    }
}

// Cache-aware fetch: returns cached data if fresh, else fetches
async function getIGPostsCached(username, forceRefresh = false) {
    const cache = getIGCache();
    const entry = cache[username];
    if (!forceRefresh && entry && (Date.now() - entry.fetchedAt) < CACHE_TTL) {
        return entry;
    }
    const result = await fetchIGPosts(username);
    if (result) {
        cache[username] = { ...result, fetchedAt: Date.now() };
        saveIGCache(cache);
    }
    return result;
}

// Load more posts for an account (appends to cache)
async function loadMorePosts(username) {
    const btn = document.getElementById('loadmore-' + username);
    if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; }

    const cache = getIGCache();
    const entry = cache[username];
    const cursor = entry?.nextCursor;
    if (!cursor) return;

    // For simplicity, re-fetch (Instagram's public endpoint doesn't easily paginate without auth)
    // so we just show a note about visiting Instagram for more
    if (btn) {
        btn.disabled = false;
        btn.textContent = 'Load more on Instagram';
        btn.onclick = () => window.open(`https://www.instagram.com/${encodeURIComponent(username)}/`, '_blank');
    }
}

// ---- Following Management ----------------------------------
function handleAddAccount() {
    const input = document.getElementById('ig-username-input');
    const username = input.value.trim().replace(/^@/, '').toLowerCase();
    if (!username) { showToast('Please enter a username.'); return; }
    if (!/^[a-z0-9._]+$/.test(username)) { showToast('Invalid Instagram username.'); return; }
    const user = getCurrentUser();
    if (user.following.some(f => f.username === username)) { showToast('Already following @' + username); return; }
    user.following.push({ username, addedAt: new Date().toISOString() });
    saveCurrentUser(user);
    input.value = '';
    renderFollowing();
    showToast('Now following @' + username);
}

function unfollowAccount(username) {
    const user = getCurrentUser();
    user.following = user.following.filter(f => f.username !== username);
    saveCurrentUser(user);
    // Clear cache
    const cache = getIGCache();
    delete cache[username];
    saveIGCache(cache);
    renderFollowing();
    showToast('Unfollowed @' + username);
}

function renderFollowing() {
    const user  = document.getElementById('following-list');
    const empty = document.getElementById('following-empty');
    const cu    = getCurrentUser();

    if (!cu.following.length) {
        user.innerHTML = '';
        empty.style.display = '';
        return;
    }
    empty.style.display = 'none';
    user.innerHTML = cu.following.map(f => `
        <div class="following-item">
            <div class="following-info">
                <div class="following-avatar">${f.username.charAt(0).toUpperCase()}</div>
                <div class="following-details">
                    <span class="following-name">@${escapeHtml(f.username)}</span>
                    <span class="following-handle">Instagram</span>
                </div>
            </div>
            <div class="following-actions">
                <a class="btn-visit" href="https://instagram.com/${encodeURIComponent(f.username)}"
                   target="_blank" rel="noopener">
                    <span class="material-icons-outlined" style="font-size:16px">open_in_new</span>
                </a>
                <button class="btn-unfollow" onclick="unfollowAccount('${safeAttr(f.username)}')">Unfollow</button>
            </div>
        </div>
    `).join('');
}

// ---- Instagram Account Link --------------------------------
function linkInstagram() {
    const input    = document.getElementById('ig-link-username');
    const username = input.value.trim().replace(/^@/, '').toLowerCase();
    if (!username) { showToast('Please enter your Instagram username.'); return; }
    const user = getCurrentUser();
    user.igLinked = username;
    saveCurrentUser(user);
    input.value = '';
    updateIGLinkUI();
    updateCrosspostToggle();
    showToast('Instagram linked: @' + username);
}

function unlinkInstagram() {
    const user = getCurrentUser();
    user.igLinked = null;
    saveCurrentUser(user);
    updateIGLinkUI();
    updateCrosspostToggle();
    showToast('Instagram unlinked.');
}

function updateIGLinkUI() {
    const user   = getCurrentUser();
    const status = document.getElementById('ig-link-status');
    const form   = document.getElementById('ig-link-form');
    if (user.igLinked) {
        status.innerHTML = `
            <div class="ig-linked">
                <span class="material-icons-outlined">check_circle</span>
                <span>Linked: @${escapeHtml(user.igLinked)}</span>
                <button class="btn-unlink" onclick="unlinkInstagram()">Unlink</button>
            </div>`;
        form.style.display = 'none';
    } else {
        status.innerHTML   = '';
        form.style.display = '';
    }
}

function updateCrosspostToggle() {
    const user = getCurrentUser();
    document.getElementById('crosspost-toggle').style.display = user.igLinked ? 'flex' : 'none';
}

// ---- Create Post -------------------------------------------
let selectedImage = null;

function handleImageSelect(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { showToast('Image must be under 10MB.'); return; }
    const reader = new FileReader();
    reader.onload = e => {
        selectedImage = e.target.result;
        document.getElementById('image-preview').src = selectedImage;
        document.getElementById('image-preview-container').style.display = '';
        document.getElementById('image-placeholder').style.display = 'none';
    };
    reader.readAsDataURL(file);
}

function removeImage(event) {
    event.stopPropagation();
    selectedImage = null;
    document.getElementById('image-input').value = '';
    document.getElementById('image-preview-container').style.display = 'none';
    document.getElementById('image-placeholder').style.display = '';
}

function handleCreatePost() {
    const caption   = document.getElementById('post-caption').value.trim();
    const crosspost = document.getElementById('crosspost-ig').checked;
    const user      = getCurrentUser();
    if (!caption && !selectedImage) { showToast('Add a photo or write something!'); return; }
    const post = {
        id:            Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        type:          'local',
        author:        user.username,
        authorDisplay: user.displayName,
        caption,
        image:         selectedImage,
        likes:         0,
        liked:         false,
        crossposted:   crosspost && !!user.igLinked,
        createdAt:     new Date().toISOString()
    };
    user.posts.unshift(post);
    saveCurrentUser(user);
    document.getElementById('post-caption').value = '';
    selectedImage = null;
    document.getElementById('image-input').value = '';
    document.getElementById('image-preview-container').style.display = 'none';
    document.getElementById('image-placeholder').style.display = '';
    showToast(post.crossposted ? 'Published! (Cross-post needs API setup)' : 'Post published!');
    showSection('feed');
}

// ---- Feed --------------------------------------------------
async function renderFeed() {
    const user      = getCurrentUser();
    const container = document.getElementById('feed-container');
    const empty     = document.getElementById('feed-empty');

    if (!user.following.length && !user.posts.length) {
        container.innerHTML = '';
        empty.style.display = '';
        return;
    }

    empty.style.display = 'none';

    // Render local posts immediately
    const localHtml = (user.posts || []).map(p => renderLocalPost(p, user)).join('');

    // Render account sections (with loading skeletons first)
    const accountSkeletons = user.following.map(f => `
        <div class="account-section" id="account-section-${escapeHtml(f.username)}">
            <div class="account-section-header">
                <div class="post-avatar" style="background:var(--gradient-ig)">
                    <span class="material-icons-outlined" style="font-size:18px;color:#fff">photo_camera</span>
                </div>
                <div class="post-author-info">
                    <span class="post-author-name">@${escapeHtml(f.username)}</span>
                    <span class="post-author-source ig-badge">Instagram</span>
                </div>
                <a class="btn-visit" href="https://instagram.com/${encodeURIComponent(f.username)}"
                   target="_blank" rel="noopener" style="margin-left:auto">
                    <span class="material-icons-outlined" style="font-size:16px">open_in_new</span>
                </a>
            </div>
            <div class="ig-posts-grid" id="ig-posts-${escapeHtml(f.username)}">
                <div class="loading-row">
                    <div class="skeleton skeleton-post"></div>
                    <div class="skeleton skeleton-post"></div>
                    <div class="skeleton skeleton-post"></div>
                </div>
            </div>
        </div>
    `).join('');

    container.innerHTML = localHtml + accountSkeletons;

    // Fetch posts for each followed account
    for (const f of user.following) {
        fetchAndRenderAccount(f.username);
    }
}

async function fetchAndRenderAccount(username) {
    const grid = document.getElementById('ig-posts-' + username);
    if (!grid) return;

    const data = await getIGPostsCached(username);

    if (!data || !data.posts || data.posts.length === 0) {
        let msg    = '';
        let detail = data?.error ? `<small style="color:var(--text-muted)">(${escapeHtml(data.error)})</small>` : '';
        let action = '';

        if (!getIGSession() || data?.setup) {
            msg    = 'Connect your Instagram session in Settings to load posts.';
            detail = '';
            action = `<button class="btn btn-primary" style="margin-top:10px;width:auto;padding:8px 16px" onclick="showSection('settings')">
                          <span class="material-icons-outlined">settings</span> Go to Settings
                      </button>`;
        } else if (data?.expired) {
            msg    = 'Instagram session expired — reconnect in Settings.';
            detail = '';
            action = `<button class="btn btn-primary" style="margin-top:10px;width:auto;padding:8px 16px" onclick="showSection('settings')">
                          <span class="material-icons-outlined">refresh</span> Reconnect
                      </button>`;
        } else if (data?.rateLimit || data?.httpStatus === 429) {
            msg = 'Instagram rate limit hit — wait a few minutes then click Refresh.';
        } else if (location.port === '3000') {
            msg    = 'Deploy to Vercel to load live Instagram posts.';
            detail = '';
        } else {
            msg = 'Could not load posts.';
        }

        grid.innerHTML = `
            <div class="ig-fetch-failed">
                <span class="material-icons-outlined">cloud_off</span>
                <p>${msg} ${detail}</p>
                ${action}
                <a href="https://instagram.com/${encodeURIComponent(username)}" target="_blank" rel="noopener" class="btn-visit" style="margin-top:8px">
                    View @${escapeHtml(username)} on Instagram <span class="material-icons-outlined" style="font-size:14px">open_in_new</span>
                </a>
            </div>`;
        return;
    }

    const postsHtml = data.posts.map(p => renderIGPostCard(p)).join('');

    const loadMoreBtn = data.hasMore
        ? `<button class="btn-load-more" id="loadmore-${escapeHtml(username)}" onclick="loadMorePosts('${safeAttr(username)}')">
               <span class="material-icons-outlined">expand_more</span> Load more
           </button>`
        : '';

    grid.innerHTML = `<div class="ig-posts-row">${postsHtml}</div>${loadMoreBtn}`;
}

function renderIGPostCard(post) {
    const time = post.timestamp ? timeAgo(new Date(post.timestamp)) : '';
    const caption = post.caption
        ? escapeHtml(post.caption.length > 120 ? post.caption.slice(0, 117) + '…' : post.caption)
        : '';

    return `
        <div class="ig-post-card-item" onclick="window.open('${escapeHtml(post.url)}','_blank')">
            ${post.imageUrl
                ? `<div class="ig-post-thumb-wrap">
                       <img class="ig-post-thumb" src="${escapeHtml(post.imageUrl)}" alt="" loading="lazy"
                            onerror="this.parentElement.innerHTML='<div class=\\"thumb-error\\"><span class=\\"material-icons-outlined\\">broken_image</span></div>'">
                       ${post.isVideo ? '<span class="video-badge"><span class="material-icons-outlined">play_circle</span></span>' : ''}
                   </div>`
                : `<div class="ig-post-thumb-wrap"><div class="thumb-error"><span class="material-icons-outlined">image_not_supported</span></div></div>`
            }
            <div class="ig-post-card-body">
                ${caption ? `<p class="ig-post-caption">${caption}</p>` : ''}
                <div class="ig-post-meta">
                    ${post.likes !== null ? `<span><span class="material-icons-outlined" style="font-size:14px;color:var(--accent)">favorite</span> ${formatCount(post.likes)}</span>` : ''}
                    ${time ? `<span>${time}</span>` : ''}
                </div>
            </div>
        </div>`;
}

function renderLocalPost(post, user) {
    const time    = timeAgo(new Date(post.createdAt));
    const isOwner = post.author === user.username;
    const initial = (post.authorDisplay || post.author).charAt(0).toUpperCase();
    return `
        <div class="post-card">
            <div class="post-card-header">
                <div class="post-author">
                    <div class="post-avatar local">${initial}</div>
                    <div class="post-author-info">
                        <span class="post-author-name">${escapeHtml(post.authorDisplay || post.author)}</span>
                        <span class="post-author-source">MyFeed${post.crossposted ? ' · <span class="ig-badge">→ Instagram</span>' : ''}</span>
                    </div>
                </div>
                ${isOwner ? `<button class="post-delete-btn" onclick="deletePost('${post.id}')" title="Delete">
                    <span class="material-icons-outlined">delete_outline</span></button>` : ''}
            </div>
            ${post.image ? `<img class="post-card-image" src="${post.image}" alt="">` : ''}
            <div class="post-card-body">
                ${post.caption ? `<p class="post-caption"><strong>${escapeHtml(post.authorDisplay || post.author)}</strong> ${escapeHtml(post.caption)}</p>` : ''}
                <p class="post-time">${time}</p>
            </div>
            <div class="post-card-actions">
                <button class="post-action-btn ${post.liked ? 'liked' : ''}" onclick="toggleLike('${post.id}')">
                    <span class="material-icons-outlined">${post.liked ? 'favorite' : 'favorite_border'}</span>
                    ${post.likes || ''}
                </button>
            </div>
        </div>`;
}

async function refreshFeed() {
    const user = getCurrentUser();
    // Clear IG cache so next renderFeed fetches fresh
    const cache = getIGCache();
    (user.following || []).forEach(f => delete cache[f.username]);
    saveIGCache(cache);
    await renderFeed();
    showToast('Feed refreshed!');
}

function toggleLike(postId) {
    const user = getCurrentUser();
    const post = user.posts.find(p => p.id === postId);
    if (!post) return;
    post.liked  = !post.liked;
    post.likes  = (post.likes || 0) + (post.liked ? 1 : -1);
    saveCurrentUser(user);
    renderFeed();
}

function deletePost(postId) {
    if (!confirm('Delete this post?')) return;
    const user = getCurrentUser();
    user.posts = user.posts.filter(p => p.id !== postId);
    saveCurrentUser(user);
    renderFeed();
    showToast('Post deleted.');
}

// ---- Settings ----------------------------------------------
function saveProfile() {
    const user        = getCurrentUser();
    const displayName = document.getElementById('settings-displayname').value.trim();
    const bio         = document.getElementById('settings-bio').value.trim();
    if (!displayName) { showToast('Display name is required.'); return; }
    user.displayName = displayName;
    user.bio         = bio;
    saveCurrentUser(user);
    document.getElementById('nav-avatar').textContent = displayName.charAt(0).toUpperCase();
    showToast('Profile saved!');
}

function toggleDarkMode() {
    const dark = document.getElementById('dark-mode-toggle').checked;
    localStorage.setItem('fv_dark_mode', dark);
    if (dark) document.documentElement.setAttribute('data-theme', 'dark');
    else      document.documentElement.removeAttribute('data-theme');
}

// ---- Utilities ---------------------------------------------
function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = String(str);
    return d.innerHTML;
}

function safeAttr(str) {
    return String(str).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function timeAgo(date) {
    const s = Math.floor((new Date() - date) / 1000);
    if (s < 60)   return 'just now';
    const m = Math.floor(s / 60);
    if (m < 60)   return m + 'm ago';
    const h = Math.floor(m / 60);
    if (h < 24)   return h + 'h ago';
    const d = Math.floor(h / 24);
    if (d < 7)    return d + 'd ago';
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatCount(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000)    return (n / 1000).toFixed(1) + 'K';
    return String(n);
}

// ---- Enter key support -------------------------------------
document.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    const id = document.activeElement.id;
    if (id === 'login-username' || id === 'login-password') handleLogin();
    if (['signup-displayname','signup-username','signup-password','signup-password-confirm'].includes(id)) handleSignup();
    if (id === 'ig-username-input')  handleAddAccount();
    if (id === 'ig-link-username')   linkInstagram();
    if (id === 'ig-login-username' || id === 'ig-login-password') handleIGLogin();
    if (id === 'ig-2fa-code')        handleIG2FA();
});

// ---- Init --------------------------------------------------
(function init() {
    if (localStorage.getItem('fv_dark_mode') === 'true')
        document.documentElement.setAttribute('data-theme', 'dark');
    const current = localStorage.getItem(DB_CURRENT);
    if (current && getUsers()[current]) enterApp();
})();
