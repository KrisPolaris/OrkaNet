import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getFirestore, collection, query, where, orderBy, limit, onSnapshot, getCountFromServer, doc, updateDoc, setDoc, getDoc, addDoc, serverTimestamp, deleteDoc, increment } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyDPvjNjR6nTHQuWdhQGAGk9iJgvPKDQTXA", 
    authDomain: "bebechchat.firebaseapp.com",
    projectId: "bebechchat",
    storageBucket: "bebechchat.firebasestorage.app",
    messagingSenderId: "738356779230",
    appId: "1:738356779230:web:2c41e46431284e3fb78a4f"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const myUser = localStorage.getItem('loggedUser') || "Gość";
let activeDMTarget = null;
let unsubscribeDM = null;
let cachedAllUsers = [];
let onlineUsersMap = {};
let unreadDMs = {};

async function checkDailyReward() {
    const today = new Date().toDateString();
    const lastClaim = localStorage.getItem('lastDailyReward');

    if (lastClaim !== today) {
        alert("🎁 ODEBRAŁEŚ DZIENNĄ NAGRODĘ! Otrzymujesz +5 OrkaCoinów!");
        localStorage.setItem('lastDailyReward', today);
        
        if (myUser && myUser !== "Gość") {
            try {
                await updateDoc(doc(db, "users", myUser), { coins: increment(5) });
            } catch(e) {
                await setDoc(doc(db, "users", myUser), { coins: 5 }, { merge: true });
            }
        } else {
            let localCoins = parseInt(localStorage.getItem('guestCoins') || "0", 10);
            localStorage.setItem('guestCoins', localCoins + 5);
            const coinsEl = document.getElementById("coins-counter");
            if (coinsEl) coinsEl.textContent = localCoins + 5;
        }
    }
}

function checkGuestNotice() {
    if (myUser.toLowerCase().includes("gość") || myUser.toLowerCase().includes("gosc")) {
        const lastNotice = localStorage.getItem('lastGuestNotice');
        const now = Date.now();
        const threeHours = 3 * 60 * 60 * 1000;

        if (!lastNotice || (now - parseInt(lastNotice, 10)) > threeHours) {
            setTimeout(() => {
                if (confirm("Proszę, zrób konto, aby zapisać swoje postępy i znajomych! Czy chcesz zmienić nick/założyć konto teraz?")) {
                    window.location.href = "zmien_nick.html";
                }
                localStorage.setItem('lastGuestNotice', now.toString());
            }, 1500);
        }
    }
}

if (myUser) {
    checkDailyReward();
    checkGuestNotice();

    const userRef = doc(db, "users", myUser);
    
    const updateActivity = () => {
        setDoc(userRef, { 
            username: myUser, 
            lastActive: serverTimestamp() 
        }, { merge: true }).catch(() => {});
    };
    updateActivity();
    setInterval(updateActivity, 60000);

    onSnapshot(userRef, (docSnap) => {
        if (docSnap.exists()) {
            const data = docSnap.data();
            const coinsEl = document.getElementById("coins-counter");
            if (coinsEl) coinsEl.textContent = data.coins || 0;
            
            if (data.avatar) document.getElementById('my-avatar').innerText = data.avatar;
            if (data.bio) document.getElementById('my-bio').innerText = `"${data.bio}"`;
        }
    });
}

window.openProfileMenu = async function() {
    if(myUser === "Gość") {
        alert("Zaloguj się, aby edytować profil!");
        return;
    }

    const choice = prompt("CO CHCESZ EDYTOWAĆ?\n1. Wpisz '1' aby zmienić Emoji Profilowe\n2. Wpisz '2' aby zmienić Twój Opis (Bio)");
    
    if (choice === "1") {
        const newAv = prompt("Wybierz nowe emoji dla swojego profilu:", document.getElementById('my-avatar').innerText);
        if(newAv) {
            document.getElementById('my-avatar').innerText = newAv;
            await setDoc(doc(db, "users", myUser), { avatar: newAv }, { merge: true });
        }
    } else if (choice === "2") {
        const currentBio = document.getElementById('my-bio').innerText.replace(/"/g, '');
        const newBio = prompt("Wpisz swój opis profilu (Bio):", currentBio);
        if(newBio !== null) {
            document.getElementById('my-bio').innerText = `"${newBio}"`;
            await setDoc(doc(db, "users", myUser), { bio: newBio }, { merge: true });
        }
    }
};

function listenToOnlineStatus() {
    onSnapshot(collection(db, "users"), (snap) => {
        onlineUsersMap = {};
        const fiveMinsAgo = Date.now() - 5 * 60 * 1000;
        snap.forEach(docSnap => {
            const data = docSnap.data();
            if(data.lastActive && data.lastActive.toDate) {
                onlineUsersMap[docSnap.id] = data.lastActive.toDate().getTime() > fiveMinsAgo;
            }
        });
        window.renderFriendsList();
    });
}
listenToOnlineStatus();

function listenToUnreadDMs() {
    if(!myUser || myUser === "Gość") return;
    const q = query(collection(db, "unread_notifications"), where("to", "==", myUser));
    onSnapshot(q, (snap) => {
        unreadDMs = {};
        snap.forEach(d => {
            unreadDMs[d.data().from] = d.data().count || 0;
        });
        window.renderFriendsList();
    });
}
listenToUnreadDMs();

function listenToShoutbox() {
    const qShout = query(collection(db, "shoutbox"), orderBy("timestamp", "desc"), limit(20));
    onSnapshot(qShout, (snap) => {
        const box = document.getElementById('shoutbox-messages');
        box.innerHTML = '';
        let msgs = [];
        snap.forEach(d => msgs.push(d.data()));
        msgs.reverse();

        if(msgs.length === 0) {
            box.innerHTML = '<span style="opacity:0.5;">Cisza na Shoutboxie... Napisz coś jako pierwszy!</span>';
            return;
        }

        msgs.forEach(m => {
            const div = document.createElement('div');
            div.className = 'shout-msg';
            div.innerHTML = `<span class="shout-user" onclick="quickInvite('${m.from}')">${m.from}</span>: ${m.text}`;
            box.appendChild(div);
        });
        box.scrollTop = box.scrollHeight;
    });
}
listenToShoutbox();

window.sendShout = async function() {
    const input = document.getElementById('shoutbox-input');
    const txt = input.value.trim();
    if(!txt) return;
    input.value = '';

    await addDoc(collection(db, "shoutbox"), {
        from: myUser,
        text: txt,
        timestamp: serverTimestamp()
    });
};

async function handleVisitsAndCoins() {
    let visits = parseInt(localStorage.getItem("orkanetVisits") || "0", 10);
    visits++;
    localStorage.setItem("orkanetVisits", visits);
    
    const visitEl = document.getElementById("visit-counter");
    if (visitEl) visitEl.textContent = visits;

    if (visits % 5 === 0 && myUser && myUser !== "Gość") {
        try {
            await updateDoc(doc(db, "users", myUser), { coins: increment(1) });
        } catch (e) {
            await setDoc(doc(db, "users", myUser), { coins: 1 }, { merge: true });
        }
    }
}
handleVisitsAndCoins();

async function loadStats() {
    try {
        const coll = collection(db, "users");
        const snapshot = await getCountFromServer(coll);
        document.getElementById('reg-count').innerText = snapshot.data().count;

        const fiveMinsAgo = new Date(Date.now() - 5 * 60 * 1000);
        const q = query(collection(db, "users"), where("lastActive", ">", fiveMinsAgo));
        
        onSnapshot(q, (snap) => {
            document.getElementById('on-count').innerText = snap.size;
        });
    } catch(e) {}
}
loadStats();

function listenToAllUsers() {
    const coll = collection(db, "users");
    onSnapshot(coll, (snap) => {
        cachedAllUsers = [];
        snap.forEach(docSnap => {
            const uName = docSnap.id || docSnap.data().username;
            if(uName && !uName.toLowerCase().includes("gość") && !uName.toLowerCase().includes("gosc")) {
                cachedAllUsers.push(uName);
            }
        });
        window.filterAllUsers();
    });
}
listenToAllUsers();

window.filterAllUsers = function() {
    const input = document.getElementById('all-users-search');
    const filterVal = input ? input.value.trim().toLowerCase() : "";
    const listContainer = document.getElementById('user-search-list');
    listContainer.innerHTML = '';

    const filtered = cachedAllUsers.filter(u => u.toLowerCase().includes(filterVal) && u !== myUser);

    if(filtered.length === 0) {
        listContainer.innerHTML = '<span style="font-size:0.75em; opacity:0.6;">Brak użytkowników do wyświetlenia</span>';
        return;
    }

    filtered.forEach(uName => {
        const item = document.createElement('div');
        item.className = 'user-search-item';
        item.innerHTML = `
            <span>👤 ${uName}</span>
            <button class="btn-small" style="padding:2px 6px; font-size:0.75em;" onclick="quickInvite('${uName}')">+ Zaproś</button>
        `;
        listContainer.appendChild(item);
    });
};

window.quickInvite = async function(targetName) {
    document.getElementById('friend-search-input').value = targetName;
    await window.sendFriendRequest();
};

const niceColors = ["#ff006e", "#00d9ff", "#00ff00", "#ffcc00", "#9b5de5", "#f15bb5", "#00f5d4"];
function getDeterministicColor(name) {
    let sum = 0;
    for (let i = 0; i < name.length; i++) sum += name.charCodeAt(i);
    return niceColors[sum % niceColors.length];
}

let rawFriendsList = [];
if(myUser) {
    onSnapshot(doc(db, "friends_lists", myUser), (docSnap) => {
        if(docSnap.exists() && docSnap.data().friendsList) {
            rawFriendsList = docSnap.data().friendsList;
        } else {
            rawFriendsList = [];
        }
        window.renderFriendsList();
    });

    const qInv = query(collection(db, "friend_requests"), where("to", "==", myUser));
    onSnapshot(qInv, (snap) => {
        const container = document.getElementById('incoming-invites');
        container.innerHTML = '';
        snap.forEach(docBox => {
            const reqData = docBox.data();
            const reqId = docBox.id;
            const fromWho = reqData.from;

            const box = document.createElement('div');
            box.className = 'invite-box';
            box.innerHTML = `
                <span>👤 <b>${fromWho}</b> zaprasza Cię!</span>
                <div>
                    <button class="btn-small" style="background:#00ff00; color:#000; padding:3px 8px; font-size:0.8em; border:none;" id="acc-${reqId}">TAK</button>
                    <button class="btn-small" style="background:#ff4444; color:#fff; padding:3px 8px; font-size:0.8em; border:none;" id="rej-${reqId}">NIE</button>
                </div>
            `;
            container.appendChild(box);

            document.getElementById(`acc-${reqId}`).onclick = async () => {
                const myRef = doc(db, "friends_lists", myUser);
                const mySnap = await getDoc(myRef);
                let myArr = mySnap.exists() ? (mySnap.data().friendsList || []) : [];
                if(!myArr.includes(fromWho)) myArr.push(fromWho);
                await setDoc(myRef, { friendsList: myArr }, { merge: true });

                const hisRef = doc(db, "friends_lists", fromWho);
                const hisSnap = await getDoc(hisRef);
                let hisArr = hisSnap.exists() ? (hisSnap.data().friendsList || []) : [];
                if(!hisArr.includes(myUser)) hisArr.push(myUser);
                await setDoc(hisRef, { friendsList: hisArr }, { merge: true });

                await deleteDoc(doc(db, "friend_requests", reqId));
            };

            document.getElementById(`rej-${reqId}`).onclick = async () => {
                await deleteDoc(doc(db, "friend_requests", reqId));
            };
        });
    });
}

window.renderFriendsList = function() {
    const listDiv = document.getElementById('friends-display-list');
    listDiv.innerHTML = '';
    if(rawFriendsList.length === 0) {
        listDiv.innerHTML = '<span style="font-size:0.8em; opacity:0.6;">Brak znajomych. Zaproś kogoś!</span>';
        return;
    }

    rawFriendsList.forEach(fName => {
        const firstLet = fName.charAt(0).toUpperCase();
        const color = getDeterministicColor(fName);
        const isOnline = onlineUsersMap[fName] || false;
        const unreadCount = unreadDMs[fName] || 0;

        const card = document.createElement('div');
        card.className = 'friend-card';
        card.innerHTML = `
            <div class="roblox-avatar" style="background: ${color}" onclick="openDM('${fName}')">
                ${firstLet}
                <div class="status-dot ${isOnline ? 'status-online' : 'status-offline'}"></div>
                ${unreadCount > 0 ? `<div class="dm-badge">${unreadCount}</div>` : ''}
            </div>
            <div class="friend-name" onclick="openDM('${fName}')">${fName}</div>
            <button class="remove-friend-btn" onclick="removeFriend('${fName}')">Usuń 🗑️</button>
        `;
        listDiv.appendChild(card);
    });
};

window.sendFriendRequest = async function() {
    const input = document.getElementById('friend-search-input');
    const targetName = input.value.trim();
    if(!targetName) return;
    if(targetName === myUser) {
        alert("Nie możesz zaprosić samego siebie!");
        return;
    }

    const userCheck = await getDoc(doc(db, "users", targetName));
    if(!userCheck.exists()) {
        alert("Nie znaleziono takiego użytkownika!");
        return;
    }

    const reqId = myUser + "_" + targetName;
    await setDoc(doc(db, "friend_requests", reqId), {
        from: myUser,
        to: targetName,
        timestamp: serverTimestamp()
    });
    
    alert("Zaproszenie wysłane!");
    input.value = '';
};

window.removeFriend = async function(targetName) {
    if(!confirm(`Czy na pewno chcesz usunąć użytkownika ${targetName} ze znajomych?`)) return;

    const myRef = doc(db, "friends_lists", myUser);
    const mySnap = await getDoc(myRef);
    if(mySnap.exists()) {
        let myArr = mySnap.data().friendsList || [];
        myArr = myArr.filter(f => f !== targetName);
        await updateDoc(myRef, { friendsList: myArr });
    }

    const hisRef = doc(db, "friends_lists", targetName);
    const hisSnap = await getDoc(hisRef);
    if(hisSnap.exists()) {
        let hisArr = hisSnap.data().friendsList || [];
        hisArr = hisArr.filter(f => f !== myUser);
        await updateDoc(hisRef, { friendsList: hisArr });
    }
};

function getChatId(user1, user2) {
    return [user1, user2].sort().join("_");
}

window.openDM = async function(targetUser) {
    activeDMTarget = targetUser;
    document.getElementById('dm-title').innerText = "Czat z: " + targetUser;
    document.getElementById('dm-modal').style.display = 'flex';
    
    await deleteDoc(doc(db, "unread_notifications", `${targetUser}_${myUser}`)).catch(()=>{});

    const chatId = getChatId(myUser, targetUser);
    const qDM = query(collection(db, "direct_messages", chatId, "messages"), orderBy("timestamp", "asc"));

    if (unsubscribeDM) unsubscribeDM();

    unsubscribeDM = onSnapshot(qDM, (snap) => {
        const container = document.getElementById('dm-messages');
        container.innerHTML = '';
        snap.forEach(docSnap => {
            const msg = docSnap.data();
            const div = document.createElement('div');
            div.className = `dm-msg ${msg.from === myUser ? 'me' : 'them'}`;
            div.innerText = msg.text;
            container.appendChild(div);
        });
        container.scrollTop = container.scrollHeight;
    });
};

window.closeDM = function() {
    document.getElementById('dm-modal').style.display = 'none';
    if (unsubscribeDM) unsubscribeDM();
    activeDMTarget = null;
};

window.sendDM = async function() {
    const input = document.getElementById('dm-input');
    const text = input.value.trim();
    if(!text || !activeDMTarget) return;

    const chatId = getChatId(myUser, activeDMTarget);
    input.value = '';

    await addDoc(collection(db, "direct_messages", chatId, "messages"), {
        from: myUser,
        to: activeDMTarget,
        text: text,
        timestamp: serverTimestamp()
    });

    const notifRef = doc(db, "unread_notifications", `${myUser}_${activeDMTarget}`);
    await setDoc(notifRef, {
        from: myUser,
        to: activeDMTarget,
        count: increment(1)
    }, { merge: true });
};

// Funkcje UI / pomocnicze do przydzielenia globalnego dla zdarzeń inline z HTML:
window.filterTiles = function() {
    const query = document.getElementById('tile-search-input').value.toLowerCase();
    const tiles = document.querySelectorAll('#main-grid .tile');
    
    tiles.forEach(tile => {
        const text = tile.textContent.toLowerCase();
        if (text.includes(query)) {
            tile.style.display = "flex";
        } else {
            tile.style.display = "none";
        }
    });
};

const themes = ['standard', 'cyberpunk', 'premium', 'dark', 'cyberpunk-legacy'];
let currentThemeIndex = themes.indexOf(localStorage.getItem('theme') || 'cyberpunk');
if (currentThemeIndex === -1) currentThemeIndex = 1;

function applyTheme(theme) {
    document.body.className = '';
    document.body.classList.add('theme-' + theme);

    const btn = document.getElementById('theme-toggle');
    const fInput = document.getElementById('friend-search-input');
    const uInput = document.getElementById('all-users-search');

    if (theme === 'standard') {
        btn.textContent = "✨ TRYB STANDARD ✨";
        btn.style.background = "#ffcc00"; btn.style.color = "#000";
        if(fInput) { fInput.style.borderColor = "#00ffff"; fInput.style.background = "#000"; fInput.style.color = "#fff"; }
        if(uInput) { uInput.style.borderColor = "#00ffff"; uInput.style.background = "#000"; uInput.style.color = "#fff"; }
    } else if (theme === 'cyberpunk') {
        btn.textContent = "⚡ TRYB CYBERPUNK ⚡";
        btn.style.background = "linear-gradient(90deg, #00ffff, #ff007f)"; btn.style.color = "#000";
        if(fInput) { fInput.style.borderColor = "#00ffff"; fInput.style.background = "rgba(10,5,20,0.8)"; fInput.style.color = "#00ffff"; }
        if(uInput) { uInput.style.borderColor = "#00ffff"; uInput.style.background = "rgba(10,5,20,0.8)"; uInput.style.color = "#00ffff"; }
    } else if (theme === 'premium') {
        btn.textContent = "💎 TRYB PREMIUM 💎";
        btn.style.background = "#2563eb"; btn.style.color = "#fff";
        if(fInput) { fInput.style.borderColor = "#ddd"; fInput.style.background = "#fff"; fInput.style.color = "#000"; }
        if(uInput) { uInput.style.borderColor = "#ddd"; uInput.style.background = "#fff"; uInput.style.color = "#000"; }
    } else if (theme === 'dark') {
        btn.textContent = "🌙 TRYB CIEMNY 🌙";
        btn.style.background = "#bb86fc"; btn.style.color = "#000";
        if(fInput) { fInput.style.borderColor = "#444"; fInput.style.background = "#252525"; fInput.style.color = "#fff"; }
        if(uInput) { uInput.style.borderColor = "#444"; uInput.style.background = "#252525"; uInput.style.color = "#fff"; }
    } else if (theme === 'cyberpunk-legacy') {
        btn.textContent = "⚙️ CYBERPUNK LEGACY ⚙️";
        btn.style.background = "#ff006e"; btn.style.color = "#fff";
        if(fInput) { fInput.style.borderColor = "#00d9ff"; fInput.style.background = "#1a1a2e"; fInput.style.color = "#e0e0e0"; }
        if(uInput) { uInput.style.borderColor = "#00d9ff"; uInput.style.background = "#1a1a2e"; uInput.style.color = "#e0e0e0"; }
    }
}
applyTheme(themes[currentThemeIndex]);

window.toggleTheme = function() {
    currentThemeIndex = (currentThemeIndex + 1) % themes.length;
    applyTheme(themes[currentThemeIndex]);
    localStorage.setItem('theme', themes[currentThemeIndex]);
};

if (localStorage.getItem('cookiesAccepted') === 'true') {
    document.getElementById('cookie-overlay').style.display = 'none';
}

window.acceptCookies = function() {
    localStorage.setItem('cookiesAccepted', 'true');
    document.getElementById('cookie-overlay').style.display = 'none';
};

window.rejectCookies = function() {
    document.getElementById('cookie-initial').style.display = 'none';
    document.getElementById('pay-screen').style.display = 'block';
};

const checkUser = localStorage.getItem('loggedUser') || "Gość";
document.getElementById('username').textContent = checkUser + " ✏️";

if (["admin", "kris", "krys", "szym", "sim"].some(n => checkUser.toLowerCase().includes(n))) {
    const v = document.getElementById('vip-label');
    if(v) { 
        v.className = "vip-tag"; 
        v.textContent = "SUPER GOŚCIU 🔥";
    }
}

window.logout = function() { 
    if(confirm("Opuszczasz OrkaNet?")) { 
        localStorage.removeItem('loggedUser'); 
        window.location.reload(); 
    } 
};

window.showRandomPage = function() {
    const pages = [...document.querySelectorAll('.tile')];
    const random = pages[Math.floor(Math.random() * pages.length)];
    if(random.href && random.href.trim() !== "") {
        location.href = random.href;
    }
};

let musicPlaying = false;
let normalMusic = new Audio("music.mp3");

window.toggleMusic = function() {
    const mBtn = document.getElementById('music-btn');
    if(musicPlaying){
        normalMusic.pause();
        mBtn.textContent = "🎵 Muzyka";
    } else {
        normalMusic.play();
        mBtn.textContent = "⏸️ Pauza";
    }
    musicPlaying = !musicPlaying;
};

document.getElementById('header-text').addEventListener('click', () => {
    document.documentElement.classList.add('rainbow-active');
    setTimeout(() => {
        document.documentElement.classList.remove('rainbow-active');
    }, 3000);
});
