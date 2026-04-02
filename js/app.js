// ============================================================
// FeedVault — Main Application Logic
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
    showToast('Welcome to FeedVault!');
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

const IG_APP_ID = '936619743392459';

async function fetchIGPosts(username, cursor = null) {
    const base = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`;
    const proxy = 'https://corsproxy.io/?' + encodeURIComponent(base);

    try {
        const res = await fetch(proxy, {
            headers: { 'x-ig-app-id': IG_APP_ID }
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const json = await res.json();
        const userData = json?.data?.user;
        if (!userData) throw new Error('No user data');

        const media = userData.edge_owner_to_timeline_media || userData.edge_felix_video_timeline;
        const edges = media?.edges || [];
        const pageInfo = media?.page_info || {};

        const posts = edges.map(e => {
            const n = e.node;
            const caption = n.edge_media_to_caption?.edges?.[0]?.node?.text || '';
            // multi-image: first image or video thumbnail
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
                username
            };
        });

        return {
            posts,
            profilePic: userData.profile_pic_url,
            fullName:   userData.full_name,
            bio:        userData.biography,
            nextCursor: pageInfo.end_cursor || null,
            hasMore:    pageInfo.has_next_page || false
        };
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
        grid.innerHTML = `
            <div class="ig-fetch-failed">
                <span class="material-icons-outlined">wifi_off</span>
                <p>Couldn't load posts — Instagram limits automated access.</p>
                <a href="https://instagram.com/${encodeURIComponent(username)}" target="_blank" rel="noopener" class="btn-visit">
                    View on Instagram <span class="material-icons-outlined" style="font-size:14px">open_in_new</span>
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
                        <span class="post-author-source">FeedVault${post.crossposted ? ' · <span class="ig-badge">→ Instagram</span>' : ''}</span>
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
    if (id === 'ig-username-input') handleAddAccount();
    if (id === 'ig-link-username')  linkInstagram();
});

// ---- Init --------------------------------------------------
(function init() {
    if (localStorage.getItem('fv_dark_mode') === 'true')
        document.documentElement.setAttribute('data-theme', 'dark');
    const current = localStorage.getItem(DB_CURRENT);
    if (current && getUsers()[current]) enterApp();
})();
