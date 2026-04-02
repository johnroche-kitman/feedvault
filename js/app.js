// ============================================================
// FeedVault — Main Application Logic
// ============================================================

const DB_USERS = 'fv_users';
const DB_CURRENT = 'fv_current_user';

function getUsers() { return JSON.parse(localStorage.getItem(DB_USERS) || '{}'); }
function saveUsers(u) { localStorage.setItem(DB_USERS, JSON.stringify(u)); }

function getCurrentUser() {
    const username = localStorage.getItem(DB_CURRENT);
    if (!username) return null;
    return getUsers()[username] || null;
}

function saveCurrentUser(user) {
    const users = getUsers();
    users[user.username] = user;
    saveUsers(users);
}

// --- Toast ---
function showToast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2600);
}

// --- Auth ---
function showLogin() {
    document.getElementById('login-form').style.display = '';
    document.getElementById('signup-form').style.display = 'none';
    clearAuthErrors();
}

function showSignup() {
    document.getElementById('login-form').style.display = 'none';
    document.getElementById('signup-form').style.display = '';
    clearAuthErrors();
}

function clearAuthErrors() {
    document.getElementById('login-error').textContent = '';
    document.getElementById('signup-error').textContent = '';
}

function handleLogin() {
    const username = document.getElementById('login-username').value.trim().toLowerCase();
    const password = document.getElementById('login-password').value;
    const errEl = document.getElementById('login-error');
    if (!username || !password) { errEl.textContent = 'Please fill in all fields.'; return; }
    const users = getUsers();
    if (!users[username]) { errEl.textContent = 'Account not found.'; return; }
    if (users[username].password !== password) { errEl.textContent = 'Incorrect password.'; return; }
    localStorage.setItem(DB_CURRENT, username);
    enterApp();
}

function handleSignup() {
    const displayName = document.getElementById('signup-displayname').value.trim();
    const username = document.getElementById('signup-username').value.trim().toLowerCase();
    const password = document.getElementById('signup-password').value;
    const confirm = document.getElementById('signup-password-confirm').value;
    const errEl = document.getElementById('signup-error');
    if (!displayName || !username || !password) { errEl.textContent = 'Please fill in all fields.'; return; }
    if (password.length < 6) { errEl.textContent = 'Password must be at least 6 characters.'; return; }
    if (password !== confirm) { errEl.textContent = 'Passwords do not match.'; return; }
    if (!/^[a-z0-9_]+$/.test(username)) { errEl.textContent = 'Username: lowercase letters, numbers, underscores only.'; return; }
    const users = getUsers();
    if (users[username]) { errEl.textContent = 'Username already taken.'; return; }
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
    if (!confirm('Are you sure? This cannot be undone.')) return;
    const user = getCurrentUser();
    if (!user) return;
    const users = getUsers();
    delete users[user.username];
    saveUsers(users);
    localStorage.removeItem(DB_CURRENT);
    handleLogout();
    showToast('Account deleted.');
}

// --- Enter App ---
function enterApp() {
    const user = getCurrentUser();
    if (!user) return;
    document.getElementById('auth-screen').classList.remove('active');
    document.getElementById('app-screen').classList.add('active');
    document.getElementById('nav-avatar').textContent = user.displayName.charAt(0).toUpperCase();
    document.getElementById('nav-username').textContent = user.username;
    document.getElementById('settings-displayname').value = user.displayName;
    document.getElementById('settings-bio').value = user.bio || '';
    const darkPref = localStorage.getItem('fv_dark_mode') === 'true';
    document.getElementById('dark-mode-toggle').checked = darkPref;
    if (darkPref) document.documentElement.setAttribute('data-theme', 'dark');
    updateIGLinkUI();
    updateCrosspostToggle();
    showSection('feed');
}

// --- Navigation ---
function showSection(name) {
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.getElementById('section-' + name).classList.add('active');
    document.querySelectorAll('.nav-btn[data-section]').forEach(b => {
        b.classList.toggle('active', b.dataset.section === name);
    });
    if (name === 'feed') renderFeed();
    if (name === 'manage') renderFollowing();
}

// --- Following Management ---
function handleAddAccount() {
    const input = document.getElementById('ig-username-input');
    let username = input.value.trim().replace(/^@/, '').toLowerCase();
    if (!username) { showToast('Please enter a username.'); return; }
    if (!/^[a-z0-9._]+$/.test(username)) { showToast('Invalid Instagram username.'); return; }
    const user = getCurrentUser();
    if (user.following.some(f => f.username === username)) { showToast('Already following @' + username); return; }
    user.following.push({ username, posts: [], addedAt: new Date().toISOString() });
    saveCurrentUser(user);
    input.value = '';
    renderFollowing();
    showToast('Now following @' + username);
}

function unfollowAccount(username) {
    const user = getCurrentUser();
    user.following = user.following.filter(f => f.username !== username);
    saveCurrentUser(user);
    renderFollowing();
    showToast('Unfollowed @' + username);
}

// Parse & validate an Instagram post URL → returns clean URL or null
function parseIGPostUrl(raw) {
    try {
        raw = raw.trim();
        // Accept formats: full URL or just the /p/CODE part
        const match = raw.match(/instagram\.com\/(p|reel|tv)\/([A-Za-z0-9_-]+)/);
        if (match) return `https://www.instagram.com/${match[1]}/${match[2]}/`;
    } catch(e) {}
    return null;
}

function addPostToAccount(username) {
    const input = document.getElementById('post-url-input-' + username);
    const url = parseIGPostUrl(input.value);
    if (!url) { showToast('Paste a valid Instagram post, reel, or video URL.'); return; }

    const user = getCurrentUser();
    const account = user.following.find(f => f.username === username);
    if (!account) return;
    if (!account.posts) account.posts = [];
    if (account.posts.some(p => p.url === url)) { showToast('Post already added.'); return; }

    account.posts.unshift({ url, addedAt: new Date().toISOString() });
    saveCurrentUser(user);
    input.value = '';
    renderFollowing();
    showToast('Post added to feed!');
}

function removePostFromAccount(username, url) {
    const user = getCurrentUser();
    const account = user.following.find(f => f.username === username);
    if (!account) return;
    account.posts = account.posts.filter(p => p.url !== url);
    saveCurrentUser(user);
    renderFollowing();
    renderFeed();
    showToast('Post removed.');
}

function toggleAddPostForm(username) {
    const form = document.getElementById('add-post-form-' + username);
    form.style.display = form.style.display === 'none' ? '' : 'none';
    if (form.style.display !== 'none') {
        document.getElementById('post-url-input-' + username).focus();
    }
}

function renderFollowing() {
    const user = getCurrentUser();
    const list = document.getElementById('following-list');
    const empty = document.getElementById('following-empty');

    if (!user.following.length) {
        list.innerHTML = '';
        empty.style.display = '';
        return;
    }

    empty.style.display = 'none';
    list.innerHTML = user.following.map(f => {
        const posts = f.posts || [];
        const safeUser = escapeHtml(f.username);
        const safeUserAttr = safeAttr(f.username);

        return `
        <div class="following-item-card">
            <div class="following-item-header">
                <div class="following-info">
                    <div class="following-avatar">${f.username.charAt(0).toUpperCase()}</div>
                    <div class="following-details">
                        <span class="following-name">@${safeUser}</span>
                        <span class="following-handle">${posts.length} post${posts.length !== 1 ? 's' : ''} in feed</span>
                    </div>
                </div>
                <div class="following-actions">
                    <button class="btn-add-post" onclick="toggleAddPostForm('${safeUserAttr}')">
                        <span class="material-icons-outlined" style="font-size:16px">add</span> Add Post
                    </button>
                    <a class="btn-visit" href="https://instagram.com/${encodeURIComponent(f.username)}" target="_blank" rel="noopener">
                        <span class="material-icons-outlined" style="font-size:16px">open_in_new</span>
                    </a>
                    <button class="btn-unfollow" onclick="unfollowAccount('${safeUserAttr}')">Unfollow</button>
                </div>
            </div>

            <div id="add-post-form-${safeUser}" class="add-post-form" style="display:none">
                <div class="add-post-input-row">
                    <div class="input-group" style="margin-bottom:0; flex:1">
                        <span class="material-icons-outlined">link</span>
                        <input type="url" id="post-url-input-${safeUser}"
                            placeholder="Paste Instagram post URL (e.g. instagram.com/p/ABC123)"
                            onkeydown="if(event.key==='Enter') addPostToAccount('${safeUserAttr}')">
                    </div>
                    <button class="btn btn-primary" style="width:auto" onclick="addPostToAccount('${safeUserAttr}')">Add</button>
                </div>
                <p class="add-post-hint">Open any post on Instagram, copy the URL from your browser, and paste it here.</p>
            </div>

            ${posts.length > 0 ? `
            <div class="added-posts-list">
                ${posts.map(p => `
                    <div class="added-post-chip">
                        <span class="material-icons-outlined" style="font-size:14px;color:var(--text-muted)">link</span>
                        <span class="chip-url">${escapeHtml(p.url)}</span>
                        <button class="chip-remove" onclick="removePostFromAccount('${safeUserAttr}', '${safeAttr(p.url)}')" title="Remove">×</button>
                    </div>
                `).join('')}
            </div>
            ` : ''}
        </div>
        `;
    }).join('');
}

// --- Instagram Link ---
function linkInstagram() {
    const input = document.getElementById('ig-link-username');
    let username = input.value.trim().replace(/^@/, '').toLowerCase();
    if (!username) { showToast('Please enter your Instagram username.'); return; }
    if (!/^[a-z0-9._]+$/.test(username)) { showToast('Invalid Instagram username.'); return; }
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
    const user = getCurrentUser();
    const statusEl = document.getElementById('ig-link-status');
    const formEl = document.getElementById('ig-link-form');
    if (user.igLinked) {
        statusEl.innerHTML = `
            <div class="ig-linked">
                <span class="material-icons-outlined">check_circle</span>
                <span>Linked: @${escapeHtml(user.igLinked)}</span>
                <button class="btn-unlink" onclick="unlinkInstagram()">Unlink</button>
            </div>`;
        formEl.style.display = 'none';
    } else {
        statusEl.innerHTML = '';
        formEl.style.display = '';
    }
}

function updateCrosspostToggle() {
    const user = getCurrentUser();
    document.getElementById('crosspost-toggle').style.display = user.igLinked ? 'flex' : 'none';
}

// --- Create Post ---
let selectedImage = null;

function handleImageSelect(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { showToast('Image must be under 10MB.'); return; }
    const reader = new FileReader();
    reader.onload = function(e) {
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
    const caption = document.getElementById('post-caption').value.trim();
    const crosspost = document.getElementById('crosspost-ig').checked;
    const user = getCurrentUser();
    if (!caption && !selectedImage) { showToast('Add a photo or write something!'); return; }
    const post = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        type: 'local',
        author: user.username,
        authorDisplay: user.displayName,
        caption,
        image: selectedImage,
        likes: 0,
        liked: false,
        crossposted: crosspost && !!user.igLinked,
        createdAt: new Date().toISOString()
    };
    user.posts.unshift(post);
    saveCurrentUser(user);
    document.getElementById('post-caption').value = '';
    selectedImage = null;
    document.getElementById('image-input').value = '';
    document.getElementById('image-preview-container').style.display = 'none';
    document.getElementById('image-placeholder').style.display = '';
    showToast(post.crossposted ? 'Post published! (Cross-post to Instagram requires API setup)' : 'Post published!');
    showSection('feed');
}

// --- Feed ---
function renderFeed() {
    const user = getCurrentUser();
    const container = document.getElementById('feed-container');
    const empty = document.getElementById('feed-empty');

    // Local posts
    const localPosts = (user.posts || []).map(p => ({ ...p, sortTime: new Date(p.createdAt).getTime() }));

    // Individual IG post embeds from followed accounts
    const igEmbeds = [];
    (user.following || []).forEach(f => {
        (f.posts || []).forEach(p => {
            igEmbeds.push({
                id: 'ig-embed-' + btoa(p.url).slice(0, 12),
                type: 'instagram-post',
                username: f.username,
                url: p.url,
                sortTime: new Date(p.addedAt).getTime()
            });
        });
    });

    const allItems = [...localPosts, ...igEmbeds].sort((a, b) => b.sortTime - a.sortTime);

    if (!allItems.length) {
        container.innerHTML = '';
        empty.style.display = '';
        return;
    }

    empty.style.display = 'none';
    container.innerHTML = allItems.map(item => {
        if (item.type === 'local') return renderLocalPost(item, user);
        if (item.type === 'instagram-post') return renderIGEmbed(item);
        return '';
    }).join('');

    // Process Instagram embeds
    processIGEmbeds();
}

function renderLocalPost(post, user) {
    const time = timeAgo(new Date(post.createdAt));
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
                ${isOwner ? `<button class="post-delete-btn" onclick="deletePost('${post.id}')" title="Delete post"><span class="material-icons-outlined">delete_outline</span></button>` : ''}
            </div>
            ${post.image ? `<img class="post-card-image" src="${post.image}" alt="Post image">` : ''}
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

function renderIGEmbed(item) {
    return `
        <div class="post-card ig-post-card">
            <div class="post-card-header">
                <div class="post-author">
                    <div class="post-avatar">
                        <span class="material-icons-outlined" style="font-size:20px;color:#fff">photo_camera</span>
                    </div>
                    <div class="post-author-info">
                        <span class="post-author-name">@${escapeHtml(item.username)}</span>
                        <span class="post-author-source"><span class="ig-badge">Instagram</span></span>
                    </div>
                </div>
                <a class="btn-visit" href="${escapeHtml(item.url)}" target="_blank" rel="noopener" title="View on Instagram">
                    <span class="material-icons-outlined" style="font-size:16px">open_in_new</span>
                </a>
            </div>
            <div class="ig-embed-container">
                <blockquote
                    class="instagram-media"
                    data-instgrm-captioned
                    data-instgrm-permalink="${escapeHtml(item.url)}"
                    data-instgrm-version="14"
                    style="background:#FFF;border:0;border-radius:0;box-shadow:none;margin:0;max-width:100%;min-width:100%;padding:0;width:100%">
                    <div class="ig-embed-placeholder">
                        <span class="material-icons-outlined">photo_camera</span>
                        <p>Loading post from @${escapeHtml(item.username)}…</p>
                        <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener">View on Instagram</a>
                    </div>
                </blockquote>
            </div>
        </div>`;
}

function processIGEmbeds() {
    if (window.instgrm) {
        window.instgrm.Embeds.process();
    } else {
        // Load script then process
        const existing = document.querySelector('script[src*="instagram.com/embed"]');
        if (existing) {
            existing.remove();
        }
        const script = document.createElement('script');
        script.async = true;
        script.src = 'https://www.instagram.com/embed.js';
        document.body.appendChild(script);
    }
}

function refreshFeed() {
    renderFeed();
    showToast('Feed refreshed!');
}

function toggleLike(postId) {
    const user = getCurrentUser();
    const post = user.posts.find(p => p.id === postId);
    if (!post) return;
    post.liked = !post.liked;
    post.likes = (post.likes || 0) + (post.liked ? 1 : -1);
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

// --- Settings ---
function saveProfile() {
    const user = getCurrentUser();
    const displayName = document.getElementById('settings-displayname').value.trim();
    const bio = document.getElementById('settings-bio').value.trim();
    if (!displayName) { showToast('Display name is required.'); return; }
    user.displayName = displayName;
    user.bio = bio;
    saveCurrentUser(user);
    document.getElementById('nav-avatar').textContent = displayName.charAt(0).toUpperCase();
    showToast('Profile saved!');
}

function toggleDarkMode() {
    const dark = document.getElementById('dark-mode-toggle').checked;
    localStorage.setItem('fv_dark_mode', dark);
    if (dark) document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
}

// --- Utilities ---
function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = String(str);
    return d.innerHTML;
}

function safeAttr(str) {
    return String(str).replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

function timeAgo(date) {
    const s = Math.floor((new Date() - date) / 1000);
    if (s < 60) return 'just now';
    const m = Math.floor(s / 60);
    if (m < 60) return m + 'm ago';
    const h = Math.floor(m / 60);
    if (h < 24) return h + 'h ago';
    const d = Math.floor(h / 24);
    if (d < 7) return d + 'd ago';
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// --- Enter key support ---
document.addEventListener('keydown', function(e) {
    if (e.key !== 'Enter') return;
    const id = document.activeElement.id;
    if (id === 'login-username' || id === 'login-password') handleLogin();
    if (['signup-displayname','signup-username','signup-password','signup-password-confirm'].includes(id)) handleSignup();
    if (id === 'ig-username-input') handleAddAccount();
    if (id === 'ig-link-username') linkInstagram();
});

// --- Init ---
(function init() {
    if (localStorage.getItem('fv_dark_mode') === 'true') {
        document.documentElement.setAttribute('data-theme', 'dark');
    }
    const current = localStorage.getItem(DB_CURRENT);
    if (current && getUsers()[current]) enterApp();
})();
