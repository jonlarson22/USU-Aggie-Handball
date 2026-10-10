/* Handball — shared core (Phase 3 rebuild).
   Owns: Firebase init, shared player store, auth + roles, top-level navigation. */
const firebaseConfig = {
  apiKey: "AIzaSyAkWOo0G_O91Cszv6qX6_elfB2qoGrTS_U",
  authDomain: "usu-aggie-handball.firebaseapp.com",
  databaseURL: "https://usu-aggie-handball-default-rtdb.firebaseio.com",
  projectId: "usu-aggie-handball",
  storageBucket: "usu-aggie-handball.firebasestorage.app",
  messagingSenderId: "726626777696",
  appId: "1:726626777696:web:e4a9b3760cc97877a7a105"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();

/* ---------- shared player store ----------
   Exactly one players listener for the whole app. Firebase stores arrays as
   numeric-keyed objects, so every subscriber always gets a real array with
   stable ids. */
function normalizePlayers(val) {
    if (!val) return [];
    if (Array.isArray(val)) return val;
    return Object.keys(val).sort((a, b) => (+a) - (+b)).map(k => {
        const p = val[k];
        if (p && typeof p === 'object' && (p.id === undefined || p.id === null)) {
            p.id = isNaN(+k) ? k : +k;
        }
        return p;
    });
}
let clubPlayers = [];
const playersSubscribers = [];
function onPlayersUpdate(fn) { playersSubscribers.push(fn); }
db.ref('players').on('value', (snap) => {
    clubPlayers = normalizePlayers(snap.val());
    refreshDisplayNames(clubPlayers);
    playersSubscribers.forEach(fn => { try { fn(clubPlayers); } catch (e) { console.error('players subscriber failed:', e); } });
    syncPlayerIdCounter(clubPlayers);
});

/* ---------- sequential player IDs (source of truth for renames) ---------- */
function getNextPlayerId() {
    return db.ref('meta/nextPlayerId').transaction(cur => (cur || 0) + 1).then(res => {
        const id = res && res.snapshot ? res.snapshot.val() : null;
        if (!id || id < 1) throw new Error('id-txn-failed');
        return id;
    }).catch(() => {
        // offline fallback: max local id + 1
        const all = (typeof clubPlayers !== 'undefined' ? clubPlayers : []).concat(typeof players !== 'undefined' ? players : []);
        return all.reduce((m, p) => Math.max(m, Number(p.id) || 0), 0) + 1;
    });
}
function syncPlayerIdCounter(list) {
    const maxId = (list || []).reduce((m, p) => Math.max(m, Number(p.id) || 0), 0);
    if (maxId < 1) return;
    db.ref('meta/nextPlayerId').transaction(cur => Math.max(cur || 0, maxId)).catch(() => {});
}

/* ---------- roles & auth ----------
   Roles live in /admins/{uid} = { email, role, createdAt }.
   owner: everything, incl. managing roles.  admin: everything except roles.
   director: tournament tools only. */
let currentUser = null;
let userRole = null;   // 'owner' | 'admin' | 'director' | null
let isAdmin = false;   // logged in AND holding a role (legacy flag kept for old call sites)

function can(perm) {
    if (!isAdmin || !userRole) return false;
    switch (perm) {
        case 'admin':       return true;  // any role may open the Admin tab
        case 'review':
        case 'players':
        case 'data':        return userRole === 'owner' || userRole === 'admin';
        case 'review-tournaments': return true;  // owner, admin, director (tournament items only)
        case 'tournaments': return true;   // owner, admin, director
        case 'roles':       return userRole === 'owner';
        default:            return false;
    }
}
/* Can this user see the Review tab at all? */
function canSeeReview() {
    return can('review') || can('review-tournaments');
}


/* ---------- player display names ----------
   Shows "J. Larson" normally. If two players share the same initial+last,
   shows full first name ("John Smith" vs "James Smith") as tiebreaker.
   Single-name players display as-is. */
let _nameCounts = {};
function buildNameIndex(roster) {
    _nameCounts = {};
    (roster || []).forEach(p => {
        const key = shortNameKey(p);
        if (key) _nameCounts[key] = (_nameCounts[key] || 0) + 1;
    });
}
function shortNameKey(p) {
    if (!p) return '';
    const fn = (p.firstName || '').trim();
    const ln = (p.lastName || '').trim();
    if (!ln) return fn;  // single-name: just first name
    if (!fn) return ln;   // no first: just last name
    return fn[0].toUpperCase() + '. ' + ln;
}
function displayName(p) {
    if (!p) return '';
    const fn = (p.firstName || '').trim();
    const ln = (p.lastName || '').trim();
    // Legacy: if still has old 'name' field, use it
    if (!fn && !ln && p.name) return p.name;
    if (!fn) return ln;
    if (!ln) return fn;
    const short = fn[0].toUpperCase() + '. ' + ln;
    // Tiebreaker: if another player shares this short name, use full first name
    const key = shortNameKey(p);
    if (_nameCounts[key] > 1) return fn + ' ' + ln;
    return short;
}


/* Refresh the computed 'name' display field for all players.
   Call after loading, adding, or editing players. */
function refreshDisplayNames(roster) {
    buildNameIndex(roster);
    (roster || []).forEach(p => {
        p.name = displayName(p);
    });
}



/* Map of pending bracket submissions: "divIdx:rIdx:mIdx:bType" -> true */
let _pendingBracketMap = {};
function updatePendingBracketMap(pendingVal) {
    _pendingBracketMap = {};
    if (pendingVal) {
        Object.values(pendingVal).forEach(item => {
            const br = item.bracketRef;
            if (br) {
                const key = `${br.divIdx}:${br.rIdx}:${br.mIdx}:${br.bType}`;
                _pendingBracketMap[key] = true;
            }
        });
    }
}
function hasPendingReview(divIdx, rIdx, mIdx, bType) {
    return !!_pendingBracketMap[`${divIdx}:${rIdx}:${mIdx}:${bType}`];
}

/* ---------- pending review notifications (admins only) ---------- */
let _lastPendingCount = 0;
let _pendingListenerActive = false;
function startPendingWatcher() {
    if (_pendingListenerActive) return;
    if (!can('admin')) return;  // owner/admin/director only (anyone with Admin tab)
    _pendingListenerActive = true;
    db.ref('pending').on('value', (snap) => {
        const val = snap.val();
        const count = val ? Object.keys(val).length : 0;
        updatePendingBadges(count);
        updatePendingBracketMap(val);
        // Toast on new arrivals (not on initial load, not when on Review tab)
        // Directors get toasts too (they can approve tournament items)
        if (_lastPendingCount > 0 && count > _lastPendingCount && canSeeReview()) {
            const newItems = count - _lastPendingCount;
            const onReview = document.querySelector('[data-astab="review"]')?.classList.contains('active');
            const onAdmin = document.getElementById('tab-admin')?.classList.contains('active');
            if (!(onAdmin && onReview) && typeof showToast === 'function') {
                showToast(`${newItems} new match${newItems>1?'es':''} ready for review!`, () => {
                    switchScreen('admin');
                    if (typeof switchAdminTab === 'function') switchAdminTab('review');
                });
            }
        }
        _lastPendingCount = count;
    });
}
function updatePendingBadges(count) {
    ['admin-badge', 'review-badge'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.hidden = count === 0;
            el.textContent = count > 99 ? '99+' : count;
        }
    });
}
function stopPendingWatcher() {
    if (_pendingListenerActive) {
        db.ref('pending').off('value');
        _pendingListenerActive = false;
    }
    _lastPendingCount = 0;
    updatePendingBadges(0);
}

/* ---------- searchable player dropdown ---------- */
function makePlayerSearchable(inputId, listId, onSelect) {
    const input = document.getElementById(inputId);
    const list = document.getElementById(listId);
    if (!input || !list) return;
    
    let selectedId = input.dataset.value || '';
    
    function getMatches(query) {
        const q = (query || '').toLowerCase().trim();
        return players
            .filter(p => !p.hidden)
            .filter(p => {
                if (!q) return true;
                const hay = [p.name, p.firstName, p.lastName, ((p.firstName||'')+' '+(p.lastName||'')).trim()]
                    .filter(Boolean).join(' ').toLowerCase();
                return hay.includes(q);
            })
            .sort((a, b) => a.name.localeCompare(b.name))
            .slice(0, 50);
    }
    
    function renderList() {
        const matches = getMatches(input.value);
        if (!matches.length) {
            list.innerHTML = '<div style="padding:8px;color:#888;">No matches</div>';
        } else {
            list.innerHTML = matches.map(p => 
                `<div class="search-opt" data-id="${p.id}" style="padding:8px 10px;cursor:pointer;border-bottom:1px solid #333;">${p.name}${p.hidden?' 👻':''}</div>`
            ).join('');
        }
        list.style.display = 'block';
    }
    
    input.addEventListener('focus', renderList);
    input.addEventListener('input', () => { selectedId = ''; input.dataset.value = ''; renderList(); });
    
    list.addEventListener('click', (e) => {
        const opt = e.target.closest('.search-opt');
        if (!opt) return;
        selectedId = opt.dataset.id;
        input.dataset.value = selectedId;
        const p = players.find(x => x.id == selectedId);
        input.value = p ? p.name : '';
        list.style.display = 'none';
        if (onSelect) onSelect(selectedId);
    });
    
    document.addEventListener('click', (e) => {
        if (e.target !== input && !list.contains(e.target)) {
            list.style.display = 'none';
        }
    });
    
    // Expose getter
    input.getSelectedId = () => input.dataset.value || '';
    input.setSelectedId = (id) => {
        input.dataset.value = id || '';
        const p = players.find(x => x.id == id);
        input.value = p ? p.name : '';
    };
}


/* ---------- connection status (green = live, red = failed) ---------- */
function setConnectionStatus(ok) {
    const el = document.getElementById('connection-status');
    if (!el) return;
    el.innerText = ok ? 'Realtime Connected ✅' : 'Connection Failed';
    el.style.color = ok ? '#2ecc71' : '#e74c3c';
}

/* ---------- navigation ---------- */
function currentScreenName() {
    const vis = document.querySelector('.screen:not([hidden])');
    return vis ? vis.id.replace('screen-', '') : 'leaderboard';
}
function switchScreen(name, push = true) {
    document.querySelectorAll('#app-tabs .app-tab').forEach(t =>
        t.classList.toggle('active', t.dataset.screen === name));
    document.querySelectorAll('.screen').forEach(s => {
        s.hidden = (s.id !== 'screen-' + name);
    });
    window.scrollTo(0, 0);
    try {
        if (push === true) history.pushState({ screen: name }, '');
        else if (push === false) history.replaceState({ screen: name }, '');
        // push === 'none': leave history untouched
    } catch (e) {}
}
document.querySelectorAll('#app-tabs .app-tab').forEach(t =>
    t.addEventListener('click', () => switchScreen(t.dataset.screen)));

// Android system back button: walk back through screens / close overlays
// instead of exiting the app. A spare marker entry sits above the root so
// back never silently closes the app: at the bottom of the history it lands
// on the main page, and a second back press within a few seconds exits.
let backExitArmed = false;
let backExitTimer = null;
let appExiting = false;
function disarmBackExit() {
    backExitArmed = false;
    if (backExitTimer) { clearTimeout(backExitTimer); backExitTimer = null; }
}
function pushSpare() {
    try { history.pushState({ spare: true }, ''); } catch (e) {}
}
window.addEventListener('popstate', (e) => {
    if (appExiting) return;
    const lm = document.getElementById('live-modal');
    const sm = document.getElementById('score-modal');
    const liveOpen = lm && lm.style.display !== 'none';
    const scoreOpen = sm && sm.style.display !== 'none';
    if (liveOpen || scoreOpen) {
        if (liveOpen && typeof closeLiveModal === 'function') closeLiveModal();
        if (scoreOpen && typeof closeScoreModal === 'function') closeScoreModal();
        // cancel the pop: stay on the current screen
        try { history.pushState({ screen: currentScreenName() }, ''); } catch (err) {}
        return;
    }
    const st = e.state || {};
    if (st.root) {
        // bottom of app history: default to the main page
        if (backExitArmed) {
            appExiting = true;
            disarmBackExit();
            history.back(); // pop the root entry — the app closes
        } else {
            backExitArmed = true;
            pushSpare();
            if (typeof showToast === 'function') showToast('Press back again to exit');
            if (backExitTimer) clearTimeout(backExitTimer);
            backExitTimer = setTimeout(disarmBackExit, 2500);
        }
        return;
    }
    if (st.spare) {
        // landed on the spare: we're at the bottom of app history — main page.
        // (the spare is already the top entry, so don't push another)
        disarmBackExit();
        switchScreen('leaderboard', 'none');
        return;
    }
    disarmBackExit();
    const target = st.screen || 'leaderboard';
    if (document.getElementById('screen-' + target)) switchScreen(target, false);
    else switchScreen('leaderboard', false);
});
try {
    history.replaceState({ screen: 'leaderboard', root: true }, '');
    history.pushState({ spare: true }, '');
} catch (e) {}

let activeAdminTab = 'review';
const ADMIN_TABS = ['review', 'players', 'tournaments', 'data', 'roles'];
const ADMIN_GATES = { review: 'review', players: 'players', tournaments: 'tournaments', data: 'data', roles: 'roles' };
/* Review tab is special: directors see it too (tournament items only) */
function canSeeAdminTab(name) {
    if (name === 'review') return canSeeReview();
    return can(ADMIN_GATES[name]);
}

function switchAdminTab(name) {
    if (!name || !canSeeAdminTab(name)) return;
    activeAdminTab = name;
    applyAdminTabVisibility();
    window.scrollTo(0, 0);
}

function applyAdminTabVisibility() {
    const loggedOut = !currentUser;
    const noRole = currentUser && !isAdmin;

    const subtabs = document.getElementById('admin-subtabs');
    if (subtabs) subtabs.hidden = loggedOut || noRole;
    document.querySelectorAll('#admin-subtabs .admin-subtab').forEach(t => {
        t.hidden = !canSeeAdminTab(t.dataset.astab);
        t.classList.toggle('active', t.dataset.astab === activeAdminTab);
    });

    // keep the active tab on something the user may actually see
    if (isAdmin && !can(ADMIN_GATES[activeAdminTab])) {
        const first = ADMIN_TABS.find(n => can(ADMIN_GATES[n]));
        if (first) activeAdminTab = first;
    }

    ADMIN_TABS.forEach(n => {
        const el = document.getElementById('admin-' + n);
        if (!el) return;
        let visible;
        if (loggedOut) visible = false;
        else if (!isAdmin) visible = (n === 'roles');  // request-access lives here
        else visible = (n === activeAdminTab);
        el.hidden = !visible;
    });

    const managePanel = document.getElementById('roles-manage-panel');
    if (managePanel) managePanel.hidden = !!noRole;
    const wipeBox = document.getElementById('wipe-box');
    if (wipeBox) wipeBox.hidden = !(isAdmin && userRole === 'owner');
    const reqPanel = document.getElementById('request-access-panel');
    if (reqPanel) reqPanel.hidden = !noRole;
}
document.querySelectorAll('#admin-subtabs .admin-subtab').forEach(t =>
    t.addEventListener('click', () => switchAdminTab(t.dataset.astab)));

function goToPublicBracket() { switchScreen('tournaments'); }
function goToAdminTournaments() { switchScreen('admin'); switchAdminTab('tournaments'); }
// legacy alias (old inline handlers)
function switchView(name) { switchScreen(name === 'rankings' ? 'leaderboard' : name); }

/* ---------- auth UI ---------- */
function refreshAuthUI() {
    document.body.classList.toggle('admin-mode', isAdmin);

    const loggedOut = !currentUser;
    const noRole = currentUser && !isAdmin;

    const loginPanel = document.getElementById('admin-login-panel');
    if (loginPanel) loginPanel.hidden = !loggedOut;
    const userRow = document.getElementById('admin-user-row');
    if (userRow) {
        userRow.hidden = loggedOut;
        const emailEl = document.getElementById('admin-user-email');
        if (emailEl && currentUser) emailEl.textContent = currentUser.email || '';
    }

    applyAdminTabVisibility();

    if (typeof updateTournamentAuthUI === 'function') updateTournamentAuthUI();
    if (typeof render === 'function') {
        render();
        if (isAdmin && typeof renderQueue === 'function') renderQueue();
    }
    if (typeof renderRoles === 'function') renderRoles();
}

function loadRoleAndFinish(user) {
    db.ref('admins/' + user.uid).once('value').then(snap => {
        const rec = snap.val();
        if (rec && rec.role) {
            userRole = rec.role;
            isAdmin = true;
            refreshAuthUI();
            startPendingWatcher();
        } else {
            // bootstrap: the very first admin login becomes the owner
            return db.ref('admins').once('value').then(all => {
                if (!all.exists()) {
                    return db.ref('admins/' + user.uid).set({
                        email: user.email || '', role: 'owner', createdAt: Date.now()
                    }).then(() => {
                        userRole = 'owner';
                        isAdmin = true;
                        if (typeof showToast === 'function') showToast('Welcome — you are the club owner.');
                        refreshAuthUI();
                        startPendingWatcher();
                    });
                }
                userRole = null;
                isAdmin = false;
                refreshAuthUI();
            });
        }
    }).catch(e => {
        console.error('role load failed:', e);
        userRole = null;
        isAdmin = false;
        refreshAuthUI();
    });
}

firebase.auth().onAuthStateChanged((user) => {
    currentUser = user || null;
    if (!user) {
        userRole = null;
        isAdmin = false;
        stopPendingWatcher();
        // don't strand the user on a hidden admin screen
        const adminScreen = document.getElementById('screen-admin');
        if (adminScreen && !adminScreen.hidden) switchScreen('leaderboard');
        refreshAuthUI();
        return;
    }
    loadRoleAndFinish(user);
});

/* ---------- login / logout (Admin screen) ---------- */
function loginAdmin() {
    const emailEl = document.getElementById('admin-email');
    const pwdEl = document.getElementById('admin-pwd');
    const email = emailEl ? emailEl.value : '';
    const pwd = pwdEl ? pwdEl.value : '';
    firebase.auth().signInWithEmailAndPassword(email, pwd)
        .then(() => { if (pwdEl) pwdEl.value = ''; })
        .catch((error) => alert('Login failed: ' + error.message));
}
let authMode = 'login';
function toggleAuthMode(e) {
    if (e) e.preventDefault();
    authMode = authMode === 'login' ? 'signup' : 'login';
    const btn = document.getElementById('admin-auth-btn');
    const link = document.getElementById('auth-toggle-link');
    if (btn) {
        btn.textContent = authMode === 'login' ? 'Login' : 'Create Account';
        btn.onclick = authMode === 'login' ? loginAdmin : signupAdmin;
    }
    if (link) link.textContent = authMode === 'login' ? 'New here? Create an account' : 'Already have an account? Log in';
}
function signupAdmin() {
    const emailEl = document.getElementById('admin-email');
    const pwdEl = document.getElementById('admin-pwd');
    const email = emailEl ? emailEl.value.trim() : '';
    const pwd = pwdEl ? pwdEl.value : '';
    if (!email || pwd.length < 6) { alert('Enter an email and a password (6+ characters).'); return; }
    firebase.auth().createUserWithEmailAndPassword(email, pwd)
        .then(() => {
            if (pwdEl) pwdEl.value = '';
            if (typeof showToast === 'function') showToast('Account created — tap Request Admin Access.');
        })
        .catch((error) => alert('Sign-up failed: ' + error.message));
}
function wipeTestData() {
    if (!can('data')) { alert('Owner only.'); return; }
    if (!confirm('WIPE ALL TEST DATA?\n\nThis clears players, pending approvals, match history and tournaments. Admins and access requests are kept. This cannot be undone.')) return;
    if (!confirm('Last chance — really wipe everything and start fresh?')) return;
    const wipes = ['players', 'pending', 'history', 'tournaments', 'meta'].map(k => db.ref(k).remove());
    Promise.all(wipes).then(() => {
        if (typeof showToast === 'function') showToast('Database wiped — fresh start. Player IDs restart at #1.');
        location.reload();
    }).catch(e => alert('Wipe failed: ' + e.message));
}
function logoutUser() {
    firebase.auth().signOut().catch(e => alert('Logout failed: ' + e.message));
}

/* ---------- access requests & role management (owner) ---------- */
function requestAdminAccess() {
    if (!currentUser) return;
    db.ref('adminRequests/' + currentUser.uid).set({
        email: currentUser.email || '', requestedAt: Date.now()
    }).then(() => {
        if (typeof showToast === 'function') showToast('Request sent to the club owner.');
    }).catch(e => alert('Request failed: ' + e.message));
}

function renderRoles() {
    if (!can('roles')) return;
    const listEl = document.getElementById('roles-list');
    const reqEl = document.getElementById('access-requests');
    if (!listEl || !reqEl) return;

    db.ref('admins').once('value').then(snap => {
        const admins = snap.val() || {};
        const uids = Object.keys(admins);
        listEl.innerHTML = uids.length ? uids.map(uid => {
            const a = admins[uid];
            const self = currentUser && uid === currentUser.uid;
            const opts = ['owner', 'admin', 'director'].map(r =>
                `<option value="${r}"${a.role === r ? ' selected' : ''}>${r}</option>`).join('');
            return `<div class="role-row">
                <span class="role-email">${a.email || uid}</span>
                <select onchange="setUserRole('${uid}', this.value)"${self ? ' disabled' : ''}>${opts}</select>
                ${self ? '<span class="muted">(you)</span>' : '<button class="uha-btn-outline btn-sm" onclick="removeUserRole(\'' + uid + '\')">Remove</button>'}
            </div>`;
        }).join('') : '<p class="muted">No admins yet.</p>';
    }).catch(e => console.error(e));

    db.ref('adminRequests').once('value').then(snap => {
        const reqs = snap.val() || {};
        const uids = Object.keys(reqs);
        reqEl.innerHTML = uids.length ? uids.map(uid => {
            const r = reqs[uid];
            return `<div class="role-row">
                <span class="role-email">${r.email || uid}</span>
                <span>
                    <button class="uha-btn-blue btn-sm" onclick="approveRequest('${uid}', 'director')">Director</button>
                    <button class="uha-btn-blue btn-sm" onclick="approveRequest('${uid}', 'admin')">Admin</button>
                    <button class="uha-btn-outline btn-sm" onclick="denyRequest('${uid}')">Deny</button>
                </span>
            </div>`;
        }).join('') : '<p class="muted">No pending requests.</p>';
    }).catch(e => console.error(e));
}

function setUserRole(uid, role) {
    if (!can('roles')) return;
    db.ref('admins/' + uid + '/role').set(role).then(renderRoles)
        .catch(e => alert('Failed: ' + e.message));
}
function removeUserRole(uid) {
    if (!can('roles')) return;
    if (!confirm('Remove this admin?')) return;
    db.ref('admins/' + uid).remove().then(renderRoles)
        .catch(e => alert('Failed: ' + e.message));
}
function approveRequest(uid, role) {
    if (!can('roles')) return;
    db.ref('adminRequests/' + uid).once('value').then(snap => {
        const r = snap.val() || {};
        return db.ref('admins/' + uid).set({
            email: r.email || '', role: role, createdAt: Date.now()
        }).then(() => db.ref('adminRequests/' + uid).remove());
    }).then(renderRoles).catch(e => alert('Failed: ' + e.message));
}
function denyRequest(uid) {
    if (!can('roles')) return;
    db.ref('adminRequests/' + uid).remove().then(renderRoles)
        .catch(e => alert('Failed: ' + e.message));
}
