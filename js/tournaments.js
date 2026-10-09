/* Tournaments half — ported from UHA-Tournaments/app.js (Phase 1 merge).
   Shared Firebase/auth now live in js/core.js. */

let allPlayers = []; 
let isDoublesMode = false;
let lockedDivisions = [];
let isViewingArchive = false;

function updateTournamentAuthUI() {
    // New structure: public bracket lives on the Tournaments tab, setup lives
    // under Admin > Tournaments. This only toggles the management buttons.
    updateVisibility();
    // Re-render the bracket cards: they may have been built before the user's
    // role finished loading (public-style buttons for a manager).
    if (typeof renderTournamentView === 'function' && lockedDivisions && lockedDivisions.length) {
        renderTournamentView();
    }
}


function canManageTournaments() {
    return (typeof can === 'function') ? can('tournaments') : isAdmin;
}

function updateVisibility() {
    const canT = canManageTournaments();
    const archiveBtn = document.getElementById('btn-archive');
    const resetBtn = document.getElementById('btn-reset');
    const backSetupBtn = document.getElementById('btn-back-setup');
    const adminActions = document.getElementById('tourney-admin-actions');

    if (archiveBtn) archiveBtn.style.display = (canT && !isViewingArchive) ? 'block' : 'none';
    if (resetBtn) resetBtn.style.display = canT ? 'block' : 'none';
    if (backSetupBtn) backSetupBtn.style.display = canT ? 'block' : 'none';
    if (adminActions) adminActions.style.display = canT ? 'flex' : 'none';
}

const teamDraftArea = document.getElementById('team-draft-area');
const playerListDiv = document.getElementById('player-list');
const searchInput = document.getElementById('player-search');

function setDoublesMode(on, opts = {}) {
    // Switching modes clears the draft area — confirm first so a misclick
    // can't wipe a half-built draft.
    if (!opts.silent && teamDraftArea.children.length > 0
        && !confirm('Switching modes will clear the current draft. Continue?')) return;
    isDoublesMode = on;
    document.getElementById('btn-mode-singles').classList.toggle('active', !on);
    document.getElementById('btn-mode-doubles').classList.toggle('active', on);
    document.getElementById('draft-header').innerText = on ? "Teams" : "Selected Players";
    teamDraftArea.innerHTML = '';
    renderRoster();
}

document.getElementById('btn-mode-singles').addEventListener('click', () => setDoublesMode(false));
document.getElementById('btn-mode-doubles').addEventListener('click', () => setDoublesMode(true));

window.toggleFormatOptions = function() {
    const format = document.getElementById('division-format').value;
    const multiSettings = document.getElementById('multi-group-settings');
    const doubleSettings = document.getElementById('double-elim-settings');
    const singleSettings = document.getElementById('single-elim-settings');

    if (multiSettings) multiSettings.style.display = (format === 'multi_group_rr') ? 'block' : 'none';
    if (doubleSettings) doubleSettings.style.display = (format === 'double_elim') ? 'block' : 'none';
    if (singleSettings) singleSettings.style.display = (format === 'single_elim') ? 'block' : 'none';
};

function refreshRosterFromDB() {
    allPlayers = clubPlayers;

    renderRoster();
    if (typeof setConnectionStatus === 'function') setConnectionStatus(true);
}
searchInput.addEventListener('input', renderRoster);

function getDraftedPlayerIds() {
    // ids from legacy hidden divs (doubles clones) plus slot datasets (singles
    // slots and team slots carry their ids directly now)
    const fromDivs = Array.from(teamDraftArea.querySelectorAll('.drafted-id')).map(p => p.dataset.id);
    const fromSlots = Array.from(teamDraftArea.querySelectorAll('.singles-slot, .team-slot')).flatMap(el => {
        try { return JSON.parse(el.dataset.ids || '[]'); } catch (e) { return []; }
    });
    return fromDivs.concat(fromSlots).map(String);
}

function renderRoster() {
    playerListDiv.innerHTML = '';
    const draftedIds = getDraftedPlayerIds();
    const searchTerm = searchInput.value.toLowerCase();

    let availablePlayers = allPlayers.filter(p => 
        p.active && 
        !draftedIds.includes(String(p.id)) &&
        p.name.toLowerCase().includes(searchTerm)
    );
    
    availablePlayers.sort((a, b) => {
        const ratingA = isDoublesMode ? (a.doubles || 1000) : (a.singles || 1000);
        const ratingB = isDoublesMode ? (b.doubles || 1000) : (b.singles || 1000);
        return ratingB - ratingA;
    });

    availablePlayers.forEach(player => {
        const div = document.createElement('div');
        div.className = 'player-item';
        div.dataset.id = player.id;
        div.dataset.name = player.name;
        div.dataset.elo = isDoublesMode ? (player.doubles || 1000) : (player.singles || 1000);
        div.innerHTML = `<span>${player.name}</span> <span style="color:var(--uha-blue); font-weight:bold;">${Math.round(div.dataset.elo)}</span>`;
        playerListDiv.appendChild(div);
    });
}

playerListDiv.addEventListener('click', (e) => {
    const playerItem = e.target.closest('.player-item');
    if (!playerItem) return;

    if (!isDoublesMode) {
        const singlesDiv = document.createElement('div');
        singlesDiv.className = 'singles-slot';
        singlesDiv.dataset.finalName = playerItem.dataset.name;
        singlesDiv.dataset.finalElo = playerItem.dataset.elo;
        
        singlesDiv.dataset.ids = JSON.stringify([playerItem.dataset.id]);
        singlesDiv.innerHTML = `
            <div style="font-weight: bold;">
                ${playerItem.dataset.name} <span style="color:var(--uha-blue); margin-left:10px;">${Math.round(playerItem.dataset.elo)}</span>
            </div>
            <button class="remove-team-btn">X</button>
        `;
        teamDraftArea.appendChild(singlesDiv);

    } else {
        let openSlot = document.querySelector('.team-slot:last-child .slots');

        if (!openSlot || openSlot.children.length >= 2) {
            const teamId = Date.now();
            const teamDiv = document.createElement('div');
            teamDiv.className = 'team-slot';
            teamDiv.innerHTML = `
                <div class="team-header">
                    <span>Team ELO: <span class="team-elo">0</span></span>
                    <button class="remove-team-btn">X</button>
                </div>
                <div class="slots" data-team-id="${teamId}"></div>
            `;
            teamDraftArea.appendChild(teamDiv);
            openSlot = teamDiv.querySelector('.slots');
        }

        const clone = document.createElement('div');
        clone.className = 'drafted-id player-item';
        clone.dataset.id = playerItem.dataset.id;
        clone.dataset.name = playerItem.dataset.name;
        clone.dataset.elo = playerItem.dataset.elo;
        clone.innerHTML = playerItem.innerHTML;
        clone.style.marginBottom = "5px";
        
        openSlot.appendChild(clone);
        updateTeamElo(openSlot.closest('.team-slot'));
    }
    renderRoster();
});

teamDraftArea.addEventListener('click', (e) => {
    if (e.target.classList.contains('remove-team-btn')) {
        const slot = e.target.closest('.singles-slot') || e.target.closest('.team-slot');
        slot.remove();
        renderRoster(); 
    }
});

function updateTeamElo(teamDiv) {
    const players = teamDiv.querySelectorAll('.drafted-id');
    let totalElo = 0;
    let names = [];
    const ids = [];
    players.forEach(p => {
        totalElo += parseFloat(p.dataset.elo);
        names.push(p.dataset.name);
        ids.push(p.dataset.id);
    });
    const avgElo = players.length > 0 ? Math.round(totalElo / players.length) : 0;
    teamDiv.querySelector('.team-elo').innerText = avgElo;
    teamDiv.dataset.finalName = names.join(' & ');
    teamDiv.dataset.finalElo = avgElo;
    teamDiv.dataset.ids = JSON.stringify(ids);
}

document.getElementById('btn-add-player').addEventListener('click', () => {
    const firstName = document.getElementById('new-player-first').value.trim();
    const lastName = document.getElementById('new-player-last').value.trim();
    const singlesVal = parseFloat(document.getElementById('new-player-singles').value) || 1000;
    const doublesVal = parseFloat(document.getElementById('new-player-doubles').value) || 1000;
    const isMember = document.getElementById('new-player-member').checked;
    
    if (!firstName && !lastName) return alert("Enter a player name");
    
    const fullName = (firstName + ' ' + lastName).trim().toLowerCase();
    if (allPlayers.some(p => ((p.firstName||'') + ' ' + (p.lastName||'')).trim().toLowerCase() === fullName)) {
        return alert("Player already exists in the database.");
    }

    getNextPlayerId().then(id => {
        const newPlayer = {
            id: id,
            firstName: firstName,
            lastName: lastName,
            singles: singlesVal,
            doubles: doublesVal,
            baseS: singlesVal,
            baseD: doublesVal,
            peakS: singlesVal,
            peakD: doublesVal,
            active: true,
            isMember: isMember
        };

        allPlayers.push(newPlayer);
        return db.ref('players').set(allPlayers).then(() => {
            document.getElementById('new-player-first').value = '';
            document.getElementById('new-player-last').value = '';
            document.getElementById('new-player-singles').value = '1000';
            document.getElementById('new-player-doubles').value = '1000';
            document.getElementById('new-player-member').checked = true;

            const searchInput = document.getElementById('player-search');
            if (searchInput) searchInput.value = nameStr;
            refreshRosterFromDB();
            if (typeof showToast === 'function') showToast(`Player added — ID #${id}`);
        });
    }).catch(e => alert("Error adding player: " + e.message));
});

/* ============ manual seeding ============ */
let manualSeeds = []; // participant names in seed order

window.toggleSeedingOptions = function() {
    const mode = document.getElementById('seeding-mode').value;
    document.getElementById('manual-seeding-box').style.display = mode === 'manual' ? 'block' : 'none';
    if (mode === 'manual') renderSeedPicker();
};

function draftParticipantNames() {
    return Array.from(document.querySelectorAll('.singles-slot, .team-slot'))
        .map(el => el.dataset.finalName).filter(Boolean);
}

function renderSeedPicker() {
    const names = draftParticipantNames();
    manualSeeds = manualSeeds.filter(n => names.includes(n));
    const listEl = document.getElementById('seed-list');
    const poolEl = document.getElementById('seed-pool');
    listEl.innerHTML = manualSeeds.length
        ? manualSeeds.map((n, i) => `
            <div style="display:flex; align-items:center; gap:6px; background:#1a1a1a; padding:6px 8px; border-radius:4px; margin-bottom:4px;">
                <span style="background:var(--uha-gold); color:#000; font-weight:bold; border-radius:4px; padding:2px 8px; font-size:12px;">${i + 1}</span>
                <span style="flex:1;">${n}</span>
                <button onclick="moveSeed(${i}, -1)" style="width:auto; padding:2px 8px; font-size:12px;" ${i === 0 ? 'disabled style="width:auto; padding:2px 8px; font-size:12px; opacity:0.3;"' : ''}>▲</button>
                <button onclick="moveSeed(${i}, 1)" style="width:auto; padding:2px 8px; font-size:12px;" ${i === manualSeeds.length - 1 ? 'disabled style="width:auto; padding:2px 8px; font-size:12px; opacity:0.3;"' : ''}>▼</button>
                <button onclick="removeSeed(${i})" style="width:auto; padding:2px 8px; font-size:12px; background:#c0392b;">✕</button>
            </div>`).join('')
        : '<div style="font-size:12px; color:var(--text-muted);">No seeds picked yet.</div>';
    const unseeded = names.filter(n => !manualSeeds.includes(n));
    poolEl.innerHTML = unseeded.map(n =>
        `<button onclick="addSeed('${n.replace(/'/g, "\\'")}')" style="width:auto; padding:6px 10px; font-size:12px;">+ ${n}</button>`
    ).join('') || '<span style="font-size:12px; color:var(--text-muted);">Everyone is seeded.</span>';
}

window.addSeed = function(name) { manualSeeds.push(name); renderSeedPicker(); };
window.removeSeed = function(i) { manualSeeds.splice(i, 1); renderSeedPicker(); };
window.moveSeed = function(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= manualSeeds.length) return;
    [manualSeeds[i], manualSeeds[j]] = [manualSeeds[j], manualSeeds[i]];
    renderSeedPicker();
};

// keep the seed pool in sync as players are drafted/removed
if (typeof MutationObserver !== 'undefined') {
    const _draftArea = document.getElementById('team-draft-area');
    if (_draftArea) new MutationObserver(() => {
        if (document.getElementById('seeding-mode').value === 'manual' &&
            document.getElementById('manual-seeding-box').style.display !== 'none') {
            renderSeedPicker();
        }
    }).observe(_draftArea, { childList: true, subtree: true });
}

document.getElementById('btn-lock-division').addEventListener('click', () => {
    const nameInput = document.getElementById('division-name');
    const divName = nameInput ? nameInput.value : "Untitled Event";
    const format = document.getElementById('division-format').value;
    const finalRuleEl = document.getElementById('double-elim-final');
    const finalRule = finalRuleEl ? finalRuleEl.value : 'true_double';

   const singleThird = document.getElementById('single-elim-third-place');
    const multiThird = document.getElementById('multi-group-third-place');
    const hasThirdPlace = (singleThird && singleThird.checked) || (multiThird && multiThird.checked);
    
    const participantElements = document.querySelectorAll('.singles-slot, .team-slot');
    if (participantElements.length < 2) return alert("Need at least 2 participants to lock an event.");

   const participants = Array.from(participantElements).map(el => {
        let ids = [];
        try { ids = JSON.parse(el.dataset.ids || '[]'); } catch (e) { ids = []; }
        ids = ids.map(Number).filter(n => !isNaN(n) && n > 0);

        return {
            name: el.dataset.finalName,
            elo: parseInt(el.dataset.finalElo),
            ids: ids
        };
    });

    const seedingMode = document.getElementById('seeding-mode').value;
    lockedDivisions.push({
        name: divName || "Untitled Event",
        format: format,
        mode: isDoublesMode ? "Doubles" : "Singles",
        grandFinalRule: finalRule,
        hasThirdPlaceMatch: hasThirdPlace,
        participants: participants,
        seeding: seedingMode,
        seedOrder: seedingMode === 'manual' ? [...manualSeeds] : [],
        bracket: []
    });
    manualSeeds = [];

    renderLockedDivisions();
    document.getElementById('team-draft-area').innerHTML = '';
    if(nameInput) nameInput.value = '';
    renderRoster();
});

const FORMAT_LABELS = { single_elim: 'Single Elim', double_elim: 'Double Elim', round_robin: 'Round Robin', multi_group_rr: 'Multi-Group RR' };
const formatLabel = (f) => FORMAT_LABELS[f] || f;

function renderLockedDivisions() {
    const divLog = document.getElementById('locked-divisions-list');
    divLog.innerHTML = '';
    lockedDivisions.forEach((div, index) => {
        divLog.innerHTML += `
            <div style="background: rgba(52, 152, 219, 0.1); padding: 8px; border-radius: 4px; margin-bottom: 5px; border-left: 3px solid var(--uha-blue);">
                ✅ Locked: <b>${div.name}</b> (${div.mode} · ${formatLabel(div.format)}) - ${div.participants.length} entries
                <button class="unlock-btn" style="border-color:#e74c3c; color:#e74c3c;" onclick="deleteLockedDivision(${index})">Delete</button>
            </div>
        `;
    });
    if (lockedDivisions.length > 0) {
        divLog.innerHTML += `<div style="font-size:12px; color:var(--text-muted); margin-top:6px;">To change players on a live bracket, use the \u21c4 swap buttons on the bracket. To fix a score, use Edit Score on the match.</div>`;
    }
}

window.deleteLockedDivision = function(index) {
    const div = lockedDivisions[index];
    if (!div) return;
    if (!confirm(`Delete the event "${div.name}"? This removes its bracket. This cannot be undone.`)) return;
    lockedDivisions.splice(index, 1);
    renderLockedDivisions();
};

// Navigation now goes through the tab structure (core.js).
window.goToBracketView = function() { goToPublicBracket(); };
window.goToSetupView = function() { goToAdminTournaments(); };

function buildSeededMatchups(teams) {
    let numTeams = teams.length;
    let bracketSize = Math.pow(2, Math.ceil(Math.log2(numTeams || 1)));
    if (bracketSize < 2) bracketSize = 2;
    let byes = bracketSize - numTeams;

    let paddedTeams = [...teams];
    for(let i=0; i<byes; i++) {
        paddedTeams.push({ name: "BYE", isBye: true });
    }

    let seeds = [0];
    for (let i = 1; i < Math.log2(bracketSize) + 1; i++) {
        let nextLevel = [];
        let sum = Math.pow(2, i) - 1;
        for (let j = 0; j < seeds.length; j++) {
            nextLevel.push(seeds[j]);
            nextLevel.push(sum - seeds[j]);
        }
        seeds = nextLevel;
    }

    let matchups = [];
    for (let i = 0; i < seeds.length; i += 2) {
        let p1 = paddedTeams[seeds[i]];
        let p2 = paddedTeams[seeds[i+1]];
        matchups.push({
            p1: p1.isBye ? null : p1,
            p2: p2.isBye ? null : p2,
            scores: (p1.isBye || p2.isBye) ? 'BYE' : '',
            p1Wins: 0, p2Wins: 0,
            winner: p1.isBye ? 'p2' : (p2.isBye ? 'p1' : null)
        });
    }
    return matchups;
}

/* Order participants for bracket building:
   elo    -> sort by ELO desc (classic seeding)
   random -> full shuffle
   manual -> hand-picked seeds first (in order), rest shuffled */
function orderBySeeding(participants, division) {
    const mode = division.seeding || 'elo';
    if (mode === 'random') {
        const a = [...participants];
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }
    if (mode === 'manual') {
        const seedNames = division.seedOrder || [];
        const seeds = [];
        const rest = [];
        participants.forEach(pt => {
            const si = seedNames.indexOf(pt.name);
            if (si >= 0) seeds[si] = pt; else rest.push(pt);
        });
        const ordered = seeds.filter(Boolean);
        for (let i = rest.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [rest[i], rest[j]] = [rest[j], rest[i]];
        }
        return ordered.concat(rest);
    }
    return [...participants].sort((a, b) => (b.elo || 0) - (a.elo || 0));
}

function buildAndStartDivisions() {
    if (lockedDivisions.length === 0) return alert("You need to lock at least one division first!");

    lockedDivisions.forEach(division => {
        if (division.bracket.length > 0) return; 
        
        if (division.format === 'single_elim') {
            let p = [...division.participants];

            if (!division.isFromRR) {
                p = orderBySeeding(p, division);
            }

            let round1 = buildSeededMatchups(p);

            let nextPowerOf2 = Math.pow(2, Math.ceil(Math.log2(p.length || 1)));
            if(nextPowerOf2 < 2) nextPowerOf2 = 2;
            let roundsCount = Math.log2(nextPowerOf2);
            
            let bracket = [round1];
            for(let r=1; r<roundsCount; r++) {
                let matchesInRound = nextPowerOf2 / Math.pow(2, r+1);
                bracket.push(Array.from({length: matchesInRound}, () => ({p1: null, p2: null, p1Wins: 0, p2Wins: 0, scores: '', winner: null})));
            }

            round1.forEach((match, mIdx) => {
                if (match.scores === 'BYE' && match.winner && bracket[1]) {
                    let advancer = match[match.winner]; 
                    let nextMIdx = Math.floor(mIdx / 2);
                    if (mIdx % 2 === 0) bracket[1][nextMIdx].p1 = advancer;
                    else bracket[1][nextMIdx].p2 = advancer;
                }
            });
            division.bracket = bracket;

            if (division.hasThirdPlaceMatch && roundsCount > 1) {
                division.thirdPlaceMatch = [[{p1: null, p2: null, p1Wins: 0, p2Wins: 0, scores: '', winner: null, isThirdPlace: true}]];
            }
        }
            
        else if (division.format === 'double_elim') {
            let p = [...division.participants];

            if (!division.isFromRR) {
                p = orderBySeeding(p, division);
            }

            let round1 = buildSeededMatchups(p);

            let nextPowerOf2 = Math.pow(2, Math.ceil(Math.log2(p.length || 1)));
            if(nextPowerOf2 < 2) nextPowerOf2 = 2;
            let winnersRoundsCount = Math.log2(nextPowerOf2);
            
            let wBracket = [round1];
            for(let r=1; r < winnersRoundsCount; r++) {
                let matchesInRound = nextPowerOf2 / Math.pow(2, r+1);
                wBracket.push(Array.from({length: matchesInRound}, () => ({p1: null, p2: null, p1Wins: 0, p2Wins: 0, scores: '', winner: null})));
            }

            let losersRoundsCount = (winnersRoundsCount * 2) - 2;
            let lBracket = [];
            let currentLoserMatches = Math.max(1, nextPowerOf2 / 4); 
            
            for (let r = 0; r < losersRoundsCount; r++) {
                if (r > 0 && r % 2 === 0) {
                    currentLoserMatches = Math.floor(currentLoserMatches / 2);
                }
                lBracket.push(Array.from({length: Math.max(1, currentLoserMatches)}, () => ({p1: null, p2: null, p1Wins: 0, p2Wins: 0, scores: '', winner: null, isLosers: true})));
            }

           wBracket.forEach((round, rIdx) => {
                round.forEach((match, mIdx) => {
                    if (rIdx === 0) {
                        match.loserDest = {
                            rIdx: 0,
                            mIdx: Math.floor(mIdx / 2),
                            slot: mIdx % 2 === 0 ? 'p1' : 'p2'
                        };
                    } else if (rIdx === 1) {
                        let crossoverMIdx = mIdx % 2 === 0 ? mIdx + 1 : mIdx - 1;

                        if (crossoverMIdx >= round.length) crossoverMIdx = mIdx;
            
                        match.loserDest = {
                            rIdx: (rIdx * 2) - 1,
                            mIdx: crossoverMIdx,
                            slot: 'p2'
                        };
                    } else {

                        match.loserDest = {
                            rIdx: (rIdx * 2) - 1,
                            mIdx: mIdx,
                            slot: 'p2'
                        };
                    }
                });
            });

            round1.forEach((match, mIdx) => {
                if (match.scores === 'BYE' && match.winner && wBracket[1]) {
                    let advancer = match[match.winner]; 
                    let loser = match.winner === 'p1' ? match.p2 : match.p1;
                    
                    let nextMIdx = Math.floor(mIdx / 2);
                    if (mIdx % 2 === 0) wBracket[1][nextMIdx].p1 = advancer;
                    else wBracket[1][nextMIdx].p2 = advancer;

                    if (match.loserDest && lBracket[match.loserDest.rIdx]) {
                        lBracket[match.loserDest.rIdx][match.loserDest.mIdx][match.loserDest.slot] = loser;
                    }
                }
            });

            division.bracket = wBracket;
            division.losersBracket = lBracket;
          
            round1.forEach((match, mIdx) => {
                if (match.scores === 'BYE' && match.winner && wBracket[1]) {
                    let advancer = match[match.winner]; 
                    let loser = match.winner === 'p1' ? match.p2 : match.p1;
                    
                    let nextMIdx = Math.floor(mIdx / 2);
                    if (mIdx % 2 === 0) wBracket[1][nextMIdx].p1 = advancer;
                    else wBracket[1][nextMIdx].p2 = advancer;

                    if (match.loserDest && lBracket[match.loserDest.rIdx]) {
                        lBracket[match.loserDest.rIdx][match.loserDest.mIdx][match.loserDest.slot] = loser;
                    }
                }
            });

            division.bracket = wBracket;
            division.losersBracket = lBracket;

            let fBracket = [];
            fBracket.push([{p1: null, p2: null, p1Wins: 0, p2Wins: 0, scores: '', winner: null}]);

            if (division.grandFinalRule === 'true_double') {
                fBracket.push([{p1: null, p2: null, p1Wins: 0, p2Wins: 0, scores: '', winner: null}]);
            }
            division.finalsBracket = fBracket;
        }
                        
        else if (division.format === 'round_robin') {
            let p = orderBySeeding([...division.participants], division);
            let matches = [];
            for(let i=0; i<p.length; i++) {
                for(let j=i+1; j<p.length; j++) {
                    matches.push({ p1: p[i], p2: p[j], p1Wins: 0, p2Wins: 0, scores: '', winner: null });
                }
            }
            division.bracket = [matches]; 
        }

        else if (division.format === 'multi_group_rr') {
            let p = [...division.participants];
            p = orderBySeeding(p, division);
            
            let numGroups = parseInt(document.getElementById('num-groups').value) || 2;
            let groups = Array.from({length: numGroups}, () => []);

            let direction = 1; 
            let groupIndex = 0;
            for (let i = 0; i < p.length; i++) {
                groups[groupIndex].push(p[i]);
                groupIndex += direction;
                if (groupIndex >= numGroups || groupIndex < 0) {
                    direction *= -1;
                    groupIndex += direction;
                }
            }

            let allGroupMatches = [];
            groups.forEach(groupPlayers => {
                let groupMatches = [];
                for(let i=0; i<groupPlayers.length; i++) {
                    for(let j=i+1; j<groupPlayers.length; j++) {
                        groupMatches.push({ p1: groupPlayers[i], p2: groupPlayers[j], p1Wins: 0, p2Wins: 0, scores: '', winner: null });
                    }
                }
                allGroupMatches.push(groupMatches);
            });

            division.draftedGroups = groups; 
            division.bracket = allGroupMatches; 
            division.advancementRule = document.getElementById('multi-group-advancement').value; 
        }

    });

    const tName = document.getElementById('tournament-name').value || "Untitled Tournament";

    db.ref('tournaments/active').set({
        name: tName,
        updatedAt: firebase.database.ServerValue.TIMESTAMP,
        divisions: lockedDivisions
    }).then(() => {
        document.getElementById('tourney-title').innerText = tName;
        renderTournamentView();
        goToPublicBracket();
    }).catch((e) => alert("Error: " + e.message));
}
document.getElementById('btn-start').addEventListener('click', buildAndStartDivisions);

function calculateStandings(players, matches) {
    let stats = {};
    players.forEach(p => {
        stats[p.name] = { player: p, matchWins: 0, matchLosses: 0, pts: 0, gamesWon: 0, totalScore: 0, h2hWins: [] };
    });

    matches.forEach(m => {
        if (m.winner) {
            let w = m.winner === 'p1' ? m.p1 : m.p2;
            let l = m.winner === 'p1' ? m.p2 : m.p1;

            stats[w.name].matchWins++;
            stats[w.name].pts += 2; 
            stats[l.name].matchLosses++;

            // --- 2-1-0 POINT LOGIC ---
            let games = (m.scores || "").split(',');
            if (games.length === 3 && games[0] !== 'BYE') {
                stats[l.name].pts += 1; // 1 pt for tie-breaker loss
            }

            stats[m.p1.name].gamesWon += m.p1Wins;
            stats[m.p2.name].gamesWon += m.p2Wins;

            games.forEach(g => {
                let s = g.trim().split('-');
                if(s.length===2) {
                    stats[m.p1.name].totalScore += parseInt(s[0]);
                    stats[m.p2.name].totalScore += parseInt(s[1]);
                }
            });
            stats[w.name].h2hWins.push(l.name);
        }
    });

    return Object.values(stats).sort((a, b) => {
    if (b.pts !== a.pts) return b.pts - a.pts;
    
    if (a.h2hWins.includes(b.player.name)) return -1;
    if (b.h2hWins.includes(a.player.name)) return 1;

    let aGameRatio = a.gamesWon / (a.matchWins + a.matchLosses || 1);
    let bGameRatio = b.gamesWon / (b.matchWins + b.matchLosses || 1);
    if (bGameRatio !== aGameRatio) return bGameRatio - aGameRatio;

    return b.totalScore - a.totalScore;
});
}

window.advanceToKnockout = function(divIdx) {
    let div = lockedDivisions[divIdx];
    const champName = div.name + " (Championship)";

    if (lockedDivisions.some(d => d.name === champName)) {
        return alert("Knockout brackets have already been generated for this group.");
    }

    let allStandings = [];
    div.bracket.forEach((groupMatches, gIdx) => {
        let groupParticipants = div.format === 'multi_group_rr' ? div.draftedGroups[gIdx] : div.participants;
        let standings = calculateStandings(groupParticipants, groupMatches);

        standings.forEach((s, rankIndex) => {
            allStandings.push({
                player: s.player,
                groupRank: rankIndex + 1,
                groupIdx: gIdx,
                pts: s.pts,
                winRatio: (s.matchWins + s.matchLosses) > 0 ? (s.matchWins / (s.matchWins + s.matchLosses)) : 0,
                totalScore: s.totalScore,
                gamesWon: s.gamesWon
            });
        });
    });

    const rule = div.advancementRule || 'all_to_single'; 
    let championshipPlayers = [];
    let consolationPlayers = [];

    const perfSort = (a, b) => {
        if (b.pts !== a.pts) return b.pts - a.pts;
        if (b.winRatio !== a.winRatio) return b.winRatio - a.winRatio;
        if (b.gamesWon !== a.gamesWon) return b.gamesWon - a.gamesWon;
        return b.totalScore - a.totalScore;
    };
    
    let rank1s = allStandings.filter(s => s.groupRank === 1).sort(perfSort);
    let poolOrder = rank1s.map(s => s.groupIdx); 
    if (poolOrder.length === 0) poolOrder = div.bracket.map((_, i) => i);

    const crossSort = (a, b) => {
        if (a.groupRank !== b.groupRank) return a.groupRank - b.groupRank;
        return poolOrder.indexOf(a.groupIdx) - poolOrder.indexOf(b.groupIdx);
    };

    let sortedAll = [...allStandings].sort(crossSort);

    if (rule === 'all_to_single') {
        championshipPlayers = sortedAll.map(s => s.player);
    } else if (rule === 'single_bracket') { 
        championshipPlayers = sortedAll.filter(s => s.groupRank <= 2).map(s => s.player);
    } else if (rule === 'split_bracket') { 
        championshipPlayers = sortedAll.filter(s => s.groupRank <= 2).map(s => s.player);
        consolationPlayers = sortedAll.filter(s => s.groupRank >= 3).map(s => s.player);
    }

    const generateThirdPlaceSlot = () => [[{ p1: null, p2: null, scores: '', p1Wins: 0, p2Wins: 0, winner: null }]];

    if (championshipPlayers.length > 0) {
        let newChampDiv = {
            name: champName,
            format: "single_elim",
            mode: div.mode,
            participants: championshipPlayers,
            bracket: [],
            isFromRR: true
        };

        if (div.hasThirdPlaceMatch) {
            newChampDiv.hasThirdPlaceMatch = true;
            newChampDiv.thirdPlaceMatch = generateThirdPlaceSlot();
        }
        lockedDivisions.push(newChampDiv);
    }

    if (consolationPlayers.length > 0) {
        let newConsDiv = {
            name: div.name + " (Consolation)",
            format: "single_elim",
            mode: div.mode,
            participants: consolationPlayers,
            bracket: [],
            isFromRR: true
        };

        if (div.hasThirdPlaceMatch) {
            newConsDiv.hasThirdPlaceMatch = true;
            newConsDiv.thirdPlaceMatch = generateThirdPlaceSlot();
        }
        lockedDivisions.push(newConsDiv);
    }

    buildAndStartDivisions();
};

function renderTournamentView() {
    let html = '';
    lockedDivisions.forEach((div, divIdx) => {
        let formatLabel = div.format.includes('elim') ? 'Knockout' : 'Round Robin';
        const modeLabel = div.mode ? div.mode.charAt(0).toUpperCase() + div.mode.slice(1) : '';
        html += `<div id="division-${divIdx}" class="section-title" style="margin-top: 40px; border-top: 1px solid #444; padding-top:20px;"><div>${div.name}</div><div class="division-sub">${modeLabel} &middot; ${formatLabel}</div></div>`;
        
        if (div.format === 'single_elim' || div.format === 'double_elim') {

            if (div.format === 'double_elim') {
                html += `<h3 style="color:var(--uha-blue); margin-top: 10px;">Winners Bracket</h3>`;
            }
            html += `<div class="bracket-layout"><div class="bracket-columns">`;
            
            div.bracket.forEach((round, rIdx) => {
                html += `<div class="bracket-round">`;
                html += `<div class="bracket-header" style="margin-bottom: 20px; color: var(--uha-gold);">Round ${rIdx + 1}</div>`; 
                html += `<div class="bracket-matches">`; 
                round.forEach((match, mIdx) => {
                    html += generateMatchCardHTML(match, divIdx, rIdx, mIdx);
                });
                html += `</div></div>`; 
            }); 
            html += `</div></div>`; 

            if (div.format === 'double_elim' && div.losersBracket) {
                html += `<hr style="border: 0; border-top: 2px dashed #444; margin: 40px 0;">`;
                html += `<h3 style="color:var(--uha-blue); margin-top: 10px;">Losers Bracket</h3>`;
                
                html += `<div class="bracket-layout"><div class="bracket-columns" style="flex-wrap: wrap; justify-content: center;">`;
                div.losersBracket.forEach((round, rIdx) => {
                    html += `<div class="bracket-round">`;
                    html += `<div class="bracket-header" style="margin-bottom: 20px; color: var(--uha-gold);">L-Round ${rIdx + 1}</div>`; 
                    html += `<div class="bracket-matches">`; 
                    round.forEach((match, mIdx) => {
                        html += generateMatchCardHTML(match, divIdx, rIdx, mIdx, 'losers'); 
                    });
                    html += `</div></div>`; 
                }); 
                html += `</div></div>`;
            }

            if (div.format === 'double_elim' && div.finalsBracket) {
                html += `<hr style="border: 0; border-top: 2px solid var(--uha-gold); margin: 50px 0 20px 0;">`;
                html += `<h2 style="color:var(--uha-gold); text-align:center; text-transform:uppercase;">Championship Finals</h2>`;
                html += `<div style="display: flex; justify-content: center; gap: 40px; padding: 20px; flex-wrap: wrap;">`;
                
                div.finalsBracket.forEach((round, rIdx) => {
                    let match = round[0]; 
                    if (rIdx === 0 || (rIdx === 1 && match.p1)) { 
                        html += `<div class="bracket-round">`;
                        html += `<div class="bracket-header" style="margin-bottom: 20px; color: var(--uha-gold);">${rIdx === 0 ? 'Match 1' : 'If Necessary'}</div>`;
                        html += `<div class="bracket-matches">`;
                        html += generateMatchCardHTML(match, divIdx, rIdx, 0, 'finals'); 
                        html += `</div></div>`;
                    }
                });
                html += `</div>`;
            }

            if (div.format === 'single_elim' && div.thirdPlaceMatch) {
                html += `<hr style="border: 0; border-top: 2px dashed var(--uha-gold); margin: 40px 0;">`;
                html += `<h3 style="color:var(--uha-gold); margin-top: 10px; text-align: center;">3rd Place Playoff</h3>`;
                
                html += `<div class="bracket-layout" style="justify-content: center;"><div class="bracket-columns" style="justify-content: center;">`;
                html += `<div class="bracket-round">`;
                html += `<div class="bracket-matches">`;
                
                html += generateMatchCardHTML(div.thirdPlaceMatch[0][0], divIdx, 0, 0, 'third_place'); 
                
                html += `</div></div></div></div>`;
            }
            
        } else if (div.format === 'round_robin' || div.format === 'multi_group_rr') {

            div.bracket.forEach((groupMatches, groupIndex) => {
                let groupParticipants = div.format === 'multi_group_rr' ? div.draftedGroups[groupIndex] : div.participants;
                let standings = calculateStandings(groupParticipants, groupMatches);

                if (div.format === 'multi_group_rr') {
                    html += `<h3 style="color:var(--uha-blue); margin-top: 30px; border-left: 4px solid var(--uha-gold); padding-left: 10px;">Group ${groupIndex + 1}</h3>`;
                }

                html += `<table class="standings-table" style="margin-bottom: 20px;">
                    <tr><th style="text-align: center; width: 12.5%;">Rank</th><th style="text-align: left; width: 37.5%;">Player / Team</th><th style="text-align: center; width: 12.5%;">Points</th><th style="text-align: center; width: 12.5%;">Match Record</th><th style="text-align: center; width: 12.5%;">Games Won</th><th style="text-align: center; width: 12.5%;">Points Scored</th></tr>`;
                standings.forEach((s, i) => {
                    html += `<tr>
                        <td style="color:var(--uha-blue); text-align: center; font-weight:bold;">#${i+1}</td>
                        <td style="text-align:left; font-weight:bold;">${(typeof resolveBracketName === 'function') ? resolveBracketName(s.player) : s.player.name}</td>
                        <td style="font-weight:bold; text-align: center;">${s.pts}</td>
                        <td style="text-align: center;">${s.matchWins}-${s.matchLosses}</td>
                        <td style="text-align: center;">${s.gamesWon}</td>
                        <td style="text-align: center;">${s.totalScore}</td>
                    </tr>`;
                });
                html += `</table>`;

                html += `<div class="rr-match-grid">`;
                groupMatches.forEach((match, mIdx) => {
                    html += generateMatchCardHTML(match, divIdx, groupIndex, mIdx);
                });
                html += `</div>`;
            });

            if (canManageTournaments()) {
                html += `<button class="uha-btn uha-btn-gold" style="margin-top:10px; margin-bottom:30px;" onclick="advanceToKnockout(${divIdx})">Generate Knockout(s) from Standings</button>`;
            }
        }
    });

    const container = document.getElementById('matchup-container');
    if (container) container.innerHTML = html;
}

function generateMatchCardHTML(match, divIdx, rIdx, mIdx, bracketType = 'winners') {
    const slotName = (team) => {
        if (!team) return (match.scores === 'BYE' ? 'BYE' : 'TBD');
        return (typeof resolveBracketName === 'function') ? resolveBracketName(team) : team.name;
    };
    let teamA = slotName(match.p1);
    let teamB = slotName(match.p2);
    
    let hasScore = match.scores && match.scores !== 'BYE';
    let scoreA = hasScore ? `[${match.p1Wins}]` : '';
    let scoreB = hasScore ? `[${match.p2Wins}]` : '';

    let classA = "";
    let classB = "";

    if (hasScore) {
        if (match.p1Wins > match.p2Wins) {
            classA = "text-win";
            classB = "text-lose";
        } else if (match.p2Wins > match.p1Wins) {
            classA = "text-lose";
            classB = "text-win";
        }
    }

    let actionArea = '';
    const isLive = match.live && match.live.status === 'live';
    const liveStrip = isLive ? `<div class="live-strip"><div><span class="live-pulse">●</span> LIVE &middot; Game ${match.live.game || 1}</div><div class="live-strip-score">${match.live.p1 || 0} &ndash; ${match.live.p2 || 0}</div></div>` : '';

    if (isViewingArchive) {
        actionArea = `<div style="color:var(--text-muted); font-size:11px; text-align:center; padding:5px;">Archived - Read Only</div>`;
    } else if (teamA === "BYE" || teamB === "BYE") {
        if (canManageTournaments() && !hasScore) {
            actionArea = `<button class="uha-btn uha-btn-outline" style="width:auto; padding:5px 10px; font-size:11px; border-color: #e74c3c; color: #e74c3c;" onclick="adminAutoWinBye(${divIdx}, ${rIdx}, ${mIdx}, '${bracketType}')">Admin: Advance BYE</button>`;
        } else {
            actionArea = `<div style="color:var(--text-muted); font-size:11px; text-align:center; padding:5px;">Auto-Advance</div>`;
        }
    } else if (teamA === "TBD" || teamB === "TBD") {
        actionArea = `<div style="color:var(--text-muted); font-size:11px; text-align:center; padding:5px;">Awaiting players</div>`;
    } else if (isLive) {
        actionArea = `<button class="uha-btn" style="width:auto; padding:5px 10px; font-size:12px; background:#e74c3c;" onclick="openLiveScoring(${divIdx}, ${rIdx}, ${mIdx}, '${bracketType}')">🔴 Resume Live</button>`;
    } else if (!hasScore && canManageTournaments()) {
        actionArea = `<div style="display:flex; gap:6px; justify-content:center;">
            <button class="uha-btn" style="width:auto; padding:5px 10px; font-size:12px;" onclick="openScoreModal(${divIdx}, ${rIdx}, ${mIdx}, '${bracketType}')">Enter Score</button>
            <button class="uha-btn" style="width:auto; padding:5px 10px; font-size:12px; background:#e74c3c;" onclick="openLiveScoring(${divIdx}, ${rIdx}, ${mIdx}, '${bracketType}')">🔴 Live</button>
        </div>`;
    } else if (!hasScore) {
        actionArea = `<button class="uha-btn" style="width:auto; padding:5px 10px; font-size:12px; background:#27ae60;" onclick="openScoreChooser(${divIdx}, ${rIdx}, ${mIdx}, '${bracketType}')">Enter Score</button>`;
    } else if (hasScore && canManageTournaments()) {
        actionArea = `<button class="uha-btn uha-btn-blue" style="width:auto; padding:5px 10px; font-size:11px;" onclick="openScoreModal(${divIdx}, ${rIdx}, ${mIdx}, '${bracketType}')">Edit Score</button>`;
    } else {
        actionArea = `<div style="color:var(--uha-gold); font-size:11px; text-align:center; padding:5px; font-weight:bold;">Complete</div>`;
    }
    // Jump-to-review button for matches with pending submissions (owner/admin/director)
    if (typeof hasPendingReview === 'function' && hasPendingReview(divIdx, rIdx, mIdx, bracketType) && typeof can === 'function' && can('admin')) {
        actionArea += `<div style="text-align:center; margin-top:6px;"><button class="uha-btn" style="width:auto; padding:5px 10px; font-size:11px; background:#f39c12;" onclick="goToReview()">👀 Review</button></div>`;
    }

    const canSwap = canManageTournaments() && !isViewingArchive;
    const swapBtn = (side, team) => (canSwap && team && team !== 'BYE' && team !== 'TBD')
        ? ` <button class="swap-btn" title="Swap player" onclick="event.stopPropagation();openSwapPicker(${divIdx},${rIdx},${mIdx},'${bracketType}','${side}')">⇄</button>`
        : '';
    return `
        <div class="match-card">
            <div style="flex:1;">
                <div class="match-team ${classA}">
                    <span>${teamA}${swapBtn('p1', teamA)}</span>
                    <span>${scoreA}</span>
                </div>

                <div class="match-vs" style="color: #3498db; margin: 2px 0;">vs</div>

                <div class="match-team ${classB}">
                    <span>${teamB}${swapBtn('p2', teamB)}</span>
                    <span>${scoreB}</span>
                </div>

                ${hasScore ? `<div style="text-align:center; font-size:10px; color:#fff; margin-top:5px; border-top: 1px solid #2a2a2a; padding-top: 3px;">${match.scores}</div>` : ''}
            </div>
            ${liveStrip}
            <div style="margin-top: 8px; display: flex; justify-content: center;">
                ${actionArea}
            </div>
        </div>
    `;
}

let currentScoreContext = null;

window.openScoreModal = function(divIdx, rIdx, mIdx, bType = 'winners') {
    currentScoreContext = { divIdx, rIdx, mIdx, bType };

    let targetBracket = lockedDivisions[divIdx].bracket;
    if (bType === 'finals') targetBracket = lockedDivisions[divIdx].finalsBracket;
    else if (bType === 'losers') targetBracket = lockedDivisions[divIdx].losersBracket;
    else if (bType === 'third_place') targetBracket = lockedDivisions[divIdx].thirdPlaceMatch;

    const match = targetBracket[rIdx][mIdx];


/* Resolve bracket team name from current roster (not stored snapshot).
   Falls back to stored name if player not found. */
function resolveBracketName(team) {
    if (!team) return 'TBD';
    if (team.name === 'BYE' || team.name === 'TBD') return team.name;
    const ids = team.ids || [];
    if (!ids.length) return team.name || 'TBD';
    const names = ids.map(id => {
        const p = (typeof players !== 'undefined' ? players : []).find(x => x.id == id);
        return p ? p.name : null;
    }).filter(Boolean);
    return names.length ? names.join(' / ') : (team.name || 'TBD');
}

    let p1Name = resolveBracketName(match.p1);
    let p2Name = resolveBracketName(match.p2);
    
    document.getElementById('score-modal-title').innerText = `${p1Name} vs ${p2Name}`;

    let existing = match.scores && match.scores !== 'BYE' ? match.scores.split(',').map(s => s.split('-')) : [];
    
    let bodyHtml = `<div class="score-grid">
        <div></div>
        <div class="score-col-head">${p1Name}</div>
        <div class="score-col-head">${p2Name}</div>`;

    for(let i=0; i<3; i++) {
        let s1 = existing[i] ? existing[i][0].trim() : '';
        let s2 = existing[i] ? existing[i][1].trim() : '';
        bodyHtml += `
            <div class="score-game-label">Game ${i+1}</div>
            <input type="number" class="score-input p1-score" value="${s1}" min="0">
            <input type="number" class="score-input p2-score" value="${s2}" min="0">`;
    }
    bodyHtml += `</div>`;
    if (typeof canManageTournaments === 'function' && !canManageTournaments()) {
        bodyHtml += `<div style="margin-top:12px;"><label style="font-weight:bold; font-size:13px;">Scorekeeper name</label>
            <input type="text" id="manual-keeper" class="uha-input" placeholder="Who is entering this score?" style="width:100%; margin-top:4px;" autocomplete="off"></div>`;
    }

    document.getElementById('score-modal-body').innerHTML = bodyHtml;
    document.getElementById('score-modal').style.display = 'flex';
};

window.closeScoreModal = function() {
    document.getElementById('score-modal').style.display = 'none';
    currentScoreContext = null;
};

window.saveScore = function() {
    const { divIdx, rIdx, mIdx, bType } = currentScoreContext;

    const p1Inputs = document.querySelectorAll('.p1-score');
    const p2Inputs = document.querySelectorAll('.p2-score');

    const gameScores = [];
    for(let i=0; i<3; i++) {
        let s1 = parseInt(p1Inputs[i].value);
        let s2 = parseInt(p2Inputs[i].value);
        if (!isNaN(s1) && !isNaN(s2)) gameScores.push({ p1: s1, p2: s2 });
    }

    const isMgr = typeof canManageTournaments === 'function' && canManageTournaments();
    if (isMgr) {
        if (finalizeBracketScore(divIdx, rIdx, mIdx, bType, gameScores)) closeScoreModal();
    } else {
        const keeper = ((document.getElementById('manual-keeper') || {}).value || '').trim();
        queueTournamentResult(divIdx, rIdx, mIdx, bType, gameScores, 'manual', keeper);
        closeScoreModal();
    }
};

/* Shared by manual score entry and live scoring.
   gameScores: [{p1, p2}] in side perspective. Returns true on success. */
function finalizeBracketScore(divIdx, rIdx, mIdx, bType, gameScores) {
    const div = lockedDivisions[divIdx];

    let targetBracket = div.bracket;
    if (bType === 'finals') targetBracket = div.finalsBracket;
    else if (bType === 'losers') targetBracket = div.losersBracket;
    else if (bType === 'third_place') targetBracket = div.thirdPlaceMatch;

    const match = targetBracket[rIdx][mIdx];

    let p1Wins = 0, p2Wins = 0;
    const scoreStrings = [];
    (gameScores || []).forEach(g => {
        scoreStrings.push(`${g.p1}-${g.p2}`);
        if (g.p1 > g.p2) p1Wins++;
        else if (g.p2 > g.p1) p2Wins++;
    });

    if (scoreStrings.length === 0) { alert("Please enter at least one game score."); return false; }
    if (p1Wins === p2Wins) { alert("Match cannot end in a tie."); return false; }

    if (match.winner && (div.format === 'single_elim' || div.format === 'double_elim') && bType !== 'third_place') {
        let nextRIdx = rIdx + 1;
        let nextMIdx = (bType === 'losers' && rIdx % 2 === 0) ? mIdx : Math.floor(mIdx / 2);

        if (targetBracket[nextRIdx] && targetBracket[nextRIdx][nextMIdx]) {
            let nextMatch = targetBracket[nextRIdx][nextMIdx];
            if (nextMatch.winner) {
                if(!confirm("Warning: Changing this score will erase the bracket forward. Continue?")) return;
                wipeForwardBracket(divIdx, rIdx, mIdx, bType);
            }
        }

        if (bType === 'winners' && div.format === 'single_elim' && div.hasThirdPlaceMatch) {
            if (rIdx === div.bracket.length - 2 && div.thirdPlaceMatch && div.thirdPlaceMatch[0][0].winner) {
                div.thirdPlaceMatch[0][0].scores = '';
                div.thirdPlaceMatch[0][0].p1Wins = 0;
                div.thirdPlaceMatch[0][0].p2Wins = 0;
                div.thirdPlaceMatch[0][0].winner = null;
            }
        }
    }

    match.scores = scoreStrings.join(', ');
    match.p1Wins = p1Wins;
    match.p2Wins = p2Wins;
    match.winner = p1Wins > p2Wins ? 'p1' : 'p2';

    const winningTeam = match.winner === 'p1' ? match.p1 : match.p2;
    const losingTeam = match.winner === 'p1' ? match.p2 : match.p1;

    let detailedGames = [];
    gameScores.forEach(g => {
        let wScore = match.winner === 'p1' ? g.p1 : g.p2;
        let lScore = match.winner === 'p1' ? g.p2 : g.p1;
        detailedGames.push({ w: wScore, l: lScore });
    });

    // Player ids ride on the team objects from draft time (no name matching).
    const teamPlayerIds = (team) => {
        if (!team || !Array.isArray(team.ids)) return [];
        // Number("") is 0 — drop it so a blank id can't pass the length guard below.
        return team.ids.map(Number).filter(id => !isNaN(id) && id > 0);
    };
    const winnerIds = teamPlayerIds(winningTeam);
    const loserIds = teamPlayerIds(losingTeam);
    if (!winnerIds.length || !loserIds.length) {
        alert("Could not resolve player IDs for this match — score was not queued.");
        return;
    }

    const pendingMatch = {
        id: Date.now(),
        mode: div.mode ? div.mode.toLowerCase() : 'unknown',
        score: `${Math.max(p1Wins, p2Wins)}-${Math.min(p1Wins, p2Wins)}`,
        winners: winnerIds,
        losers: loserIds,
        games: detailedGames
    };

    db.ref('pending').push(pendingMatch)
    .catch(e => console.error("Pending queue error:", e));

    try {
        if (bType !== 'third_place') {
            progressBracket(divIdx, rIdx, mIdx, bType);
        }

        if (bType === 'winners' && div.format === 'single_elim' && div.hasThirdPlaceMatch && div.thirdPlaceMatch) {
            let totalRounds = div.bracket.length;
            if (rIdx === totalRounds - 2) { // It's a semifinal match
                if (mIdx % 2 === 0) {
                    div.thirdPlaceMatch[0][0].p1 = losingTeam; // Route top semi loser
                } else {
                    div.thirdPlaceMatch[0][0].p2 = losingTeam; // Route bottom semi loser
                }
            }
        }

    } catch (err) {
        console.error("Auto-advance failed, but saving score anyway:", err);
    }

    renderTournamentView();

    const titleEl = document.getElementById('tourney-title');
    const inputEl = document.getElementById('tournament-name');
    const tName = titleEl ? titleEl.innerText : (inputEl ? inputEl.value : "Aggie Tournament");

    db.ref('tournaments/active').set({
        name: tName,
        updatedAt: firebase.database.ServerValue.TIMESTAMP,
        divisions: lockedDivisions
    }).then(() => {
        console.log("Tournament state saved successfully.");
    }).catch(e => console.error("Firebase auto-save failed:", e));
    return true;
}

function wipeForwardBracket(divIdx, rIdx, mIdx, bType = 'winners') {
    let div = lockedDivisions[divIdx];
    let targetBracket = bType === 'finals' ? div.finalsBracket : (bType === 'losers' ? div.losersBracket : div.bracket);

    let currR = rIdx;
    let currM = mIdx;

    while (targetBracket[currR + 1]) {

        let nextM = (bType === 'losers' && currR % 2 === 0) ? currM : Math.floor(currM / 2);
        let nextMatch = targetBracket[currR + 1][nextM];

        if (nextMatch) {
            nextMatch.p1 = null; nextMatch.p2 = null;
            nextMatch.scores = ''; nextMatch.p1Wins = 0; nextMatch.p2Wins = 0;
            nextMatch.winner = null;
        }
        currR++;
        currM = nextM;
    }
}

function progressBracket(divIdx, rIdx, mIdx, bType) {
    let div = lockedDivisions[divIdx];
    if (div.format !== 'single_elim' && div.format !== 'double_elim') return;

    if (!bType) bType = currentScoreContext ? currentScoreContext.bType : 'winners';
    let targetBracket = bType === 'finals' ? div.finalsBracket : (bType === 'losers' ? div.losersBracket : div.bracket);
    let match = targetBracket[rIdx][mIdx];
    
    let winner = match.winner === 'p1' ? match.p1 : match.p2;
    let loser = match.winner === 'p1' ? match.p2 : match.p1;
    
    let nextRIdx = rIdx + 1;
    let nextMIdx = Math.floor(mIdx / 2);

    if (bType === 'winners') {
        if (div.bracket[nextRIdx]) {
            if (mIdx % 2 === 0) div.bracket[nextRIdx][nextMIdx].p1 = winner;
            else div.bracket[nextRIdx][nextMIdx].p2 = winner;
        } else if (div.format === 'double_elim' && div.finalsBracket) {
            div.finalsBracket[0][0].p1 = winner;
        }

        if (div.format === 'double_elim' && div.losersBracket && match.loserDest) { 
            let lr = match.loserDest.rIdx;
            let lm = match.loserDest.mIdx;
            let slot = match.loserDest.slot;

            if (div.losersBracket[lr] && div.losersBracket[lr][lm]) {
                div.losersBracket[lr][lm][slot] = loser;
            }
        }
    } else if (bType === 'losers') {
        if (div.losersBracket[nextRIdx]) {
            if (rIdx % 2 === 0) {
                div.losersBracket[nextRIdx][mIdx].p1 = winner;
            } else {
                if (mIdx % 2 === 0) div.losersBracket[nextRIdx][nextMIdx].p1 = winner;
                else div.losersBracket[nextRIdx][nextMIdx].p2 = winner;
            }
        } else if (div.format === 'double_elim' && div.finalsBracket) {
            div.finalsBracket[0][0].p2 = winner;
        }
    } else if (bType === 'finals') {

        if (rIdx === 0 && div.finalsBracket[1]) {
            if (match.winner === 'p2') {
                div.finalsBracket[1][0].p1 = match.p1;
                div.finalsBracket[1][0].p2 = match.p2;
            } else {
                div.finalsBracket[1][0].p1 = null;
                div.finalsBracket[1][0].p2 = null;
                div.finalsBracket[1][0].scores = '';
                div.finalsBracket[1][0].winner = null;
            }
        }
    }
}

window.adminAutoWinBye = function(divIdx, rIdx, mIdx, bType) {
    if (!confirm("Admin: Advance the real player past this BYE?")) return;
    
    const div = lockedDivisions[divIdx];
    const targetBracket = bType === 'finals' ? div.finalsBracket : (bType === 'losers' ? div.losersBracket : div.bracket);
    const match = targetBracket[rIdx][mIdx];

    const p1IsBye = !match.p1 || match.p1.name === "BYE";
    const p2IsBye = !match.p2 || match.p2.name === "BYE";

    if (p1IsBye && p2IsBye) return alert("Both slots are empty or BYEs. Nothing to advance.");

    match.winner = p1IsBye ? 'p2' : 'p1';
    match.scores = "BYE";
    match.p1Wins = p1IsBye ? 0 : 1;
    match.p2Wins = p1IsBye ? 1 : 0;

    currentScoreContext = { divIdx, rIdx, mIdx, bType };

    try {
        progressBracket(divIdx, rIdx, mIdx, bType);
    } catch (e) {
        console.error("Progress error:", e);
        alert("Advanced the score, but could not push forward automatically. Use the Override tool.");
    }
    
    currentScoreContext = null;
    renderTournamentView();

    const titleEl = document.getElementById('tourney-title');
    const inputEl = document.getElementById('tournament-name');
    const tName = titleEl ? titleEl.innerText : (inputEl ? inputEl.value : "Aggie Tournament");

    db.ref('tournaments/active').set({
        name: tName,
        updatedAt: firebase.database.ServerValue.TIMESTAMP,
        divisions: lockedDivisions
    }).catch(e => console.error("Firebase auto-save failed:", e));
};

window.openManualMoveModal = function() {
    if (!canManageTournaments()) return;
    if (!lockedDivisions || lockedDivisions.length === 0) return alert("No active divisions to edit.");
    const selector = document.getElementById('move-div-idx');
    selector.innerHTML = lockedDivisions.map((div, i) => `<option value="${i}">${div.name}</option>`).join('');
    selector.onchange = refreshMovePlayerOptions;
    refreshMovePlayerOptions();
    document.getElementById('manual-move-modal').style.display = 'flex';
};

function refreshMovePlayerOptions() {
    const sel = document.getElementById('move-player-name');
    const divIdx = document.getElementById('move-div-idx').value;
    const div = lockedDivisions[divIdx];
    if (!sel || !div) return;
    // Every option is a real participant, so the moved player always carries ids.
    const seen = new Set();
    const opts = (div.participants || []).filter(pt => {
        const key = (pt.name || '').toLowerCase();
        if (!key || seen.has(key)) return false;
        seen.add(key); return true;
    }).map(pt => `<option value="${pt.name}">${pt.name}</option>`).join('');
    sel.innerHTML = opts || '<option value="">No participants</option>';
}

window.executeManualMove = function() {
    const divIdx = document.getElementById('move-div-idx').value;
    const pName = document.getElementById('move-player-name').value;
    const bType = document.getElementById('move-target-bracket').value; 
    const roundNum = parseInt(document.getElementById('move-target-round').value) - 1; // 0-indexed internally
    const matchNum = parseInt(document.getElementById('move-target-match').value) - 1; // 0-indexed internally
    const slot = document.getElementById('move-target-slot').value;

    if (!pName) return alert("Please enter a player name.");
    if (isNaN(roundNum) || isNaN(matchNum)) return alert("Please enter valid Round and Match numbers.");

    const div = lockedDivisions[divIdx];
    const targetBracket = div[bType];

    if (!targetBracket || !targetBracket[roundNum] || !targetBracket[roundNum][matchNum]) {
        return alert("That specific round or match does not exist in the selected bracket.");
    }

    let playerObj = (div.participants || []).find(pt => pt.name === pName)
        || allPlayers.find(pt => pt.name === pName);
    // No id-less fallback: a manually moved player must resolve for the
    // tournament -> approval queue -> ELO pipeline to work.
    if (!playerObj || !playerObj.ids || !playerObj.ids.length) {
        return alert("That player has no database record — add them to the database first.");
    }

    targetBracket[roundNum][matchNum][slot] = playerObj;

    db.ref('tournaments/active').update({ divisions: lockedDivisions }).then(() => {
        alert(`Successfully moved ${playerObj.name}.`);
        renderTournamentView();
        document.getElementById('manual-move-modal').style.display = 'none';
    }).catch(e => alert("Error saving move: " + e.message));
};

window.archiveTournament = function() {
    if (!canManageTournaments()) return;
    
    db.ref('tournaments/active').once('value').then((snapshot) => {
        const data = snapshot.val();
        if (!data) return alert("No active tournament found to archive.");

        const tName = data.name || "Untitled Tournament";
        if (!confirm(`Are you sure you want to archive "${tName}"?\n\nIt will be moved to history and become read-only. This will clear the dashboard for a new event.`)) return;

        const archiveID = "tourney_" + Date.now();
        return db.ref('tournaments/archived/' + archiveID).set(data).then(() => {
            return db.ref('tournaments/active').remove();
        }).then(() => {
            alert(`"${tName}" archived successfully.`);
            location.reload();
        });
    }).catch(e => console.error("Archive failed:", e));
};

function loadArchiveList() {
    const selector = document.getElementById('public-tournament-selector');
    if (!selector) return;

    db.ref('tournaments/archived').on('value', (snapshot) => {
        const archives = snapshot.val();

        selector.innerHTML = '<option value="active">Current Live Tournament</option>';
        
        if (!archives) return;

        Object.keys(archives).forEach(key => {
            const tourney = archives[key];
            const date = new Date(tourney.updatedAt).toLocaleDateString();
            const name = tourney.name || "Past Event";
            const option = document.createElement('option');
            option.value = 'archived/' + key;
            option.textContent = `${name} (${date})`;
            selector.appendChild(option);
        });
        console.log("Archives loaded:", Object.keys(archives).length);
    });
}

let currentTourneyPath = null;
function refreshDivisionSelector() {
    const sel = document.getElementById('public-division-selector');
    if (!sel) return;
    sel.innerHTML = '<option value="all">All Events</option>';
    lockedDivisions.forEach((div, i) => {
        const o = document.createElement('option');
        o.value = String(i);
        o.textContent = div.name || ('Event ' + (i + 1));
        sel.appendChild(o);
    });
}
function loadTournamentData(path) {
    if (currentTourneyPath) db.ref('tournaments/' + currentTourneyPath).off();
    currentTourneyPath = path;
    const divSel = document.getElementById('public-division-selector');
    if (divSel) divSel.value = 'all';
    db.ref('tournaments/' + path).on('value', (snapshot) => {
        const data = snapshot.val();
        if (data && data.divisions) {
            lockedDivisions = data.divisions;
            const titleEl = document.getElementById('tourney-title');
            if(titleEl) titleEl.innerText = data.name || "Live Tournament";

            renderTournamentView();
            refreshDivisionSelector();
            if (typeof renderLiveOverlay === 'function' && typeof liveCtx !== 'undefined' && liveCtx) renderLiveOverlay();
        } else {
            lockedDivisions = [];
            refreshDivisionSelector();
            const container = document.getElementById('matchup-container');
            if(container) container.innerHTML = "<div style='text-align:center; padding: 50px; color: #888;'>No tournament data found for this selection.</div>";
        }
    });
}

window.editActiveTournament = function() {
    if (!canManageTournaments()) return;
    if (!confirm("This will pull the current live tournament back into the setup area so you can add or delete events. Player swaps and score fixes are done directly on the bracket. Ready?")) return;

    db.ref('tournaments/active').once('value').then((snapshot) => {
        const data = snapshot.val();
        if (!data || !data.divisions) return alert("No active tournament found to edit.");

        lockedDivisions = data.divisions;
        document.getElementById('tournament-name').value = data.name || "";

        const first = (lockedDivisions || [])[0];
        if (first) {
            setDoublesMode(first.mode === 'Doubles', { silent: true });
            const fmtSel = document.getElementById('division-format');
            if (fmtSel && first.format) {
                fmtSel.value = first.format;
                toggleFormatOptions();
            }
        }

        goToAdminTournaments();
        renderLockedDivisions();
        renderRoster();
        
        alert("Setup reloaded. Add new events below, or delete events from the locked list. For player/score changes, use the bracket directly.");
    });
};

const divSelector = document.getElementById('public-division-selector');
if (divSelector) {
    divSelector.addEventListener('change', (e) => {
        if (e.target.value === 'all') return;
        const el = document.getElementById('division-' + e.target.value);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
}

const pubSelector = document.getElementById('public-tournament-selector');
if (pubSelector) {
    pubSelector.addEventListener('change', (e) => {
        const path = e.target.value;

        isViewingArchive = path.startsWith('archived');

        const archiveBtn = document.getElementById('btn-archive');
        if (archiveBtn) {
            archiveBtn.style.display = (isAdmin && !isViewingArchive) ? 'block' : 'none';
        }

        loadTournamentData(path);
    });
}

loadArchiveList();
onPlayersUpdate(refreshRosterFromDB);
// Re-render brackets when roster loads (names resolve by ID)
onPlayersUpdate(() => {
    if (typeof renderTournamentView === 'function') renderTournamentView();
});

loadTournamentData('active');

/* ================= participant swap =================
   Swap a player/team in a bracket slot without destroying the bracket.
   The new team inherits the slot; future (undecided) matches showing the
   old team are updated. Decided matches (history) are left alone. */
let swapCtx = null;
let swapPicks = [];

function swapBracket(div, bType) {
    if (bType === 'finals') return div.finalsBracket;
    if (bType === 'losers') return div.losersBracket;
    if (bType === 'third_place') return div.thirdPlaceMatch;
    return div.bracket;
}

window.openSwapPicker = function(divIdx, rIdx, mIdx, bType = 'winners', side = 'p1') {
    if (typeof canManageTournaments === 'function' && !canManageTournaments()) return;
    const div = lockedDivisions[divIdx];
    const br = swapBracket(div, bType);
    const match = br && br[rIdx] && br[rIdx][mIdx];
    if (!match || !match[side]) return;
    swapCtx = { divIdx, rIdx, mIdx, bType, side };
    swapPicks = [];
    const sub = document.getElementById('swap-modal-sub');
    const oldName = match[side].name || side.toUpperCase();
    const need = (div.mode && div.mode.toLowerCase() === 'doubles') ? 2 : 1;
    if (sub) sub.textContent = `Replacing ${oldName} — select ${need === 1 ? 'a player' : '2 players'}. Future undecided matches update too; decided matches are left as history.`;
    const search = document.getElementById('swap-search');
    if (search) search.value = '';
    renderSwapList();
    document.getElementById('swap-modal').style.display = 'flex';
};

window.closeSwapPicker = function() {
    document.getElementById('swap-modal').style.display = 'none';
    swapCtx = null;
    swapPicks = [];
};

window.renderSwapList = function() {
    const list = document.getElementById('swap-list');
    if (!list || !swapCtx) return;
    const q = (document.getElementById('swap-search').value || '').toLowerCase();
    const div = lockedDivisions[swapCtx.divIdx];
    const isDoubles = div.mode && div.mode.toLowerCase() === 'doubles';
    const eloKey = isDoubles ? 'doubles' : 'singles';
    list.innerHTML = '';
    (players || [])
        .filter(pl => !q || (pl.name || '').toLowerCase().includes(q))
        .slice(0, 60)
        .forEach(pl => {
            const sel = swapPicks.includes(pl.id) ? ' selected' : '';
            const row = document.createElement('div');
            row.className = 'swap-pick' + sel;
            row.innerHTML = `<span><b>${pl.name}</b> <span class="muted">#${pl.id}</span></span><span>${Math.round(pl[eloKey] || 1000)}</span>`;
            row.onclick = () => toggleSwapPick(pl.id, isDoubles);
            list.appendChild(row);
        });
};

window.toggleSwapPick = function(id, isDoubles) {
    if (!isDoubles) {
        swapPicks = [id];
    } else {
        const i = swapPicks.indexOf(id);
        if (i >= 0) swapPicks.splice(i, 1);
        else if (swapPicks.length < 2) swapPicks.push(id);
    }
    renderSwapList();
};

function swapTeamEq(a, b) {
    if (!a || !b) return false;
    const ka = JSON.stringify((a.ids || []).map(Number).sort());
    const kb = JSON.stringify((b.ids || []).map(Number).sort());
    return ka.length > 2 && ka === kb;
}

window.confirmSwap = function() {
    if (!swapCtx) return;
    const { divIdx, rIdx, mIdx, bType, side } = swapCtx;
    const div = lockedDivisions[divIdx];
    const isDoubles = div.mode && div.mode.toLowerCase() === 'doubles';
    const need = isDoubles ? 2 : 1;
    if (swapPicks.length !== need) {
        alert(isDoubles ? 'Select 2 players for a doubles team.' : 'Select a player.');
        return;
    }
    const picked = swapPicks.map(id => (players || []).find(p => p.id == id)).filter(Boolean);
    if (picked.length !== need) return alert('Player not found.');
    const eloKey = isDoubles ? 'doubles' : 'singles';
    const avgElo = Math.round(picked.reduce((t, p) => t + (parseFloat(p[eloKey]) || 1000), 0) / picked.length);
    const newTeam = {
        name: picked.map(p => p.name).join(' & '),
        ids: picked.map(p => p.id),
        elo: avgElo,
    };

    const br = swapBracket(div, bType);
    const match = br[rIdx][mIdx];
    const oldTeam = match[side];
    if (!confirm(`Replace ${oldTeam.name || side.toUpperCase()} with ${newTeam.name}?`)) return;

    // swap in this match
    match[side] = newTeam;

    // propagate to future undecided matches (all brackets); leave history alone
    ['winners', 'losers', 'finals', 'third_place'].forEach(bt => {
        const b = swapBracket(div, bt);
        if (!b) return;
        b.forEach((round, ri) => {
            (round || []).forEach((m, mi) => {
                if (!m || m.winner) return;
                if (bt === bType && ri === rIdx && mi === mIdx) return; // source already done
                if (swapTeamEq(m.p1, oldTeam)) m.p1 = newTeam;
                if (swapTeamEq(m.p2, oldTeam)) m.p2 = newTeam;
            });
        });
    });

    db.ref('tournaments/active').update({ divisions: lockedDivisions })
        .then(() => {
            closeSwapPicker();
            renderTournamentView();
            if (typeof showToast === 'function') showToast(`Swapped in ${newTeam.name}.`);
        })
        .catch(e => alert('Could not save swap: ' + e.message));
};

/* ============ public tournament results -> review queue ============
   Volunteers (non-managers) can score via Live or Enter Score, but the
   result goes to the pending queue. On approve, it commits to the bracket
   via finalizeBracketScore (advances winner, queues ELO). */
function queueTournamentResult(divIdx, rIdx, mIdx, bType, gameScores, source, keeper) {
    const div = lockedDivisions[divIdx];
    if (!div) return alert('Tournament data not loaded.');
    const br = swapBracket(div, bType);
    const match = br && br[rIdx] && br[rIdx][mIdx];
    if (!match || !match.p1 || !match.p2) return alert('Match not found.');

    let p1Wins = 0, p2Wins = 0;
    const detailedGames = [];
    (gameScores || []).forEach(g => {
        if (g.p1 > g.p2) p1Wins++; else if (g.p2 > g.p1) p2Wins++;
        detailedGames.push({ w: Math.max(g.p1, g.p2), l: Math.min(g.p1, g.p2) });
    });
    if (!p1Wins && !p2Wins) return alert('Please enter at least one game score.');
    if (p1Wins === p2Wins) return alert('Match cannot end in a tie.');

    const winnerSide = p1Wins > p2Wins ? 'p1' : 'p2';
    const teamIds = (t) => (t && Array.isArray(t.ids) ? t.ids.map(Number).filter(n => n > 0) : []);
    const winnerIds = teamIds(match[winnerSide]);
    const loserIds = teamIds(match[winnerSide === 'p1' ? 'p2' : 'p1']);
    if (!winnerIds.length || !loserIds.length) return alert('Could not resolve player IDs.');

    const roundLabel = bType === 'third_place' ? '3rd Place' :
        (bType === 'finals' ? 'Final' : bType === 'losers' ? `Losers R${rIdx + 1}` : `Round ${rIdx + 1}`);

    db.ref('pending').push({
        id: Date.now(),
        mode: div.mode ? div.mode.toLowerCase() : 'unknown',
        score: `${Math.max(p1Wins, p2Wins)}-${Math.min(p1Wins, p2Wins)}`,
        winners: winnerIds,
        losers: loserIds,
        games: detailedGames,
        source: source || 'live',
        keeper: keeper || '',
        bracketRef: {
            divIdx, rIdx, mIdx, bType,
            divName: div.name || 'Event',
            roundLabel,
            p1Name: match.p1.name, p2Name: match.p2.name,
            p1Ids: winnerSide === 'p1' ? winnerIds : loserIds,
            p2Ids: winnerSide === 'p1' ? loserIds : winnerIds,
        },
        submittedAt: new Date().toISOString(),
    }).then(() => {
        showToast('Result submitted for review!');
    }).catch(e => alert('Could not submit: ' + e.message));
}

window.goToReview = function() {
    switchScreen('admin');
    if (typeof switchAdminTab === 'function') switchAdminTab('review');
};


/* ================= live scoring =================
   Each bracket match can carry match.live = {
     status:'live', p1, p2 (current game points), game (game number),
     games:[{p1,p2} finished], target, winByTwo, server:'p1'|'p2',
     timeouts:{p1,p2} (used this game), timeoutLimit,
     updatedAt, updatedBy }
   Writes go to the single live node so every viewer updates instantly
   through the existing tournament listener. */
let liveCtx = null;
let liveEndAck = false; // game-end interstitial already shown for this game
const liveSessionId = 's' + Math.random().toString(36).slice(2) + Date.now().toString(36);
let liveHeartbeat = null;
const LOCK_TTL_MS = 60000; // a lock older than this is considered abandoned

function liveLockFresh(live) {
    return live && live.lockId && live.lockId !== liveSessionId &&
        live.lockAt && (Date.now() - live.lockAt) < LOCK_TTL_MS;
}
function startLiveHeartbeat() {
    stopLiveHeartbeat();
    liveHeartbeat = setInterval(() => {
        if (!liveCtx) return stopLiveHeartbeat();
        db.ref(liveNodePath()).transaction(live => {
            if (!live || live.status !== 'live') return live;
            // only refresh if I still hold it (or it's mine/stale)
            if (!live.lockId || live.lockId === liveSessionId || (live.lockAt && (Date.now() - live.lockAt) >= LOCK_TTL_MS)) {
                live.lockId = liveSessionId;
                live.lockAt = Date.now();
            }
            return live;
        });
    }, 15000);
}
function stopLiveHeartbeat() {
    if (liveHeartbeat) { clearInterval(liveHeartbeat); liveHeartbeat = null; }
}
function releaseLiveLock() {
    stopLiveHeartbeat();
    if (!liveCtx) return;
    db.ref(liveNodePath()).transaction(live => {
        if (!live) return live;
        if (live.lockId === liveSessionId) { live.lockId = null; live.lockAt = 0; }
        return live;
    });
}

function liveBracketKey(bType) {
    return bType === 'finals' ? 'finalsBracket'
         : bType === 'losers' ? 'losersBracket'
         : bType === 'third_place' ? 'thirdPlaceMatch' : 'bracket';
}
function getLiveMatch() {
    if (!liveCtx) return null;
    const div = lockedDivisions[liveCtx.divIdx];
    if (!div) return null;
    const tb = div[liveBracketKey(liveCtx.bType)];
    return (tb && tb[liveCtx.rIdx]) ? tb[liveCtx.rIdx][liveCtx.mIdx] : null;
}
function liveNodePath() {
    const c = liveCtx;
    return `tournaments/active/divisions/${c.divIdx}/${liveBracketKey(c.bType)}/${c.rIdx}/${c.mIdx}/live`;
}
function writeLive(live) {
    live.updatedAt = firebase.database.ServerValue.TIMESTAMP;
    live.updatedBy = (typeof currentUser !== 'undefined' && currentUser && currentUser.email) || '';
    return db.ref(liveNodePath()).set(live);
}
function liveTeamName(match, side) {
    const t = side === 'p1' ? match.p1 : match.p2;
    return (t && t.name) ? t.name : side.toUpperCase();
}
// doubles teams are "A & B" — stack the names in the server picker
function serverNameHtml(name) {
    return String(name).split(' & ').map(s => `<div>${s}</div>`).join('');
}
function liveGameDone(live) {
    if (!live || live.status !== 'live') return false;
    const t = live.target || 21;
    const reached = (live.p1 >= t) || (live.p2 >= t);
    if (!reached) return false;
    if (live.winByTwo && Math.abs(live.p1 - live.p2) < 2) return false;
    return true;
}

/* Unified score entry: one button -> choose live scoring or final score */
window.openScoreChooser = function(divIdx, rIdx, mIdx, bType = 'winners') {
    const div = lockedDivisions[divIdx];
    const br = div ? div[liveBracketKey(bType)] : null;
    const match = br && br[rIdx] && br[rIdx][mIdx];
    const n1 = match && match.p1 ? match.p1.name : 'TBD';
    const n2 = match && match.p2 ? match.p2.name : 'TBD';
    const liveActive = !!(match && match.live && match.live.status === 'live');
    const locked = liveActive && liveLockFresh(match.live);
    const who = locked && match.live.keeper ? ` (${match.live.keeper})` : '';
    const body = document.getElementById('score-modal-body');
    document.getElementById('score-modal-title').innerText = `${n1} vs ${n2}`;
    body.innerHTML = `
        <p class="muted" style="text-align:center; margin-top:0;">How do you want to enter this score?</p>
        <div style="display:flex; flex-direction:column; gap:10px;">
            <button class="uha-btn" style="background:#e74c3c; padding:14px;${locked ? ' opacity:0.7;' : ''}" onclick="closeScoreModal(); openLiveScoring(${divIdx}, ${rIdx}, ${mIdx}, '${bType}')">
                🔴 Live Scoring${locked ? `<div style="font-size:11px; font-weight:normal;">In use${who} — tap for options</div>` : '<div style="font-size:11px; font-weight:normal;">Score point-by-point in real time</div>'}
            </button>
            <button class="uha-btn uha-btn-blue" style="padding:14px;" onclick="openScoreModal(${divIdx}, ${rIdx}, ${mIdx}, '${bType}')">
                📝 Enter Final Score<div style="font-size:11px; font-weight:normal;">Type in the completed game scores</div>
            </button>
        </div>`;
    document.getElementById('score-modal').style.display = 'flex';
};

window.openLiveScoring = function(divIdx, rIdx, mIdx, bType = 'winners') {
    if (typeof currentTourneyPath !== 'undefined' && currentTourneyPath !== 'active') {
        alert('Live scoring is only available on the active tournament.');
        return;
    }
    liveCtx = { divIdx, rIdx, mIdx, bType };
    liveEndAck = false;
    const match = getLiveMatch();
    const existing = match && match.live;
    if (existing && existing.status === 'live' && liveLockFresh(existing)) {
        const who = existing.keeper ? ` (${existing.keeper})` : '';
        const body = document.getElementById('live-modal-body');
        const modal = document.getElementById('live-modal');
        if (modal) modal.style.display = 'flex';
        if (body) body.innerHTML = `
            <h2 style="color:var(--uha-gold);margin-top:0;">Scorekeeper Active</h2>
            <p>Someone${who} is currently scoring this match on another device.</p>
            <p class="muted" style="font-size:12px;">Only one scorekeeper at a time. If they've left, you can take over.</p>
            <div style="display:flex;gap:10px;margin-top:16px;">
                <button class="uha-btn" style="flex:1;background:#e74c3c;" onclick="takeOverLive()">Take Over</button>
                <button class="uha-btn-outline" style="flex:1;" onclick="closeLiveModal()">Cancel</button>
            </div>`;
        return;
    }
    const modal = document.getElementById('live-modal');
    if (modal) modal.style.display = 'flex';
    renderLiveOverlay();
};
window.takeOverLive = function() {
    const match = getLiveMatch();
    if (match && match.live) { match.live.lockId = liveSessionId; match.live.lockAt = Date.now(); }
    // force the lock over, then heartbeat keeps it
    db.ref(liveNodePath()).update({ lockId: liveSessionId, lockAt: Date.now() }).catch(() => {});
    startLiveHeartbeat();
    renderLiveOverlay();
};
window.closeLiveModal = function() {
    releaseLiveLock();
    const modal = document.getElementById('live-modal');
    if (modal) modal.style.display = 'none';
    liveCtx = null;
    liveEndAck = false;
};

window.startLiveScoring = function() {
    const target = parseInt((document.getElementById('live-setup-target') || {}).value) || 21;
    const toLimit = parseInt((document.getElementById('live-setup-to') || {}).value);
    const keeper = ((document.getElementById('live-setup-keeper') || {}).value || '').trim();
    const serverEl = document.querySelector('input[name="live-server"]:checked');
    const live = {
        status: 'live', p1: 0, p2: 0, game: 1, games: [],
        target: target, winByTwo: false,
        server: serverEl ? serverEl.value : 'p1',
        timeouts: { p1: 0, p2: 0 }, timeoutLimit: isNaN(toLimit) ? 2 : toLimit,
        keeper: keeper,
        lockId: liveSessionId, lockAt: Date.now(),
    };
    startLiveHeartbeat();
    // optimistic: show the scoring view immediately instead of waiting
    // for the listener round-trip
    const match = getLiveMatch();
    if (match) match.live = live;
    renderLiveOverlay();
    writeLive(live).catch(e => alert('Could not start live scoring: ' + e.message));
};

window.livePoint = function(side, delta = 1) {
    if (!liveCtx) return;
    db.ref(liveNodePath()).transaction(live => {
        if (!live || live.status !== 'live') return live;
        live[side] = Math.max(0, (live[side] || 0) + delta);
        return live;
    }).then(res => {
        const live = res && res.snapshot ? res.snapshot.val() : null;
        if (live && liveGameDone(live) && !liveEndAck) {
            liveEndAck = true;
            showLiveGameEnd(live);
        }
    });
};
window.liveTimeout = function(side) {
    if (!liveCtx) return;
    db.ref(liveNodePath()).transaction(live => {
        if (!live || live.status !== 'live') return live;
        live.timeouts = live.timeouts || { p1: 0, p2: 0 };
        const used = live.timeouts[side] || 0;
        if (used >= (live.timeoutLimit || 2)) return live;
        live.timeouts[side] = used + 1;
        return live;
    });
};
window.liveToggleServer = function() {
    const match = getLiveMatch();
    if (!match || !match.live) return;
    const live = match.live;
    live.server = live.server === 'p1' ? 'p2' : 'p1';
    writeLive(live);
};
function showLiveGameEnd(live) {
    const match = getLiveMatch();
    if (!match) return;
    const winnerSide = live.p1 > live.p2 ? 'p1' : 'p2';
    const wName = liveTeamName(match, winnerSide);
    document.getElementById('live-gameend-title').textContent = `Game ${live.game} — ${wName} wins`;
    document.getElementById('live-gameend-score').textContent = `${live.p1} – ${live.p2}`;
    const doneGames = live.games || [];
    const w = doneGames.filter(g => g.p1 > g.p2).length + (winnerSide === 'p1' ? 1 : 0);
    const l = doneGames.length + 1 - w;
    document.getElementById('live-games-tally').textContent = `Games: ${w} – ${l}`;
    document.getElementById('live-next-target').value = live.target || 21;
    document.getElementById('live-gameend').hidden = false;
}
window.liveNextGame = function() {
    const match = getLiveMatch();
    if (!match || !match.live) return;
    const live = match.live;
    const target = parseInt((document.getElementById('live-next-target') || {}).value) || live.target || 21;
    live.games = live.games || [];
    live.games.push({ p1: live.p1, p2: live.p2 });
    live.p1 = 0; live.p2 = 0;
    live.game = (live.game || 1) + 1;
    live.target = target;
    live.timeouts = { p1: 0, p2: 0 };
    liveEndAck = false;
    document.getElementById('live-gameend').hidden = true;
    writeLive(live).catch(e => alert('Failed: ' + e.message));
};
window.liveEndGameManual = function() {
    const match = getLiveMatch();
    if (!match || !match.live) return;
    const live = match.live;
    if (live.p1 === 0 && live.p2 === 0) { alert('No points scored yet.'); return; }
    if (live.p1 === live.p2) { alert('A game cannot end tied.'); return; }
    liveEndAck = true;
    showLiveGameEnd(live);
};
window.liveCommitMatch = function() {
    const match = getLiveMatch();
    if (!match || !match.live || !liveCtx) return;
    const live = match.live;
    const gameScores = (live.games || []).map(g => ({ p1: g.p1, p2: g.p2 }));
    // the current game isn't banked yet when ending from the game-end interstitial
    if ((live.p1 || 0) > 0 || (live.p2 || 0) > 0) {
        const last = gameScores[gameScores.length - 1];
        if (!last || last.p1 !== live.p1 || last.p2 !== live.p2) gameScores.push({ p1: live.p1, p2: live.p2 });
    }
    if (!gameScores.length) { alert('No completed games yet.'); return; }
    const w1 = gameScores.filter(g => g.p1 > g.p2).length;
    const wName = liveTeamName(match, w1 > gameScores.length / 2 ? 'p1' : 'p2');
    if (!confirm(`End match and record ${wName} as the winner?\nGames: ` + gameScores.map(g => `${g.p1}-${g.p2}`).join(', '))) return;
    const { divIdx, rIdx, mIdx, bType } = liveCtx;
    const isMgr = typeof canManageTournaments === 'function' && canManageTournaments();
    document.getElementById('live-gameend').hidden = true;
    if (isMgr) {
        delete match.live;
        if (finalizeBracketScore(divIdx, rIdx, mIdx, bType, gameScores)) {
            closeLiveModal();
        } else {
            match.live = live; // restore if finalize bailed
        }
    } else {
        // volunteers queue for review; clear the live node
        queueTournamentResult(divIdx, rIdx, mIdx, bType, gameScores, 'live', match.live.keeper);
        db.ref(liveNodePath()).remove().catch(() => {});
        closeLiveModal();
    }
};

function renderLiveOverlay() {
    const body = document.getElementById('live-modal-body');
    if (!body || !liveCtx) return;
    const match = getLiveMatch();
    if (!match) { body.innerHTML = '<p class="muted">Match not found.</p>'; return; }
    const n1 = liveTeamName(match, 'p1');
    const n2 = liveTeamName(match, 'p2');

    if (!match.live || match.live.status !== 'live') {
        // setup view
        body.innerHTML = `
            <h2 style="color:var(--uha-gold);margin-top:0;">Start Live Scoring</h2>
            <p class="muted" style="margin-top:0;">${n1} vs ${n2}</p>
            <div style="display:grid;gap:12px;text-align:left;">
                <div><label style="font-weight:bold;">Points per game</label>
                    <input type="number" id="live-setup-target" class="uha-input" value="21" min="1"></div>
                <div><label style="font-weight:bold;">Timeouts per game (each side)</label>
                    <input type="number" id="live-setup-to" class="uha-input" value="2" min="0"></div>
                <div><label style="font-weight:bold;">First server</label>
                    <div style="display:flex;gap:8px;margin-top:4px;">
                        <label class="live-server-opt"><input type="radio" name="live-server" value="p1" checked><span>${serverNameHtml(n1)}</span></label>
                        <label class="live-server-opt"><input type="radio" name="live-server" value="p2"><span>${serverNameHtml(n2)}</span></label>
                    </div></div>
                <div><label style="font-weight:bold;">Scorekeeper name</label>
                    <input type="text" id="live-setup-keeper" class="uha-input" placeholder="Who is keeping score?" autocomplete="off"></div>
            </div>
            <div style="display:flex;gap:10px;margin-top:16px;">
                <button class="uha-btn uha-btn-gold" style="flex:1;" onclick="startLiveScoring()">Start</button>
                <button class="uha-btn-outline" style="flex:1;" onclick="closeLiveModal()">Cancel</button>
            </div>`;
        return;
    }

    const live = match.live;
    const toLim = live.timeoutLimit || 2;
    const gamesLine = (live.games || []).map((g, i) => `G${i + 1}: ${g.p1}-${g.p2}`).join(' &nbsp;·&nbsp; ');
    const serveBadge = s => live.server === s ? '<div class="live-serve-dot">● SERVING</div>' : '<div class="live-serve-dot off">&nbsp;</div>';
    const toBtn = s => {
        const used = (live.timeouts && live.timeouts[s]) || 0;
        const done = used >= toLim;
        return `<button class="live-to-btn${done ? ' used' : ''}" ${done ? 'disabled' : ''} onclick="liveTimeout('${s}')">TO ${used}/${toLim}</button>`;
    };
    body.innerHTML = `
        <div class="live-head">
            <span class="live-badge"><span class="live-pulse">●</span> LIVE</span>
            <span class="live-title">${n1} vs ${n2}</span>
            <button class="uha-btn-outline btn-sm" onclick="closeLiveModal()">Done</button>
        </div>
        <div class="live-game-label">Game ${live.game} &nbsp;·&nbsp; first to ${live.target}${live.winByTwo ? ' (win by 2)' : ''}</div>
        ${gamesLine ? `<div class="live-games-line">${gamesLine}</div>` : ''}
        <div class="live-scores">
            <div class="live-side">
                <div class="live-name">${n1}</div>
                <div class="live-pts">${live.p1}</div>
                ${serveBadge('p1')}
                <button class="live-plus" onclick="livePoint('p1', 1)">+1</button>
                <div class="live-row">
                    <button class="live-minus" onclick="livePoint('p1', -1)">−1</button>
                    ${toBtn('p1')}
                </div>
            </div>
            <div class="live-side">
                <div class="live-name">${n2}</div>
                <div class="live-pts">${live.p2}</div>
                ${serveBadge('p2')}
                <button class="live-plus" onclick="livePoint('p2', 1)">+1</button>
                <div class="live-row">
                    <button class="live-minus" onclick="livePoint('p2', -1)">−1</button>
                    ${toBtn('p2')}
                </div>
            </div>
        </div>
        <div class="live-controls">
            <button class="uha-btn-outline btn-sm" onclick="liveToggleServer()">⇄ Switch server</button>
            <button class="uha-btn-outline btn-sm" onclick="liveEndGameManual()">End game</button>
            <button class="uha-btn btn-sm" style="background:#e74c3c;" onclick="liveCommitMatch()">End match</button>
        </div>
        <div id="live-gameend" hidden>
            <h3 id="live-gameend-title" style="color:var(--uha-gold);"></h3>
            <p id="live-gameend-score" style="font-size:28px;font-weight:bold;margin:4px 0;"></p>
            <p id="live-games-tally" class="muted"></p>
            <div style="margin:10px 0;"><label style="font-weight:bold;">Next game to: </label>
                <input type="number" id="live-next-target" class="uha-input" style="width:90px;display:inline-block;" min="1"></div>
            <div style="display:flex;gap:10px;">
                <button class="uha-btn uha-btn-blue" style="flex:1;" onclick="liveNextGame()">Start next game</button>
                <button class="uha-btn uha-btn-gold" style="flex:1;" onclick="liveCommitMatch()">End match</button>
            </div>
        </div>`;
    // the Firebase listener re-renders on every point; keep the game-end
    // interstitial visible across re-renders once the game is decided
    if (liveEndAck && liveGameDone(live)) showLiveGameEnd(live);
}
