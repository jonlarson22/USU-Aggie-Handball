/* Rankings half — ported from Utah-Handball/app.js (Phase 1 merge).
   Shared Firebase/auth now live in js/core.js. */

let players = [];
let history = [];

/* players arrive from the shared store in core.js */
onPlayersUpdate((arr) => { players = arr; render(); if (isAdmin) renderQueue(); });
let pending = [];	
let mode = 'singles';	
let currentView = 'singles';
let h2hMode = 'singles';
let currentPage = 1;
const rowsPerPage = 20;

db.ref('/').on('value', (snapshot) => {
    const data = snapshot.val();
    if (data) {
        history = data.history || [];
        
        const pendingData = data.pending || {};
        pending = Object.keys(pendingData).map(key => ({
            ...pendingData[key],
            firebaseKey: key
        }));
        
        render(); 
        if (isAdmin) renderQueue();
        
        if (typeof setConnectionStatus === 'function') setConnectionStatus(true);
    } else {
        render();
    }
}, (error) => {
    console.error("Firebase Load Failed:", error);
    if (typeof setConnectionStatus === 'function') setConnectionStatus(false);
});

	function setView(v) { 
    currentView = v;
    currentPage = 1;
    
    const btnS = document.getElementById('vS');
    const btnD = document.getElementById('vD');
    if (btnS) btnS.classList.toggle('active-tab', v === 'singles');
    if (btnD) btnD.classList.toggle('active-tab', v === 'doubles');
    
    filterTable();
}

    function setMode(m) { 
    mode = m; 
    document.getElementById('tS').classList.toggle('active-tab', m === 'singles');
    document.getElementById('tD').classList.toggle('active-tab', m === 'doubles');
    document.querySelectorAll('.d-only').forEach(e => e.classList.toggle('hidden', m === 'singles'));
    
    if (m === 'singles') {
        const w2 = document.getElementById('w2');
        const l2 = document.getElementById('l2');
        if (w2) w2.value = "0";
        if (l2) l2.value = "0";
    }
}

function setH2HMode(m) {
    h2hMode = m;
    document.getElementById('h2hTS').classList.toggle('active-tab', m === 'singles');
    document.getElementById('h2hTD').classList.toggle('active-tab', m === 'doubles');
    runH2H(); 
}

function showToast(message, isError = false, onClick = null) {
    const toast = document.getElementById('toast');
    toast.innerText = message;
    toast.style.background = isError ? "#e74c3c" : "#2ecc71";
    toast.style.cursor = onClick ? "pointer" : "default";
    toast.onclick = onClick || (() => {});
    
    toast.style.display = "block";
    setTimeout(() => { 
        toast.style.opacity = "1"; 
        toast.style.top = "20px";
    }, 10);

    setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.top = "-50px";
        setTimeout(() => { toast.style.display = "none"; }, 300);
    }, 3000);
}

function addPlayer() {
    const firstN = document.getElementById('addFirst').value.trim();
    const lastN = document.getElementById('addLast').value.trim();
    const isMem = document.getElementById('addMember').checked;
    if(!firstN && !lastN) return;
    getNextPlayerId().then(id => {
        players.push({
            id: id, firstName: firstN, lastName: lastN, singles: 1000, doubles: 1000,
            baseS: 1000, baseD: 1000, peakS: 1000, peakD: 1000,
            active: true, isMember: isMem
        });
        save();
        document.getElementById('addFirst').value = '';
        document.getElementById('addLast').value = '';
        filterTable();
        if (typeof showToast === 'function') showToast(`Player added — ID #${id}`);
    }).catch(e => alert('Could not assign a player ID: ' + e.message));
}

function loadEditData() {
    const p = players.find(x => x.id == document.getElementById('editList').getSelectedId());
    if(p) { 
        document.getElementById('editFirst').value = p.firstName || ''; 
        document.getElementById('editLast').value = p.lastName || ''; 
        document.getElementById('editS').value = p.singles; 
        document.getElementById('editD').value = p.doubles;
        const memberEl = document.getElementById('editMember');
        if (memberEl) memberEl.checked = p.isMember !== false;
    }
}

    function updatePlayer() {
    const p = players.find(x => x.id == document.getElementById('editList').getSelectedId());
    const newFirst = document.getElementById('editFirst').value.trim();
    const newLast = document.getElementById('editLast').value.trim();
    
    if(p && (newFirst || newLast)) { 
        p.firstName = newFirst;
        p.lastName = newLast; 
        p.isMember = document.getElementById('editMember').checked;
        
        const inputS = parseFloat(document.getElementById('editS').value);
        const inputD = parseFloat(document.getElementById('editD').value);

        if(!isNaN(inputS) && inputS !== p.singles) {
            (p.adjustments = p.adjustments || []).push({ t: Date.now(), mode: 'singles', from: p.singles, to: inputS });
            p.singles = inputS; p.baseS = inputS; p.peakS = inputS;
        }
        if(!isNaN(inputD) && inputD !== p.doubles) {
            (p.adjustments = p.adjustments || []).push({ t: Date.now(), mode: 'doubles', from: p.doubles, to: inputD });
            p.doubles = inputD; p.baseD = inputD; p.peakD = inputD;
        }
        save(); 
        showToast("Player updated!"); 
    }
}

    function processMatch() {
    const w1ID = document.getElementById('w1').getSelectedId();
    const w2ID = document.getElementById('w2').getSelectedId();
    const l1ID = document.getElementById('l1').getSelectedId();
    const l2ID = document.getElementById('l2').getSelectedId();
    
    const activeMode = mode || 'singles';
    let games = [];

    for(let i=1; i<=3; i++) { 
        const wVal = parseInt(document.getElementById(`g${i}_w`).value);
        const lVal = parseInt(document.getElementById(`g${i}_l`).value);
        if(!isNaN(wVal) && !isNaN(lVal)) {
            games.push({w: wVal, l: lVal});
        }
    }
    
    let rawWinners = activeMode === 'singles' ? [w1ID] : [w1ID, w2ID];
	let rawLosers = activeMode === 'singles' ? [l1ID] : [l1ID, l2ID];

    // Empty-string select values (a re-render can drop the selection) become 0
    // via Number("") - filter those before they can reach the queue as id 0.
    const toIds = arr => arr.filter(id => id !== "0" && id !== "" && id != null).map(Number).filter(n => n > 0);
    const winners = toIds(rawWinners);
	const losers = toIds(rawLosers);

    if (winners.length === 0 || losers.length === 0 || games.length === 0) {
        return alert("Please select players and enter scores.");
    }

    if (isAdmin) {
        calculateAndAddMatch(activeMode, winners, losers, games);
        save();
        if (editingPendingKey) {
            db.ref(`pending/${editingPendingKey}`).remove()
                .catch(err => console.error("Error removing edited match:", err));
            editingPendingKey = null;
            const banner = document.getElementById('edit-pending-banner');
            if (banner) banner.style.display = 'none';
        }
        showToast("Match recorded and rankings updated!");
    } else {
        db.ref('pending').push({
            id: Date.now(),
            mode: activeMode,
            winners: winners,
            losers: losers,
            games: games,
            submittedAt: new Date().toISOString()
        });
        showToast("Match submitted for review!");
    }

    ['g1_w','g2_w','g3_w','g1_l','g2_l','g3_l'].forEach(id => {
        const el = document.getElementById(id);
        if(el) el.value = '';
    });
}
function calculateAndAddMatch(activeMode, winners, losers, games) {
    const winObjs = players.filter(p => winners.some(wId => wId == p.id));
    const lossObjs = players.filter(p => losers.some(lId => lId == p.id));

    if (winObjs.length === 0 || lossObjs.length === 0) {
        console.error("Math Engine Error: Could not find players for IDs:", winners, losers);
        return;
    }

    let setsW = 0, setsL = 0, tW = 0, tL = 0;
    games.forEach(g => {
        tW += g.w; tL += g.l;
        if(g.w > g.l) setsW++; else setsL++;
    });

    const avgW = winObjs.reduce((a, b) => a + (b[activeMode] || 1000), 0) / winObjs.length;
    const avgL = lossObjs.reduce((a, b) => a + (b[activeMode] || 1000), 0) / lossObjs.length;
    const baseGain = 15 * (Math.pow((tW - tL + 24), 0.7) / (7.5 + (0.01 * (avgW - avgL))));
    
    let impactMap = {}; 
    let peakKey = activeMode === 'singles' ? 'peakS' : 'peakD';
    let oldPeaks = {};

    [...winObjs, ...lossObjs].forEach(p => { oldPeaks[p.id] = p[peakKey] || 1000; });

    winObjs.forEach(p => {
        let ratio = activeMode === 'doubles' ? (p[activeMode] / (avgW * winObjs.length)) * 2 : 1;
        let pts = Math.round((baseGain * Math.min(1.25, Math.max(0.75, ratio))) * 10) / 10;
        p[activeMode] = Math.round((p[activeMode] + pts) * 10) / 10;
        if (p[activeMode] > (p[peakKey] || 0)) p[peakKey] = p[activeMode];
        impactMap[p.id] = pts;
    });

    lossObjs.forEach(p => {
        let ratio = activeMode === 'doubles' ? (p[activeMode] / (avgL * lossObjs.length)) * 2 : 1;
        let pts = Math.round((baseGain * Math.min(1.25, Math.max(0.75, ratio))) * 10) / 10;
        p[activeMode] = Math.round((p[activeMode] - pts) * 10) / 10;
        impactMap[p.id] = -pts;
    });

    history.unshift({
        id: Date.now(),
        playedAt: Date.now(),
        mode: activeMode,
        winners, losers,
        score: `${setsW}-${setsL}`,
        detailedGames: games,
        impacts: impactMap,
        oldPeaks: oldPeaks
    });
}

function resolvePlayerId(input) {
    if (!isNaN(input) && Number(input) > 0) return Number(input);

    if (typeof input === 'string') {
        const found = players.find(p => p.name.toLowerCase() === input.trim().toLowerCase());
        return found ? found.id : 0;
    }
 
    if (typeof input === 'object' && input !== null && input.name) {
        const found = players.find(p => p.name.toLowerCase() === input.name.trim().toLowerCase());
        return found ? found.id : 0;
    }
    
    return 0;
}

let historyMode = 'singles';
function setHistoryMode(mode) {
    historyMode = mode;
    const ts = document.getElementById('histTS');
    const td = document.getElementById('histTD');
    if (ts) ts.classList.toggle('active-tab', mode === 'singles');
    if (td) td.classList.toggle('active-tab', mode === 'doubles');
    render();
}

function renderQueue() {
    const queueEl = document.getElementById('adminQueue');
    if (!queueEl) return;
    
    // Directors only see tournament submissions (those with bracketRef)
    const isDirectorOnly = (typeof can === 'function' && !can('review') && can('review-tournaments'));
    const visiblePending = isDirectorOnly ? pending.filter(m => m.bracketRef) : pending;
    
    if (visiblePending.length === 0) {
        queueEl.innerHTML = isDirectorOnly ? "<p style='color:var(--text-muted);'>No tournament submissions pending.</p>" : "";
        return;
    }

    let html = `<h2 style="color: #f1c40f; border-bottom: 1px solid #f1c40f; padding-bottom: 10px;">⚠️ Pending Approvals (${visiblePending.length})</h2>`;
    
    visiblePending.forEach((m, index) => {
        const nameOf = (w) => {
            const id = resolvePlayerId(w);
            const hit = players.find(p => p.id == id);
            return hit ? hit.name : `Unknown (#${id})`;
        };
        const wNames = (m.winners || []).map(nameOf).join('/');
        const lNames = (m.losers || []).map(nameOf).join('/');

        const gamesList = m.games || m.detailedGames || [];
        const scoreStr = gamesList.map(g => `${g.w}-${g.l}`).join(', ');
        const displayMode = (m.mode || 'singles').toUpperCase();
        
        const isTourney = !!(m.bracketRef && m.source);
        const tourneyTag = isTourney
            ? `<div style="font-size:11px;color:var(--uha-gold);margin-bottom:4px;">\uD83C\uDFC6 ${m.source === 'live' ? 'Live scored' : 'Entered'} — ${m.bracketRef.divName || 'Event'} · ${m.bracketRef.roundLabel || ''}${m.keeper ? ` · scored by ${m.keeper}` : ''}</div>`
            : '';
        const approveFn = isTourney ? `approveLiveMatchById(${m.id})` : `approveMatchById(${m.id})`;
        html += `
    <div class="queue-item">
        ${tourneyTag}
        <div class="queue-matchup">${wNames} <span class="vs">def.</span> ${lNames}</div>
        <div class="queue-scores">Scores: ${scoreStr} | <span>${displayMode}</span></div>
        <div class="queue-actions">
            <button class="qa-approve" onclick="${approveFn}">APPROVE</button>
            <button class="qa-review" onclick="reviewSub(${index})">REVIEW/EDIT</button>
            <button class="qa-reject" onclick="rejectSubById(${m.id})">REJECT</button>
        </div>
    </div>`;
    });
    queueEl.innerHTML = html;
}

function approveMatch(index) {
    const _m = pending[index];
    if (_m) return approveMatchById(_m.id);
    return;
}
function approveMatchById(id) {
    const m = pending.find(x => x.id == id);
    if (!m) return;
    const index = pending.indexOf(m);

    const winners = m.winners.map(resolvePlayerId).filter(id => id !== 0);
    const losers = m.losers.map(resolvePlayerId).filter(id => id !== 0);
    const gamesToProcess = m.games || m.detailedGames || [];
    const historyCountBefore = history.length;

    calculateAndAddMatch(m.mode || 'singles', winners, losers, gamesToProcess);

    if (history.length > historyCountBefore) {
        
        const updates = {
            players: players,
            history: history
        };

        if (m.firebaseKey) {
            updates[`pending/${m.firebaseKey}`] = null; 
        }

        db.ref('/').update(updates).then(() => {
            showToast("Match Approved!");
        }).catch(err => {
            console.error("Firebase Sync Failed:", err);
            alert("Error syncing to database.");
        });

        localStorage.setItem('hbFullP', JSON.stringify(players));
        localStorage.setItem('hbFullH', JSON.stringify(history));
        
    } else {
        alert("Error: Match could not be processed.");
    }
}

let editingPendingKey = null;
function reviewSub(index) {
    const m = pending[index];
    if (!m) return;

    // stash the key — the old entry is only removed AFTER a successful resubmit
    editingPendingKey = m.firebaseKey || null;
    const banner = document.getElementById('edit-pending-banner');
    if (banner) banner.style.display = 'block';

    setMode(m.mode || 'singles');

    ['g1_w','g1_l','g2_w','g2_l','g3_w','g3_l'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = "";
    });

    const mappedWinners = (m.winners || []).map(resolvePlayerId);
    const mappedLosers = (m.losers || []).map(resolvePlayerId);

    document.getElementById('w1').setSelectedId(mappedWinners[0] || "");
    document.getElementById('l1').setSelectedId(mappedLosers[0] || "");

    if ((m.mode || 'singles') === 'doubles') {
        document.getElementById('w2').setSelectedId(mappedWinners[1] || "");
        document.getElementById('l2').setSelectedId(mappedLosers[1] || "");
    }

    const gamesList = m.games || m.detailedGames || [];
    if (gamesList && Array.isArray(gamesList)) {
        gamesList.forEach((g, i) => {
            const num = i + 1;
            const wInput = document.getElementById(`g${num}_w`);
            const lInput = document.getElementById(`g${num}_l`);
            if (wInput) wInput.value = g.w;
            if (lInput) lInput.value = g.l;
        });
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
    showToast("Match loaded for editing. Submit to save, or Cancel to keep the original.");
}

window.cancelPendingEdit = function() {
    editingPendingKey = null;
    const banner = document.getElementById('edit-pending-banner');
    if (banner) banner.style.display = 'none';
    ['g1_w','g1_l','g2_w','g2_l','g3_w','g3_l'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    showToast('Edit cancelled — the original is still in the queue.');
};

function approveLiveMatch(index) {
    const _m = pending[index];
    if (_m) return approveLiveMatchById(_m.id);
    return;
}
function approveLiveMatchById(id) {
    const m = pending.find(x => x.id == id);
    if (!m || !m.bracketRef) return;
    const ref = m.bracketRef;

    // the bracket may have changed since scoring — validate the slot
    const div = (lockedDivisions || [])[ref.divIdx];
    const br = div ? (ref.bType === 'finals' ? div.finalsBracket
        : ref.bType === 'losers' ? div.losersBracket
        : ref.bType === 'third_place' ? div.thirdPlaceMatch : div.bracket) : null;
    const match = br && br[ref.rIdx] && br[ref.rIdx][ref.mIdx];

    if (!div || !match || !match.p1 || !match.p2) {
        return alert('That bracket slot no longer exists (the tournament changed since this was scored). Reject this entry or re-enter the result.');
    }
    const idsEq = (a, b) => JSON.stringify((a || []).map(Number).sort()) === JSON.stringify((b || []).map(Number).sort());
    const slotOk = (idsEq((match.p1.ids || []), ref.p1Ids) && idsEq((match.p2.ids || []), ref.p2Ids))
        || (idsEq((match.p1.ids || []), ref.p2Ids) && idsEq((match.p2.ids || []), ref.p1Ids));
    if (!slotOk) {
        const cur = `${match.p1.name} vs ${match.p2.name}`;
        const was = `${ref.p1Name} vs ${ref.p2Name}`;
        if (!confirm(`The bracket has changed since this was scored.\nWas: ${was}\nNow: ${cur}\n\nApply the scores to the current matchup anyway?`)) return;
    }

    // rebuild game scores in side perspective (p1/p2) from the queued result
    const wIds = (m.winners || []).map(Number);
    let wIsP1 = idsEq((match.p1.ids || []), wIds);
    if (!wIsP1 && !idsEq((match.p2.ids || []), wIds)) {
        // winners match neither current slot — fall back to the stored order
        wIsP1 = idsEq(ref.p1Ids || [], wIds);
    }
    const gameScores = (m.games || []).map(g => wIsP1 ? { p1: g.w, p2: g.l } : { p1: g.l, p2: g.w });

    if (typeof finalizeBracketScore === 'function' && finalizeBracketScore(ref.divIdx, ref.rIdx, ref.mIdx, ref.bType, gameScores)) {
        if (m.firebaseKey) db.ref(`pending/${m.firebaseKey}`).remove().catch(() => {});
        else pending.splice(index, 1);
        if (typeof renderQueue === 'function') renderQueue();
    }
}

function rejectSub(index) {
    const _m = pending[index];
    if (_m) return rejectSubById(_m.id);
    return;
}
function rejectSubById(id) {
    const m = pending.find(x => x.id == id);
    if (!m) return;

    if (confirm("Permanently delete this submission?")) {
        if (m.firebaseKey) {
            db.ref(`pending/${m.firebaseKey}`).remove()
                .then(() => console.log("Match rejected."))
                .catch((error) => console.error("Rejection failed:", error));
        }
    }
}
	
function runH2H() {
    const idA = document.getElementById('h2hA').getSelectedId();
    const idB = document.getElementById('h2hB').getSelectedId();
    
    if (idA === "0" || idB === "0" || idA === idB) { 
        document.getElementById('h2hResults').style.display = 'none'; 
        return; 
    }
    
    let winsA = 0, winsB = 0, total = 0, recentHTML = "";
    
    history.forEach(m => {
        console.log("Checking match:", m.mode, "against", h2hMode);
    	if (m.mode !== h2hMode) return; 

        const aInW = m.winners.some(id => id == idA);
        const aInL = m.losers.some(id => id == idA);
        const bInW = m.winners.some(id => id == idB);
        const bInL = m.losers.some(id => id == idB);
        
        if ((aInW && bInL) || (aInL && bInW)) {
            total++;
            if (aInW) winsA++; else winsB++;
            
           if (total <= 10) {
    const isDoubles = m.mode === 'doubles';
    const wNames = m.winners.map(id => players.find(x => x.id == id)?.name || "??").join('/');
    const lNames = m.losers.map(id => players.find(x => x.id == id)?.name || "??").join('/');

    const isFirst = (total === 1);

    let matchupHTML = "";
    if (isDoubles) {
        matchupHTML = `
            <div style="line-height: 1.2;">
                <div style="color: #2ecc71;">${wNames}</div>
                <div style="font-size: 9px; color: #666; margin: 2px 0;">— VS —</div>
                <div style="color: #e74c3c;">${lNames}</div>
            </div>`;
    } else {
        matchupHTML = `
            <span style="color: #2ecc71;">${wNames}</span> 
            <small style="color:#666; margin: 0 4px;">vs</small> 
            <span style="color: #e74c3c;">${lNames}</span>`;
    }

    const h2hTs = m.playedAt || m.id;
    const h2hDate = h2hTs ? new Date(h2hTs).toLocaleDateString('en-US', {month: 'numeric', day: 'numeric', year: '2-digit'}) : '';
    recentHTML += `
        <div class="h2h-recent-item" style="display: flex; justify-content: space-between; align-items: center; 
            padding: ${isFirst ? '0 0 10px 0' : '10px 0'}; 
            ${isFirst ? '' : 'border-top: 1px solid #333;'}">
            <div style="font-size: 10px; color: #fff; min-width: 48px; text-align: center; white-space: nowrap;">${h2hDate}</div>
            <div style="font-size: 11px; flex: 1; padding: 0 8px;">${matchupHTML}</div>
            <div style="text-align: right; min-width: 60px;">
                <div style="font-weight: bold; color: #fff;">${m.score}</div>
                <div style="font-size: 10px; color: #888;">${getGameString(m)}</div>
            </div>
        </div>`;
			}
        }
    });

    document.getElementById('h2hResults').style.display = 'block';
    document.getElementById('h2hNameA').innerText = players.find(x => x.id == idA)?.name || "--";
    document.getElementById('h2hNameB').innerText = players.find(x => x.id == idB)?.name || "--";
    document.getElementById('h2hWinsA').innerText = winsA;
    document.getElementById('h2hWinsB').innerText = winsB;
    document.getElementById('h2hTotal').innerText = total;
    document.getElementById('h2hRecent').innerHTML = recentHTML || `No ${h2hMode} matches found.`;
}

function exportFullData() {
    const now = new Date();
    const fileName = `handball_backup_${now.toISOString().split('T')[0]}.json`;
    const blob = new Blob([JSON.stringify({ players, history, pending, meta: { nextPlayerId: (players || []).reduce((m, p) => Math.max(m, Number(p.id) || 0), 0) + 1 } })], { type: 'application/json' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = fileName;
    link.click();
}
	
function getGameString(match) {
    if (!match.detailedGames) return ""; 
    return `(${match.detailedGames.map(g => `${g.w}-${g.l}`).join(', ')})`;
}

function importFullData(e) {
    const reader = new FileReader();
    reader.onload = (ev) => {
        try {
            const data = JSON.parse(ev.target.result);
            players = normalizePlayers(data.players);
            history = data.history || [];
            pending = data.pending || [];
            save();
            if (typeof syncPlayerIdCounter === 'function') syncPlayerIdCounter(players);
            showToast("Import complete!");
        } catch(err) { alert("Invalid file."); }
    };
    reader.readAsText(e.target.files[0]);
}

    function undoMatch(id) {
    if(!confirm("Delete this match? This will recalculate the entire history using individual player baselines to ensure all ELO shifts are accurate.")) return;

    history = history.filter(m => m.id !== id);

    players.forEach(p => {
        p.singles = p.baseS || 1000;
        p.doubles = p.baseD || 1000;
        
        p.peakS = p.singles;
        p.peakD = p.doubles;
    });

    const chronologicalHistory = [...history].reverse();

    chronologicalHistory.forEach(match => {
        recalculateSingleMatch(match);
    });

    save();
}

function recalculateSingleMatch(m) {
    const activeMode = m.mode || 'singles';
    const peakKey = activeMode === 'singles' ? 'peakS' : 'peakD';

    const winObjs = players.filter(p => m.winners.some(id => id == p.id));
	const lossObjs = players.filter(p => m.losers.some(id => id == p.id));

    if (winObjs.length === 0 || lossObjs.length === 0) return;

    let tW = 0, tL = 0;
    if (m.detailedGames) {
        m.detailedGames.forEach(g => { tW += g.w; tL += g.l; });
    }

    const avgW = winObjs.reduce((a, b) => a + (b[activeMode] || 1000), 0) / winObjs.length;
    const avgL = lossObjs.reduce((a, b) => a + (b[activeMode] || 1000), 0) / lossObjs.length;

    const baseGain = 15 * (Math.pow((tW - tL + 24), 0.7) / (7.5 + (0.01 * (avgW - avgL))));

    let newImpacts = {};

    winObjs.forEach(p => {
        let ratio = activeMode === 'doubles' ? (p[activeMode] / (avgW * winObjs.length)) * 2 : 1;
        let pts = Math.round((baseGain * Math.min(1.25, Math.max(0.75, ratio))) * 10) / 10;
        
        p[activeMode] = Math.round((p[activeMode] + pts) * 10) / 10;
        
        if (p[activeMode] > (p[peakKey] || 0)) p[peakKey] = p[activeMode];
        newImpacts[p.id] = pts;
    });

    lossObjs.forEach(p => {
        let ratio = activeMode === 'doubles' ? (p[activeMode] / (avgL * lossObjs.length)) * 2 : 1;
        let pts = Math.round((baseGain * Math.min(1.25, Math.max(0.75, ratio))) * 10) / 10;
        
        p[activeMode] = Math.round((p[activeMode] - pts) * 10) / 10;
        newImpacts[p.id] = -pts;
    });

    m.impacts = newImpacts;
}

	function save() {
    localStorage.setItem('hbFullP', JSON.stringify(players));
    localStorage.setItem('hbFullH', JSON.stringify(history));

    if (isAdmin) {
        console.log("Attempting Firebase Sync...");
        db.ref('/').update({
            players: players,
            history: history
        }).then(() => {
            console.log("Firebase Sync Success ✅");
        }).catch(err => {
            console.error("Firebase Sync FAILED ❌:", err);
        });
    }
    render();
    runH2H();
}

    function filterTable() {
    const searchInput = document.getElementById('playerSearch');
    const body = document.getElementById('leaderboardBody');
    const controls = document.getElementById('paginationControls');
    if (!body || !searchInput) return;

    const searchTerm = searchInput.value.toLowerCase();
    const view = currentView; 
    const peakKey = view === 'singles' ? 'peakS' : 'peakD';

    const globalRanked = [...players]
        .filter(p => !p.hidden && p.isMember !== false)
        .sort((a, b) => (b[view] || 1000) - (a[view] || 1000))
        .map((p, index) => {
            p.trueRank = index + 1;
            return p;
        });

    let filtered = globalRanked.filter(p => {
        const hay = [p.name, p.firstName, p.lastName, ((p.firstName||'')+' '+(p.lastName||'')).trim()]
            .filter(Boolean).join(' ').toLowerCase();
        return hay.includes(searchTerm);
    });

    const totalPages = Math.ceil(filtered.length / rowsPerPage) || 1;
    const start = (currentPage - 1) * rowsPerPage;
    const paginatedItems = filtered.slice(start, start + rowsPerPage);

    body.innerHTML = paginatedItems.map((p) => `
        <tr onclick="openReport(${p.id})" style="cursor:pointer;" title="View player report">
            <td style="text-align: center; padding: 10px;">#${p.trueRank}</td>
            <td style="text-align: left; font-weight: 500; padding: 10px;">${p.name}</td>
            <td style="text-align: center; font-weight: bold; padding: 10px;">${Math.round(p[view] || 1000)}</td>
            <td style="text-align: center; color: #f1c40f; padding: 10px;">${Math.round(p[peakKey] || p[view] || 1000)}</td>
        </tr>
    `).join('');

    if (controls) {
        if (totalPages <= 1) {
            controls.innerHTML = '';
        } else {
            controls.innerHTML = `
                <button onclick="changePage(-1)" ${currentPage === 1 ? 'disabled' : ''} style="width:auto; padding: 8px 15px;">Prev</button>
                <span style="color: #888; font-size: 13px;">Page ${currentPage} of ${totalPages}</span>
                <button onclick="changePage(1)" ${currentPage === totalPages ? 'disabled' : ''} style="width:auto; padding: 8px 15px;">Next</button>
            `;
        }
    }
		console.log("Table rendered successfully.");
}
  
function changePage(step) {
    currentPage += step;
    filterTable();
}

function changeStatus(hide) {
    const pID = document.getElementById('manageList').getSelectedId();
    const p = players.find(x => x.id == pID);
    if (pID === "0") return alert("Select a player.");
    
    p.hidden = hide;
    save();
    showToast(`${p.name} is now ${hide ? 'Retired' : 'Active'}!`);
}

function loadPlayer() {
    const selectedID = document.getElementById('editList').getSelectedId();
    const p = players.find(x => x.id == selectedID);

    if(p) {
        document.getElementById('editN').value = p.name;
        document.getElementById('editS').value = p.singles || 1000;
        document.getElementById('editD').value = p.doubles || 1000;
        document.getElementById('editMember').checked = p.isMember !== false; 
    } else {
        document.getElementById('editN').value = "";
        document.getElementById('editS').value = "";
        document.getElementById('editD').value = "";
    }
}

function render() {
    filterTable(); 

    // Initialize searchable player inputs (preserve selections)
    ['w1','w2','l1','l2'].forEach(id => {
        const el = document.getElementById(id);
        if (el && el.getSelectedId) {
            const cur = el.getSelectedId();
            makePlayerSearchable(id, id + '-list');
            if (cur) el.setSelectedId(cur);
        } else if (el) {
            makePlayerSearchable(id, id + '-list');
        }
    });
    ['h2hA','h2hB'].forEach(id => {
        const el = document.getElementById(id);
        if (el && el.getSelectedId) {
            const cur = el.getSelectedId();
            makePlayerSearchable(id, id + '-list', () => runH2H());
            if (cur) el.setSelectedId(cur);
        } else if (el) {
            makePlayerSearchable(id, id + '-list', () => runH2H());
        }
    });
    const repOpp = document.getElementById('report-opp');
    if (repOpp && !repOpp.getSelectedId) {
        makePlayerSearchable('report-opp', 'report-opp-list', () => renderReport());
    }

    // Searchable for edit/manage (preserve selections)
    [['editList', () => loadEditData()], ['manageList', null]].forEach(([id, cb]) => {
        const el = document.getElementById(id);
        if (el && el.getSelectedId) {
            const cur = el.getSelectedId();
            makePlayerSearchable(id, id + '-list', cb);
            if (cur) el.setSelectedId(cur);
        } else if (el) {
            makePlayerSearchable(id, id + '-list', cb);
        }
    });

    const historyBody = document.querySelector('#historyTable tbody');
    if (historyBody) {
        const hq = ((document.getElementById('historySearch') || {}).value || '').trim().toLowerCase();
        const hlist = history
            .filter(m => (m.mode || 'singles') === historyMode)
            .filter(m => {
                if (!hq) return true;
                const names = [...(m.winners || []), ...(m.losers || [])].map(id => {
                    const p = players.find(x => x.id == id);
                    if (!p) return '';
                    // Search display name, first, last, and full name
                    return [p.name, p.firstName, p.lastName, ((p.firstName||'')+' '+(p.lastName||'')).trim()]
                        .filter(Boolean).join(' ').toLowerCase();
                }).join(' ');
                return names.includes(hq);
            });
        if (!hlist.length) {
            historyBody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 20px;" class="muted">No ${historyMode} matches found.</td></tr>`;
        } else {
        historyBody.innerHTML = hlist.slice(0, 15).map(m => {
            const isDoubles = m.mode === 'doubles';
            
            const winNames = (m.winners || []).map(id => {
                const p = players.find(x => x.id == id);
                return p ? (p.name + (p.hidden ? ' 👻' : '')) : "Unknown";
            }).join('/');

            const lossNames = (m.losers || []).map(id => {
                const p = players.find(x => x.id == id);
                return p ? (p.name + (p.hidden ? ' 👻' : '')) : "Unknown";
            }).join('/');

            let matchupHTML = "";
            if (isDoubles) {
                matchupHTML = `
                    <div style="line-height: 1.2;">
                        <div style="color: #2ecc71;">${winNames}</div>
                        <div style="font-size: 9px; color: #666; margin: 2px 0;">— VS —</div>
                        <div style="color: #e74c3c;">${lossNames}</div>
                    </div>`;
            } else {
                matchupHTML = `<span style="color: #2ecc71; white-space:nowrap;">${winNames}</span> <small style="color:#666">vs</small> <span style="color: #e74c3c; white-space:nowrap;">${lossNames}</span>`;
            }

            let plusShifts = [];
            let minusShifts = [];
            if (m.impacts) {
                for (let pID in m.impacts) {
                    const p = players.find(x => x.id == pID);
                    const val = m.impacts[pID];
                    if (p) {
                        const html = `<span class="${val > 0 ? 'shift-plus' : 'shift-minus'}">${p.name} ${val > 0 ? '+' : ''}${val}</span>`;
                        if (val > 0) plusShifts.push(html);
                        else minusShifts.push(html);
                    }
                }
            }

            let shiftHTML = plusShifts.concat(minusShifts).join('<br>');

            const detailedScore = m.detailedGames ? 
                `<div style="font-size:10px; color:#888;">(${m.detailedGames.map(g => `${g.w}-${g.l}`).join(', ')})</div>` : 
                '';

            const dateTs = m.playedAt || m.id;
            const dateStr = dateTs ? new Date(dateTs).toLocaleDateString('en-US', {month: 'numeric', day: 'numeric', year: '2-digit'}) : '';
            return `<tr>
                <td style="font-size:11px; text-align:center; white-space:nowrap;">${dateStr}</td>
                <td style="font-size:11px">${matchupHTML}</td>
                <td style="text-align:center;">
                    <div style="font-weight:bold;">${m.score || '0-0'}</div>
                    ${detailedScore}
                </td>
                <td style="font-size:10px; white-space:nowrap;">${shiftHTML}</td>
                
                <td class="admin-only">
                    <button class="undo-btn" onclick="undoMatch(${m.id})">Delete</button>
                </td>
            </tr>`;
        }).join('');
        }
    }
    
    document.getElementById('statP').innerText = players.length;
    document.getElementById('statM').innerText = history.length;
	if (isAdmin) renderQueue();
}

/* ================= player report ================= */
let reportPlayerId = null;
let reportMode = 'singles';

function matchTime(m) { return (m && (m.playedAt || m.id)) || 0; }
function fmtDate(t) {
    if (!t) return '—';
    const d = new Date(t);
    return (d.getMonth() + 1) + '/' + d.getDate() + '/' + d.getFullYear();
}
function playerName(id) {
    const p = players.find(x => x.id == id);
    return p ? p.name : 'Unknown';
}

function openReport(playerId) {
    reportPlayerId = Number(playerId);
    reportMode = 'singles';
    const p = players.find(x => x.id == reportPlayerId);
    document.getElementById('report-player-name').textContent = p ? p.name + ' — Report' : 'Player Report';
    const fullName = p ? ((p.firstName || '') + ' ' + (p.lastName || '')).trim() || p.name : '';
    document.getElementById('report-print-title').textContent = p ? 'Player Report — ' + fullName : 'Player Report';
    updateReportRange();
    const genEl = document.getElementById('report-generated');
    if (genEl) genEl.textContent = 'Generated ' + new Date().toLocaleDateString() + ' ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const opp = document.getElementById('report-opp');
    if (opp) {
        if (!opp.getSelectedId) makePlayerSearchable('report-opp', 'report-opp-list', () => renderReport());
        opp.setSelectedId('');
        opp.value = '';
        opp.placeholder = 'All opponents';
    }
    document.getElementById('report-from').value = '';
    document.getElementById('report-to').value = '';
    setReportModeTabs();
    switchScreen('report');
    document.querySelectorAll('#app-tabs .app-tab').forEach(t =>
        t.classList.toggle('active', t.dataset.screen === 'leaderboard'));
    renderReport();
}
function closeReport() { switchScreen('leaderboard'); }
function setReportMode(mode) { reportMode = mode; setReportModeTabs(); renderReport(); }
function setReportModeTabs() {
    [['singles', 'repMS'], ['doubles', 'repMD'], ['both', 'repMB']].forEach(([k, id]) => {
        const el = document.getElementById(id);
        if (el) el.classList.toggle('active-tab', k === reportMode);
    });
}
function playerMatches(pid, mode) {
    return history
        .filter(m => (m.mode || 'singles') === mode)
        .map(m => ({ m, t: matchTime(m) }))
        .filter(x => [...(x.m.winners || []), ...(x.m.losers || [])].some(id => id == pid))
        .sort((a, b) => a.t - b.t);
}
function playerTrajectory(pid, mode, fromT, toT) {
    const p = players.find(x => x.id == pid);
    const cur = p ? Number(p[mode] || 1000) : 1000;
    let ms = playerMatches(pid, mode);
    if (fromT) ms = ms.filter(x => x.t >= fromT);
    if (toT) ms = ms.filter(x => x.t <= toT + 86399999);
    // walk back from current ELO — no assumed 1000 anchor before the first match
    const totalShift = ms.reduce((s, x) => s + (Number(x.m.impacts && x.m.impacts[pid]) || 0), 0);
    let elo = Math.round((cur - totalShift) * 10) / 10;
    const pts = [];
    if (ms.length) pts.push({ t: ms[0].t, elo });
    ms.forEach(x => {
        elo = Math.round((elo + (Number(x.m.impacts && x.m.impacts[pid]) || 0)) * 10) / 10;
        pts.push({ t: x.t, elo, m: x.m });
    });
    return { pts, ms: ms.map(x => x.m), current: cur };
}
function eloGraphSVG(seriesList) {
    const W = 620, H = 240, PL = 46, PR = 12, PT = 14, PB = 30;
    const allPts = seriesList.reduce((a, s) => a.concat(s.pts), []);
    if (!allPts.length) return '<p class="muted" style="text-align:center;">No matches in this range.</p>';
    const dataMin = Math.min(...allPts.map(p => p.elo));
    const dataMax = Math.max(...allPts.map(p => p.elo));
    const center = Math.round((dataMin + dataMax) / 2 / 50) * 50;
    const step = 150;
    let gridMin = center, gridMax = center;
    while (gridMin > dataMin - step * 0.3) gridMin -= step;
    while (gridMax < dataMax + step * 0.3) gridMax += step;
    const minE = gridMin, maxE = gridMax;
    const minT = Math.min(...allPts.map(p => p.t));
    const maxT = Math.max(...allPts.map(p => p.t));
    const X = t => PL + (maxT === minT ? (W - PL - PR) / 2 : (t - minT) / (maxT - minT) * (W - PL - PR));
    const Y = e => PT + (1 - (e - minE) / (maxE - minE)) * (H - PT - PB);
    let g = '';
    for (let e = gridMin; e <= gridMax; e += step) {
        const y = Y(e).toFixed(1);
        g += `<line class="grid-line" x1="${PL}" y1="${y}" x2="${W - PR}" y2="${y}" stroke="#333" stroke-width="1"/><text x="${PL - 6}" y="${+y + 4}" fill="#888" font-size="11" text-anchor="end">${e}</text>`;
    }
    const avgLines = seriesList.map(s => {
        if (s.avg == null) return '';
        const y = Y(s.avg).toFixed(1);
        return `<line x1="${PL}" y1="${y}" x2="${W - PR}" y2="${y}" stroke="${s.color}" stroke-width="2" stroke-dasharray="6,4" opacity="0.85"/>`;
    }).join('');
    const paths = seriesList.map(s => {
        if (!s.pts.length) return '';
        const d = s.pts.map((p, i) => (i ? 'L' : 'M') + X(p.t).toFixed(1) + ',' + Y(p.elo).toFixed(1)).join(' ');
        const dots = s.pts.filter(p => p.m).map(p => {
            const m = p.m;
            const won = (m.winners || []).some(id => id == reportPlayerId);
            const opps = [...(won ? m.losers : m.winners) || []].map(playerName).join(' / ');
            const tip = (fmtDate(p.t) + ' · ' + s.label + '\\nELO ' + Math.round(p.elo) + (opps ? '\\n' + (won ? 'W' : 'L') + ' vs ' + opps + (m.score ? ' (' + m.score + ')' : '') : '')).replace(/'/g, "\\'");
            const esc = tip.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
            return `<circle cx="${X(p.t).toFixed(1)}" cy="${Y(p.elo).toFixed(1)}" r="3.5" fill="${s.color}" style="cursor:pointer;"`
                + ` onmousemove="showGraphTip(event, &quot;${esc}&quot;)" onmouseleave="hideGraphTip()" onclick="showGraphTip(event, &quot;${esc}&quot;)"/>`;
        }).join('');
        return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2.5"/>${dots}`;
    }).join('');
    const legend = `<div style="margin-bottom:6px;font-size:13px;">` + seriesList.map(s =>
        `<span style="color:${s.color};">&#9679; ${s.label}</span>&nbsp;&nbsp;<span style="color:${s.color};">&#9472;&#9472; ${s.label} Avg</span>`).join('&nbsp;&nbsp;&nbsp;&nbsp;') + `</div>`;
    let dates = '';
    const nTicks = 5;
    for (let i = 0; i < nTicks; i++) {
        const t = minT + (maxT - minT) * i / (nTicks - 1);
        const x = X(t).toFixed(1);
        const anchor = i === 0 ? '' : (i === nTicks - 1 ? ' text-anchor="end"' : ' text-anchor="middle"');
        dates += `<text x="${x}" y="${H - 8}" fill="#888" font-size="10"${anchor}>${fmtDate(t)}</text>`;
    }
    return `${legend}<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;background:#141414;border-radius:8px;" role="img">${g}${avgLines}${paths}${dates}</svg>`;
}
function showGraphTip(e, text) {
    let tip = document.getElementById('graph-tip');
    if (!tip) {
        tip = document.createElement('div');
        tip.id = 'graph-tip';
        tip.style.cssText = 'position:fixed;z-index:9999;background:#000;border:1px solid #555;color:#fff;font-size:12px;padding:8px 10px;border-radius:6px;pointer-events:none;white-space:pre-line;max-width:220px;box-shadow:0 2px 8px rgba(0,0,0,0.6);';
        document.body.appendChild(tip);
    }
    tip.textContent = text;
    tip.style.display = 'block';
    const x = (e.touches && e.touches[0] ? e.touches[0].clientX : e.clientX) || 0;
    const y = (e.touches && e.touches[0] ? e.touches[0].clientY : e.clientY) || 0;
    tip.style.left = Math.min(window.innerWidth - 230, x + 12) + 'px';
    tip.style.top = Math.max(8, y - 10 - tip.offsetHeight) + 'px';
    clearTimeout(tip._t);
    tip._t = setTimeout(() => tip.style.display = 'none', 4000);
}
function hideGraphTip() {
    const tip = document.getElementById('graph-tip');
    if (tip) tip.style.display = 'none';
}
function updateReportRange() {
    const fromV = document.getElementById('report-from').value;
    const toV = document.getElementById('report-to').value;
    const todayStr = new Date().toISOString().slice(0, 10);
    const isToday = toV === todayStr;
    const endLabel = (!toV || isToday) ? 'Present' : new Date(toV + 'T00:00:00').toLocaleDateString('en-US', {month: 'numeric', day: 'numeric', year: '2-digit'});
    const rangeStr = (fromV || toV)
        ? 'Report Range: ' + (fromV ? new Date(fromV + 'T00:00:00').toLocaleDateString('en-US', {month: 'numeric', day: 'numeric', year: '2-digit'}) : '…')
          + ' - ' + endLabel
        : 'Report Range: All Time';
    const el = document.getElementById('report-print-date');
    if (el) el.textContent = rangeStr;
}
function renderReport() {
    updateReportRange();
    const body = document.getElementById('report-body');
    if (!body || reportPlayerId == null) return;
    const p = players.find(x => x.id == reportPlayerId);
    if (!p) { body.innerHTML = '<p class="muted">Player not found.</p>'; return; }

    const fromV = document.getElementById('report-from').value;
    const toV = document.getElementById('report-to').value;
    const fromT = fromV ? new Date(fromV + 'T00:00:00').getTime() : 0;
    const toT = toV ? new Date(toV + 'T00:00:00').getTime() : 0;
    const oppId = document.getElementById('report-opp').getSelectedId();
    const oppName = oppId ? playerName(oppId) : '';
    const modes = reportMode === 'both' ? ['singles', 'doubles'] : [reportMode];

    let summaryHtml = '';
    const seriesList = [];
    let allMs = [];
    modes.forEach(mode => {
        const { pts, ms, current } = playerTrajectory(reportPlayerId, mode, fromT, toT);
        const elos = pts.map(q => q.elo);
        const mn = elos.length ? Math.min(...elos) : current;
        const mx = elos.length ? Math.max(...elos) : current;
        const avg = elos.length ? elos.reduce((a, b) => a + b, 0) / elos.length : current;
        const mnPt = pts.find(q => q.elo === mn);
        const mxPt = pts.find(q => q.elo === mx);
        let fms = ms;
        if (oppId) fms = fms.filter(m => [...(m.winners || []), ...(m.losers || [])].some(id => id == oppId));
        const w = fms.filter(m => (m.winners || []).some(id => id == reportPlayerId)).length;
        const l = fms.length - w;
        const color = mode === 'singles' ? '#3498db' : '#f1c40f';
        const label = mode[0].toUpperCase() + mode.slice(1);
        seriesList.push({ label, color, pts, avg });
        fms.forEach(m => allMs.push({ m, mode }));
        summaryHtml += `
        <div class="panel report-summary">
            <h3 style="color:${color};margin-top:0;">${label}</h3>
            <div class="report-stat-grid" style="grid-template-columns: repeat(5, 1fr);">
                <div><span class="muted">Current</span><b>${Math.round(current)}</b></div>
                <div><span class="muted">Peak</span><b>${Math.round(mx)}</b><small>${mxPt ? fmtDate(mxPt.t) : ''}</small></div>
                <div><span class="muted">Low</span><b>${Math.round(mn)}</b><small>${mnPt ? fmtDate(mnPt.t) : ''}</small></div>
                <div><span class="muted">Average</span><b>${Math.round(avg)}</b></div>
                <div><span class="muted">Record${oppName ? ' vs ' + oppName : ''}</span><b>${w}W – ${l}L</b></div>
            </div>
        </div>`;
    });

    allMs.sort((a, b) => matchTime(b.m) - matchTime(a.m));

    // manual rating adjustments (logged by updatePlayer)
    const pl = players.find(x => x.id == reportPlayerId);
    let adjList = (pl && pl.adjustments) || [];
    if (fromT) adjList = adjList.filter(a => a.t >= fromT);
    if (toT) adjList = adjList.filter(a => a.t <= toT + 86399999);
    if (reportMode !== 'both') adjList = adjList.filter(a => (a.mode || 'singles') === reportMode);
    adjList = adjList.slice().sort((a, b) => b.t - a.t);
    const adjRows = adjList.map(a => {
        const lbl = (a.mode || 'singles')[0].toUpperCase() + (a.mode || 'singles').slice(1);
        const delta = Math.round((a.to - a.from) * 10) / 10;
        return `<tr>
            <td style="white-space:nowrap;font-size:11px;">${fmtDate(a.t)}</td>
            <td style="text-align:center;font-size:11px;"><span style="background:#6c3483;color:#fff;border-radius:4px;padding:2px 6px;font-size:10px;">ADJ</span></td>
            <td style="font-size:11px;">${lbl}<div class="muted">manual adjustment</div></td>
            <td style="text-align:center;font-size:11px;">${Math.round(a.from)} → ${Math.round(a.to)}</td>
            <td style="text-align:center;" class="${delta >= 0 ? 'shift-plus' : 'shift-minus'}">${delta > 0 ? '+' : ''}${delta}</td>
        </tr>`;
    }).join('');
    const adjSection = adjList.length ? `
        <div class="panel">
            <h3 style="margin-top:0;">Rating Adjustments (${adjList.length})</h3>
            <div style="overflow-x:auto;">
            <table style="width:100%;border-collapse:collapse;font-size:12px;">
                <thead><tr style="background:#222;">
                    <th style="padding:8px;text-align:left;">Date</th>
                    <th style="padding:8px;"></th>
                    <th style="padding:8px;text-align:left;">Type</th>
                    <th style="padding:8px;">Change</th>
                    <th style="padding:8px;">ELO</th>
                </tr></thead>
                <tbody>${adjRows}</tbody>
            </table>
            </div>
        </div>` : '';

    const rows = allMs.slice(0, 100).map(({ m, mode }) => {
        const won = (m.winners || []).some(id => id == reportPlayerId);
        const isD = mode === 'doubles';
        const mySide = (won ? m.winners : m.losers) || [];
        const opSide = (won ? m.losers : m.winners) || [];
        const partner = isD ? mySide.filter(id => id != reportPlayerId).map(playerName).join(', ') : '';
        const opps = opSide.map(playerName).join(' / ');
        const shift = Number(m.impacts && m.impacts[reportPlayerId]) || 0;
        const scores = (m.detailedGames || []).map(g => g.w + '-' + g.l).join(', ');
        return `<tr>
            <td style="white-space:nowrap;font-size:11px;">${fmtDate(matchTime(m))}</td>
            <td style="text-align:center;color:${won ? '#2ecc71' : '#e74c3c'};font-weight:bold;">${won ? 'W' : 'L'}</td>
            <td style="font-size:11px;">${opps}${partner ? `<div class="muted">w/ ${partner}</div>` : ''}</td>
            <td style="text-align:center;font-size:11px;">${m.score || ''}${scores ? `<div class="muted">(${scores})</div>` : ''}</td>
            <td style="text-align:center;" class="${shift >= 0 ? 'shift-plus' : 'shift-minus'}">${shift > 0 ? '+' : ''}${shift}</td>
        </tr>`;
    }).join('');

    body.innerHTML = summaryHtml + adjSection + `
        <div class="panel">
            <h3 style="margin-top:0;">ELO Over Time</h3>
            ${eloGraphSVG(seriesList)}
        </div>
        <div class="panel">
            <h3 style="margin-top:0;">Matches (${allMs.length}${allMs.length > 100 ? ', showing 100' : ''})</h3>
            <div style="overflow-x:auto;">
            <table style="width:100%;border-collapse:collapse;font-size:12px;">
                <thead><tr style="background:#222;">
                    <th style="padding:8px;text-align:left;">Date</th>
                    <th style="padding:8px;">W/L</th>
                    <th style="padding:8px;text-align:left;">Opponents</th>
                    <th style="padding:8px;">Score</th>
                    <th style="padding:8px;">ELO</th>
                </tr></thead>
                <tbody>${rows || '<tr><td colspan="5" class="muted" style="text-align:center;padding:16px;">No matches in this range.</td></tr>'}</tbody>
            </table>
            </div>
        </div>`;
}
function exportReport() { window.print(); }
