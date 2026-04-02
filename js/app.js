// ============================================================
// FeedVault — Main Application Logic
// ============================================================

// --- Storage helpers ---
const DB_USERS = 'fv_users';
const DB_CURRENT = 'fv_current_user';

function getUsers() {
    return JSON.parse(localStorage.getItem(DB_USERS) || '{}');
}

function saveUsers(users) {
    localStorage.setItem(DB_USERS, JSON.stringify(users));
}

function getCurrentUser() {
    const username = localStorage.getItem(DB_CURRENT);
    if (!username) return null;
    const users = getUsers();
    return users[username] || null;
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

    users[username] = {
        username,
        displayName,
        password,
        bio: '',
        igLinked: null,
        following: [],
        posts: [],
        createdAt: new Date().toISOString()
    };

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
    if (!confirm('Are you sure you want to delete your account? This cannot be undone.')) return;
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

    // Set nav user info
    document.getElementById('nav-avatar').textContent = user.displayName.charAt(0).toUpperCase();
    document.getElementById('nav-username').textContent = user.username;

    // Load settings fields
    document.getElementById('settings-displayname').value = user.displayName;
    document.getElementById('settings-bio').value = user.bio || '';

    // Dark mode
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
    if (user.following.some(f => f.username === username)) {
        showToast('Already following @' + username);
        return;
    }

    user.following.push({
        username,
        addedAt: new Date().toISOString()
    });

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
    list.innerHTML = user.following.map(f => `
        <div class="following-item">
            <div class="following-info">
                <div class="following-avatar">${f.username.charAt(0).toUpperCase()}</div>
                <div class="following-details">
                    <span class="following-name">@${escapeHtml(f.username)}</span>
                    <span class="following-handle">Instagram</span>
                </div>
            </div>
            <div class="following-actions">
                <a class="btn-visit" href="https://instagram.com/${encodeURIComponent(f.username)}" target="_blank" rel="noopener">
                    <span class="material-icons-outlined" style="font-size:16px">open_in_new</span> View
                </a>
                <button class="btn-unfollow" onclick="unfollowAccount('${escapeHtml(f.username)}')">Unfollow</button>
            </div>
        </div>
    `).join('');
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
            </div>
        `;
        formEl.style.display = 'none';
    } else {
        statusEl.innerHTML = '';
        formEl.style.display = '';
    }
}

function updateCrosspostToggle() {
    const user = getCurrentUser();
    const toggle = document.getElementById('crosspost-toggle');
    toggle.style.display = user.igLinked ? 'flex' : 'none';
}

// --- Create Post ---
let selectedImage = null;

function handleImageSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
        showToast('Image must be under 10MB.');
        return;
    }

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

    if (!caption && !selectedImage) {
        showToast('Add a photo or write something!');
        return;
    }

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

    // Reset form
    document.getElementById('post-caption').value = '';
    selectedImage = null;
    document.getElementById('image-input').value = '';
    document.getElementById('image-preview-container').style.display = 'none';
    document.getElementById('image-placeholder').style.display = '';

    if (post.crossposted) {
        showToast('Post published! (Cross-post to Instagram requires API setup)');
    } else {
        showToast('Post published!');
    }

    showSection('feed');
}

// --- Feed ---
function renderFeed() {
    const user = getCurrentUser();
    const container = document.getElementById('feed-container');
    const empty = document.getElementById('feed-empty');

    // Collect local posts
    const localPosts = (user.posts || []).map(p => ({
        ...p,
        sortTime: new Date(p.createdAt).getTime()
    }));

    // Build IG embed cards for followed accounts
    const igPosts = user.following.map(f => ({
        id: 'ig-' + f.username,
        type: 'instagram-profile',
        username: f.username,
        sortTime: new Date(f.addedAt).getTime()
    }));

    const allItems = [...localPosts, ...igPosts].sort((a, b) => b.sortTime - a.sortTime);

    if (!allItems.length) {
        container.innerHTML = '';
        empty.style.display = '';
        return;
    }

    empty.style.display = 'none';
    container.innerHTML = allItems.map(item => {
        if (item.type === 'local') return renderLocalPost(item, user);
        if (item.type === 'instagram-profile') return renderIGProfile(item);
        return '';
    }).join('');
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
                        <span class="post-author-source">
                            FeedVault
                            ${post.crossposted ? ' · <span class="ig-badge">→ Instagram</span>' : ''}
                        </span>
                    </div>
                </div>
                ${isOwner ? `<button class="post-delete-btn" onclick="deletePost('${post.id}')" title="Delete post"><span class="material-icons-outlined">delete_outline</span></button>` : ''}
            </div>
            ${post.image ? `<img class="post-card-image" src="${post.image}" alt="Post image">` : ''}
            ${post.caption ? `
                <div class="post-card-body">
                    <p class="post-caption"><strong>${escapeHtml(post.authorDisplay || post.author)}</strong> ${escapeHtml(post.caption)}</p>
                    <p class="post-time">${time}</p>
                </div>
            ` : `<div class="post-card-body"><p class="post-time">${time}</p></div>`}
            <div class="post-card-actions">
                <button class="post-action-btn ${post.liked ? 'liked' : ''}" onclick="toggleLike('${post.id}')">
                    <span class="material-icons-outlined">${post.liked ? 'favorite' : 'favorite_border'}</span>
                    ${post.likes || ''}
                </button>
            </div>
        </div>
    `;
}

function renderIGProfile(item) {
    return `
        <div class="post-card">
            <div class="post-card-header">
                <div class="post-author">
                    <div class="post-avatar">${item.username.charAt(0).toUpperCase()}</div>
                    <div class="post-author-info">
                        <span class="post-author-name">@${escapeHtml(item.username)}</span>
                        <span class="post-author-source"><span class="ig-badge">Instagram</span></span>
                    </div>
                </div>
                <a class="btn-visit" href="https://instagram.com/${encodeURIComponent(item.username)}" target="_blank" rel="noopener">
                    <span class="material-icons-outlined" style="font-size:16px">open_in_new</span> Open
                </a>
            </div>
            <div class="post-card-body">
                <div class="ig-embed-wrapper">
                    <blockquote class="instagram-media" data-instgrm-permalink="https://www.instagram.com/${encodeURIComponent(item.username)}/" data-instgrm-version="14" style="background:#FFF; border:0; border-radius:12px; box-shadow:0 0 1px 0 rgba(0,0,0,0.5),0 1px 10px 0 rgba(0,0,0,0.15); margin:0; max-width:100%; min-width:100%; padding:0; width:100%;">
                        <div style="padding:16px;">
                            <a href="https://www.instagram.com/${encodeURIComponent(item.username)}/" style="color:#3897f0; font-family:Arial,sans-serif; font-size:14px; font-weight:600; text-decoration:none;" target="_blank" rel="noopener">View @${escapeHtml(item.username)} on Instagram</a>
                        </div>
                    </blockquote>
                </div>
            </div>
        </div>
    `;
}

function refreshFeed() {
    renderFeed();
    // Reload Instagram embeds
    if (window.instgrm) {
        window.instgrm.Embeds.process();
    } else {
        loadInstagramEmbed();
    }
    showToast('Feed refreshed!');
}

function loadInstagramEmbed() {
    if (document.querySelector('script[src*="instagram.com/embed"]')) return;
    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://www.instagram.com/embed.js';
    document.body.appendChild(script);
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
    if (dark) {
        document.documentElement.setAttribute('data-theme', 'dark');
    } else {
        document.documentElement.removeAttribute('data-theme');
    }
}

// --- Utilities ---
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function timeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return minutes + 'm ago';
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + 'h ago';
    const days = Math.floor(hours / 24);
    if (days < 7) return days + 'd ago';
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// --- Enter key support ---
document.addEventListener('keydown', function(e) {
    if (e.key !== 'Enter') return;
    const active = document.activeElement;
    if (active.id === 'login-username' || active.id === 'login-password') handleLogin();
    if (active.id === 'signup-displayname' || active.id === 'signup-username' ||
        active.id === 'signup-password' || active.id === 'signup-password-confirm') handleSignup();
    if (active.id === 'ig-username-input') handleAddAccount();
    if (active.id === 'ig-link-username') linkInstagram();
});

// --- Init ---
(function init() {
    // Apply dark mode preference
    if (localStorage.getItem('fv_dark_mode') === 'true') {
        document.documentElement.setAttribute('data-theme', 'dark');
    }

    // Auto-login if session exists
    const current = localStorage.getItem(DB_CURRENT);
    if (current && getUsers()[current]) {
        enterApp();
    }

    // Load Instagram embed script
    loadInstagramEmbed();
})();
