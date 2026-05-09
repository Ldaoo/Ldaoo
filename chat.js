// ======== 全局及基礎狀態管理 ========
document.addEventListener('gesturestart', function(e) {
    e.preventDefault();
});
document.addEventListener('touchstart', function(e) {
    if (e.touches.length > 1) {
        const modal = document.getElementById('media-modal');
        if (!modal || !modal.classList.contains('show')) {
            e.preventDefault();
        }
    }
}, { passive: false });

function showToast(msg) {
    const toast = document.getElementById('toast-container');
    toast.innerText = msg;
    toast.classList.add('show');
    setTimeout(() => { toast.classList.remove('show'); }, 2500);
}

// ====== 全局點擊監聽 (處理下拉菜單和搜索框點擊外部收回) ======
document.addEventListener('click', (e) => {
    // 收回普通的下拉菜單
    document.querySelectorAll('.glass-dropdown').forEach(el => el.style.display = 'none');

    // 如果有打开内嵌网页菜单，点击外部关闭
    const iframeMenu = document.getElementById('iframe-dropdown');
    if (iframeMenu && iframeMenu.style.display === 'block') iframeMenu.style.display = 'none';

    // 處理表情包菜單收回
    const panel = document.getElementById('emoji-panel');
    const btn = document.getElementById('emoji-btn');
    if (panel && panel.classList.contains('show') && !panel.contains(e.target) && e.target !== btn) { 
        panel.classList.remove('show'); 
    }

    // 點擊空白處關閉搜索飄窗 (排除搜索框本身、加號按鈕和下拉菜單內的點擊)
    const searchBar = document.getElementById('top-search-bar');
    const plusBtn = document.getElementById('plus-btn');
    if (searchBar && searchBar.classList.contains('show')) {
        if (!searchBar.contains(e.target) && e.target !== plusBtn && !e.target.classList.contains('dd-item')) {
            closeSearchModal();
        }
    }
});

// ====== 自定義飄窗 Dialog 邏輯 ======
function customConfirm(message, title = "提示") {
    return new Promise((resolve) => {
        const overlay = document.getElementById('custom-dialog-overlay');
        document.getElementById('cd-title').innerText = title;
        document.getElementById('cd-msg').innerHTML = message;
        document.getElementById('cd-cancel').style.display = 'block';
        
        const confirmBtn = document.getElementById('cd-confirm');
        const cancelBtn = document.getElementById('cd-cancel');
        
        const cleanup = () => {
            overlay.classList.remove('show');
            setTimeout(() => { overlay.style.display = 'none'; }, 300);
            confirmBtn.onclick = null;
            cancelBtn.onclick = null;
        };

        overlay.style.display = 'flex';
        void overlay.offsetWidth; // 觸發重繪
        overlay.classList.add('show');

        confirmBtn.onclick = () => { cleanup(); resolve(true); };
        cancelBtn.onclick = () => { cleanup(); resolve(false); };
    });
}

function customAlert(message, title = "提示") {
    return new Promise((resolve) => {
        const overlay = document.getElementById('custom-dialog-overlay');
        document.getElementById('cd-title').innerText = title;
        document.getElementById('cd-msg').innerHTML = message;
        document.getElementById('cd-cancel').style.display = 'none';
        
        const confirmBtn = document.getElementById('cd-confirm');
        
        const cleanup = () => {
            overlay.classList.remove('show');
            setTimeout(() => { overlay.style.display = 'none'; }, 300);
            confirmBtn.onclick = null;
        };

        overlay.style.display = 'flex';
        void overlay.offsetWidth;
        overlay.classList.add('show');

        confirmBtn.onclick = () => { cleanup(); resolve(true); };
    });
}

// SPA 視圖控制核心
let usersDataCache = {};
let groupDataCache = {}; 
let lastContentMap = {}; 
let roomScrolls = {};

let currentMsgLimit = 30;
let isFetching = false;
let hasMoreHistory = true;

window.lastOutsideUnread = undefined;
let notifyCtx = null;
let notifyBuffer = null;
let audioUnlocked = false;

// ====== 網頁標題閃爍與通知控制 ======
let originalTitle = document.title;
let titleBlinkTimer = null;
let isTitleBlinking = false;

function setBaseTitle(title) {
    originalTitle = title;
    if (!isTitleBlinking) {
        document.title = title;
    }
}

function startTitleBlink() {
    if (isTitleBlinking) return;
    isTitleBlinking = true;
    let showNew = true;
    titleBlinkTimer = setInterval(() => {
        // 標題在 "用戶名 (有新消息...)" 和 "原始標題" 之間切換
        document.title = showNew ? MY_NAME + ' (有新消息...)' : originalTitle;
        showNew = !showNew;
    }, 1000);
}

function stopTitleBlink() {
    if (!isTitleBlinking) return;
    isTitleBlinking = false;
    clearInterval(titleBlinkTimer);
    document.title = originalTitle;
}

// 當使用者切回該網頁時，自動停止閃爍並恢復原始標題
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
        stopTitleBlink();
    }
});

// ====== 桌面通知核心邏輯 ======
function requestDesktopNotification() {
    if ("Notification" in window && Notification.permission !== "granted" && Notification.permission !== "denied") {
        Notification.requestPermission();
    }
}

function sendDesktopNotification(title, body) {
    let toggle = document.getElementById('sound-toggle');
    if (toggle && toggle.checked && "Notification" in window && Notification.permission === "granted") {
        const notification = new Notification(title, {
            body: body,
            icon: (typeof MY_AVATAR !== 'undefined' && MY_AVATAR) ? MY_AVATAR : 'favicon.ico'
        });
        notification.onclick = function() {
            window.focus();
            this.close();
        };
    }
}

function initNotifyAudio() {
    window.AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!notifyCtx) {
        notifyCtx = new window.AudioContext();
    }
    if (!notifyBuffer) {
        fetch('d.wav')
            .then(res => res.arrayBuffer())
            .then(buf => notifyCtx.decodeAudioData(buf))
            .then(decoded => { notifyBuffer = decoded; })
            .catch(e => console.log("提示音加載失敗:", e));
    }
}

function unlockAudio() {
    if (!notifyCtx) initNotifyAudio();
    if (notifyCtx && notifyCtx.state === 'suspended') {
        notifyCtx.resume();
    }
    if (notifyCtx && !audioUnlocked) {
        let buffer = notifyCtx.createBuffer(1, 1, 22050);
        let source = notifyCtx.createBufferSource();
        source.buffer = buffer;
        source.connect(notifyCtx.destination);
        source.start(0);
        audioUnlocked = true;
    }
}

// 整合初始化：首次互動時解鎖音效並請求通知權限
function initUserInteractions() {
    unlockAudio();
    requestDesktopNotification();
    ['touchstart', 'touchend', 'click', 'keydown'].forEach(e => document.removeEventListener(e, initUserInteractions));
}
['touchstart', 'touchend', 'click', 'keydown'].forEach(e => document.addEventListener(e, initUserInteractions, {once:true}));

function playNotifySound() {
    let toggle = document.getElementById('sound-toggle');
    if (toggle && toggle.checked && notifyCtx && notifyBuffer) {
        if (notifyCtx.state === 'suspended') notifyCtx.resume();
        let source = notifyCtx.createBufferSource();
        source.buffer = notifyBuffer;
        source.connect(notifyCtx.destination);
        source.start(0);
    }
}

function saveSoundPref() {
    let on = document.getElementById("sound-toggle").checked;
    localStorage.setItem("sound_notify_" + MY_NAME, on ? "on" : "off");
    if(on) {
        unlockAudio(); 
        requestDesktopNotification();
        playNotifySound(); 
    }
}

function initApp() {
    let sPref = localStorage.getItem("sound_notify_" + MY_NAME);
    let toggle = document.getElementById("sound-toggle");
    if (sPref === "off" && toggle) {
        toggle.checked = false;
    }

    if (typeof initError !== 'undefined' && initError !== '') {
        setTimeout(() => showToast(initError), 300);
    }

    if (currentTarget !== "") {
        let initialTarget = currentTarget; 
        currentTarget = ''; 
        switchView('chat', initialTarget, true);
        refreshData(true); 
    } else {
        refreshData();
    }
    
    const container = document.getElementById("allspace");
    container.addEventListener('scroll', function() {
        if (this.scrollTop <= 10 && hasMoreHistory && !isFetching && currentTarget) {
            currentMsgLimit += 30;
            checkMessages(false, true);
        }
    });
}

function switchView(view, target = '', skipPush = false) {
    window.lastOutsideUnread = undefined; 

    const isDesktop = window.innerWidth >= 768;

    if (currentTarget && (document.getElementById('view-chat').style.display !== 'none' || isDesktop)) {
        if (!isDesktop || document.getElementById('chat-main').style.display !== 'none') {
            roomScrolls[currentTarget] = document.getElementById("allspace").scrollTop;
        }
    }

    if (view === 'chat') {
        closeSearchModal(); 
        
        currentTarget = target;
        currentMsgLimit = 30;     
        hasMoreHistory = true;    
        
        if (!isDesktop) {
            document.getElementById('view-list').style.display = 'none';
            document.getElementById('view-chat').style.display = 'flex';
        }
        
        document.getElementById('chat-placeholder').style.display = 'none';
        document.getElementById('chat-main').style.display = 'flex';
        
        updateChatHeaderUI(target);
        
        const allspace = document.getElementById("allspace");
        Array.from(allspace.children).forEach(child => {
            if (child.classList.contains('chat-room-container')) child.style.display = 'none';
        });

        let activeRoom = document.getElementById('room-' + target);
        let isNewRoom = false;
        
        if (!activeRoom) {
            activeRoom = document.createElement('div');
            activeRoom.id = 'room-' + target;
            activeRoom.className = 'chat-room-container';
            allspace.appendChild(activeRoom);
            isNewRoom = true;
        }
        
        activeRoom.style.display = 'block';

        if (!isNewRoom && roomScrolls[target] !== undefined) {
            allspace.scrollTop = roomScrolls[target];
        }

        checkMessages(isNewRoom);

        if (!skipPush) history.pushState({view: 'chat', target: target}, '', '?to=' + encodeURIComponent(target));
    } else {
        currentTarget = '';
        
        if (!isDesktop) {
            document.getElementById('view-chat').style.display = 'none';
            document.getElementById('view-list').style.display = 'flex';
        } else {
            document.getElementById('chat-placeholder').style.display = 'flex';
            document.getElementById('chat-main').style.display = 'none';
        }
        
        setBaseTitle(MY_NAME); // 修改: 使用自定義標題控制
        refreshData();
        if (!skipPush) history.pushState({view: 'list'}, '', 'chat.php');
    }
    
    updateActiveUserHighlight(); 
}

function updateActiveUserHighlight() {
    document.querySelectorAll('.user-item, .lobby-card').forEach(el => {
        el.classList.remove('active-chat');
    });
    
    if (currentTarget === 'all') {
        const lc = document.querySelector('.lobby-card');
        if(lc) lc.classList.add('active-chat');
    } else if (currentTarget) {
        const userItem = document.querySelector(`.user-item[data-username="${currentTarget}"]`);
        if (userItem) userItem.classList.add('active-chat');
    }
}

window.addEventListener('resize', () => {
    const isDesktop = window.innerWidth >= 768;
    if (isDesktop) {
        if (currentTarget) {
            document.getElementById('chat-placeholder').style.display = 'none';
            document.getElementById('chat-main').style.display = 'flex';
        } else {
            document.getElementById('chat-placeholder').style.display = 'flex';
            document.getElementById('chat-main').style.display = 'none';
        }
    } else {
        if (currentTarget) {
            document.getElementById('view-list').style.display = 'none';
            document.getElementById('view-chat').style.display = 'flex';
            document.getElementById('chat-main').style.display = 'flex';
            document.getElementById('chat-placeholder').style.display = 'none';
        } else {
            document.getElementById('view-list').style.display = 'flex';
            document.getElementById('view-chat').style.display = 'none';
        }
    }

    // ====== 新增：动态调整窗口大小时，刷新下拉菜单按钮的显示状态 ======
    if (currentTarget) {
        updateChatHeaderUI(currentTarget);
    }
    // =================================================================
});

window.addEventListener('popstate', (e) => {
    if (e.state && e.state.view === 'chat') {
        switchView('chat', e.state.target, true);
    } else {
        switchView('list', '', true);
    }
});

function updateChatHeaderUI(target) {
    let titleStr = target;
    let subtitleStr = '';
    
    const menuBtn = document.getElementById('chat-menu-btn');
    const ddProfile = document.getElementById('dd-view-profile');
    const ddMembers = document.getElementById('dd-view-members');
    const ddClear = document.getElementById('dd-clear');
    const ddDisband = document.getElementById('dd-disband');
    const ddLeave = document.getElementById('dd-leave');
    const ddClose = document.getElementById('dd-close-chat'); // 新增绑定
    
    // 初始化隱藏
    ddProfile.style.display = 'none';
    ddMembers.style.display = 'none';
    ddClear.style.display = 'none';
    ddDisband.style.display = 'none';
    ddLeave.style.display = 'none';
    if (ddClose) ddClose.style.display = 'none'; // 新增初始化隐藏

    let showMenu = false;

    if (target === 'all') {
        titleStr = '公共大廳';
        if (IS_ADMIN) {
            ddClear.style.display = 'block';
            showMenu = true;
        }
    } else if (target.startsWith('g_')) {
        let group = usersDataCache[target];
        titleStr = group ? group.displayName : '群聊';
        subtitleStr = '群聊';
        
        ddMembers.style.display = 'block';
        showMenu = true;
        
        if (group) {
            if (group.creator === MY_NAME || IS_ADMIN) {
                ddClear.style.display = 'block';
                ddDisband.style.display = 'block';
            }
            if (group.creator !== MY_NAME) {
                ddLeave.style.display = 'block';
            }
        }
    } else {
        titleStr = target;
        subtitleStr = usersDataCache[target] ? usersDataCache[target].signature : '這個人很懶，什麼都沒寫~';
        
        ddProfile.style.display = 'block';
        ddClear.style.display = 'block';
        showMenu = true;
    }
    
    // ====== 新增：桌面端关闭按钮判断 ======
    if (window.innerWidth >= 768) {
        if (ddClose) ddClose.style.display = 'block';
        showMenu = true; // 确保在桌面端模式下，无论什么会话都强制显示 "..." 菜单
    }
    // ======================================
    
    menuBtn.style.display = showMenu ? 'block' : 'none';
    
    setBaseTitle(titleStr); // 修改: 使用自定義標題控制
    document.getElementById('chat-title').innerText = titleStr;
    const subEl = document.getElementById('chat-subtitle');
    if (subtitleStr) {
        subEl.innerText = subtitleStr;
        subEl.style.display = 'block';
    } else {
        subEl.style.display = 'none';
    }
}

function clearUnread() {
    if(!currentTarget) return;
    if (currentTarget === 'all') {
        fetch('?action=get_counts&t=' + Date.now()).then(res => res.json()).then(data => {
            localStorage.setItem('read_all_' + MY_NAME, data.lobby || 0);
        });
    } else if (currentTarget.startsWith('g_')) {
        fetch('?action=get_counts&t=' + Date.now()).then(res => res.json()).then(data => {
            localStorage.setItem('read_' + currentTarget + '_' + MY_NAME, data.groupTotals[currentTarget] || 0);
        });
    } else {
        fetch('?action=get_counts&t=' + Date.now()).then(res => res.json()).then(data => {
            localStorage.setItem('read_' + currentTarget + '_' + MY_NAME, data.privateUnread[currentTarget] || 0);
        });
    }
}

function goBack() { 
    clearUnread(); 
    switchView('list'); 
}

// ======== 列表頁引擎 ========
let pendingAvatarBase64 = '';
function openProfile() { 
    const pm = document.getElementById('profile-modal');
    // 每次打開時，清除防遮擋的類名
    pm.classList.remove('keyboard-up-container');
    pm.style.display = 'flex'; 
}
function viewMyAvatar() {
    document.getElementById('avatar-viewer-img').src = document.getElementById('avatar-preview').src;
    document.getElementById('avatar-viewer-modal').style.display = 'flex';
}

function previewAvatar(input) {
    if (input.files && input.files[0]) {
        const file = input.files[0];
        const reader = new FileReader();
        reader.onload = function(e) {
            const img = new Image(); img.src = e.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const scale = img.width > avatarMaxWidth ? avatarMaxWidth / img.width : 1;
                canvas.width = img.width * scale; canvas.height = img.height * scale;
                canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
                const b64 = canvas.toDataURL('image/jpeg', 0.8);
                
                document.getElementById('avatar-preview').src = b64;
                
                const fd = new FormData();
                fd.append('avatar', b64);
                fetch('?action=save_profile', { method: 'POST', body: fd })
                .then(r => r.json()).then(data => {
                    if(data.status === 'success') {
                        showToast("頭像上傳成功！");
                        if (data.avatar) {
                            const newUrl = data.avatar + '?t=' + Date.now();
                            MY_AVATAR = newUrl;
                            
                            const topAvatar = document.querySelector('#list-header img');
                            if (topAvatar) topAvatar.src = newUrl;
                            
                            document.querySelectorAll('.msg-avatar[data-name="' + MY_NAME + '"]').forEach(img => {
                                img.src = newUrl;
                                img.setAttribute('data-avatar', newUrl);
                            });
                        }
                    } else { showToast("頭像上傳失敗"); }
                });
            };
        };
        reader.readAsDataURL(file);
    }
}

function saveProfile() {
    const pOld = document.getElementById('prof-old-pass').value;
    const p1 = document.getElementById('prof-pass').value;
    
    if(p1) { 
        if(!pOld) { showToast("修改密碼必須輸入舊密碼！"); return; }
    }

    const signEl = document.getElementById('prof-sign');
    const emailEl = document.getElementById('prof-email');
    const signVal = signEl.value.trim();
    const emailVal = emailEl.value.trim();

    // 獲取初始加載時的值，以此作為資料是否改變的判斷基準
    const origSign = signEl.hasAttribute('data-orig') ? signEl.getAttribute('data-orig') : signEl.defaultValue;
    const origEmail = emailEl.hasAttribute('data-orig') ? emailEl.getAttribute('data-orig') : emailEl.defaultValue;

    // 校驗是否完全沒有發生修改
    if (signVal === origSign && emailVal === origEmail && !pOld && !p1) {
        showToast("資料未改變");
        return;
    }

    const btn = document.querySelector('.btn-save-profile');
    btn.innerText = '保存中...'; btn.disabled = true;

    const fd = new FormData();
    fd.append('signature', signVal);
    fd.append('email', emailVal);
    
    if(p1) {
        fd.append('old_password', pOld);
        fd.append('password', p1);
    }

    fetch('?action=save_profile', { method: 'POST', body: fd })
    .then(r => r.json()).then(data => {
        if(data.status === 'success') {
            if (data.pwd_changed) {
                showToast("密碼修改成功，請重新登錄！");
                setTimeout(() => { location.href = '?action=logout'; }, 1500);
                return;
            }

            showToast("資料保存成功！"); 
            btn.innerText = '保存設置'; btn.disabled = false;
            
            // 保存成功後，更新本地狀態基準以供下次比對
            MY_SIGN = signVal;
            signEl.setAttribute('data-orig', signVal);
            emailEl.setAttribute('data-orig', emailVal);
            
            const headerSignNode = document.querySelector('#list-header div[style*="font-size:12px"]');
            if (headerSignNode) headerSignNode.innerText = signVal ? signVal : '這個人很懶，什麼都沒寫~';
            
            document.querySelectorAll('.msg-avatar[data-name="' + MY_NAME + '"]').forEach(img => {
                img.setAttribute('data-sign', MY_SIGN);
            });
            
            document.getElementById('profile-modal').style.display = 'none';
            document.getElementById('prof-old-pass').value = '';
            document.getElementById('prof-pass').value = '';
        } else {
            btn.innerText = '保存設置'; btn.disabled = false; 
            showToast(data.msg || "保存失敗，請重試！");
        }
    }).catch(e => { 
        btn.innerText = '保存設置'; btn.disabled = false; 
        showToast("網絡連接異常，請重試"); 
    });
}

function enterLobby() {
    const total = parseInt(document.getElementById('badge-all').getAttribute('data-total') || 0);
    if (total > 0) {
        localStorage.setItem('read_all_' + MY_NAME, total);
        fetch('?action=update_lobby_read&count=' + total).then(() => {
            switchView('chat', 'all');
        }).catch(() => { switchView('chat', 'all'); });
    } else {
        switchView('chat', 'all');
    }
}

function refreshData(silentMode = false) {
    fetch('?action=get_counts&t=' + new Date().getTime())
    .then(res => res.json())
    .then(data => {
        if (data.error) { location.replace('index.php'); return; }
        if (data.avatar_width) avatarMaxWidth = parseInt(data.avatar_width);
        
        data.userList.forEach(u => { usersDataCache[u.name] = u; });

        if (currentTarget) {
            updateChatHeaderUI(currentTarget);
        }

        let lDiffForSound = 0;
        const lobbyReadKeySound = 'read_all_' + MY_NAME;
        let localLobbyReadS = parseInt(localStorage.getItem(lobbyReadKeySound) || 0); 
        let serverLobbyReadS = parseInt(data.lobbyRead || 0);
        let actualReadS = Math.max(localLobbyReadS, serverLobbyReadS);
        if (data.lobby < actualReadS) { actualReadS = data.lobby; }
        lDiffForSound = data.lobby - actualReadS;

        let currentOutsideUnread = 0;
        for (let user in data.privateUnread) {
            if (currentTarget !== user) { 
                currentOutsideUnread += data.privateUnread[user];
            }
        }
        for (let group in data.groupTotals) {
             if (currentTarget !== group) {
                 let lRead = parseInt(localStorage.getItem('read_' + group + '_' + MY_NAME) || 0);
                 currentOutsideUnread += Math.max(0, data.groupTotals[group] - lRead);
             }
        }
        if (currentTarget !== 'all' && lDiffForSound > 0) { 
            currentOutsideUnread += lDiffForSound;
        }

        if (!silentMode && window.lastOutsideUnread !== undefined && currentOutsideUnread > window.lastOutsideUnread) {
            playNotifySound();
            if (document.hidden) {
                sendDesktopNotification("喵喵聊天", "您有新的未讀消息");
                startTitleBlink(); // 修改: 觸發標題閃爍
            }
        }
        window.lastOutsideUnread = currentOutsideUnread;

        const nBox = document.getElementById('notice-container'); 
        const nText = document.getElementById('notice-content');
        if(data.notice && data.notice.trim() !== "") { 
            nBox.style.display = 'flex'; 
            if(nText.innerText !== "📣 " + data.notice) nText.innerText = "📣 " + data.notice; 
        } else { nBox.style.display = 'none'; }

        const listContainer = document.getElementById('user-list'); 
        const activeNames = data.userList.map(u => u.name);
        
        // 增強容錯：只有當 activeNames 有效且有內容時才執行清理，防止把列表清空
        if (activeNames && activeNames.length > 0) {
            document.querySelectorAll('.user-item').forEach(el => { 
                if (!activeNames.includes(el.getAttribute('data-username'))) el.remove(); 
            });
        }

        let totalGlobalUnread = 0;

        data.userList.sort((a, b) => b.lastTime - a.lastTime).forEach((user, index) => {
            let item = listContainer.querySelector(`.user-item[data-username="${user.name}"]`);
            if (!item) {
                item = document.createElement('div'); 
                item.className = 'user-item'; 
                item.setAttribute('data-username', user.name);
                item.onclick = () => switchView('chat', user.name);
                
                let dName = user.displayName || user.name;
                let displayName = dName.length > 15 ? dName.substring(0, 15) + '..' : dName;
                let displaySign = user.signature.length > 20 ? user.signature.substring(0, 20) + '..' : user.signature;
                
                let avatarHtml = '';
                if (user.isGroup && user.groupAvatars) {
                    let gridHtml = user.groupAvatars.map(av => {
                        if (av.type === 'img') return `<div style="width:100%;height:100%;overflow:hidden;border-radius:2px;"><img src="${av.src}" style="width:100%;height:100%;object-fit:cover;"></div>`;
                        else return `<div style="width:100%;height:100%;background:#085A48;color:#fff;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:bold;border-radius:2px;overflow:hidden;">${av.text}</div>`;
                    }).join('');
                    
                    avatarHtml = `<div class="user-avatar" style="display:grid; grid-template-columns:repeat(2, 1fr); grid-template-rows:repeat(2, 1fr); gap:1px; background:#e0e0e0; padding:2px; box-sizing:border-box; overflow:hidden;">${gridHtml}</div>`;
                } else {
                    avatarHtml = user.avatar ? `<img src="${user.avatar}" class="user-avatar" style="object-fit:cover; background:#fff;">` : `<div class="user-avatar">${user.firstChar}</div>`;
                }
                
                item.innerHTML = `${avatarHtml}
                                  <div class="user-info-col">
                                      <div class="user-name">${displayName}</div>
                                      <div class="user-sign">${displaySign}</div>
                                  </div>
                                  <div class="msg-badge">0</div>`;
                listContainer.appendChild(item);
            }
            if (listContainer.children[index] !== item) { listContainer.insertBefore(item, listContainer.children[index]); }
            
            const badge = item.querySelector('.msg-badge'); 
            let unreadCount = 0;
            if (user.isGroup) {
                let localRead = parseInt(localStorage.getItem('read_' + user.name + '_' + MY_NAME) || 0);
                let total = data.groupTotals[user.name] || 0;
                unreadCount = Math.max(0, total - localRead);
            } else {
                unreadCount = data.privateUnread[user.name] || 0; 
            }
            totalGlobalUnread += unreadCount; 
            
            badge.innerText = unreadCount > 99 ? '99+' : unreadCount; 
            badge.style.display = unreadCount > 0 ? 'flex' : 'none';
        });

        const lBadge = document.getElementById('badge-all'); 
        const lobbyReadKey = 'read_all_' + MY_NAME;
        let localLobbyRead = parseInt(localStorage.getItem(lobbyReadKey) || 0); 
        let serverLobbyRead = parseInt(data.lobbyRead || 0);
        let actualRead = Math.max(localLobbyRead, serverLobbyRead);
        if (data.lobby < actualRead) { actualRead = data.lobby; }

        if (localLobbyRead > serverLobbyRead) { fetch('?action=update_lobby_read&count=' + localLobbyRead); } 
        else if (serverLobbyRead > localLobbyRead) { localStorage.setItem(lobbyReadKey, serverLobbyRead); }

        lBadge.setAttribute('data-total', data.lobby);
        const lDiff = data.lobby - actualRead; 
        if (lDiff > 0) totalGlobalUnread += lDiff; 

        lBadge.innerText = lDiff > 99 ? '99+' : lDiff; 
        lBadge.style.display = lDiff > 0 ? 'flex' : 'none';
        
        // 修改: 使用自定義標題控制
        if (currentTarget === '') {
            if (totalGlobalUnread > 0) {
                setBaseTitle(MY_NAME + '（有未讀消息）');
            } else {
                setBaseTitle(MY_NAME);
            }
        }
        
        filterUsers();
        updateActiveUserHighlight(); 
    });
}

function filterUsers() {
    const searchBar = document.getElementById('top-search-bar');
    const searchInput = document.getElementById('modal-search-input');
    
    // 【終極防禦：阻斷 Chrome 幽靈自動填充】
    // 只有當搜索面板真正顯示時（包含 'show' class），才讀取輸入框的值。
    // 如果是隱藏狀態，強制設為空字符串，無視 Chrome 在後台偷偷填充的賬號名。
    let query = '';
    if (searchBar && searchBar.classList.contains('show') && searchInput) {
        query = searchInput.value.toLowerCase();
    }
    
    document.querySelectorAll('.user-item').forEach(item => { 
        let uName = item.getAttribute('data-username') || '';
        let dName = (usersDataCache[uName] ? usersDataCache[uName].displayName : uName) || '';
        
        let matchName = typeof dName === 'string' ? dName.toLowerCase() : '';
        let matchUser = typeof uName === 'string' ? uName.toLowerCase() : '';
        
        // 執行隱藏邏輯
        item.classList.toggle('hidden', !matchName.includes(query) && !matchUser.includes(query)); 
    });
}

// ======== 頂部搜索飄窗控制 ========
function openSearchModal(e) {
    if(e) e.stopPropagation();
    document.getElementById('plus-dropdown').style.display = 'none';
    document.getElementById('top-search-bar').classList.add('show');
    setTimeout(() => {
        const input = document.getElementById('modal-search-input');
        if (input) input.focus();
    }, 300);
}

function closeSearchModal() {
    const searchBar = document.getElementById('top-search-bar');
    if (searchBar) {
        searchBar.classList.remove('show');
    }
    const input = document.getElementById('modal-search-input');
    if (input) {
        input.value = '';
        input.blur();
    }
    filterUsers(); 
}

// ======== 對話頁引擎 ========
function formatLocalTime(ts) {
    const date = new Date(parseInt(ts));
    if (isNaN(date.getTime())) return "";

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterday = today - 86400000;
    
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const timeStr = `${hours}:${minutes}`;

    const dateTs = date.getTime();

    if (dateTs >= today) { return timeStr; } 
    else if (dateTs >= yesterday) { return '昨天 ' + timeStr; } 
    else if (dateTs >= today - 86400000 * 6) {
        const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
        return weekdays[date.getDay()] + ' ' + timeStr;
    } else { return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${timeStr}`; }
}

function showUserInfoModal(imgEl) {
    const uName = imgEl.getAttribute('data-name');
    document.getElementById('upm-avatar').src = imgEl.getAttribute('data-avatar');
    document.getElementById('upm-name').innerText = uName;
    document.getElementById('upm-sign').innerText = imgEl.getAttribute('data-sign');
    
    if(uName === MY_NAME) { document.getElementById('upm-avatar-edit').style.display = 'block'; } 
    else { document.getElementById('upm-avatar-edit').style.display = 'none'; }
    document.getElementById('user-profile-modal').style.display = 'flex';
}

function viewCurrentProfile() {
    if (!currentTarget || currentTarget === 'all' || currentTarget.startsWith('g_')) return;
    const user = usersDataCache[currentTarget];
    if (user) {
        const mockEl = document.createElement('img');
        mockEl.setAttribute('data-name', user.name);
        
        let safeAvatar = user.avatar;
        if (!safeAvatar) {
            const firstChar = user.firstChar || user.name.charAt(0);
            const textSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#085A48"/><text x="50%" y="54%" font-family="system-ui, -apple-system, sans-serif" font-size="50" font-weight="bold" fill="#ffffff" text-anchor="middle" dominant-baseline="middle">${firstChar}</text></svg>`;
            safeAvatar = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(textSvg)));
        }
        
        mockEl.setAttribute('data-avatar', safeAvatar);
        mockEl.setAttribute('data-sign', user.signature || '這個人很懶，什麼都沒寫~');
        
        showUserInfoModal(mockEl);
    }
}

async function uploadAvatar(file) {
    if (!file) return;
    const editBtn = document.getElementById('upm-avatar-edit');
    editBtn.innerText = "壓縮中...";
    let finalFile = file;
    if (file.type.startsWith('image/')) { finalFile = await compressImageFrontend(file, avatarMaxWidth); }

    const fd = new FormData(); fd.append('file', finalFile); fd.append('username', MY_NAME);
    editBtn.innerText = "上傳中...";

    fetch('?action=upload_avatar', { method: 'POST', body: fd }).then(res => res.json()).then(data => {
        editBtn.innerText = "换头像";
        if (data.status === 'success') {
            showToast("頭像上傳成功！");
            const newAvatarUrl = data.url + '?t=' + Date.now();
            MY_AVATAR = newAvatarUrl;
            document.getElementById('upm-avatar').src = newAvatarUrl;
            
            const topAvatar = document.querySelector('#list-header img');
            if (topAvatar) topAvatar.src = newAvatarUrl;
            document.getElementById('avatar-preview').src = newAvatarUrl;

            document.querySelectorAll('.msg-avatar').forEach(img => {
                if (img.getAttribute('data-name') === MY_NAME) {
                    img.src = newAvatarUrl; img.setAttribute('data-avatar', newAvatarUrl);
                }
            });
            document.getElementById('avatarInput').value = '';
        } else { showToast(data.msg || '頭像上傳失敗'); }
    }).catch(e => { editBtn.innerText = "换头像"; showToast("上傳出錯！"); });
}

let mediaElements = []; let currentMediaIndex = 0; let imageDownloads = {};
let mediaModal, mediaContent, btnLoadOriginal, viewportMeta, prevBtn, nextBtn;
let currentScale = 1, panX = 0, panY = 0, lastPanX = 0, lastPanY = 0, initialPinchDistance = 0, lastScale = 1;
let lastCloseTime = 0; let mediaCloseTimeout;

function openAvatarModal(url) {
    if (!url) return;
    mediaElements = []; currentMediaIndex = 0;
    mediaContent.innerHTML = `<img src="${url}" class="smooth-zoom">`;
    btnLoadOriginal.style.display = 'none'; prevBtn.classList.remove('show-nav'); nextBtn.classList.remove('show-nav');
    document.getElementById('media-close-btn').style.display = 'none'; // 頭像預覽也不顯示 X 按鈕
    viewportMeta.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=5.0, user-scalable=yes');
    mediaContent.style.transform = "translate3d(0px, 0px, 0px)"; mediaContent.style.opacity = "1";
    mediaModal.classList.add('show');
}

function openMediaModal(sourceEl) {
    if (Date.now() - lastCloseTime < 400) return; 
    
    const querySelectorStr = `#room-${currentTarget} img.media-thumb, #room-${currentTarget} img:not(.msg-avatar):not(.emoji), #room-${currentTarget} .video-wrapper video`;
    mediaElements = Array.from(document.querySelectorAll(querySelectorStr));
    
    currentMediaIndex = mediaElements.indexOf(sourceEl);
    if(currentMediaIndex === -1) return;
    viewportMeta.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=5.0, user-scalable=yes');
    mediaContent.classList.remove('animate-swipe'); mediaContent.style.transform = "translate3d(0px, 0px, 0px)"; mediaContent.style.opacity = "1";
    clearTimeout(mediaCloseTimeout); renderMediaModal(); mediaModal.classList.add('show');
}

function updateOriginalButtonState() {
    if (!mediaElements || currentMediaIndex < 0 || currentMediaIndex >= mediaElements.length) return;
    const el = mediaElements[currentMediaIndex]; if (el.tagName !== 'IMG') return;
    const origUrl = el.getAttribute('data-original'); if (!origUrl) return;
    const modalImg = mediaContent.querySelector('img'); const state = imageDownloads[origUrl];
    if (!state) { if(btnLoadOriginal.getAttribute('data-url') === origUrl) btnLoadOriginal.style.display = 'block'; return; }
    
    if (state.status === 'loading') {
        if(btnLoadOriginal.getAttribute('data-url') === origUrl) { 
            btnLoadOriginal.style.display = 'block'; 
            btnLoadOriginal.innerText = state.progressText; 
            btnLoadOriginal.onclick = null; 
        }
    } else if (state.status === 'done') {
        if(btnLoadOriginal.getAttribute('data-url') === origUrl) {
            btnLoadOriginal.innerText = '加載完成'; 
            if (modalImg && modalImg.src !== state.blobUrl) {
                const newImg = modalImg.cloneNode(true);
                newImg.src = state.blobUrl;
                modalImg.parentNode.replaceChild(newImg, modalImg);
            }
            setTimeout(() => { if(mediaElements[currentMediaIndex] && mediaElements[currentMediaIndex].getAttribute('data-original') === origUrl) btnLoadOriginal.style.display = 'none'; }, 1200);
        }
    } else if (state.status === 'error') {
        if(btnLoadOriginal.getAttribute('data-url') === origUrl) {
            btnLoadOriginal.style.display = 'block'; 
            btnLoadOriginal.innerText = state.progressText;
            setTimeout(() => { if(mediaElements[currentMediaIndex] && mediaElements[currentMediaIndex].getAttribute('data-original') === origUrl) btnLoadOriginal.style.display = 'none'; }, 1500);
        }
    }
}

function fetchOriginalImage(origUrl, sizeInBytes, displaySize = '') {
    if (imageDownloads[origUrl] && imageDownloads[origUrl].status === 'loading') return;
    imageDownloads[origUrl] = { status: 'loading', blobUrl: '', progressText: '加載中...' };
    updateOriginalButtonState();

    const xhr = new XMLHttpRequest();
    xhr.open('GET', origUrl + (origUrl.includes('?') ? '&' : '?') + 'nocache=' + Date.now(), true);
    xhr.responseType = 'blob';
    let lastLoaded = 0; let lastTime = Date.now();
    
    xhr.onprogress = function(e) {
        let total = e.lengthComputable ? e.total : sizeInBytes;
        let loaded = e.loaded; 
        
        let currentTime = Date.now(); 
        let timeDiff = (currentTime - lastTime) / 1000; 
        
        if (timeDiff >= 0.25 || (total && loaded === total)) { 
            let speedBytes = timeDiff > 0 ? (loaded - lastLoaded) / timeDiff : 0;
            let speedDisplay = speedBytes > 1024 * 1024 ? (speedBytes / (1024 * 1024)).toFixed(1) + 'MB/s' : (speedBytes / 1024).toFixed(0) + 'KB/s';
            
            let loadedDisplay = loaded > 1024 * 1024 ? (loaded / (1024 * 1024)).toFixed(1) + 'MB' : (loaded / 1024).toFixed(0) + 'KB';
            
            let totalStr = displaySize;
            if (total > 0) {
                totalStr = total > 1024 * 1024 ? (total / (1024 * 1024)).toFixed(1) + 'MB' : (total / 1024).toFixed(0) + 'KB';
            } else if (!totalStr) {
                totalStr = '未知大小';
            }

            imageDownloads[origUrl].progressText = `${totalStr}/${loadedDisplay}(${speedDisplay})`;
            
            updateOriginalButtonState(); 
            lastLoaded = loaded; 
            lastTime = currentTime;
        }
    };
    xhr.onload = function() {
        if (xhr.status === 200) {
            const blobUrl = URL.createObjectURL(xhr.response);
            imageDownloads[origUrl].status = 'done'; imageDownloads[origUrl].blobUrl = blobUrl;
            document.querySelectorAll(`img[data-original="${origUrl}"]`).forEach(t => t.src = blobUrl);
            updateOriginalButtonState();
        } else { imageDownloads[origUrl].status = 'error'; imageDownloads[origUrl].progressText = '加載失敗'; updateOriginalButtonState(); }
    };
    xhr.onerror = function() { imageDownloads[origUrl].status = 'error'; imageDownloads[origUrl].progressText = '網絡錯誤'; updateOriginalButtonState(); };
    xhr.send();
}

function loadVideoIntoModal(url) {
    btnLoadOriginal.style.display = 'none'; mediaContent.innerHTML = '';
    const video = document.createElement('video'); video.src = url; video.controls = true; video.autoplay = true;
    video.setAttribute('playsinline', 'true'); video.setAttribute('webkit-playsinline', 'true'); mediaContent.appendChild(video);
}

function renderMediaModal() {
    mediaContent.innerHTML = ''; currentScale = 1; panX = 0; panY = 0; lastPanX = 0; lastPanY = 0; lastScale = 1; btnLoadOriginal.style.display = 'none';
    if (currentMediaIndex > 0) prevBtn.classList.add('show-nav'); else prevBtn.classList.remove('show-nav');
    if (currentMediaIndex < mediaElements.length - 1) nextBtn.classList.add('show-nav'); else nextBtn.classList.remove('show-nav');

    const el = mediaElements[currentMediaIndex];
    
    // 精準判斷是否為影片，影片顯示 X 按鈕，圖片隱藏 X 按鈕
    let isVideoItem = false;
    if (el) {
        if (el.tagName === 'VIDEO') isVideoItem = true;
        if (el.tagName === 'IMG' && el.getAttribute('data-video')) isVideoItem = true;
    }
    const closeBtn = document.getElementById('media-close-btn');
    if (closeBtn) {
        if (isVideoItem) {
            closeBtn.style.display = 'flex';
        } else {
            closeBtn.style.display = 'none';
        }
    }

    if (el.tagName === 'IMG') {
        const origUrl = el.getAttribute('data-original'); const videoUrl = el.getAttribute('data-video');
        if (videoUrl) { loadVideoIntoModal(videoUrl); } 
        else {
            const img = document.createElement('img');
            if (imageDownloads[origUrl] && imageDownloads[origUrl].status === 'done') { img.src = imageDownloads[origUrl].blobUrl; } else { img.src = el.src; }
            img.className = 'smooth-zoom'; mediaContent.appendChild(img);
            if (origUrl) {
                btnLoadOriginal.setAttribute('data-url', origUrl);
                if (imageDownloads[origUrl]) { updateOriginalButtonState(); } else {
                    let displaySize = el.getAttribute('data-size');
                    if (!displaySize) { const parent = el.closest('.media-container'); if (parent) { const dlBtn = parent.querySelector('.dl-btn-overlay'); if (dlBtn && dlBtn.innerText.includes('(')) { displaySize = dlBtn.innerText.split('(')[1].replace(')', ''); } } }
                    
                    if (displaySize) { btnLoadOriginal.innerText = `加載原圖 (${displaySize})`; } else { btnLoadOriginal.innerText = '加載原圖'; }
                    btnLoadOriginal.style.display = 'block'; btnLoadOriginal.onclick = (e) => { e.stopPropagation(); fetchOriginalImage(origUrl, 0, displaySize); };
                }
            }
        }
    } else if (el.tagName === 'VIDEO') {
        const video = document.createElement('video'); let vSrc = el.getAttribute('src') || el.currentSrc;
        if(vSrc.includes('#t=')) vSrc = vSrc.split('#t=')[0]; 
        video.src = vSrc; video.controls = true; video.autoplay = true; 
        video.setAttribute('playsinline', 'true'); video.setAttribute('webkit-playsinline', 'true');
        mediaContent.appendChild(video); video.play().catch(e => console.log(e));
    }
}

function closeMediaModal() {
    mediaModal.classList.remove('show'); lastCloseTime = Date.now(); clearTimeout(mediaCloseTimeout);
    mediaCloseTimeout = setTimeout(() => { if (!mediaModal.classList.contains('show')) mediaContent.innerHTML = ''; }, 250);
    viewportMeta.setAttribute('content', 'width=device-width, initial-scale=1.0, minimum-scale=1.0, maximum-scale=1.0, user-scalable=0, viewport-fit=cover');
}

function executeMediaSwipe(direction) {
    mediaContent.classList.add('animate-swipe');
    if (direction === 1 && currentMediaIndex < mediaElements.length - 1) {
        mediaContent.style.transform = `translate3d(-100vw, 0, 0)`; mediaContent.style.opacity = "0";
        setTimeout(() => { currentMediaIndex++; renderMediaModal(); mediaContent.classList.remove('animate-swipe'); mediaContent.style.transform = `translate3d(100vw, 0, 0)`; void mediaContent.offsetWidth; mediaContent.classList.add('animate-swipe'); mediaContent.style.transform = `translate3d(0, 0, 0)`; mediaContent.style.opacity = "1"; }, 250);
    } else if (direction === -1 && currentMediaIndex > 0) {
        mediaContent.style.transform = `translate3d(100vw, 0, 0)`; mediaContent.style.opacity = "0";
        setTimeout(() => { currentMediaIndex--; renderMediaModal(); mediaContent.classList.remove('animate-swipe'); mediaContent.style.transform = `translate3d(-100vw, 0, 0)`; void mediaContent.offsetWidth; mediaContent.classList.add('animate-swipe'); mediaContent.style.transform = `translate3d(0, 0, 0)`; mediaContent.style.opacity = "1"; }, 250);
    } else { mediaContent.style.transform = "translate3d(0, 0, 0)"; }
}

function processNode(node) {
    node.querySelectorAll('.other_talk, .me_talk').forEach(talk => {
        const hasMedia = talk.querySelector('img:not(.msg-avatar), video, .file-card-inner, .voice-up-box, .up-box');
        const hasUploadTag = talk.innerHTML.includes('📄') || talk.innerHTML.includes('up-box');
        
        if (hasMedia || hasUploadTag) talk.classList.add('no-bubble');
        if (talk.querySelector('audio')) { talk.classList.remove('no-bubble'); }
        
        talk.querySelectorAll('.media-thumb, img:not(.msg-avatar):not(.emoji)').forEach(img => {
            img.style.cursor = 'pointer'; img.setAttribute('decoding', 'async');
            const wrapper = img.closest('.video-wrapper');
            if (wrapper) { wrapper.onclick = function(e) { e.preventDefault(); e.stopPropagation(); openMediaModal(img); }; } 
            else { img.onclick = function(e) { e.stopPropagation(); openMediaModal(this); }; }
            img.onerror = function() { const src = this.src; if(src.indexOf('?') === -1) this.src = src + '?r=' + Math.random(); };
        });
        
        talk.querySelectorAll('video:not(.up-box video)').forEach(v => {
            if (v.parentElement.classList.contains('video-wrapper')) return;
            let videoSrc = v.getAttribute('src');
            if (videoSrc && videoSrc.indexOf('#t=') === -1) { v.src = videoSrc + '#t=0.1'; }
            const wrapper = document.createElement('div'); wrapper.className = 'video-wrapper';
            const playOverlay = document.createElement('div'); playOverlay.className = 'play-overlay';
            playOverlay.innerHTML = `<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>`;
            v.parentNode.insertBefore(wrapper, v); wrapper.appendChild(v); wrapper.appendChild(playOverlay);
            v.setAttribute('preload', 'metadata'); v.controls = false; 
            wrapper.onclick = function(e) { e.preventDefault(); openMediaModal(v); };
        });

        talk.querySelectorAll('audio').forEach(a => {
            if (a.getAttribute('data-cache-processed')) return;
            a.setAttribute('data-cache-processed', '1');
            a.style.display = 'none';

            const wrapper = document.createElement('div');
            wrapper.className = 'voice-player-wrapper';
            const iconHtml = `<svg class="voice-icon-svg" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M11 5L6 9H2v6h4l5 4V5z"></path>
                <path class="wave-1" d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
                <path class="wave-2" d="M19.07 4.93a10 10 0 0 1 0 14.14"></path>
            </svg>`;
            const timeText = document.createElement('span');
            timeText.className = 'voice-time-text'; timeText.innerText = '..."'; 
            const statusTips = document.createElement('div'); statusTips.className = 'voice-status-tips';
            wrapper.innerHTML = iconHtml; wrapper.appendChild(timeText); wrapper.appendChild(statusTips);
            a.parentNode.insertBefore(wrapper, a);

            const updateVoiceUI = () => {
                if (a.duration && a.duration !== Infinity && !isNaN(a.duration)) {
                    const dur = Math.round(a.duration); timeText.innerText = dur + '"';
                    const calcWidth = 60 + (dur * 4); wrapper.style.width = calcWidth + 'px';
                }
            };
            if (a.readyState >= 1) updateVoiceUI();
            a.addEventListener('loadedmetadata', updateVoiceUI); a.addEventListener('durationchange', updateVoiceUI);

            const talkBubble = wrapper.closest('.me_talk, .other_talk');
            if (talkBubble) {
                talkBubble.style.cursor = 'pointer';
                talkBubble.onclick = (e) => {
                    e.stopPropagation();
                    if (window.currentPlayingAudio && window.currentPlayingAudio !== a) {
                        window.currentPlayingAudio.pause(); window.currentPlayingAudio.currentTime = 0;
                        if (window.currentPlayingWrapper) {
                            window.currentPlayingWrapper.classList.remove('playing');
                            window.currentPlayingWrapper.querySelector('.voice-status-tips').style.display = 'none';
                        }
                    }
                    if (a.paused) {
                        a.play().catch(err => console.log('語音播放需交互許可', err));
                        wrapper.classList.add('playing'); statusTips.innerText = '播放中...'; statusTips.style.display = 'block';
                        window.currentPlayingAudio = a; window.currentPlayingWrapper = wrapper;
                    } else {
                        a.pause(); wrapper.classList.remove('playing'); statusTips.innerText = '已暫停...'; statusTips.style.display = 'block';
                    }
                };
            }
            a.addEventListener('ended', () => { wrapper.classList.remove('playing'); statusTips.style.display = 'none'; if (window.currentPlayingAudio === a) { window.currentPlayingAudio = null; window.currentPlayingWrapper = null; } });

            const origSrc = a.getAttribute('src') || a.getAttribute('data-src');
            if (!origSrc || origSrc.startsWith('blob:') || origSrc.startsWith('data:')) return;

            a.removeAttribute('src'); a.setAttribute('data-src', origSrc); a.setAttribute('preload', 'none'); 
            if ('caches' in window) {
                caches.open('chat-audio-cache').then(cache => {
                    cache.match(origSrc).then(res => {
                        if (res) { res.blob().then(blob => { const reader = new FileReader(); reader.onloadend = () => { a.src = reader.result; a.setAttribute('preload', 'auto'); }; reader.readAsDataURL(blob); }); } 
                        else { a.src = origSrc; a.setAttribute('preload', 'metadata'); fetch(origSrc).then(netRes => { if (netRes.ok) cache.put(origSrc, netRes.clone()); }).catch(e => console.log('語音緩存失敗', e)); }
                    });
                });
            } else { a.src = origSrc; a.setAttribute('preload', 'metadata'); }
        });
    });
}

// ======== 異步拉取網頁鏈接卡片元數據 ========
function processLinkCards() {
    document.querySelectorAll('.link-card:not(.meta-loaded)').forEach(card => {
        card.classList.add('meta-loaded'); 
        const url = card.getAttribute('data-url');
        if (!url) return;
        
        fetch(`?action=url_meta&url=${encodeURIComponent(url)}`)
            .then(r => r.json())
            .then(data => {
                const titleEl = card.querySelector('.lc-title');
                const descEl = card.querySelector('.lc-desc');
                if(titleEl) titleEl.innerText = data.title;
                if(descEl) descEl.innerText = data.desc;
            }).catch(() => {
                const titleEl = card.querySelector('.lc-title');
                const descEl = card.querySelector('.lc-desc');
                if(titleEl) titleEl.innerText = '🔗 網頁鏈接';
                if(descEl) descEl.innerText = '點擊查看網頁詳細內容...';
            });
    });
}

function checkMessages(isFirstLoad = false, isLoadMore = false) {
    if (!currentTarget) return; 
    if (isFetching) return;
    isFetching = true;
    
    fetch(`?action=read&to=${encodeURIComponent(currentTarget)}&limit=${currentMsgLimit}&t=${Date.now()}`)
    .then(r => r.text()).then(res => {
        isFetching = false;
        res = res.trim();
        
        if (res.includes('id="not-found-flag"')) {
            showToast("群組不存在");
            goBack();
            return;
        }

        if (res.includes('id="kicked-flag"')) {
            showToast("您已被移出該群組");
            goBack();
            return;
        }

        let allspace = document.getElementById("allspace");
        let activeRoom = document.getElementById('room-' + currentTarget);
        if (!activeRoom) return;
        
        if(res === lastContentMap[currentTarget] && !isFirstLoad && !isLoadMore) return;
        
        let isAtBottom = (allspace.scrollHeight - allspace.scrollTop - allspace.clientHeight) < 150;
        let oldScrollHeight = allspace.scrollHeight;
        
        let parser = new DOMParser();
        let newDoc = parser.parseFromString(res, 'text/html');
        
        let newRows = Array.from(newDoc.querySelectorAll('.msg-container'));
        
        let currentIds = new Set();
        activeRoom.querySelectorAll('.msg-container[data-id]').forEach(el => currentIds.add(el.getAttribute('data-id')));
        
        if (isLoadMore && newRows.length <= currentIds.size) {
            hasMoreHistory = false;
        }

        let incomingIds = new Set();
        newRows.forEach(row => { let id = row.getAttribute('data-id'); if (id) incomingIds.add(id); });
        
        activeRoom.querySelectorAll('.msg-container[data-id]').forEach(el => { 
            if (!incomingIds.has(el.getAttribute('data-id'))) el.remove(); 
        });
        
        if (newRows.length === 0 && !activeRoom.querySelector('.uploading-task')) activeRoom.innerHTML = "";
        
        let hasNewMessage = false;
        let hasNewOtherMsg = false;
        let latestSender = "新消息";
        let latestMsgText = "您收到了一條新消息";
        
        newRows.forEach(row => {
            let msgId = row.getAttribute('data-id');
            if (msgId) {
                if (!currentIds.has(msgId)) {
                    let n = row.cloneNode(true); processNode(n);
                    activeRoom.appendChild(n); 
                    
                    if (!isLoadMore) hasNewMessage = true; 
                    if (!isLoadMore && row.querySelector('.row-other')) {
                        hasNewOtherMsg = true;
                        
                        let nameEl = row.querySelector('.msg-name');
                        latestSender = nameEl ? nameEl.innerText : (currentTarget === 'all' ? '公共大廳' : currentTarget);

                        let talkEl = row.querySelector('.other_talk');
                        if (talkEl) {
                            if (talkEl.querySelector('img:not(.emoji)') || talkEl.querySelector('.video-wrapper')) {
                                latestMsgText = "[圖片/視頻]";
                            } else if (talkEl.querySelector('.voice-player-wrapper')) {
                                latestMsgText = "[語音]";
                            } else if (talkEl.querySelector('.file-card-inner')) {
                                latestMsgText = "[文件]";
                            } else {
                                latestMsgText = talkEl.innerText.replace(/[\r\n]+/g, ' ').substring(0, 50);
                            }
                        }
                    }
                } else {
                    let existingRow = activeRoom.querySelector(`.msg-container[data-id="${msgId}"]`);
                    if (existingRow) {
                        let newDot = row.querySelector('.status-dot');
                        let oldDot = existingRow.querySelector('.status-dot');
                        if (newDot && oldDot) {
                            if (oldDot.outerHTML !== newDot.outerHTML) oldDot.outerHTML = newDot.outerHTML;
                        } else if (newDot && !oldDot) {
                            let talkBox = existingRow.querySelector('.me_talk');
                            if(talkBox) talkBox.insertAdjacentHTML('afterbegin', newDot.outerHTML);
                        } else if (!newDot && oldDot) {
                            oldDot.remove(); 
                        }

                        let newTime = row.querySelector('.chat-time-center');
                        let oldTime = existingRow.querySelector('.chat-time-center');
                        if (newTime && !oldTime) {
                            existingRow.insertAdjacentHTML('afterbegin', newTime.outerHTML);
                        } else if (!newTime && oldTime) {
                            oldTime.remove();
                        } else if (newTime && oldTime && oldTime.getAttribute('data-ts') !== newTime.getAttribute('data-ts')) {
                            oldTime.outerHTML = newTime.outerHTML;
                        }
                    }
                }
            }
        });

        // ==========================================
        // 修復：優化 DOM 排序插入邏輯，防止頻繁強制渲染導致的閃屏
        // ==========================================
        let nodesArray = Array.from(activeRoom.querySelectorAll('.msg-container[data-id]'));
        nodesArray.sort((a, b) => parseInt(a.getAttribute('data-id')) - parseInt(b.getAttribute('data-id')));
        
        nodesArray.forEach((node, index) => {
            if (activeRoom.children[index] !== node) {
                activeRoom.insertBefore(node, activeRoom.children[index] || null);
            }
        });
        
        let optimisticNodes = Array.from(activeRoom.querySelectorAll('.optimistic-msg, .uploading-task'));
        optimisticNodes.forEach(node => {
            if (activeRoom.lastChild !== node) {
                activeRoom.appendChild(node);
            }
        });
        // ==========================================

        if (hasNewOtherMsg && document.hidden) {
            playNotifySound();
            sendDesktopNotification(latestSender, latestMsgText);
            startTitleBlink(); // 修改: 觸發標題閃爍
        }
        
        activeRoom.querySelectorAll('.chat-time-center[data-ts]').forEach(el => {
            if(!el.getAttribute('data-formatted')) {
                el.innerText = formatLocalTime(el.getAttribute('data-ts'));
                el.setAttribute('data-formatted', '1');
            }
        });

        if (hasNewMessage && !isLoadMore) { activeRoom.querySelectorAll('.optimistic-msg').forEach(pNode => { pNode.remove(); }); }
        
        if (isLoadMore) {
            allspace.scrollTop = allspace.scrollHeight - oldScrollHeight;
        } else if (isFirstLoad || (hasNewMessage && isAtBottom)) { 
            setTimeout(() => { allspace.scrollTop = allspace.scrollHeight; }, 100); 
        }
        
        processLinkCards();
        
        lastContentMap[currentTarget] = res; 
        clearUnread();
    }).catch(() => { isFetching = false; });
}

function sendText() {
    let textarea = document.getElementById("text"), m = textarea.value.trim();
    if (!m || !currentTarget) return;
    
    let allspace = document.getElementById("allspace");
    let activeRoom = document.getElementById('room-' + currentTarget);
    if (!activeRoom) return;

    let tempRow = document.createElement("div"); tempRow.className = "msg-container optimistic-msg";
    
    let safeM = m.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;").replace(/\n/g, '<br>');
    
    let dotHtml = '<div class="status-dot dot-sending"></div>';
    let contentHtml = '';
    let bubbleClass = 'me_talk';
    
    if (/^https?:\/\/[^\s]+$/i.test(m)) {
        contentHtml = `<div class="link-card" data-url="${m}" onclick="openIframeModal('${m}')">
            <div class="lc-title">🔗 加載中...</div>
            <div class="lc-desc">正在獲取網頁資訊...</div>
            <div class="lc-url">${m}</div>
            <button class="lc-copy-btn" onclick="copyLinkUrl(event, '${m}')">複製</button>
        </div>`;
        bubbleClass = 'me_talk no-bubble';
    } else {
        contentHtml = safeM;
    }

    tempRow.innerHTML = `<div class="msg-row row-me"><div class="msg-content-wrapper"><div class="me-msg-box"><div class="${bubbleClass}">${dotHtml}${contentHtml}</div></div></div><img src="${MY_AVATAR}" class="msg-avatar" data-name="${MY_NAME}" data-avatar="${MY_AVATAR}" data-sign="${MY_SIGN}" onclick="showUserInfoModal(this)"></div>`;
    
    activeRoom.appendChild(tempRow); 
    allspace.scrollTop = allspace.scrollHeight; 
    textarea.value = ""; 
    textarea.style.height = '40px';
    
    processLinkCards();

    const fd = new FormData(); fd.append('message', m);
    fetch(`?action=send&to=${encodeURIComponent(currentTarget)}`, { method: 'POST', body: fd }).then(() => checkMessages());
}

async function handleMultipleUpload(files) {
    if (!files || files.length === 0) return;
    const fileArray = Array.from(files);

    if (!IS_ADMIN && UPLOAD_SIZE_LIMIT > 0) {
        const maxBytes = UPLOAD_SIZE_LIMIT * 1024 * 1024;
        for (let i = 0; i < fileArray.length; i++) {
            if (fileArray[i].size > maxBytes) {
                await customAlert(`禁止上傳：文件大於 ${UPLOAD_SIZE_LIMIT}MB！`);
                document.getElementById('imgInput').value = "";
                return;
            }
        }
    }

    fileArray.forEach(file => handleSingleUploadTask(file));
    document.getElementById('imgInput').value = ""; 
}

async function createThumb(file) {
    return new Promise(resolve => {
        if (file.type.startsWith('image/')) {
            const img = new Image(); img.src = URL.createObjectURL(file);
            img.onload = () => {
                const canvas = document.createElement('canvas'); const scale = THUMB_ACTUAL_WIDTH / img.width;
                canvas.width = THUMB_ACTUAL_WIDTH; canvas.height = img.height * scale;
                canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL('image/jpeg', 0.7)); URL.revokeObjectURL(img.src);
            };
            img.onerror = () => resolve('');
        } else if (file.type.startsWith('video/')) {
            const video = document.createElement('video'); video.src = URL.createObjectURL(file); video.muted = true; video.playsInline = true;
            const fallback = setTimeout(() => { resolve(''); }, 2000);
            video.onloadeddata = () => { video.currentTime = 1; };
            video.onseeked = () => {
                clearTimeout(fallback);
                try {
                    const canvas = document.createElement('canvas'); const scale = THUMB_ACTUAL_WIDTH / video.videoWidth;
                    canvas.width = THUMB_ACTUAL_WIDTH; canvas.height = video.videoHeight * scale;
                    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
                    resolve(canvas.toDataURL('image/jpeg', 0.7)); 
                } catch(e) { resolve(''); }
                URL.revokeObjectURL(video.src);
            };
            video.onerror = () => { clearTimeout(fallback); resolve(''); };
            video.load();
        } else { resolve(''); }
    });
}

async function compressImageFrontend(file, maxWidth) {
    return new Promise((resolve) => {
        const reader = new FileReader(); reader.readAsDataURL(file);
        reader.onload = event => {
            const img = new Image(); img.src = event.target.result;
            img.onload = () => {
                if (img.width <= maxWidth) { resolve(file); return; }
                const scale = maxWidth / img.width; const newWidth = maxWidth, newHeight = img.height * scale;
                const canvas = document.createElement('canvas'); canvas.width = newWidth; canvas.height = newHeight;
                canvas.getContext('2d').drawImage(img, 0, 0, newWidth, newHeight);
                canvas.toBlob(blob => { resolve(new File([blob], file.name, { type: 'image/jpeg' })); }, 'image/jpeg', 0.8);
            };
        };
    });
}

async function handleSingleUploadTask(file, fileName = null) {
    if(!file || !currentTarget) return;
    const isVoice = file.type === 'audio/mp3' || (fileName && fileName.startsWith('voice_'));
    
    if (!IS_ADMIN && !isVoice) {
        if (UPLOAD_SIZE_LIMIT === 0) { await customAlert("禁止上傳：管理員已關閉文件上傳功能"); return; }
        if (UPLOAD_SIZE_LIMIT > 0 && file.size > UPLOAD_SIZE_LIMIT * 1024 * 1024) { await customAlert(`禁止上傳：文件大於 ${UPLOAD_SIZE_LIMIT}MB！`); return; }
    }

    let configData = {};
    try { const configRes = await fetch('?action=get_configs'); configData = await configRes.json(); } catch (e) {}

    if (file.type.startsWith('image/')) { if (configData.disable_image === '1') { await customAlert("禁止圖片發送請聯繫管理員"); return; } }
    if (file.type.startsWith('video/')) { if (configData.disable_video === '1') { await customAlert("禁止視頻發送請聯繫管理員"); return; } }

    const allspace = document.getElementById("allspace");
    const activeRoom = document.getElementById('room-' + currentTarget);
    if (!activeRoom) return;

    const previewUrl = URL.createObjectURL(file);
    let previewHtml = ""; let fn = fileName || file.name; let isVoiceBubble = false;
    
    if (file.type === 'audio/mp3' || file.name.toLowerCase().endsWith('.mp3') || (fileName && fileName.startsWith('voice_'))) {
        isVoiceBubble = true;
        previewHtml = `<div class="voice-player-wrapper" style="width: 100px;">
            <svg class="voice-icon-svg" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.4;">
                <path d="M11 5L6 9H2v6h4l5 4V5z"></path>
                <path class="wave-1" d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
                <path class="wave-2" d="M19.07 4.93a10 10 0 0 1 0 14.14"></path>
            </svg>
            <span class="voice-time-text" style="display:none;"></span>
            <span id="up-pct" style="font-size: 15px; font-weight: 500; color: rgba(8, 90, 72, 0.65); margin-right: auto;">0%</span>
            <button class="action-btn" style="display:none;"></button>
        </div>`;
    } else if (file.type.startsWith('image/')) {
        previewHtml = `<div class="up-box" style="width:${THUMB_DISPLAY_WIDTH}px; height:${THUMB_DISPLAY_WIDTH}px;"><img src="${previewUrl}" class="up-bg-preview"><div class="up-mask"><div class="up-bar-cnt"><div class="up-bar-bg"><div class="up-bar-fill" id="up-fill"></div></div><div style="display:flex;justify-content:center;gap:5px;"><span class="up-pct-text" id="up-pct">0%</span><span class="up-pct-text" id="up-speed"></span></div></div></div><button class="cancel-btn action-btn">取消</button></div>`;
    } else if (file.type.startsWith('video/')) {
        previewHtml = `<div class="up-box" style="width:${THUMB_DISPLAY_WIDTH}px; height:${THUMB_DISPLAY_WIDTH}px;"><video src="${previewUrl}" class="up-bg-preview" autoplay loop muted playsinline webkit-playsinline></video><div class="up-mask"><div class="up-bar-cnt"><div class="up-bar-bg"><div class="up-bar-fill" id="up-fill"></div></div><div style="display:flex;justify-content:center;gap:5px;"><span class="up-pct-text" id="up-pct">0%</span><span class="up-pct-text" id="up-speed"></span></div></div></div><button class="cancel-btn action-btn">取消</button></div>`;
    } else {
        let extStr = fn.split('.').pop().toUpperCase(); if(extStr.length > 4 || !fn.includes('.')) extStr = 'FILE';
        previewHtml = `<div class="up-box file-card-inner" style="background-color: rgba(0, 0, 0, 0.1);"><div style="width:32px; height:32px; background:#F2F5F8; border-radius:6px; border:1px solid #E8ECEF; display:flex; flex-direction:column; align-items:center; justify-content:center; flex-shrink:0;"><svg viewBox="0 0 24 24" style="width:14px; height:14px; fill:none; stroke:#555; stroke-width:2;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg><span style="font-size:8px; font-weight:bold; margin-top:1px; color:#E67E22;">${extStr}</span></div><div style="flex:1; min-width:0; display:flex; flex-direction:column; gap:2px;"><div style="font-size:13px; font-weight:bold; color:#333; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${fn}</div><div style="display:flex; justify-content:space-between; align-items:center;"><span style="font-size:10px; color:#999;">${extStr} 文件</span></div></div><div class="up-mask" style="background:rgba(255,255,255,0.85); border-radius:12px;"><div class="up-bar-cnt" style="width:80%;"><div class="up-bar-bg" style="height:3px;"><div class="up-bar-fill" id="up-fill"></div></div><div style="display:flex;justify-content:center;gap:4px;margin-top:2px;"><span style="color:#085A48;font-size:10px;font-weight:bold;" id="up-pct">0%</span><span style="color:#085A48;font-size:10px;" id="up-speed"></span></div></div></div><button class="cancel-btn action-btn" style="bottom:2px; right:2px; font-size:9px; padding:1px 5px;">取消</button></div>`;
    }

    const wrapper = document.createElement("div"); wrapper.className = "msg-container uploading-task";
    let dotHtml = '<div class="status-dot dot-sending"></div>';
    let bubbleClass = isVoiceBubble ? 'me_talk' : 'me_talk no-bubble';
    
    wrapper.innerHTML = `<div class="msg-row row-me"><div class="msg-content-wrapper"><div class="me-msg-box"><div class="${bubbleClass}">${dotHtml}${previewHtml}</div></div></div><img src="${MY_AVATAR}" class="msg-avatar" data-name="${MY_NAME}" data-avatar="${MY_AVATAR}" data-sign="${MY_SIGN}" onclick="showUserInfoModal(this)"></div>`;
    activeRoom.appendChild(wrapper); allspace.scrollTop = allspace.scrollHeight;

    let finalFile = fileName ? new File([file], fileName, { type: 'audio/mp3' }) : file;
    if (finalFile.type.startsWith('image/') && configData.compress_img === '1') {
        const targetWidth = parseInt(configData.img_max_width) || 720;
        finalFile = await compressImageFrontend(finalFile, targetWidth);
    }

    const thumb = await createThumb(finalFile);
    const isChunkingEnabled = configData.chunk_upload === '1';
    const chunkSizeMB = parseFloat(configData.chunk_size) || 2;
    const chunkSizeBytes = Math.floor(chunkSizeMB * 1024 * 1024);

    return new Promise(async (resolve) => {
        let abortFlag = false; let activeXhrs = new Set(); 
        wrapper.querySelector('.action-btn').onclick = () => { abortFlag = true; activeXhrs.forEach(xhr => xhr.abort()); activeXhrs.clear(); URL.revokeObjectURL(previewUrl); wrapper.remove(); resolve(); };

        if (isChunkingEnabled && finalFile.size > chunkSizeBytes) {
            const totalChunks = Math.ceil(finalFile.size / chunkSizeBytes);
            const fileId = Date.now() + '_' + Math.floor(Math.random() * 10000);
            let chunksLoaded = new Array(totalChunks).fill(0); let lastTime = Date.now(); let lastLoadedTotal = 0; let currentChunk = 0; const maxConcurrent = 3; const maxRetries = 3;

            const updateProgress = () => {
                let currentTotalLoaded = chunksLoaded.reduce((a, b) => a + b, 0);
                let p = Math.round((currentTotalLoaded / finalFile.size) * 100);
                const fill = wrapper.querySelector("#up-fill"), pct = wrapper.querySelector("#up-pct");
                if (fill) fill.style.width = p + "%"; if (pct) pct.innerText = p + "%";
                let currentTime = Date.now(); let timeDiff = (currentTime - lastTime) / 1000;
                if (timeDiff >= 0.25 || currentTotalLoaded === finalFile.size) {
                    let speedBytes = timeDiff > 0 ? (currentTotalLoaded - lastLoadedTotal) / timeDiff : 0;
                    let speedStr = speedBytes > 1048576 ? (speedBytes / 1048576).toFixed(1) + 'MB/s' : Math.round(speedBytes / 1024) + 'KB/s';
                    const speedEl = wrapper.querySelector("#up-speed"); if (speedEl) speedEl.innerText = speedStr;
                    lastLoadedTotal = currentTotalLoaded; lastTime = currentTime;
                }
            };

            async function uploadWorker() {
                while (currentChunk < totalChunks) {
                    if (abortFlag) break;
                    let i = currentChunk++; let start = i * chunkSizeBytes; let end = Math.min(start + chunkSizeBytes, finalFile.size); let chunk = finalFile.slice(start, end);
                    let success = false; let retries = 0;
                    while (!success && retries < maxRetries && !abortFlag) {
                        try {
                            await new Promise((resolveChunk, rejectChunk) => {
                                const xhr = new XMLHttpRequest(); activeXhrs.add(xhr); xhr.open("POST", "?action=upload", true);
                                xhr.upload.onprogress = (e) => { if (e.lengthComputable && !abortFlag) { chunksLoaded[i] = e.loaded; updateProgress(); } };
                                xhr.onload = () => { activeXhrs.delete(xhr); if (xhr.status === 200) { chunksLoaded[i] = chunk.size; updateProgress(); resolveChunk(); } else { rejectChunk(new Error(`HTTP ${xhr.status}`)); } };
                                xhr.onerror = () => { activeXhrs.delete(xhr); rejectChunk(new Error("Network error")); };
                                xhr.onabort = () => { activeXhrs.delete(xhr); rejectChunk(new Error("Aborted")); };
                                let fd = new FormData(); fd.append("action_type", "chunk"); fd.append("file", chunk, finalFile.name); fd.append("fileId", fileId); fd.append("chunkIndex", i);
                                if (abortFlag) { xhr.abort(); } else { xhr.send(fd); }
                            });
                            success = true; 
                        } catch (err) {
                            if (abortFlag) break; retries++; console.warn(`切片 ${i} 上傳失敗，正在進行第 ${retries} 次重試...`, err);
                            if (retries >= maxRetries) { abortFlag = true; showToast("網絡不穩定，文件上傳失敗"); } else { await new Promise(r => setTimeout(r, 1000)); }
                        }
                    }
                }
            }

            let workers = []; for (let w = 0; w < maxConcurrent; w++) { workers.push(uploadWorker()); } await Promise.all(workers);

            if (!abortFlag) {
                const fd = new FormData();
                fd.append("action_type", "merge"); fd.append("fileName", finalFile.name); fd.append("username", MY_NAME); fd.append("to", currentTarget); fd.append("fileId", fileId); fd.append("totalChunks", totalChunks); if (thumb) fd.append("thumb", thumb);
                await new Promise((resolveMerge) => {
                    const xhr = new XMLHttpRequest(); activeXhrs.add(xhr); xhr.open("POST", "?action=upload", true);
                    xhr.onload = () => {
                        activeXhrs.delete(xhr); URL.revokeObjectURL(previewUrl); 
                        if(wrapper.parentNode) {
                            wrapper.classList.remove('uploading-task'); wrapper.classList.add('optimistic-msg');
                            const pct = wrapper.querySelector('#up-pct'); if(pct) pct.style.display = 'none';
                            const actionBtn = wrapper.querySelector('.action-btn'); if(actionBtn) actionBtn.style.display = 'none';
                            const speed = wrapper.querySelector('#up-speed'); if(speed) speed.style.display = 'none';
                            const barBg = wrapper.querySelector('.up-bar-bg'); if(barBg) barBg.style.display = 'none';
                            const upMask = wrapper.querySelector('.up-mask'); if(upMask) upMask.style.background = 'transparent';
                        }
                        checkMessages(); resolveMerge();
                    };
                    xhr.onerror = () => { activeXhrs.delete(xhr); if(wrapper.parentNode) wrapper.remove(); resolveMerge(); };
                    xhr.onabort = () => { activeXhrs.delete(xhr); if(wrapper.parentNode) wrapper.remove(); resolveMerge(); };
                    if (abortFlag) { xhr.abort(); } else { xhr.send(fd); }
                });
                resolve();
            } else { resolve(); }
        } else {
            const fd = new FormData();
            fd.append("file", finalFile); if(thumb) fd.append("thumb", thumb); fd.append("fileName", finalFile.name); fd.append("username", MY_NAME); fd.append("to", currentTarget);
            const xhr = new XMLHttpRequest(); activeXhrs.add(xhr); xhr.open("POST", "?action=upload", true);
            let lastLoaded = 0; let lastTime = Date.now();
            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable && !abortFlag) {
                    let p = Math.round((e.loaded / e.total) * 100);
                    const fill = wrapper.querySelector("#up-fill"), pct = wrapper.querySelector("#up-pct");
                    if(fill) fill.style.width = p + "%"; if(pct) pct.innerText = p + "%";
                    let currentTime = Date.now(); let timeDiff = (currentTime - lastTime) / 1000;
                    if (timeDiff >= 0.25) {
                        let speedBytes = (e.loaded - lastLoaded) / timeDiff;
                        let speedStr = speedBytes > 1048576 ? (speedBytes / 1048576).toFixed(1) + 'MB/s' : Math.round(speedBytes / 1024) + 'KB/s';
                        const speedEl = wrapper.querySelector("#up-speed"); if (speedEl) speedEl.innerText = speedStr;
                        lastLoaded = e.loaded; lastTime = currentTime;
                    }
                }
            };
            xhr.onload = () => { 
                activeXhrs.delete(xhr); URL.revokeObjectURL(previewUrl); 
                if(wrapper.parentNode) {
                    wrapper.classList.remove('uploading-task'); wrapper.classList.add('optimistic-msg');
                    const pct = wrapper.querySelector('#up-pct'); if(pct) pct.style.display = 'none';
                    const actionBtn = wrapper.querySelector('.action-btn'); if(actionBtn) actionBtn.style.display = 'none';
                    const speed = wrapper.querySelector('#up-speed'); if(speed) speed.style.display = 'none';
                    const barBg = wrapper.querySelector('.up-bar-bg'); if(barBg) barBg.style.display = 'none';
                    const upMask = wrapper.querySelector('.up-mask'); if(upMask) upMask.style.background = 'transparent';
                }
                checkMessages(); resolve(); 
            };
            xhr.onerror = async () => { activeXhrs.delete(xhr); await customAlert("上傳失敗"); if(wrapper.parentNode) wrapper.remove(); resolve(); };
            xhr.onabort = () => { activeXhrs.delete(xhr); resolve(); };
            if (abortFlag) { xhr.abort(); } else { xhr.send(fd); }
        }
    });
}

async function clearHistory() {
    if(currentTarget === 'all' && !IS_ADMIN) return;
    const confirmRes = await customConfirm("確定要清空當前聊天記錄嗎？", "清空對話");
    if(!confirmRes) return;
    
    fetch(`?action=clear&to=${encodeURIComponent(currentTarget)}`).then(res => res.json()).then(data => { 
        if(data.status === 'success') { 
            let activeRoom = document.getElementById('room-' + currentTarget);
            if (activeRoom) activeRoom.innerHTML = "";
            lastContentMap[currentTarget] = "";
            showToast("已清空聊天記錄");
        } else {
            showToast(data.msg || "清空失敗或無權限");
        }
    }).catch(() => {
        showToast("網路異常");
    });
}

let isVoiceMode = false;
function switchInputMode() {
    if (DISABLE_VOICE) { showToast("禁止發送：管理員已關閉語音功能"); return; }
    const modeBtn = document.getElementById("modeSwitchBtn"); 
    const textAreaWrapper = document.getElementById("text-wrapper");
    const textArea = document.getElementById("text");
    const targetArea = textAreaWrapper || textArea;
    const recordBtn = document.getElementById("recordBtn");
    
    isVoiceMode = !isVoiceMode;
    if (isVoiceMode) { 
        modeBtn.innerText = "⌨️"; 
        targetArea.style.display = "none"; 
        recordBtn.style.display = "flex"; 
    } 
    else { 
        modeBtn.innerText = "🎤"; 
        targetArea.style.display = textAreaWrapper ? "flex" : "block"; 
        recordBtn.style.display = "none"; 
    }
}

let audioCtx, recorderNode, mp3Encoder, mp3Data = [], isRecording = false, startTime, streamRef;
let startY = 0, isCanceling = false, isPressing = false; 
let voiceTimeoutId = null; 

async function startRecording(e) {
    e.preventDefault();
    if (isPressing) return; isPressing = true; if (isRecording) return;
    isCanceling = false; startY = e.touches ? e.touches[0].clientY : e.clientY;
    const recordBtn = document.getElementById("recordBtn"); const vOverlay = document.getElementById("voice-overlay"); const vHint = document.getElementById("voice-hint");

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            } 
        });
        
        if (!isPressing) { stream.getTracks().forEach(t => t.stop()); showToast("說話時間太短"); return; }

        streamRef = stream; 
        
        audioCtx = new (window.AudioContext || window.webkitAudioContext)(); 
        const nativeSampleRate = audioCtx.sampleRate; 
        
        const source = audioCtx.createMediaStreamSource(stream);
        
        mp3Encoder = new lamejs.Mp3Encoder(1, nativeSampleRate, 128); 
        mp3Data = [];
        
        recorderNode = audioCtx.createScriptProcessor(4096, 1, 1);
        recorderNode.onaudioprocess = (ev) => {
            const left = ev.inputBuffer.getChannelData(0); const pcm = new Int16Array(left.length);
            for (let i = 0; i < left.length; i++) pcm[i] = left[i] < 0 ? left[i] * 0x8000 : left[i] * 0x7FFF;
            const buf = mp3Encoder.encodeBuffer(pcm); if (buf.length > 0) mp3Data.push(buf);
            
            const outputBuffer = ev.outputBuffer.getChannelData(0);
            for (let i = 0; i < outputBuffer.length; i++) outputBuffer[i] = 0;
        };
        
        const gainNode = audioCtx.createGain();
        gainNode.gain.value = 0;
        
        source.connect(recorderNode); 
        recorderNode.connect(gainNode);
        gainNode.connect(audioCtx.destination); 
        
        startTime = Date.now(); isRecording = true; recordBtn.innerText = "鬆開 結束"; recordBtn.classList.add("active"); 
        vHint.innerText = "手指上滑，取消發送"; vHint.style.background = "transparent"; vOverlay.style.display = "flex";

        voiceTimeoutId = setTimeout(() => {
            if (isRecording && !isCanceling) { showToast("錄音達到最大時長(2分鐘)，自動發送"); stopRecording(); }
        }, 120 * 1000);

    } catch (err) { 
        isPressing = false; isRecording = false; recordBtn.innerText = "按住 說話"; recordBtn.classList.remove("active"); vOverlay.style.display = "none";
        await customAlert("⚠️ 無法開啟麥克風！\n1. 請檢查是否授予瀏覽器錄音權限。\n2. 蘋果手機和部分安卓必须使用 https:// 或 localhost 訪問才能錄音。\n報錯信息：" + err.message, "錄音失敗"); 
    }
}

function handleRecordMove(e) {
    if (!isRecording) return; e.preventDefault();
    let currentY = e.touches ? e.touches[0].clientY : e.clientY; const vHint = document.getElementById("voice-hint");
    if (startY - currentY > 50) { 
        isCanceling = true; vHint.innerText = "鬆開手指，取消發送"; vHint.style.background = "#ff4d4f"; vHint.style.padding = "2px 8px"; vHint.style.borderRadius = "4px";
    } else { isCanceling = false; vHint.innerText = "手指上滑，取消發送"; vHint.style.background = "transparent"; }
}

function stopRecording(e) {
    isPressing = false; if (!isRecording) return;
    if (e && e.cancelable) e.preventDefault();
    if (voiceTimeoutId) { clearTimeout(voiceTimeoutId); voiceTimeoutId = null; }

    const recordBtn = document.getElementById("recordBtn"); const vOverlay = document.getElementById("voice-overlay");
    isRecording = false; recordBtn.innerText = "按住 說話"; recordBtn.classList.remove("active"); vOverlay.style.display = "none";
    
    const endBuf = mp3Encoder.flush(); if (endBuf.length > 0) mp3Data.push(endBuf);
    streamRef.getTracks().forEach(t => t.stop()); recorderNode.disconnect(); audioCtx.close();
    
    let duration = Date.now() - startTime;
    if (isCanceling) { showToast("已取消發送"); } else if (duration < 1000) { showToast("說話時間太短"); } 
    else { handleSingleUploadTask(new Blob(mp3Data, { type: 'audio/mp3' }), `voice_${Date.now()}.mp3`); }
}

window.onload = () => {
    // ======== 資料編輯小窗：鍵盤防遮擋動態上移 ========
    const profileModal = document.getElementById('profile-modal');
    if (profileModal) {
        const profileInputs = profileModal.querySelectorAll('input[type="text"], input[type="password"]');
        profileInputs.forEach(input => {
            input.addEventListener('focus', () => {
                profileModal.classList.add('keyboard-up-container');
                // 延遲滾動，確保視口變化後輸入框在可視範圍內
                setTimeout(() => {
                    input.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }, 300);
            });
            
            input.addEventListener('blur', () => {
                setTimeout(() => {
                    const activeEl = document.activeElement;
                    // 如果焦點已經不在編輯框的任何 input 裡面了，就恢復彈窗位置
                    if (!Array.from(profileInputs).includes(activeEl)) {
                        profileModal.classList.remove('keyboard-up-container');
                    }
                }, 50);
            });
        });
    }

    const appWrapper = document.getElementById('app-wrapper'); const textInputFix = document.getElementById("text");
    if (window.visualViewport) {
        const updateViewport = () => {
            const vv = window.visualViewport;
            const isKeyboardOpen = vv.height < window.innerHeight - 100;

            if (isKeyboardOpen) {
                appWrapper.style.setProperty('height', vv.height + 'px', 'important');
                appWrapper.style.setProperty('transform', `translateY(${vv.offsetTop}px)`, 'important');
                appWrapper.style.setProperty('margin-top', '0px', 'important');
                appWrapper.style.setProperty('border-radius', '0px', 'important');
            } else {
                appWrapper.style.removeProperty('margin-top');
                appWrapper.style.removeProperty('border-radius');
                appWrapper.style.removeProperty('height');
                appWrapper.style.removeProperty('transform');
                
                appWrapper.style.height = vv.height + 'px';
                appWrapper.style.transform = `translateY(${vv.offsetTop}px)`;
            }

            window.scrollTo(0, 0);
            const allspace = document.getElementById("allspace");
            if (allspace && document.getElementById('view-chat').style.display !== 'none') { 
                allspace.scrollTop = allspace.scrollHeight; 
            }
        };
        
        window.visualViewport.addEventListener('resize', updateViewport); 
        window.visualViewport.addEventListener('scroll', updateViewport);
        
        if (textInputFix) {
            textInputFix.addEventListener('focus', () => { setTimeout(updateViewport, 50); setTimeout(updateViewport, 300); });
            textInputFix.addEventListener('blur', () => { setTimeout(() => { updateViewport(); }, 50); });
        }
        updateViewport();
    }

    mediaModal = document.getElementById('media-modal'); mediaContent = document.getElementById('media-modal-content');
    btnLoadOriginal = document.getElementById('btn-load-original'); viewportMeta = document.getElementById('viewport-meta');
    prevBtn = document.getElementById('media-prev-btn'); nextBtn = document.getElementById('media-next-btn');

    mediaModal.addEventListener('wheel', e => {
        const targetImg = mediaContent.querySelector('img'); if (!targetImg) return; e.preventDefault(); 
        const zoomDelta = e.deltaY < 0 ? 0.2 : -0.2; currentScale = Math.max(0.5, Math.min(currentScale + zoomDelta, 5));
        if (currentScale <= 1) { panX = 0; panY = 0; lastPanX = 0; lastPanY = 0; currentScale = 1; }
        targetImg.style.transform = `translate3d(${panX}px, ${panY}px, 0) scale(${currentScale})`;
    }, { passive: false });

    let isDraggingPC = false, hasDraggedPC = false, pcStartX = 0, pcStartY = 0;
    mediaModal.addEventListener('mousedown', e => {
        if (e.target.id === 'btn-load-original' || e.target.classList.contains('media-nav-btn')) return;
        const targetImg = mediaContent.querySelector('img'); if (!targetImg || currentScale <= 1 || e.target !== targetImg) return;
        isDraggingPC = true; hasDraggedPC = false; pcStartX = e.clientX; pcStartY = e.clientY; targetImg.classList.remove('smooth-zoom'); e.preventDefault(); 
    });
    window.addEventListener('mousemove', e => {
        if (!isDraggingPC) return; let diffX = e.clientX - pcStartX, diffY = e.clientY - pcStartY;
        if (Math.abs(diffX) > 3 || Math.abs(diffY) > 3) hasDraggedPC = true; panX = lastPanX + diffX; panY = lastPanY + diffY;
        const targetImg = mediaContent.querySelector('img'); if (targetImg) targetImg.style.transform = `translate3d(${panX}px, ${panY}px, 0) scale(${currentScale})`;
    });
    window.addEventListener('mouseup', e => {
        if (!isDraggingPC) return; isDraggingPC = false; lastPanX = panX; lastPanY = panY;
        const targetImg = mediaContent.querySelector('img'); if (targetImg) targetImg.classList.add('smooth-zoom'); setTimeout(() => { hasDraggedPC = false; }, 50);
    });

    let startX = 0, startY = 0, isSwiping = false, touchTarget = null;
    mediaModal.addEventListener('touchstart', e => {
        const targetImg = mediaContent.querySelector('img'); if (targetImg) targetImg.classList.remove('smooth-zoom'); 
        if (e.touches.length === 1) { 
            touchTarget = e.target; 
            if (touchTarget.id === 'btn-load-original' || touchTarget.classList.contains('media-nav-btn')) return; 
            startX = e.touches[0].clientX; startY = e.touches[0].clientY; isSwiping = true; 
            if (currentScale === 1) mediaContent.classList.remove('animate-swipe'); 
        } else if (e.touches.length === 2 && targetImg) { 
            isSwiping = false; initialPinchDistance = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); lastScale = currentScale; 
        }
    }, { passive: false });

    mediaModal.addEventListener('touchmove', e => {
        const targetImg = mediaContent.querySelector('img');
        if (e.touches.length === 2 && targetImg) { 
            e.preventDefault();
            const currentDistance = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); 
            currentScale = lastScale * (currentDistance / initialPinchDistance); currentScale = Math.max(0.5, Math.min(currentScale, 5)); 
            targetImg.style.transform = `translate3d(${panX}px, ${panY}px, 0) scale(${currentScale})`; return; 
        }
        if (!isSwiping || e.touches.length !== 1) return;
        let diffX = e.touches[0].clientX - startX, diffY = e.touches[0].clientY - startY;
        
        // 放大时，禁止滑动切换上下张图片，只允许平移当前图片
        if (currentScale > 1 && targetImg) { 
            e.preventDefault();
            panX = lastPanX + diffX; panY = lastPanY + diffY; targetImg.style.transform = `translate3d(${panX}px, ${panY}px, 0) scale(${currentScale})`; return; 
        }
        
        if (touchTarget && touchTarget.tagName === 'VIDEO') { const rect = touchTarget.getBoundingClientRect(); if (rect.bottom - e.touches[0].clientY < 90) { isSwiping = false; return; } }
        
        e.preventDefault();
        if (Math.abs(diffX) > Math.abs(diffY)) { 
            let moveX = diffX; if (currentMediaIndex === 0 && diffX > 0) moveX = diffX / 3; else if (currentMediaIndex === mediaElements.length - 1 && diffX < 0) moveX = diffX / 3; 
            mediaContent.style.transform = `translate3d(${moveX}px, 0, 0)`; 
        }
    }, { passive: false });

    mediaModal.addEventListener('touchend', e => {
        const targetImg = mediaContent.querySelector('img'); if (targetImg) targetImg.classList.add('smooth-zoom'); 
        if (e.touches.length > 0) return; 
        let diffX = e.changedTouches[0].clientX - startX, diffY = e.changedTouches[0].clientY - startY;
        
        if (currentScale > 1 && targetImg) { 
            lastPanX = panX; lastPanY = panY; isSwiping = false; 
            // 放大时，如果只是轻轻点击（没有移动距离），立刻恢复原始大小
            if (Math.abs(diffX) < 10 && Math.abs(diffY) < 10) { 
                e.preventDefault(); currentScale = 1; panX = 0; panY = 0; lastPanX = 0; lastPanY = 0; targetImg.style.transform = `translate3d(0px, 0px, 0) scale(1)`; 
            } 
            return; // 提前返回，绝不执行下面切换图片的逻辑
        } else if (currentScale < 1 && targetImg) { currentScale = 1; panX = 0; panY = 0; lastPanX = 0; lastPanY = 0; targetImg.style.transform = `translate3d(0px, 0px, 0) scale(1)`; }
        
        if (!isSwiping) return;
        
        if (Math.abs(diffX) > 50 && Math.abs(diffX) > Math.abs(diffY)) { executeMediaSwipe(diffX < 0 ? 1 : -1); } 
        else if (Math.abs(diffX) < 10 && Math.abs(diffY) < 10) { 
            mediaContent.style.transform = "translate3d(0, 0, 0)"; 
            if (touchTarget && touchTarget.id === 'btn-load-original') { isSwiping = false; return; }
            if (touchTarget && touchTarget.tagName === 'VIDEO') { isSwiping = false; return; }
            e.preventDefault(); 
            if (touchTarget) { 
                if (touchTarget.id === 'media-close-btn') { closeMediaModal(); return; }
                if (touchTarget.classList.contains('media-nav-btn')) return;
                if (touchTarget.tagName === 'IMG') {
                    if (currentScale > 1) { currentScale = 1; panX = 0; panY = 0; lastPanX = 0; lastPanY = 0; touchTarget.style.transform = `translate3d(0px, 0px, 0) scale(1)`; return; }
                }
            }

            const currentEl = mediaElements[currentMediaIndex];
            let isVideoItem = false;
            if (currentEl) {
                if (currentEl.tagName === 'VIDEO') isVideoItem = true;
                if (currentEl.tagName === 'IMG' && currentEl.getAttribute('data-video')) isVideoItem = true;
            }
            if (isVideoItem) {
                isSwiping = false;
                return;
            }

            closeMediaModal(); 
        } else { mediaContent.style.transform = "translate3d(0, 0, 0)"; }
        isSwiping = false;
    });

    mediaModal.addEventListener('click', e => {
        if (hasDraggedPC) return; 
        if (e.target.id === 'btn-load-original' || e.target.id === 'media-close-btn' || e.target.classList.contains('media-nav-btn')) return; 
        if (e.target.tagName === 'IMG') { 
            if (currentScale > 1) { 
                currentScale = 1; panX = 0; panY = 0; lastPanX = 0; lastPanY = 0; e.target.style.transform = `translate3d(0px, 0px, 0) scale(1)`; return; 
            } 
        } 
        else if (e.target.tagName === 'VIDEO') { return; }

        const currentEl = mediaElements[currentMediaIndex];
        let isVideoItem = false;
        if (currentEl) {
            if (currentEl.tagName === 'VIDEO') isVideoItem = true;
            if (currentEl.tagName === 'IMG' && currentEl.getAttribute('data-video')) isVideoItem = true;
        }
        if (isVideoItem) {
            return;
        }

        closeMediaModal(); 
    });

    initApp();
    setInterval(() => { if (currentTarget) { checkMessages(false); refreshData(true); } else { refreshData(); } }, 2000);
    const textarea = document.getElementById("text");
    textarea.addEventListener("input", function() { this.style.height = '40px'; this.style.height = this.scrollHeight + 'px'; });
    
    textarea.addEventListener("keydown", function(e) {
        if (e.key === "Enter" && !e.shiftKey) {
            if (e.isComposing || e.keyCode === 229) { return; }
            e.preventDefault(); sendText();         
        }
    });

    const recordBtn = document.getElementById("recordBtn");
    if (recordBtn) {
        recordBtn.addEventListener('touchstart', startRecording, { passive: false });
        recordBtn.addEventListener('touchmove', handleRecordMove, { passive: false });
        recordBtn.addEventListener('touchend', stopRecording, { passive: false });
        recordBtn.addEventListener('touchcancel', () => { isCanceling = true; stopRecording(); }, { passive: false });
        recordBtn.addEventListener('mousedown', startRecording);
        window.addEventListener('mousemove', handleRecordMove);
        window.addEventListener('mouseup', stopRecording);
    }
    
    // 初始化掛載長按與右鍵事件引擎
    initLongPress();
};

// ======== 表情功能引擎 ========
const emojiList = [
    "😀","😃","😄","😁","😆","😅","😂","🤣","😊","😇","🙂","🙃","😉","😌","😍","🥰","😘","😗","😙","😚","😋","😛","😝","😜","🤪","🤨","🧐","🤓","😎","🤩","🥳","😏","😒","😞","😔","😟","😕","🙁","☹️","😣","😖","😫","😩","🥺","😢","😭","😤","😠","😡","🤬","🤯","😳","🥵","🥶","😱","😨","😰","😥","😓","🤗","🤔","🤭","🤫","🤥","😶","😐","😑","😬","🙄","😯","😦","😧","😮","😲","🥱","😴","🤤","😪","😵","🤐","🥴","🤢","🤮","🤧","😷","🤒","🤕","🤑","🤠","😈","👿","👹","👺","🤡","💩","👻","💀","👽","👾","🤖","🎃","😺","😸","😹","😻","😼","😽","🙀","😿","😾","❤️","🧡","💛","💚","💙","💜","🖤","🤍","🤎","💔","❣️","💕","💞","💓","💗","💖","💘","💝","👍","👎","👏","🙌","👐","🤲","🤝","🙏","✍️","💪","👀","👁️","👅","👄"
];

function initEmojiPanel() {
    const panel = document.getElementById('emoji-panel');
    if (panel && panel.children.length === 0) {
        emojiList.forEach(emoji => {
            const span = document.createElement('span');
            span.className = 'emoji-item'; span.innerText = emoji;
            span.onclick = (e) => { e.stopPropagation(); insertEmoji(emoji); };
            panel.appendChild(span);
        });
    }
}

function toggleEmojiPanel(e) {
    if(e) e.stopPropagation();
    const panel = document.getElementById('emoji-panel');
    if(panel.classList.contains('show')) { panel.classList.remove('show'); } 
    else { initEmojiPanel(); panel.classList.add('show'); }
}

function insertEmoji(emoji) {
    const textarea = document.getElementById('text');
    const start = textarea.selectionStart; const end = textarea.selectionEnd; const text = textarea.value;
    textarea.value = text.slice(0, start) + emoji + text.slice(end);
    textarea.selectionStart = textarea.selectionEnd = start + emoji.length;
    textarea.focus(); textarea.dispatchEvent(new Event('input'));
    
    // ======== 新增：自動發送並關閉表情面板 ========
    sendText();
    const panel = document.getElementById('emoji-panel');
    if (panel) panel.classList.remove('show');
}

// ======== 新增群組 UI 與交互管理 ========
function togglePlusMenu(e) {
    e.stopPropagation();
    const dd = document.getElementById('plus-dropdown');
    const isShow = dd.style.display === 'block';
    document.querySelectorAll('.glass-dropdown').forEach(el => el.style.display = 'none');
    dd.style.display = isShow ? 'none' : 'block';
}

function toggleChatMenu(e) {
    e.stopPropagation();
    const dd = document.getElementById('chat-dropdown');
    const isShow = dd.style.display === 'block';
    document.querySelectorAll('.glass-dropdown').forEach(el => el.style.display = 'none');
    dd.style.display = isShow ? 'none' : 'block';
}

function openCreateGroupModal() {
    document.getElementById('cg-name').value = '';
    const listEl = document.getElementById('cg-user-list');
    listEl.innerHTML = '';
    
    const meUser = usersDataCache[MY_NAME];
    if (meUser) {
        let avatarHtml = meUser.avatar ? `<img src="${meUser.avatar}" class="cg-user-avatar">` : `<div class="cg-user-avatar" style="background:#085A48; color:#fff; display:flex; align-items:center; justify-content:center; font-weight:bold;">${meUser.firstChar}</div>`;
        listEl.insertAdjacentHTML('beforeend', `
            <div class="cg-user-row" style="background:#f9f9f9;">
                ${avatarHtml}
                <div class="cg-user-info">
                    <div class="cg-user-name">${meUser.name} <span style="font-size:10px; background:#FF9800; color:#fff; padding:1px 4px; border-radius:4px; margin-left:4px;">創建者</span></div>
                    <div class="cg-user-sign">${meUser.signature || '暫無簽名'}</div>
                </div>
                <input type="checkbox" class="cg-checkbox" value="${meUser.name}" checked disabled>
            </div>
        `);
    }
    
    for (const key in usersDataCache) {
        const u = usersDataCache[key];
        if (u.name === MY_NAME || u.name === '[公告]' || u.isGroup) continue;
        
        let avatarHtml = u.avatar ? `<img src="${u.avatar}" class="cg-user-avatar">` : `<div class="cg-user-avatar" style="background:#085A48; color:#fff; display:flex; align-items:center; justify-content:center; font-weight:bold;">${u.firstChar}</div>`;
        
        listEl.insertAdjacentHTML('beforeend', `
            <div class="cg-user-row">
                ${avatarHtml}
                <div class="cg-user-info">
                    <div class="cg-user-name">${u.name}</div>
                    <div class="cg-user-sign">${u.signature || '暫無簽名'}</div>
                </div>
                <input type="checkbox" class="cg-checkbox" value="${u.name}">
            </div>
        `);
    }
    
    const overlay = document.getElementById('cg-overlay');
    if(overlay) overlay.classList.add('show');
    document.getElementById('create-group-modal').classList.add('show');
}

function closeCreateGroup() {
    const overlay = document.getElementById('cg-overlay');
    if(overlay) overlay.classList.remove('show');
    document.getElementById('create-group-modal').classList.remove('show');
}

function submitCreateGroup() {
    const name = document.getElementById('cg-name').value.trim();
    if (!name) return showToast('請輸入群聊名稱');
    
    const checkboxes = document.querySelectorAll('#create-group-modal .cg-checkbox:checked, #create-group-modal .cg-checkbox:disabled');
    const members = Array.from(checkboxes).map(cb => cb.value);
    
    if (members.length === 0) return showToast('請至少選擇一名成員');
    
    const fd = new FormData();
    fd.append('name', name);
    fd.append('members', JSON.stringify(members));
    
    fetch('?action=create_group', { method: 'POST', body: fd })
        .then(r => r.json())
        .then(res => {
            if (res.status === 'success') {
                showToast('群聊創建成功');
                closeCreateGroup();
                refreshData(); 
            } else {
                showToast(res.msg || '創建失敗');
            }
        });
}

function viewGroupMembers() {
    fetch(`?action=get_group_members&id=${currentTarget}`)
        .then(r => r.json())
        .then(data => {
            const members = data.members;
            const creator = data.creator;
            const listEl = document.getElementById('gm-list');
            listEl.innerHTML = '';
            
            members.forEach(m => {
                const safeName = m.username;
                let safeAvatar = m.avatar;
                
                if (!safeAvatar) {
                    const firstChar = safeName.charAt(0);
                    const textSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#085A48"/><text x="50%" y="54%" font-family="system-ui, -apple-system, sans-serif" font-size="50" font-weight="bold" fill="#ffffff" text-anchor="middle" dominant-baseline="middle">${firstChar}</text></svg>`;
                    safeAvatar = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(textSvg)));
                }
                
                const safeSign = m.signature || '這個人很懶，什麼都沒寫~';
                const isCreator = (safeName === creator);
                const badge = isCreator ? `<div style="position:absolute; bottom:-3px; right:-3px; background:#FF9800; color:#fff; font-size:9px; padding:1px 3px; border-radius:4px; font-weight:bold; transform:scale(0.85); z-index:2; border:1px solid #fff; white-space:nowrap;">創建者</div>` : '';
                
                listEl.insertAdjacentHTML('beforeend', `
                    <div class="gm-item" onclick="showUserInfoModal(this.querySelector('img'))">
                        <div style="position:relative; display:inline-block;">
                            <img src="${safeAvatar}" data-name="${safeName}" data-avatar="${safeAvatar}" data-sign="${safeSign}">
                            ${badge}
                        </div>
                        <span>${safeName}</span>
                    </div>
                `);
            });
            
            if (creator === MY_NAME || IS_ADMIN) {
                listEl.insertAdjacentHTML('beforeend', `
                    <div class="gm-item" onclick="openEditGroupModal('${creator}')">
                        <div style="width: 50px; height: 50px; border-radius: 14px; border: 1px dashed #ccc; display: flex; align-items: center; justify-content: center; font-size: 26px; color: #999; cursor: pointer; box-sizing: border-box; box-shadow: none; font-weight: 300;">+</div>
                        <span style="color:#999;">添加成員</span>
                    </div>
                `);
            }
            
            document.getElementById('group-members-modal').style.display = 'flex';
        });
}

function openEditGroupModal(creator) {
    document.getElementById('group-members-modal').style.display = 'none';
    const listEl = document.getElementById('eg-user-list');
    listEl.innerHTML = '';
    
    fetch(`?action=get_group_members&id=${currentTarget}`)
    .then(r => r.json())
    .then(data => {
        const currentMemberNames = data.members.map(m => m.username);
        
        const creatorUser = usersDataCache[creator];
        if (creatorUser) {
            let avatarHtml = creatorUser.avatar ? `<img src="${creatorUser.avatar}" class="cg-user-avatar">` : `<div class="cg-user-avatar" style="background:#085A48; color:#fff; display:flex; align-items:center; justify-content:center; font-weight:bold;">${creatorUser.firstChar}</div>`;
            listEl.insertAdjacentHTML('beforeend', `
                <div class="cg-user-row" style="background:#f9f9f9;">
                    ${avatarHtml}
                    <div class="cg-user-info">
                        <div class="cg-user-name">${creatorUser.name} <span style="font-size:10px; background:#FF9800; color:#fff; padding:1px 4px; border-radius:4px; margin-left:4px;">創建者</span></div>
                        <div class="cg-user-sign">${creatorUser.signature || '暫無簽名'}</div>
                    </div>
                    <input type="checkbox" class="eg-checkbox cg-checkbox" value="${creatorUser.name}" checked disabled>
                </div>
            `);
        }
        
        for (const key in usersDataCache) {
            const u = usersDataCache[key];
            if (u.name === '[公告]' || u.isGroup || u.name === creator) continue;
            
            let isChecked = currentMemberNames.includes(u.name) ? 'checked' : '';
            
            let avatarHtml = u.avatar ? `<img src="${u.avatar}" class="cg-user-avatar">` : `<div class="cg-user-avatar" style="background:#085A48; color:#fff; display:flex; align-items:center; justify-content:center; font-weight:bold;">${u.firstChar}</div>`;
            
            listEl.insertAdjacentHTML('beforeend', `
                <div class="cg-user-row">
                    ${avatarHtml}
                    <div class="cg-user-info">
                        <div class="cg-user-name">${u.name}</div>
                        <div class="cg-user-sign">${u.signature || '暫無簽名'}</div>
                    </div>
                    <input type="checkbox" class="eg-checkbox cg-checkbox" value="${u.name}" ${isChecked}>
                </div>
            `);
        }
        
        const overlay = document.getElementById('cg-overlay');
        if(overlay) overlay.classList.add('show');
        document.getElementById('edit-group-modal').classList.add('show');
    });
}

function closeEditGroup() {
    const overlay = document.getElementById('cg-overlay');
    if(overlay) overlay.classList.remove('show');
    document.getElementById('edit-group-modal').classList.remove('show');
}

function submitEditGroup() {
    const checkboxes = document.querySelectorAll('#edit-group-modal .eg-checkbox:checked, #edit-group-modal .eg-checkbox:disabled');
    const members = Array.from(checkboxes).map(cb => cb.value);
    
    const fd = new FormData();
    fd.append('group_id', currentTarget);
    fd.append('members', JSON.stringify(members));
    
    fetch('?action=update_group_members', { method: 'POST', body: fd })
        .then(r => r.json())
        .then(res => {
            if (res.status === 'success') {
                showToast('群成員已更新');
                closeEditGroup();
                viewGroupMembers();
                refreshData(true);
            } else {
                showToast(res.msg || '更新失敗');
            }
        });
}

async function leaveGroup() {
    const res = await customConfirm('確定要退出此群聊嗎？', "退出群聊");
    if (!res) return;
    fetch(`?action=leave_group&id=${currentTarget}`).then(() => {
        showToast('已退出群聊');
        goBack();
    });
}

async function disbandGroup() {
    const res = await customConfirm('警告：解散群聊將移除所有成員！確定解散嗎？', "解散群聊");
    if (!res) return;
    fetch(`?action=disband_group&id=${currentTarget}`).then(() => {
        showToast('群聊已解散');
        goBack();
    });
}

// ======== 網頁內嵌小窗 (Iframe) 控制 ========
let currentIframeUrl = '';

function openIframeModal(url) {
    currentIframeUrl = url;
    document.getElementById('modal-iframe').src = url;
    
    const overlay = document.getElementById('cg-overlay');
    if (overlay) {
        overlay.classList.add('show');
        overlay.style.backgroundColor = 'transparent'; 
    }
    document.getElementById('iframe-modal').classList.add('show');
}

function closeIframeModal() {
    const overlay = document.getElementById('cg-overlay');
    if (overlay) {
        overlay.classList.remove('show');
        setTimeout(() => { overlay.style.backgroundColor = ''; }, 300);
    }
    document.getElementById('iframe-modal').classList.remove('show');
    
    setTimeout(() => {
        document.getElementById('modal-iframe').src = '';
    }, 300);
}

function toggleIframeMenu(e) {
    e.stopPropagation();
    const dd = document.getElementById('iframe-dropdown');
    dd.style.display = (dd.style.display === 'block') ? 'none' : 'block';
}

function refreshIframe() {
    const iframe = document.getElementById('modal-iframe');
    iframe.src = iframe.src; 
    document.getElementById('iframe-dropdown').style.display = 'none';
}

function openIframeInBrowser() {
    if (currentIframeUrl) {
        window.open(currentIframeUrl, '_blank'); 
    }
    document.getElementById('iframe-dropdown').style.display = 'none';
}

// ======== 複製網址功能 ========
function copyLinkUrl(e, url) {
    e.stopPropagation(); 
    
    const textArea = document.createElement("textarea");
    textArea.value = url;
    textArea.style.position = "fixed"; 
    textArea.style.opacity = "0"; 
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    
    try {
        document.execCommand('copy');
        showToast('✅ 已複製網址');
    } catch (err) {
        showToast('❌ 複製失敗');
    }
    
    document.body.removeChild(textArea);
}

// ======== 修復 iPad/iOS 鍵盤彈出時遮擋輸入框與標題欄上移問題 ========
if (window.visualViewport) {
    const handleViewportChange = () => {
        const vv = window.visualViewport;
        const appWrapper = document.getElementById('app-wrapper');
        
        document.body.style.setProperty('height', vv.height + 'px', 'important');
        if (appWrapper) {
            appWrapper.style.setProperty('height', vv.height + 'px', 'important');
        }
        
        window.scrollTo(0, 0);
        document.body.scrollTop = 0;
    };

    window.visualViewport.addEventListener('resize', handleViewportChange);
    window.visualViewport.addEventListener('scroll', handleViewportChange);

    document.addEventListener('focusin', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
            setTimeout(() => {
                handleViewportChange();
            }, 100);
        }
    });
}

// ======== 長按/右鍵 撤回與複製引擎 (含全類型支援與時效判斷) ========
let pressTimer = null;
let pressStartX = 0;
let pressStartY = 0;
let isLongPressTriggered = false; 

function initLongPress() {
    const allspace = document.getElementById("allspace");
    if (!allspace) return;

    // 行動端長按支援
    allspace.addEventListener('touchstart', handleTouchStart, { passive: true });
    allspace.addEventListener('touchmove', handleTouchMove, { passive: true });
    allspace.addEventListener('touchend', cancelPress);
    allspace.addEventListener('touchcancel', cancelPress);

    // 桌面端右鍵呼出選單
    allspace.addEventListener('contextmenu', handleContextMenu);

    // 攔截長按觸發後的冒泡 Click 事件（重要：防止長按圖片鬆手時彈出看大圖或影片播放）
    allspace.addEventListener('click', (e) => {
        if (isLongPressTriggered) {
            e.preventDefault();
            e.stopPropagation();
            isLongPressTriggered = false;
        }
    }, true); 
}

function handleContextMenu(e) {
    const target = e.target.closest('.msg-container[data-id]');
    if (!target) return;

    if (e.target.closest('.msg-avatar')) return;

    e.preventDefault();
    showMsgContextMenu(target, e.clientX, e.clientY);
}

function handleTouchStart(e) {
    isLongPressTriggered = false;
    const target = e.target.closest('.msg-container[data-id]');
    if (!target) return;

    if (e.target.closest('.msg-avatar')) return;

    const touch = e.touches ? e.touches[0] : e;
    pressStartX = touch.clientX;
    pressStartY = touch.clientY;

    pressTimer = setTimeout(() => {
        isLongPressTriggered = true; 
        showMsgContextMenu(target, pressStartX, pressStartY);
        if (navigator.vibrate) navigator.vibrate(50); 
    }, 600); 
}

function handleTouchMove(e) {
    if (!pressTimer) return;
    const touch = e.touches ? e.touches[0] : e;
    if (Math.abs(touch.clientX - pressStartX) > 10 || Math.abs(touch.clientY - pressStartY) > 10) {
        cancelPress();
    }
}

function cancelPress() {
    if (pressTimer) {
        clearTimeout(pressTimer);
        pressTimer = null;
    }
}

function showMsgContextMenu(msgNode, x, y) {
    cancelPress();
    const msgId = msgNode.getAttribute('data-id');
    const msgTs = parseInt(msgNode.getAttribute('data-ts') || 0); 
    if (!msgId) return;

    const isMe = msgNode.querySelector('.row-me') !== null;

    // ======== 【核心修改區域】精準提取純文本，屏蔽多媒體複製 ========
    let textContent = '';
    const talkBubble = msgNode.querySelector('.me_talk, .other_talk');
    
    if (talkBubble) {
        // 如果氣泡內存在以下容器，代表這是一條圖片/視頻/語音/文件消息，直接跳過提取文本（也就不會有複製按鈕）
        const hasMedia = talkBubble.querySelector('.media-container, .video-wrapper, .file-card-inner, .voice-player-wrapper, .up-box');
        const hasLinkCard = talkBubble.querySelector('.link-card');

        if (hasLinkCard) {
            // 如果是連結卡片，可以複製原始連結
            textContent = hasLinkCard.getAttribute('data-url') || '';
        } else if (!hasMedia) {
            // 如果沒有任何媒體容器，才認定這是一條純文字消息
            const clone = talkBubble.cloneNode(true);
            const dot = clone.querySelector('.status-dot');
            if (dot) dot.remove();
            
            clone.innerHTML = clone.innerHTML.replace(/<br\s*[\/]?>/gi, "\n");
            textContent = clone.textContent.trim();
        }
    }
    // ====================================================================

    let menu = document.getElementById('msg-context-menu');
    if (!menu) {
        menu = document.createElement('div');
        menu.id = 'msg-context-menu';
        document.body.appendChild(menu);

        const closeMenu = (e) => {
            if (menu.style.display === 'block' && !menu.contains(e.target)) {
                menu.style.display = 'none';
            }
        };
        document.addEventListener('click', closeMenu, true);
        document.addEventListener('touchstart', closeMenu, true);
        
        const allspace = document.getElementById('allspace');
        if(allspace) allspace.addEventListener('scroll', closeMenu, { passive: true });
    }

    menu.innerHTML = '';

    // 【複製按鈕】：只要有純文本提取出來就可以複製
    if (textContent) {
        const copyBtn = document.createElement('div');
        copyBtn.className = 'msg-menu-item';
        copyBtn.innerText = '複製';
        copyBtn.onclick = (e) => {
            e.stopPropagation();
            copyToClipboard(textContent);
            menu.style.display = 'none';
        };
        menu.appendChild(copyBtn);
    }

    // 【撤回按鈕】的合法性檢測
    let isExpired = false;
    if (RECALL_TIME > 0 && msgTs > 0) {
        const timeDiffMinutes = (Date.now() - msgTs) / 1000 / 60;
        if (timeDiffMinutes > RECALL_TIME) isExpired = true;
    }

    // 後台設置不為0，且時間沒過期，而且是自己發的消息
    if (isMe && RECALL_TIME > 0 && !isExpired) {
        const recallBtn = document.createElement('div');
        recallBtn.className = 'msg-menu-item danger';
        recallBtn.innerText = '撤回';
        recallBtn.onclick = (e) => {
            e.stopPropagation();
            recallMessage(msgId, msgNode);
            menu.style.display = 'none';
        };
        menu.appendChild(recallBtn);
    }

    // 如果沒有任何按鈕（例如：別人發的圖片），直接攔截退出
    if (menu.children.length === 0) return; 

    // 防止選單超出屏幕邊緣的定位邏輯
    menu.style.display = 'block';
    let menuWidth = menu.offsetWidth;
    let menuHeight = menu.offsetHeight;

    let finalX = x - (menuWidth / 2);
    let finalY = y - menuHeight - 15;

    if (finalX < 10) finalX = 10;
    if (finalX + menuWidth > window.innerWidth) finalX = window.innerWidth - menuWidth - 10;
    if (finalY < 10) finalY = y + 25; 

    menu.style.left = finalX + 'px';
    menu.style.top = finalY + 'px';
}

function recallMessage(msgId, msgNode) {
    const fd = new FormData();
    fd.append('msg_id', msgId);
    fetch('?action=recall', { method: 'POST', body: fd })
    .then(r => r.json())
    .then(data => {
        if (data.status === 'success') {
            msgNode.style.transition = "all 0.3s ease";
            msgNode.style.opacity = "0";
            msgNode.style.transform = "scale(0.9)";
            setTimeout(() => {
                msgNode.remove();
            }, 300);
            showToast('已撤回');
        } else {
            showToast(data.msg || '撤回失敗，可能超時');
        }
    })
    .catch(() => showToast('網絡錯誤'));
}

function copyToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(() => {
            showToast('✅ 已複製');
        }).catch(err => {
            fallbackCopyTextToClipboard(text);
        });
    } else {
        fallbackCopyTextToClipboard(text);
    }
}

function fallbackCopyTextToClipboard(text) {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.opacity = "0";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
        document.execCommand('copy');
        showToast('✅ 已複製');
    } catch (err) {
        showToast('❌ 複製失敗');
    }
    document.body.removeChild(textArea);
}