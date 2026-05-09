window.currentConfigs = {};

// 【核心修复区域：同步前台本地时间格式化引擎】
function formatLocalTime(ts) {
    if (!ts) return "";
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

document.addEventListener('gesturestart', function(e) { e.preventDefault(); });
document.addEventListener('gesturechange', function(e) { e.preventDefault(); });
document.addEventListener('gestureend', function(e) { e.preventDefault(); });
document.addEventListener('wheel', function(e) { if(e.ctrlKey) { e.preventDefault(); } }, { passive: false });

function showToast(msg) {
    const toast = document.getElementById('toast-container');
    toast.innerText = msg;
    toast.classList.add('show');
    setTimeout(() => { toast.classList.remove('show'); }, 2500);
}

function loadData() {
    const isViewingMedia = document.getElementById('media-modal').classList.contains('show');

    fetch('?action=api_update&t=' + Date.now()).then(r => r.json()).then(data => {
        window.currentConfigs = data.configs; 
        
        document.getElementById('stat-msgs').innerText = data.stats.msgs;
        document.getElementById('stat-files').innerText = data.stats.files;
        
        // 渲染总体最近时间
        document.getElementById('stat-time').innerText = data.stats.lastTs ? formatLocalTime(data.stats.lastTs) : '--:--';

        const iDis = data.configs['disable_image'] === '1'; 
        document.getElementById('cfg-image').checked = !iDis;

        const vDis = data.configs['disable_video'] === '1'; 
        document.getElementById('cfg-video').checked = !vDis;

        const voDis = data.configs['disable_voice'] === '1'; 
        document.getElementById('cfg-voice').checked = !voDis;

        const iComp = data.configs['compress_img'] === '1';
        document.getElementById('cfg-img-comp').checked = iComp;

        const vComp = data.configs['compress_video'] === '1';
        document.getElementById('cfg-vid-comp').checked = vComp;
        
        const fDis = data.configs['disable_forgot'] === '1'; 
        document.getElementById('cfg-forgot').checked = !fDis;
        
        const rDis = data.configs['disable_register'] === '1'; 
        document.getElementById('cfg-register').checked = !rDis;

        if (!document.getElementById('notice-input').value && data.configs['global_notice']) {
            document.getElementById('notice-input').value = data.configs['global_notice'];
        }

        let uHtml = '';
        data.users.forEach(u => {
            const emailDisp = u.email ? u.email : '沒有綁定郵件地址';
            const searchKw = (u.name + ' ' + (u.email || '')).toLowerCase();
            
            // 渲染用户最后登录时间
            const userTimeStr = u.timeTs ? formatLocalTime(u.timeTs) : '從未登錄';
            
            uHtml += `<div class="user-row" data-search="${searchKw}">
                <div style="display:flex; flex-direction:column; justify-content:center; flex:1; min-width:0;">
                    <div class="u-name" style="line-height:1.1; margin-bottom:3px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${u.name}</div>
                    <div style="font-size:10px; color:#999; line-height:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${emailDisp}</div>
                </div>
                <div style="display:flex; align-items:center; flex-shrink:0;">
                    <div class="u-time">${userTimeStr}</div>
                    <button class="btn-outline-red" onclick="delUser('${u.name}')">注銷</button>
                </div>
            </div>`;
        });
        document.getElementById('user-list').innerHTML = uHtml || '<div style="text-align:center;color:#999;font-size:13px;padding:10px;">暫無用戶</div>';

        // 检测当前是否有语音正在播放
        const isPlayingAudio = window.currentPlayingAudio && !window.currentPlayingAudio.paused;

        // 仅当没有查看全屏媒体，且【没有正在播放语音】时，才刷新消息列表 DOM
        if (!isViewingMedia && !isPlayingAudio) {
            let mHtml = '';
            data.messages.forEach(m => {
                const noBubble = ['image','video','file'].includes(m.type) ? 'no-bubble' : '';
                
                // 渲染消息接收时间
                const msgTimeStr = m.timeTs ? formatLocalTime(m.timeTs) : '--:--';
                
                mHtml += `<div class="msg-item" data-search="${m.search}"><div class="msg-meta"><div class="meta-left"><span style="color:#085A48;font-weight:bold;">${m.sender}</span> → <span>${m.receiver}</span><span class="meta-time">${msgTimeStr}</span></div><button class="btn-outline-red" onclick="delMsg(${m.id})">刪除</button></div><div class="msg-body ${noBubble}">${m.content}</div></div>`;
            });
            document.getElementById('msg-list').innerHTML = mHtml || '<div style="text-align:center;color:#999;font-size:13px;padding:10px;">暫無消息記錄</div>';
            bindMediaEvents(); 
        }
    });
}

function bindMediaEvents() {
    const list = document.getElementById('msg-list');
    list.querySelectorAll('.media-thumb, img:not(.emoji)').forEach(img => {
        img.style.cursor = 'pointer'; img.setAttribute('decoding', 'async');
        const wrapper = img.closest('.video-wrapper');
        if (wrapper) { wrapper.onclick = function(e) { e.preventDefault(); e.stopPropagation(); openMediaModal(img); }; } 
        else { img.onclick = function(e) { e.stopPropagation(); openMediaModal(this); }; }
        img.onerror = function() { const src = this.src; if(src.indexOf('?') === -1) this.src = src + '?r=' + Math.random(); };
    });
    
    list.querySelectorAll('video:not(.up-box video)').forEach(v => {
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

    list.querySelectorAll('audio').forEach(a => {
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
        timeText.className = 'voice-time-text';
        timeText.innerText = '..."';

        const statusTips = document.createElement('div');
        statusTips.className = 'voice-status-tips';

        wrapper.innerHTML = iconHtml;
        wrapper.appendChild(timeText);
        wrapper.appendChild(statusTips);

        a.parentNode.insertBefore(wrapper, a);

        const updateVoiceUI = () => {
            if (a.duration && a.duration !== Infinity && !isNaN(a.duration)) {
                const dur = Math.round(a.duration);
                timeText.innerText = dur + '"';
                const calcWidth = 60 + (dur * 4);
                wrapper.style.width = calcWidth + 'px';
            }
        };

        if (a.readyState >= 1) updateVoiceUI();
        a.addEventListener('loadedmetadata', updateVoiceUI);
        a.addEventListener('durationchange', updateVoiceUI);

        wrapper.onclick = (e) => {
            e.stopPropagation();
            if (window.currentPlayingAudio && window.currentPlayingAudio !== a) {
                window.currentPlayingAudio.pause();
                window.currentPlayingAudio.currentTime = 0;
                if (window.currentPlayingWrapper) {
                    window.currentPlayingWrapper.classList.remove('playing');
                    window.currentPlayingWrapper.querySelector('.voice-status-tips').style.display = 'none';
                }
            }
            if (a.paused) {
                a.play().catch(err => console.log('播放失败', err));
                wrapper.classList.add('playing');
                statusTips.innerText = '播放中...';
                statusTips.style.display = 'block';
                window.currentPlayingAudio = a;
                window.currentPlayingWrapper = wrapper;
            } else {
                a.pause();
                wrapper.classList.remove('playing');
                statusTips.innerText = '已暂停...';
                statusTips.style.display = 'block';
            }
        };

        a.addEventListener('ended', () => {
            wrapper.classList.remove('playing');
            statusTips.style.display = 'none';
            if (window.currentPlayingAudio === a) {
                window.currentPlayingAudio = null;
                window.currentPlayingWrapper = null;
            }
        });

        const origSrc = a.getAttribute('src') || a.getAttribute('data-src');
        if (!origSrc || origSrc.startsWith('blob:') || origSrc.startsWith('data:')) return;

        a.removeAttribute('src');
        a.setAttribute('data-src', origSrc);
        a.setAttribute('preload', 'none'); 

        if ('caches' in window) {
            caches.open('chat-audio-cache').then(cache => {
                cache.match(origSrc).then(res => {
                    if (res) {
                        res.blob().then(blob => {
                            const reader = new FileReader();
                            reader.onloadend = () => {
                                a.src = reader.result;
                                a.setAttribute('preload', 'auto');
                            };
                            reader.readAsDataURL(blob);
                        });
                    } else {
                        a.src = origSrc;
                        a.setAttribute('preload', 'metadata');
                        fetch(origSrc).then(netRes => {
                            if (netRes.ok) cache.put(origSrc, netRes.clone());
                        }).catch(e => console.log('语音缓存失败', e));
                    }
                });
            });
        } else {
            a.src = origSrc;
            a.setAttribute('preload', 'metadata');
        }
    });
}

function toggleConfig(key) { 
    fetch(`?action=toggle_config&key=${key}`).then(() => {
        showToast("狀態設置成功！");
        loadData(); 
    }); 
}

function handleCompressToggle(key, title) {
    const cb = document.getElementById(key === 'compress_img' ? 'cfg-img-comp' : 'cfg-vid-comp');
    if (cb.checked) {
        if (key === 'compress_img') {
            const isImageAllowed = document.getElementById('cfg-image').checked;
            if (!isImageAllowed) {
                showToast("請先開啟【允許圖片】功能，再設置圖片壓縮！");
                cb.checked = false; return;
            }
        } else if (key === 'compress_video') {
            const isVideoAllowed = document.getElementById('cfg-video').checked;
            if (!isVideoAllowed) {
                showToast("請先開啟【允許視頻】功能，再設置視頻轉碼！");
                cb.checked = false; return;
            }
        }
        handleConfigInput(key, title, 'number');
    } else {
        toggleConfig(key);
    }
}

let pendingConfigKey = '';
function handleConfigInput(key, title, inputType) {
    pendingConfigKey = key;
    document.getElementById('width-modal-title').innerText = title;
    
    if (key === 'admin_thumb_display') {
        document.getElementById('single-input-container').style.display = 'none';
        document.getElementById('double-input-container').style.display = 'none';
        document.getElementById('admin-thumb-input-container').style.display = 'flex';
        
        document.getElementById('admin-width-input').value = window.currentConfigs['admin_thumb_display'] || '125';
        document.getElementById('admin-height-input').value = window.currentConfigs['admin_thumb_display_h'] || '125';
        
    } else if (key === 'sys_settings') {
        document.getElementById('single-input-container').style.display = 'none';
        document.getElementById('admin-thumb-input-container').style.display = 'none';
        document.getElementById('double-input-container').style.display = 'flex';
        
        document.getElementById('width-input-display').value = window.currentConfigs['chat_thumb_display'] || '125';
        document.getElementById('width-input-display-h').value = window.currentConfigs['chat_thumb_display_h'] || '125';
        document.getElementById('width-input-actual').value = window.currentConfigs['chat_thumb_actual'] || '125';
        document.getElementById('width-input-file-w').value = window.currentConfigs['chat_file_width'] || '220';
        document.getElementById('width-input-file-h').value = window.currentConfigs['chat_file_height'] || '50';
        document.getElementById('width-input-upload-limit').value = window.currentConfigs['upload_size_limit'] || '0';
        
        let cs = window.currentConfigs['chunk_size'] || '2';
        if (window.currentConfigs['chunk_upload'] === '0') cs = '0';
        document.getElementById('width-input-chunk-size').value = cs;
        
        document.getElementById('width-input-avatar').value = window.currentConfigs['avatar_max_width'] || '200';
        
        document.getElementById('width-input-admin-users').value = window.currentConfigs['admin_username'] || '';

        // 【新增】：讀取撤回時效並賦值 (預設為 3)
        document.getElementById('width-input-recall-time').value = window.currentConfigs['recall_time'] !== undefined ? window.currentConfigs['recall_time'] : '3';
    } else {
        document.getElementById('single-input-container').style.display = 'block';
        document.getElementById('admin-thumb-input-container').style.display = 'none';
        document.getElementById('double-input-container').style.display = 'none';
        
        let inputEl = document.getElementById('width-input');
        inputEl.type = inputType === 'number' ? 'number' : 'text';
        if(inputType === 'number') {
             inputEl.setAttribute('oninput', "value=value.replace(/[^\\d]/g,'')");
        } else {
             inputEl.removeAttribute('oninput');
        }
        
        let defaultVal = window.currentConfigs[key] || '';
        if (!defaultVal && pendingConfigKey !== 'admin_username') {
            if (key.startsWith('compress_')) defaultVal = '720';
        }
        if (key === 'compress_img') defaultVal = window.currentConfigs['img_max_width'] || '720';
        if (key === 'compress_video') defaultVal = window.currentConfigs['video_max_width'] || '720';
        
        inputEl.value = defaultVal;
    }
    
    document.getElementById('width-modal').style.display = 'flex';
}

function closeWidthModal() { 
    document.getElementById('width-modal').style.display = 'none'; 
    if (pendingConfigKey === 'compress_img') {
        document.getElementById('cfg-img-comp').checked = window.currentConfigs['compress_img'] === '1';
    } else if (pendingConfigKey === 'compress_video') {
        document.getElementById('cfg-vid-comp').checked = window.currentConfigs['compress_video'] === '1';
    }
    pendingConfigKey = ''; 
}

function saveWidthConfig() {
    if (pendingConfigKey === 'admin_thumb_display') {
        const w = document.getElementById('admin-width-input').value;
        const h = document.getElementById('admin-height-input').value;
        if (!w || !h) { showToast("請輸入有效的數值！"); return; }
        
        fetch(`?action=set_admin_thumb&w=${w}&h=${h}`).then(() => { 
            closeWidthModal(); 
            showToast("設置成功！"); 
            
            document.documentElement.style.setProperty('--admin-thumb-width', w + 'px');
            document.documentElement.style.setProperty('--admin-thumb-height', h + 'px');
            
            loadData();
        });
        
    } else if (pendingConfigKey === 'sys_settings') {
        const display = document.getElementById('width-input-display').value;
        const display_h = document.getElementById('width-input-display-h').value;
        const actual = document.getElementById('width-input-actual').value;
        const fw = document.getElementById('width-input-file-w').value;
        const fh = document.getElementById('width-input-file-h').value;
        const cs = document.getElementById('width-input-chunk-size').value;
        const aw = document.getElementById('width-input-avatar').value;
        const ul = document.getElementById('width-input-upload-limit').value;
        const admins = document.getElementById('width-input-admin-users').value;
        const rt = document.getElementById('width-input-recall-time').value; // 【新增】：獲取撤回時間
        
        // 【修改】：加入 rt 驗證
        if (!display || !display_h || !actual || !fw || !fh || !aw || cs === '' || ul === '' || rt === '') { 
            showToast("請輸入有效的數值！"); return; 
        }
        
        const ce = parseFloat(cs) > 0 ? 1 : 0;
        
        // 【修改】：加入 rt 參數傳遞至後端
        fetch(`?action=set_sys_settings&display=${display}&display_h=${display_h}&actual=${actual}&fw=${fw}&fh=${fh}&ce=${ce}&cs=${cs}&aw=${aw}&ul=${ul}&rt=${rt}&admins=${encodeURIComponent(admins)}`).then(() => { 
            closeWidthModal(); 
            showToast("系統設置保存成功！"); 
            loadData(); 
        });
        
    } else if (pendingConfigKey.startsWith('compress_')) {
        const widthVal = document.getElementById('width-input').value;
        if (!widthVal || widthVal < 10) { showToast("請輸入有效的數值！"); return; }
        
        fetch(`?action=set_compress_width&key=${pendingConfigKey}&width=${widthVal}`).then(() => { 
            closeWidthModal(); 
            showToast("壓縮設置成功！"); 
            loadData(); 
        });
        
    } else {
        const val = document.getElementById('width-input').value.trim();
        if (pendingConfigKey !== 'admin_username' && !val) { showToast("輸入不能為空！"); return; }
        
        fetch(`?action=set_custom_width&key=${pendingConfigKey}&width=${encodeURIComponent(val)}`).then(() => { 
            closeWidthModal(); 
            showToast("設置成功！"); 
            loadData(); 
        });
    }
}

function openSmtpModal() {
    ['smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_crypto', 'smtp_from', 'smtp_from_name', 'smtp_test_email', 'smtp_test_msg'].forEach(id => {
        if(window.currentConfigs[id]) document.getElementById(id).value = window.currentConfigs[id];
    });
    document.getElementById('smtp-modal').style.display = 'flex';
}

function saveSmtp() {
    const fd = new FormData();
    ['smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_crypto', 'smtp_from', 'smtp_from_name', 'smtp_test_email', 'smtp_test_msg'].forEach(id => {
        fd.append(id, document.getElementById(id).value);
    });
    fetch(`?action=save_smtp`, { method: 'POST', body: fd }).then(() => { 
        showToast("發信配置保存成功！"); 
        document.getElementById('smtp-modal').style.display='none'; 
        loadData(); 
    });
}

function testSmtp() {
    const host = document.getElementById('smtp_host').value.trim();
    const port = document.getElementById('smtp_port').value.trim();
    const testEmail = document.getElementById('smtp_test_email').value.trim();
    const testMsg = document.getElementById('smtp_test_msg').value.trim();
    
    if (!host || !port || !testEmail || !testMsg) {
        showToast("請填寫 SMTP 伺服器、端口、收件郵箱及內容！");
        return;
    }

    showToast("正在提交發信测试...");
    
    const fd = new FormData();
    ['smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_crypto', 'smtp_from', 'smtp_from_name', 'smtp_test_email', 'smtp_test_msg'].forEach(id => {
        fd.append(id, document.getElementById(id).value);
    });

    fetch('?action=test_smtp', { method: 'POST', body: fd })
    .then(r => r.json()).then(res => {
        showToast(res.msg || (res.status === 'success' ? "發信測試成功" : "發信測試失敗"));
    }).catch(e => {
        showToast("發信請求出錯");
    });
}

function sendNotice() {
    const msg = document.getElementById('notice-input').value.trim();
    const fd = new FormData(); fd.append('message', msg);
    fetch(`?action=send_notice`, { method: 'POST', body: fd }).then(() => { showToast(msg ? "廣播已下發！" : "廣播已清除！"); loadData(); });
}
function delUser(name) { if(confirm(`確定要注銷用戶 [${name}] 嗎？`)) { fetch(`?action=del_user&username=${encodeURIComponent(name)}`).then(() => { showToast("用戶已注銷"); loadData(); }); } }
function delMsg(id) { if(confirm(`確定刪除這條消息嗎？`)) { fetch(`?action=del_msg&id=${id}`).then(() => { showToast("消息已刪除"); loadData(); }); } }
function sysReset(type) {
    let text = type === 'chat' ? "清空所有聊天記錄（已上傳的文件將保留）" : "清空所有聊天記錄，並【彻底刪除】所有附件文件（用戶賬號保留）";
    if(confirm(`⚠️ 警告：即將觸發 ${text}，操作不可逆！是否繼續？`)) { fetch(`?action=sys_reset&type=${type}`).then(() => { showToast("清空操作成功！"); loadData(); }); }
}
function filterList(className, keyword) {
    const kw = keyword.toLowerCase();
    document.querySelectorAll(`.${className}`).forEach(el => {
        const searchData = el.getAttribute('data-search') || '';
        el.style.display = searchData.includes(kw) ? 'flex' : 'none';
        if (className === 'msg-item' && searchData.includes(kw)) el.style.display = 'block';
    });
}

function openPwdModal() {
    ['old_pwd', 'new_pwd', 'confirm_pwd'].forEach(id => {
        const input = document.getElementById(id);
        input.value = '';
        input.type = 'password';
        input.nextElementSibling.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>';
    });
    document.getElementById('pwd-modal').style.display = 'flex';
}

function closePwdModal() {
    document.getElementById('pwd-modal').style.display = 'none';
}

function togglePwdVis(id, iconEl) {
    const input = document.getElementById(id);
    if (input.type === 'password') {
        input.type = 'text';
        iconEl.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/></svg>';
    } else {
        input.type = 'password';
        iconEl.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>';
    }
}

function savePwd() {
    const oldPwd = document.getElementById('old_pwd').value;
    const newPwd = document.getElementById('new_pwd').value;
    const confirmPwd = document.getElementById('confirm_pwd').value;

    if (!oldPwd || !newPwd || !confirmPwd) {
        showToast('請完整填寫密碼信息！');
        return;
    }
    if (newPwd !== confirmPwd) {
        showToast('兩次輸入的新密碼不一致！');
        return;
    }

    const fd = new FormData();
    fd.append('old_pwd', oldPwd);
    fd.append('new_pwd', newPwd);

    fetch('?action=change_pwd', { method: 'POST', body: fd })
    .then(r => r.json())
    .then(res => {
        if (res.status === 'success') {
            showToast('密碼修改成功，請重新登錄！');
            setTimeout(() => { location.href = '?action=logout'; }, 1500);
        } else {
            showToast(res.msg || '修改失敗');
        }
    }).catch(e => {
        showToast('請求出錯，請檢查網絡');
    });
}

let mediaElements = [];
let currentMediaIndex = 0;
const mediaModal = document.getElementById('media-modal');
const mediaContent = document.getElementById('media-modal-content');
const btnLoadOriginal = document.getElementById('btn-load-original');
const viewportMeta = document.getElementById('viewport-meta');
const prevBtn = document.getElementById('media-prev-btn');
const nextBtn = document.getElementById('media-next-btn');

let currentScale = 1, panX = 0, panY = 0, lastPanX = 0, lastPanY = 0, initialPinchDistance = 0, lastScale = 1;
let lastCloseTime = 0;
let mediaCloseTimeout;

function openMediaModal(sourceEl) {
    if (Date.now() - lastCloseTime < 400) return; 
    mediaElements = Array.from(document.querySelectorAll('#msg-list img.media-thumb, #msg-list img:not(.emoji), #msg-list .video-wrapper video'));
    currentMediaIndex = mediaElements.indexOf(sourceEl);
    if(currentMediaIndex === -1) return;
    
    viewportMeta.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=5.0, user-scalable=yes');
    mediaContent.classList.remove('animate-swipe'); mediaContent.style.transform = "translate3d(0px, 0px, 0px)"; mediaContent.style.opacity = "1";
    clearTimeout(mediaCloseTimeout);
    renderMediaModal(); mediaModal.classList.add('show');
}

function fetchOriginalImage(url, sizeInBytes) {
    btnLoadOriginal.onclick = null; 
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url + (url.includes('?') ? '&' : '?') + 'nocache=' + Date.now(), true);
    xhr.responseType = 'blob';

    let lastLoaded = 0; let lastTime = Date.now();

    xhr.onprogress = function(e) {
        let total = e.lengthComputable ? e.total : sizeInBytes;
        let loaded = e.loaded; let pct = total ? Math.floor((loaded / total) * 100) : 0; if(pct > 100) pct = 100;
        let currentTime = Date.now(); let timeDiff = (currentTime - lastTime) / 1000; 
        if (timeDiff >= 0.25) { 
            let speedBytes = (loaded - lastLoaded) / timeDiff;
            let speedDisplay = speedBytes > 1024 * 1024 ? (speedBytes / (1024 * 1024)).toFixed(1) + 'MB/s' : (speedBytes / 1024).toFixed(0) + 'KB/s';
            btnLoadOriginal.innerText = `加載中 ${pct}% (${speedDisplay})`;
            lastLoaded = loaded; lastTime = currentTime;
        }
    };
    xhr.onload = function() {
        if (xhr.status === 200) {
            btnLoadOriginal.innerText = '加載完成';
            const blobUrl = URL.createObjectURL(xhr.response);
            const modalImg = mediaContent.querySelector('img');
            if (modalImg) modalImg.src = blobUrl; mediaElements[currentMediaIndex].src = blobUrl; 
            setTimeout(() => { btnLoadOriginal.style.display = 'none'; }, 1200);
        } else { btnLoadOriginal.innerText = '加載失敗'; setTimeout(() => { btnLoadOriginal.style.display = 'none'; }, 1500); }
    };
    xhr.onerror = function() { btnLoadOriginal.innerText = '網絡錯誤'; setTimeout(() => { btnLoadOriginal.style.display = 'none'; }, 1500); };
    xhr.send();
}

function loadVideoIntoModal(url) {
    btnLoadOriginal.style.display = 'none';
    mediaContent.innerHTML = '';
    const video = document.createElement('video');
    video.src = url; video.controls = true; video.autoplay = true;
    video.setAttribute('playsinline', 'true'); video.setAttribute('webkit-playsinline', 'true');
    mediaContent.appendChild(video);
}

function renderMediaModal() {
    mediaContent.innerHTML = '';
    currentScale = 1; panX = 0; panY = 0; lastPanX = 0; lastPanY = 0; lastScale = 1; btnLoadOriginal.style.display = 'none';
    
    if (currentMediaIndex > 0) prevBtn.classList.add('show-nav'); else prevBtn.classList.remove('show-nav');
    if (currentMediaIndex < mediaElements.length - 1) nextBtn.classList.add('show-nav'); else nextBtn.classList.remove('show-nav');

    const el = mediaElements[currentMediaIndex];
    
    if (el.tagName === 'IMG') {
        const origUrl = el.getAttribute('data-original');
        const videoUrl = el.getAttribute('data-video');

        if (videoUrl) {
            loadVideoIntoModal(videoUrl);
        } else {
            const img = document.createElement('img');
            img.src = el.src; img.className = 'smooth-zoom'; mediaContent.appendChild(img);
            
            if (origUrl) {
                btnLoadOriginal.style.display = 'block'; btnLoadOriginal.innerText = '獲取大小...'; btnLoadOriginal.onclick = null;
                fetch(origUrl, { method: 'HEAD' }).then(res => {
                    const size = res.headers.get('content-length');
                    if (size) {
                        const mb = (size / (1024 * 1024)).toFixed(2), kb = (size / 1024).toFixed(1);
                        const displaySize = size > 1024 * 1024 ? mb + 'MB' : kb + 'KB';
                        btnLoadOriginal.innerText = `加載原圖 (${displaySize})`;
                        btnLoadOriginal.onclick = (e) => { e.stopPropagation(); fetchOriginalImage(origUrl, size); };
                    } else {
                        btnLoadOriginal.innerText = '加載原圖';
                        btnLoadOriginal.onclick = (e) => { e.stopPropagation(); fetchOriginalImage(origUrl, 0); };
                    }
                }).catch(() => { btnLoadOriginal.style.display = 'none'; });
            }
        }
    } else if (el.tagName === 'VIDEO') {
        const video = document.createElement('video');
        let vSrc = el.getAttribute('src') || el.currentSrc;
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
        setTimeout(() => {
            currentMediaIndex++; renderMediaModal();
            mediaContent.classList.remove('animate-swipe'); mediaContent.style.transform = `translate3d(100vw, 0, 0)`; void mediaContent.offsetWidth;
            mediaContent.classList.add('animate-swipe'); mediaContent.style.transform = `translate3d(0, 0, 0)`; mediaContent.style.opacity = "1";
        }, 250);
    } else if (direction === -1 && currentMediaIndex > 0) {
        mediaContent.style.transform = `translate3d(100vw, 0, 0)`; mediaContent.style.opacity = "0";
        setTimeout(() => {
            currentMediaIndex--; renderMediaModal();
            mediaContent.classList.remove('animate-swipe'); mediaContent.style.transform = `translate3d(-100vw, 0, 0)`; void mediaContent.offsetWidth;
            mediaContent.classList.add('animate-swipe'); mediaContent.style.transform = `translate3d(0, 0, 0)`; mediaContent.style.opacity = "1";
        }, 250);
    } else { mediaContent.style.transform = "translate3d(0, 0, 0)"; }
}

mediaModal.addEventListener('wheel', e => {
    const targetImg = mediaContent.querySelector('img'); if (!targetImg) return; e.preventDefault(); 
    const zoomDelta = e.deltaY < 0 ? 0.2 : -0.2; currentScale = Math.max(0.5, Math.min(currentScale + zoomDelta, 5));
    if (currentScale <= 1) { panX = 0; panY = 0; lastPanX = 0; lastPanY = 0; currentScale = 1; }
    targetImg.style.transform = `translate3d(${panX}px, ${panY}px, 0) scale(${currentScale})`;
}, { passive: false });

let isDraggingPC = false, hasDraggedPC = false, pcStartX = 0, pcStartY = 0;
mediaModal.addEventListener('mousedown', e => {
    if (e.target.id === 'btn-load-original' || e.target.id === 'media-close-btn' || e.target.classList.contains('media-nav-btn')) return;
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
        isSwiping = false; 
        initialPinchDistance = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); 
        lastScale = currentScale; 
    }
}, { passive: false });

mediaModal.addEventListener('touchmove', e => {
    const targetImg = mediaContent.querySelector('img');
    if (e.touches.length === 2 && targetImg) { 
        e.preventDefault();
        const currentDistance = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); 
        currentScale = lastScale * (currentDistance / initialPinchDistance); currentScale = Math.max(0.5, Math.min(currentScale, 5)); 
        targetImg.style.transform = `translate3d(${panX}px, ${panY}px, 0) scale(${currentScale})`; 
        return; 
    }
    if (!isSwiping || e.touches.length !== 1) return;
    let diffX = e.touches[0].clientX - startX, diffY = e.touches[0].clientY - startY;
    if (currentScale > 1 && targetImg) { 
        e.preventDefault();
        panX = lastPanX + diffX; panY = lastPanY + diffY; targetImg.style.transform = `translate3d(${panX}px, ${panY}px, 0) scale(${currentScale})`; 
        return; 
    }
    if (touchTarget && touchTarget.tagName === 'VIDEO') { 
        const rect = touchTarget.getBoundingClientRect(); if (rect.bottom - e.touches[0].clientY < 90) { isSwiping = false; return; } 
    }
    
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
        if (Math.abs(diffX) < 10 && Math.abs(diffY) < 10) { 
            e.preventDefault(); 
            currentScale = 1; panX = 0; panY = 0; lastPanX = 0; lastPanY = 0; 
            targetImg.style.transform = `translate3d(0px, 0px, 0) scale(1)`; 
        } 
        return; 
    } else if (currentScale < 1 && targetImg) { 
        currentScale = 1; panX = 0; panY = 0; lastPanX = 0; lastPanY = 0; targetImg.style.transform = `translate3d(0px, 0px, 0) scale(1)`; 
    }
    
    if (!isSwiping) return;
    
    if (Math.abs(diffX) > 50 && Math.abs(diffX) > Math.abs(diffY)) { 
        executeMediaSwipe(diffX < 0 ? 1 : -1); 
    } else if (Math.abs(diffX) < 10 && Math.abs(diffY) < 10) { 
        mediaContent.style.transform = "translate3d(0, 0, 0)"; 
        
        if (touchTarget && touchTarget.id === 'btn-load-original') {
            isSwiping = false;
            return;
        }

        if (touchTarget && touchTarget.tagName === 'VIDEO') {
            const rect = touchTarget.getBoundingClientRect();
            const touchY = e.changedTouches[0].clientY;
            const touchX = e.changedTouches[0].clientX;
            const isBottomControls = rect.bottom - touchY < 90; 
            const isCenterPlay = Math.abs((rect.top + rect.height/2) - touchY) < 90 && Math.abs((rect.left + rect.width/2) - touchX) < 90; 
            
            if (isBottomControls || isCenterPlay) {
                isSwiping = false;
                return; 
            }
        }
        
        e.preventDefault(); 
        if (touchTarget) { 
            if (touchTarget.id === 'media-close-btn') { closeMediaModal(); return; }
            if (touchTarget.classList.contains('media-nav-btn')) return;
            
            if (touchTarget.tagName === 'IMG') {
                if (currentScale > 1) {
                    currentScale = 1; panX = 0; panY = 0; lastPanX = 0; lastPanY = 0;
                    touchTarget.style.transform = `translate3d(0px, 0px, 0) scale(1)`;
                    return;
                }
            }
        }
        closeMediaModal(); 
    } else { 
        mediaContent.style.transform = "translate3d(0, 0, 0)"; 
    }
    isSwiping = false;
});

mediaModal.addEventListener('click', e => {
    if (hasDraggedPC) return; 
    if (e.target.id === 'btn-load-original' || e.target.id === 'media-close-btn' || e.target.classList.contains('media-nav-btn')) return; 
    
    if (e.target.tagName === 'IMG') {
        if (currentScale > 1) {
            currentScale = 1; panX = 0; panY = 0; lastPanX = 0; lastPanY = 0;
            e.target.style.transform = `translate3d(0px, 0px, 0) scale(1)`;
            return; 
        }
    } else if (e.target.tagName === 'VIDEO') { 
        const rect = e.target.getBoundingClientRect(); 
        const isBottomControls = rect.bottom - e.clientY < 90; 
        const isCenterPlay = Math.abs((rect.top + rect.height/2) - e.clientY) < 90 && Math.abs((rect.left + rect.width/2) - e.clientX) < 90; 
        if (isBottomControls || isCenterPlay) return; 
    }
    
    closeMediaModal(); 
});

document.addEventListener('DOMContentLoaded', () => {
    loadData(); 
    setInterval(() => {
        loadData();
    }, 3000);
});

// ====== 附件管理功能 ======

// 监听顶部附件统计卡片的点击
document.getElementById('btn-manage-files').addEventListener('click', function() {
    const statFilesStr = document.getElementById('stat-files').innerText;
    const fileCount = parseInt(statFilesStr, 10);
    
    // 大于0时弹出窗口，否则弹出提示
    if (!isNaN(fileCount) && fileCount > 0) {
        openFileModal();
    } else {
        showToast('当前没有附件');
    }
});

function openFileModal() {
    document.getElementById('file-modal').style.display = 'flex';
    fetchAndRenderFiles();
}

function closeFileModal() {
    document.getElementById('file-modal').style.display = 'none';
}

function fetchAndRenderFiles() {
    const container = document.getElementById('file-list-container');
    container.innerHTML = '<div style="text-align:center; padding:30px; color:#999; font-size: 14px;">正在读取文件列表...</div>';
    
    fetch('?action=get_files')
        .then(res => res.json())
        .then(data => {
            if (data.status === 'success') {
                if (data.files.length === 0) {
                    container.innerHTML = '<div style="text-align:center; padding:30px; color:#999; font-size: 14px;">文件夹为空，暂无物理附件</div>';
                    return;
                }
                
                let html = '';
                data.files.forEach(f => {
                    // 换算文件大小
                    const sizeMb = (f.size / (1024 * 1024)).toFixed(2);
                    const displaySize = sizeMb >= 1 ? sizeMb + ' MB' : (f.size / 1024).toFixed(2) + ' KB';
                    
                    // 【修复】：在此处也引入兼容本地时间的逻辑展示附件时间
                    const timeStr = formatLocalTime(f.time * 1000);
                    
                    html += `
                        <div class="file-list-item">
                            <div class="file-list-info">
                                <div class="file-list-name" title="${f.name}">${f.name}</div>
                                <div class="file-list-meta">${displaySize} · ${timeStr}</div>
                            </div>
                            <div style="flex-shrink:0; display:flex; align-items:center;">
                                <a href="storage/files/${encodeURIComponent(f.name)}" download="${f.name}" class="btn-outline-blue" onclick="event.stopPropagation();">下载</a>&nbsp;
                                <button class="btn-outline-red" onclick="deletePhysicalFile('${f.name}')">删除</button>
                            </div>
                        </div>
                    `;
                });
                container.innerHTML = html;
            } else {
                container.innerHTML = '<div style="text-align:center; padding:30px; color:#FF3B30; font-size: 14px;">读取失败</div>';
            }
        })
        .catch(err => {
            container.innerHTML = '<div style="text-align:center; padding:30px; color:#FF3B30; font-size: 14px;">网络异常，读取失败</div>';
        });
}

function deletePhysicalFile(fileName) {
    if (!confirm(`确定彻底删除附件【${fileName}】吗？此操作不可恢复！`)) return;
    
    fetch(`?action=del_file&file=${encodeURIComponent(fileName)}`)
        .then(res => res.json())
        .then(data => {
            if (data.status === 'success') {
                showToast('附件文件已成功删除');
                fetchAndRenderFiles(); // 重新加载小窗中的列表
                loadData(); // 通知后台刷新外部顶部的总体统计计数
            } else {
                showToast(data.msg || '删除失败');
            }
        })
        .catch(err => {
            showToast('请求删除时出错');
        });
}