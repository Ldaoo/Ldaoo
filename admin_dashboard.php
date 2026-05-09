<?php
// 【核心优化】：同步延长存活时间
ini_set('session.gc_maxlifetime', 7 * 86400);
session_set_cookie_params(7 * 86400, '/');
session_start();
header('Content-Type: text/html; charset=utf-8');

$dbPath = __DIR__ . '/storage/data.sqlite';
try {
    $pdo = new PDO('sqlite:' . $dbPath);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    // 提升并发能力
    $pdo->setAttribute(PDO::ATTR_TIMEOUT, 5);
    try { $pdo->exec("PRAGMA journal_mode = WAL;"); } catch (Exception $e) {}
    try { $pdo->exec("ALTER TABLE users ADD COLUMN avatar TEXT DEFAULT ''"); } catch (Exception $e) {}
    try { $pdo->exec("ALTER TABLE users ADD COLUMN email TEXT DEFAULT ''"); } catch (Exception $e) {}
    try { $pdo->exec("ALTER TABLE users ADD COLUMN admin_remember_token TEXT DEFAULT NULL"); } catch (Exception $e) {}
} catch (PDOException $e) { die("數據庫連接失敗"); }

// 将退出逻辑移到此处 (在 session_write_close 之前)
if (isset($_GET['action']) && $_GET['action'] === 'logout') { 
    try { $pdo->exec("UPDATE users SET admin_remember_token = NULL WHERE role = 'admin'"); } catch (Exception $e) {}
    if (session_status() === PHP_SESSION_NONE) { @session_start(); }
    $_SESSION = array();
    @session_destroy(); 
    setcookie('admin_remember_token', '', time() - 3600, '/');
    header("Location: admin_dashboard.php"); 
    exit; 
}

// 7天免登录：校验 Token
if (empty($_SESSION['admin_auth']) && !empty($_COOKIE['admin_remember_token'])) {
    $token = $_COOKIE['admin_remember_token'];
    $stmt = $pdo->prepare("SELECT id FROM users WHERE admin_remember_token = ? AND role = 'admin'");
    $stmt->execute([$token]);
    if ($stmt->fetch()) {
        $_SESSION['admin_auth'] = true;
        setcookie('admin_remember_token', $token, time() + 7 * 86400, '/');
    } else {
        setcookie('admin_remember_token', '', time() - 3600, '/');
    }
}

if (!isset($_SESSION['admin_auth']) || $_SESSION['admin_auth'] !== true) { header("Location: admin.php"); exit; }

// 鉴权通过后尽早释放 session 锁
session_write_close();

$adminThumbDisplay = 125;
$adminThumbDisplayH = 125;
$stmt = $pdo->query("SELECT key_name, key_value FROM configs WHERE key_name IN ('admin_thumb_display', 'admin_thumb_display_h')");
while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
    if ($row['key_name'] === 'admin_thumb_display') $adminThumbDisplay = intval($row['key_value']);
    if ($row['key_name'] === 'admin_thumb_display_h') $adminThumbDisplayH = intval($row['key_value']);
}

if (isset($_GET['action']) && $_GET['action'] === 'set_admin_thumb') {
    $w = intval($_GET['w']);
    $h = intval($_GET['h']);
    $pdo->prepare("REPLACE INTO configs (key_name, key_value) VALUES ('admin_thumb_display', ?)")->execute([$w]);
    $pdo->prepare("REPLACE INTO configs (key_name, key_value) VALUES ('admin_thumb_display_h', ?)")->execute([$h]);
    echo json_encode(['status' => 'success']);
    exit;
}

if (isset($_GET['action']) && $_GET['action'] === 'change_pwd') {
    header('Content-Type: application/json');
    $old = $_POST['old_pwd'] ?? '';
    $new = $_POST['new_pwd'] ?? '';
    
    $isValid = false;
    $hashMethod = 'plain'; // plain, md5, 或 password_hash
    $updateTarget = 'none'; // 'configs' 或 'users'
    $adminId = 0;

    try {
        $stmt = $pdo->query("SELECT id, password FROM users WHERE role = 'admin' LIMIT 1");
        $adminUser = $stmt->fetch(PDO::FETCH_ASSOC);
        if ($adminUser && !empty($adminUser['password'])) {
            $dbPwd = $adminUser['password'];
            if (password_verify($old, $dbPwd)) { $isValid = true; $hashMethod = 'password_hash'; }
            elseif (md5($old) === $dbPwd) { $isValid = true; $hashMethod = 'md5'; }
            elseif ($old === $dbPwd) { $isValid = true; $hashMethod = 'plain'; }
            if ($isValid) { $updateTarget = 'users'; $adminId = $adminUser['id']; }
        }
    } catch (Exception $e) {}

    if (!$isValid) {
        try {
            $stmt = $pdo->query("SELECT key_value FROM configs WHERE key_name IN ('admin_password', 'admin_pwd') LIMIT 1");
            $dbPwd = $stmt->fetchColumn();
            if ($dbPwd !== false) {
                if (password_verify($old, $dbPwd)) { $isValid = true; $hashMethod = 'password_hash'; }
                elseif (md5($old) === $dbPwd) { $isValid = true; $hashMethod = 'md5'; }
                elseif ($old === $dbPwd) { $isValid = true; $hashMethod = 'plain'; }
                if ($isValid) { $updateTarget = 'configs'; }
            }
        } catch (Exception $e) {}
    }

    if (!$isValid) { echo json_encode(['status' => 'error', 'msg' => '旧密码不正确！']); exit; }
    
    $newHash = $new;
    if ($hashMethod === 'password_hash') { $newHash = password_hash($new, PASSWORD_DEFAULT); } 
    elseif ($hashMethod === 'md5') { $newHash = md5($new); }
    
    if ($updateTarget === 'users') { 
        $pdo->prepare("UPDATE users SET password = ?, admin_remember_token = NULL WHERE id = ?")->execute([$newHash, $adminId]); 
    } else { 
        $pdo->prepare("REPLACE INTO configs (key_name, key_value) VALUES ('admin_password', ?)")->execute([$newHash]); 
        try { $pdo->exec("UPDATE users SET admin_remember_token = NULL WHERE role = 'admin'"); } catch (Exception $e) {}
    }
    
    if (session_status() === PHP_SESSION_NONE) { @session_start(); }
    $_SESSION = array();
    @session_destroy();
    setcookie('admin_remember_token', '', time() - 3600, '/');

    echo json_encode(['status' => 'success']);
    exit;
}

if (isset($_GET['action']) && $_GET['action'] === 'get_files') {
    header('Content-Type: application/json');
    $dir = __DIR__ . '/storage/files/';
    $filesList = [];
    
    if (is_dir($dir)) {
        $items = scandir($dir);
        foreach ($items as $item) {
            if ($item !== '.' && $item !== '..') {
                $filePath = $dir . $item;
                if (is_file($filePath)) {
                    $filesList[] = [
                        'name' => $item,
                        'size' => filesize($filePath),
                        'time' => filemtime($filePath)
                    ];
                }
            }
        }
    }
    
    usort($filesList, function($a, $b) {
        return $b['time'] - $a['time'];
    });
    
    echo json_encode(['status' => 'success', 'files' => $filesList]);
    exit;
}

if (isset($_GET['action']) && $_GET['action'] === 'del_file') {
    header('Content-Type: application/json');
    $fileName = basename($_GET['file'] ?? '');
    
    if (empty($fileName)) { echo json_encode(['status' => 'error', 'msg' => '文件名为空']); exit; }
    
    $filePath = __DIR__ . '/storage/files/' . $fileName;
    if (is_file($filePath)) {
        @unlink($filePath);
        echo json_encode(['status' => 'success']);
    } else {
        echo json_encode(['status' => 'error', 'msg' => '文件不存在或已被删除']);
    }
    exit;
}

if (isset($_GET['action']) && $_GET['action'] === 'api_update') {
    header('Content-Type: application/json');
    $msgCount = $pdo->query("SELECT COUNT(*) FROM messages WHERE sender != '[公告]'")->fetchColumn();
    
    $fileCount = 0;
    $uploadDir = __DIR__ . '/storage/files/';
    if (is_dir($uploadDir)) {
        $items = scandir($uploadDir);
        foreach ($items as $item) { if ($item !== '.' && $item !== '..' && is_file($uploadDir . $item)) { $fileCount++; } }
    }
    
    $lastMsg = $pdo->query("SELECT created_at FROM messages WHERE sender != '[公告]' ORDER BY created_at DESC LIMIT 1")->fetchColumn();

    $configs = [];
    $stmt = $pdo->query("SELECT key_name, key_value FROM configs");
    while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) { $configs[$row['key_name']] = $row['key_value']; }
    
    $users = [];
    $stmt = $pdo->query("SELECT username, email, last_active FROM users WHERE role != 'admin' ORDER BY last_active DESC");
    while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) { 
        $users[] = [
            'name' => $row['username'],
            'email' => $row['email'],
            'timeTs' => $row['last_active'] ? (strtotime($row['last_active'] . ' UTC') * 1000) : null
        ]; 
    }
    
    $msgs = [];
    $stmt = $pdo->query("SELECT id, sender, receiver, content, type, created_at FROM messages ORDER BY created_at DESC LIMIT 100");
    while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
        if ($row['sender'] === '[公告]') continue;
        
        $displayContent = $row['content'];
        if ($row['type'] === 'text') {
            $displayContent = nl2br(htmlspecialchars($displayContent, ENT_QUOTES, 'UTF-8'));
        }
        
        $msgs[] = [
            'id' => $row['id'],
            'sender' => htmlspecialchars($row['sender']),
            'receiver' => htmlspecialchars($row['receiver'] === 'all' ? '大廳' : $row['receiver']),
            'timeTs' => $row['created_at'] ? (strtotime($row['created_at'] . ' UTC') * 1000) : null,
            'content' => $displayContent,
            'type' => $row['type'],
            'search' => mb_strtolower($row['sender'] . ' ' . $row['receiver'] . ' ' . strip_tags($row['content']), 'UTF-8')
        ];
    }

    echo json_encode([
        'stats' => [ 'msgs' => $msgCount, 'files' => $fileCount, 'lastTs' => $lastMsg ? (strtotime($lastMsg . ' UTC') * 1000) : null ],
        'configs' => $configs,
        'users' => $users,
        'messages' => $msgs
    ]);
    exit;
}

if (isset($_GET['action']) && $_GET['action'] === 'toggle_config') {
    $key = $_GET['key'];
    $stmt = $pdo->prepare("SELECT key_value FROM configs WHERE key_name = ?");
    $stmt->execute([$key]);
    $current = $stmt->fetchColumn();
    $newVal = ($current === '1') ? '0' : '1';
    $pdo->prepare("REPLACE INTO configs (key_name, key_value) VALUES (?, ?)")->execute([$key, $newVal]);

    if ($key === 'disable_image' && $newVal === '1') { $pdo->prepare("REPLACE INTO configs (key_name, key_value) VALUES ('compress_img', '0')")->execute(); }
    if ($key === 'disable_video' && $newVal === '1') { $pdo->prepare("REPLACE INTO configs (key_name, key_value) VALUES ('compress_video', '0')")->execute(); }

    echo json_encode(['status' => 'success']);
    exit;
}

if (isset($_GET['action']) && $_GET['action'] === 'set_sys_settings') {
    $display = intval($_GET['display']);
    $display_h = intval($_GET['display_h']);
    $actual = intval($_GET['actual']);
    $fw = intval($_GET['fw']);
    $fh = intval($_GET['fh']);
    $ce = intval($_GET['ce']);
    $cs = floatval($_GET['cs']);
    $aw = intval($_GET['aw']);
    $ul = floatval($_GET['ul']);
    $rt = intval($_GET['rt'] ?? 3); // 接收撤回时间参数，默认为 3 分钟
    $admins = trim($_GET['admins'] ?? '');
    
    $pdo->prepare("REPLACE INTO configs (key_name, key_value) VALUES ('chat_thumb_display', ?)")->execute([$display]);
    $pdo->prepare("REPLACE INTO configs (key_name, key_value) VALUES ('chat_thumb_display_h', ?)")->execute([$display_h]);
    $pdo->prepare("REPLACE INTO configs (key_name, key_value) VALUES ('chat_thumb_actual', ?)")->execute([$actual]);
    $pdo->prepare("REPLACE INTO configs (key_name, key_value) VALUES ('chat_file_width', ?)")->execute([$fw]);
    $pdo->prepare("REPLACE INTO configs (key_name, key_value) VALUES ('chat_file_height', ?)")->execute([$fh]);
    $pdo->prepare("REPLACE INTO configs (key_name, key_value) VALUES ('chunk_upload', ?)")->execute([$ce]);
    $pdo->prepare("REPLACE INTO configs (key_name, key_value) VALUES ('chunk_size', ?)")->execute([$cs]);
    $pdo->prepare("REPLACE INTO configs (key_name, key_value) VALUES ('avatar_max_width', ?)")->execute([$aw]);
    $pdo->prepare("REPLACE INTO configs (key_name, key_value) VALUES ('upload_size_limit', ?)")->execute([$ul]);
    $pdo->prepare("REPLACE INTO configs (key_name, key_value) VALUES ('recall_time', ?)")->execute([$rt]); // 保存撤回时效
    $pdo->prepare("REPLACE INTO configs (key_name, key_value) VALUES ('admin_username', ?)")->execute([$admins]);

    echo json_encode(['status' => 'success']);
    exit;
}

if (isset($_GET['action']) && $_GET['action'] === 'set_compress_width') {
    $key = $_GET['key'];
    $width = intval($_GET['width']);
    $widthKey = $key === 'compress_img' ? 'img_max_width' : 'video_max_width';
    $pdo->prepare("REPLACE INTO configs (key_name, key_value) VALUES (?, ?)")->execute([$key, '1']);
    $pdo->prepare("REPLACE INTO configs (key_name, key_value) VALUES (?, ?)")->execute([$widthKey, $width]);
    echo json_encode(['status' => 'success']);
    exit;
}

if (isset($_GET['action']) && $_GET['action'] === 'set_custom_width') {
    $key = $_GET['key'];
    $width = ($key === 'admin_username') ? trim($_GET['width']) : intval($_GET['width']);
    $pdo->prepare("REPLACE INTO configs (key_name, key_value) VALUES (?, ?)")->execute([$key, $width]);
    echo json_encode(['status' => 'success']);
    exit;
}

if (isset($_GET['action']) && $_GET['action'] === 'save_smtp') {
    $keys = ['smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_crypto', 'smtp_from', 'smtp_from_name', 'smtp_test_email', 'smtp_test_msg'];
    foreach ($keys as $k) {
        if (isset($_POST[$k])) { $pdo->prepare("REPLACE INTO configs (key_name, key_value) VALUES (?, ?)")->execute([$k, $_POST[$k]]); }
    }
    echo json_encode(['status' => 'success']);
    exit;
}

if (isset($_GET['action']) && $_GET['action'] === 'test_smtp') {
    header('Content-Type: application/json');
    $host = trim($_POST['smtp_host'] ?? '');
    $port = (int)($_POST['smtp_port'] ?? 0);
    $user = trim($_POST['smtp_user'] ?? '');
    $pass = trim($_POST['smtp_pass'] ?? '');
    $crypto = $_POST['smtp_crypto'] ?? '';
    $from = trim($_POST['smtp_from'] ?? '');
    $name = trim($_POST['smtp_from_name'] ?? '');
    $to = trim($_POST['smtp_test_email'] ?? '');
    $content = trim($_POST['smtp_test_msg'] ?? '');
    
    if(empty($host) || empty($port) || empty($to) || empty($content)){
        echo json_encode(["status" => "error", "msg" => "請填寫SMTP伺服器、端口、接收郵箱和內容"]); exit;
    }
    
    $timeout = 10;
    $host_prefix = ($crypto === 'ssl' || $port == 465) ? 'ssl://' : '';
    $fp = @fsockopen($host_prefix . $host, $port, $errno, $errstr, $timeout);
    
    if (!$fp) { echo json_encode(["status" => "error", "msg" => "無法連接到伺服器: $errstr"]); exit; }
    stream_set_timeout($fp, $timeout);
    fgets($fp, 515);

    function send_smtp_cmd($fp, $cmd) {
        fputs($fp, $cmd . "\r\n");
        $res = '';
        while($str = fgets($fp, 515)) {
            $res .= $str;
            if(substr($str, 3, 1) == ' ') break;
        }
        return $res;
    }

    send_smtp_cmd($fp, "EHLO " . ($_SERVER['SERVER_NAME'] ?? 'localhost'));
    if ($crypto === 'tls') {
        send_smtp_cmd($fp, "STARTTLS");
        stream_socket_enable_crypto($fp, true, STREAM_CRYPTO_METHOD_TLS_CLIENT);
        send_smtp_cmd($fp, "EHLO " . ($_SERVER['SERVER_NAME'] ?? 'localhost'));
    }
    if (!empty($user) && !empty($pass)) {
        send_smtp_cmd($fp, "AUTH LOGIN");
        send_smtp_cmd($fp, base64_encode($user));
        $auth_res = send_smtp_cmd($fp, base64_encode($pass));
        if (substr($auth_res, 0, 3) != '235') {
            fclose($fp); echo json_encode(["status" => "error", "msg" => "SMTP認證失敗，請檢查賬號密碼"]); exit;
        }
    }
    send_smtp_cmd($fp, "MAIL FROM:<$from>");
    send_smtp_cmd($fp, "RCPT TO:<$to>");
    send_smtp_cmd($fp, "DATA");

    $subject = "=?UTF-8?B?".base64_encode("管理中心 - 發信測試")."?=";
    $header = "From: =?UTF-8?B?".base64_encode($name)."?= <$from>\r\nTo: <$to>\r\nSubject: $subject\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n";
    $mail_res = send_smtp_cmd($fp, $header . $content . "\r\n.");
    send_smtp_cmd($fp, "QUIT");
    fclose($fp);

    if (substr($mail_res, 0, 3) == '250') {
        echo json_encode(["status" => "success", "msg" => "郵件發送成功！請前往收件箱查看。"]);
    } else {
        echo json_encode(["status" => "error", "msg" => "伺服器拒絕發送: " . $mail_res]);
    }
    exit;
}

if (isset($_GET['action']) && $_GET['action'] === 'send_notice') {
    $pdo->prepare("REPLACE INTO configs (key_name, key_value) VALUES ('global_notice', ?)")->execute([trim($_POST['message'] ?? '')]);
    echo json_encode(['status' => 'success']); exit;
}

if (isset($_GET['action']) && $_GET['action'] === 'del_user') {
    $pdo->prepare("DELETE FROM users WHERE username = ? AND role != 'admin'")->execute([$_GET['username']]);
    echo json_encode(['status' => 'success']); exit;
}

if (isset($_GET['action']) && $_GET['action'] === 'del_msg') {
    $pdo->prepare("DELETE FROM messages WHERE id = ?")->execute([$_GET['id']]);
    echo json_encode(['status' => 'success']); exit;
}

if (isset($_GET['action']) && $_GET['action'] === 'sys_reset') {
    if ($_GET['type'] === 'chat') { $pdo->exec("DELETE FROM messages"); } 
    elseif ($_GET['type'] === 'all') {
        $pdo->exec("DELETE FROM messages");
        $uploadDir = __DIR__ . '/storage/files/';
        if (is_dir($uploadDir)) { foreach (glob($uploadDir . '*') as $file) { if (is_file($file)) @unlink($file); } }
    }
    echo json_encode(['status' => 'success']); exit;
}
?>
<!DOCTYPE html>
<html lang="zh">
<head>
    <meta charset="utf-8">
    <meta id="viewport-meta" name="viewport" content="width=device-width, initial-scale=1.0, minimum-scale=1.0, maximum-scale=1.0, user-scalable=0, viewport-fit=cover">
    <title>管理中心</title>
    <link rel="stylesheet" href="admin.css?v=<?php echo filemtime(__DIR__ . '/admin.css'); ?>">
    <style>
        :root { 
            --admin-thumb-width: <?php echo $adminThumbDisplay; ?>px; 
            --admin-thumb-height: <?php echo $adminThumbDisplayH; ?>px; 
        }
        .msg-list-area .media-thumb, .msg-list-area img:not(.emoji) { width: var(--admin-thumb-width) !important; height: var(--admin-thumb-height) !important; object-fit: cover; }
        .msg-list-area .video-wrapper { width: var(--admin-thumb-width) !important; height: var(--admin-thumb-height) !important; }
    </style>
</head>
<body>
<div id="toast-container"></div>
<div id="app-wrapper">
    <div id="header">
        <h1 style="display:flex; align-items:center; margin:0;">
            管理中心&nbsp;&nbsp;
            <button onclick="openPwdModal()" style="background:transparent; border:1px solid rgba(255,255,255,0.6); color:#fff; border-radius:12px; padding:3px 10px; font-size:12px; cursor:pointer; font-weight:normal; outline:none;">修改密码</button>
        </h1>
        <a href="?action=logout" class="btn-exit">退出系統</a>
    </div>
    
    <div id="content-area">
        <div class="card" style="padding: 10px;">
            <div class="top-stats">
                <div class="stat-card"><span class="stat-label">消息</span><span class="stat-num" id="stat-msgs">-</span></div>
                <div class="stat-card" id="btn-manage-files" style="cursor: pointer;" title="点击管理附件"><span class="stat-label">附件</span><span class="stat-num" id="stat-files">-</span></div>
                <div class="stat-card"><span class="stat-label">最近</span><span class="stat-num" id="stat-time" style="font-size:16px; line-height:24px;">-</span></div>
            </div>
        </div>

        <div class="card">
            <span class="card-title">系統廣播</span>
            <div class="inline-action-row">
                <input type="text" id="notice-input" class="input-inline" placeholder="發佈新廣播...">
                <button class="btn-send" onclick="sendNotice()">下發</button>
            </div>
        </div>

        <div class="card">
            <span class="card-title">系統設置</span>
            <div class="config-grid">
                <div class="config-item"><div class="config-label">允許圖片</div><label class="switch"><input type="checkbox" id="cfg-image" onchange="toggleConfig('disable_image')"><span class="slider"></span></label></div>
                <div class="config-item"><div class="config-label">允許視頻</div><label class="switch"><input type="checkbox" id="cfg-video" onchange="toggleConfig('disable_video')"><span class="slider"></span></label></div>
                <div class="config-item"><div class="config-label">允許语音</div><label class="switch"><input type="checkbox" id="cfg-voice" onchange="toggleConfig('disable_voice')"><span class="slider"></span></label></div>
                <div class="config-item"><div class="config-label">圖片壓縮</div><label class="switch"><input type="checkbox" id="cfg-img-comp" onchange="handleCompressToggle('compress_img', '設置圖片壓縮最大寬度')"><span class="slider"></span></label></div>
                <div class="config-item"><div class="config-label">視頻轉碼</div><label class="switch"><input type="checkbox" id="cfg-vid-comp" onchange="handleCompressToggle('compress_video', '設置視頻轉碼最大寬度')"><span class="slider"></span></label></div>
                <div class="config-item"><div class="config-label">找回密碼</div><label class="switch"><input type="checkbox" id="cfg-forgot" onchange="toggleConfig('disable_forgot')"><span class="slider"></span></label></div>
                <div class="config-item"><div class="config-label">参数设置</div><button class="btn-toggle status-blue" onclick="handleConfigInput('sys_settings', '参数设置', 'special')">设置</button></div>
                <div class="config-item"><div class="config-label">發信設置</div><button class="btn-toggle status-blue" onclick="openSmtpModal()">設置</button></div>
            </div>
        </div>

        <div class="card">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                <span class="card-title" style="margin-bottom:0;">用戶管理</span>
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="font-size:12px; color:#888;">允許註冊</span>
                    <label class="switch"><input type="checkbox" id="cfg-register" onchange="toggleConfig('disable_register')"><span class="slider"></span></label>
                </div>
            </div>
            <input type="text" id="search-user" class="single-search" placeholder="搜索用戶或邮箱..." oninput="filterList('user-row', this.value)">
            <div class="scroll-v" id="user-list"></div>
        </div>

        <div class="card">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px; flex-wrap:wrap; gap:10px;">
                <span class="card-title" style="margin-bottom:0;">消息審計</span>
                <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                    <button class="btn-outline-red" style="border-color:#085A48; color:#085A48;" onclick="handleConfigInput('admin_thumb_display', '設置後台審計微縮圖尺寸', 'special')">設置微縮圖</button>
                    <button class="btn-outline-red" style="border-color:#085A48; color:#085A48;" onclick="sysReset('chat')">清空消息</button>
                    <button class="btn-outline-red" onclick="sysReset('all')">全站重置</button>
                </div>
            </div>
            <input type="text" id="search-msg" class="single-search" placeholder="搜索內容..." oninput="filterList('msg-item', this.value)">
            <div class="scroll-v msg-list-area" id="msg-list"></div>
        </div>
    </div>
</div>

<div id="width-modal" class="modal-overlay">
    <div class="modal-box">
        <div class="modal-close" onclick="closeWidthModal()">×</div>
        <h4 id="width-modal-title">設置</h4>
        
        <div id="single-input-container"><input type="text" id="width-input" placeholder=""></div>
        
        <div id="admin-thumb-input-container" style="display:none; flex-direction: row; gap: 5px; margin-bottom: 5px;">
            <input type="number" id="admin-width-input" placeholder="寬 (px)" style="margin-bottom:0; flex:1; width:0;" min="1" oninput="value=value.replace(/[^\d]/g,'')">
            <input type="number" id="admin-height-input" placeholder="高 (px)" style="margin-bottom:0; flex:1; width:0;" min="1" oninput="value=value.replace(/[^\d]/g,'')">
        </div>

        <div id="double-input-container" style="display:none; flex-direction: column; gap: 5px; margin-bottom: 10px;">
            <div style="display: flex; gap: 10px;">
                <div style="flex: 1; text-align: left;">
                    <label style="font-size:12px; color:#666; display:block; margin-bottom:5px; padding-left:5px;">對話圖片顯示寬 高(px)</label>
                    <div style="display: flex; gap: 5px;">
                        <input type="number" id="width-input-display" placeholder="寬 (例: 125)" style="margin-bottom:0; flex:1; width:0;" min="1" oninput="value=value.replace(/[^\d]/g,'')">
                        <input type="number" id="width-input-display-h" placeholder="高 (例: 125)" style="margin-bottom:0; flex:1; width:0;" min="1" oninput="value=value.replace(/[^\d]/g,'')">
                    </div>
                </div>
                <div style="flex: 1; text-align: left;">
                    <label style="font-size:12px; color:#666; display:block; margin-bottom:5px; padding-left:5px;">實際生成寬 (px)</label>
                    <input type="number" id="width-input-actual" placeholder="例如: 500" style="margin-bottom:0;" min="1" oninput="value=value.replace(/[^\d]/g,'')">
                </div>
            </div>
            
            <div style="display: flex; gap: 10px;">
                <div style="flex: 1; text-align: left;">
                    <label style="font-size:12px; color:#666; display:block; margin-bottom:5px; padding-left:5px;">文件氣泡寬 高(px)</label>
                    <div style="display: flex; gap: 5px;">
                        <input type="number" id="width-input-file-w" placeholder="寬 (例: 220)" style="margin-bottom:0; flex:1; width:0;" min="1" oninput="value=value.replace(/[^\d]/g,'')">
                        <input type="number" id="width-input-file-h" placeholder="高 (例: 50)" style="margin-bottom:0; flex:1; width:0;" min="1" oninput="value=value.replace(/[^\d]/g,'')">
                    </div>
                </div>
                <div style="flex: 1; text-align: left;">
                    <label style="font-size:12px; color:#666; display:block; margin-bottom:5px; padding-left:5px;">上傳限制 (MB, 0為關閉)</label>
                    <input type="number" id="width-input-upload-limit" placeholder="例如: 10" style="margin-bottom:0;" step="0.1" min="0">
                </div>
            </div>

            <div style="display: flex; gap: 10px; border-top: 1px dashed #ccc; padding-top: 10px; margin-top: 5px;">
                <div style="flex: 1; text-align: left;">
                    <label style="font-size:12px; color:#666; display:block; margin-bottom:5px; padding-left:5px;">切片大小 (MB, 0為關閉)</label>
                    <input type="number" id="width-input-chunk-size" placeholder="例如: 2" style="margin-bottom:0;" step="0.1" min="0">
                </div>
                <div style="flex: 1; text-align: left;">
                    <label style="font-size:12px; color:#666; display:block; margin-bottom:5px; padding-left:5px;">头像压缩宽 (px)</label>
                    <input type="number" id="width-input-avatar" placeholder="例如: 200" style="margin-bottom:0;" min="1" oninput="value=value.replace(/[^\d]/g,'')">
                </div>
            </div>
            
            <div style="display: flex; gap: 10px; border-top: 1px dashed #ccc; padding-top: 10px; margin-top: 5px;">
                <div style="flex: 1; text-align: left;">
                    <label style="font-size:12px; color:#666; display:block; margin-bottom:5px; padding-left:5px;">大厅管理员 (多个用#分隔)</label>
                    <input type="text" id="width-input-admin-users" placeholder="例如: admin#user1" style="margin-bottom:0; width:100%; box-sizing:border-box;">
                </div>
                <div style="flex: 1; text-align: left;">
                    <label style="font-size:12px; color:#666; display:block; margin-bottom:5px; padding-left:5px;">撤回时效 (分钟, 0为关闭)</label>
                    <input type="number" id="width-input-recall-time" placeholder="例如: 3" style="margin-bottom:0; width:100%; box-sizing:border-box;" min="0" oninput="value=value.replace(/[^\d]/g,'')">
                </div>
            </div>
        </div>
        <div class="modal-btns">
            <button class="btn-cancel" onclick="closeWidthModal()">取消</button>
            <button class="btn-confirm" onclick="saveWidthConfig()">確定</button>
        </div>
    </div>
</div>

<div id="smtp-modal" class="modal-overlay">
    <div class="modal-box">
        <div class="modal-close" onclick="document.getElementById('smtp-modal').style.display='none'">×</div>
        <h4 style="margin-bottom:20px;">SMTP 發信配置</h4>
        <form id="smtp-form" onsubmit="event.preventDefault();" style="display:flex; flex-direction:column; text-align:left;">
            <input type="text" id="smtp_host" placeholder="輸入 smtp服務器地址">
            <input type="text" id="smtp_port" placeholder="輸入 端口">
            <input type="text" id="smtp_user" placeholder="輸入 賬號">
            <input type="text" id="smtp_pass" placeholder="輸入 密碼">
            <select id="smtp_crypto"><option value="ssl">SSL</option><option value="tls">TLS</option><option value="none">無加密</option></select>
            <input type="text" id="smtp_from" placeholder="輸入 發件地址">
            <input type="text" id="smtp_from_name" placeholder="輸入 發件名稱">
            <hr style="border:none; border-top:1px dashed #ddd; margin:10px 0;">
            <input type="text" id="smtp_test_email" placeholder="輸入 測試收件郵箱">
            <textarea id="smtp_test_msg" rows="3" placeholder="這是一封來自管理系統的測試郵件。當您看到此內容，說明您的 SMTP 發信配置已成功生效！"></textarea>
            <div class="modal-btns" style="margin-top:15px;">
                <button type="button" class="btn-outline-primary" onclick="testSmtp()">發信測試</button>
                <button type="button" class="btn-confirm" onclick="saveSmtp()">保存設置</button>
            </div>
        </form>
    </div>
</div>

<div id="pwd-modal" class="modal-overlay">
    <div class="modal-box">
        <div class="modal-close" onclick="closePwdModal()">×</div>
        <h4 style="margin-bottom:20px;">修改密码</h4>
        <form id="pwd-form" onsubmit="event.preventDefault();" style="display:flex; flex-direction:column; text-align:left; gap:12px;">
            <div class="pwd-input-wrapper">
                <input type="password" id="old_pwd" placeholder="输入旧密码" class="pwd-input">
                <span class="pwd-toggle" onclick="togglePwdVis('old_pwd', this)"><svg viewBox="0 0 24 24"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg></span>
            </div>
            <div class="pwd-input-wrapper">
                <input type="password" id="new_pwd" placeholder="输入新密码" class="pwd-input">
                <span class="pwd-toggle" onclick="togglePwdVis('new_pwd', this)"><svg viewBox="0 0 24 24"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg></span>
            </div>
            <div class="pwd-input-wrapper">
                <input type="password" id="confirm_pwd" placeholder="确认新密码" class="pwd-input">
                <span class="pwd-toggle" onclick="togglePwdVis('confirm_pwd', this)"><svg viewBox="0 0 24 24"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg></span>
            </div>
            <div class="modal-btns" style="margin-top:15px;">
                <button type="button" class="btn-cancel" onclick="closePwdModal()">取消</button>
                <button type="button" class="btn-confirm" onclick="savePwd()">确定修改</button>
            </div>
        </form>
    </div>
</div>

<div id="media-modal">
    <div id="media-close-btn" onclick="closeMediaModal(); event.stopPropagation();">×</div>
    <div id="media-prev-btn" class="media-nav-btn" onclick="executeMediaSwipe(-1); event.stopPropagation();">&#10094;</div>
    <div id="media-next-btn" class="media-nav-btn" onclick="executeMediaSwipe(1); event.stopPropagation();">&#10095;</div>
    <div id="media-modal-content"></div>
    <div id="btn-load-original">加載原圖</div>
</div>

<div id="file-modal" class="modal-overlay">
    <div class="modal-box" style="width: 90%; max-width: 450px; max-height: 80vh; display: flex; flex-direction: column; padding: 20px;">
        <div class="modal-close" onclick="closeFileModal()">×</div>
        <h4 style="margin-bottom:15px; flex-shrink: 0;">附件文件管理</h4>
        <div id="file-list-container" class="scroll-v" style="flex: 1; text-align: left; margin-bottom: 15px;"></div>
        <div class="modal-btns" style="flex-shrink: 0;">
            <button class="btn-cancel" onclick="closeFileModal()" style="width: 100%;">关闭</button>
        </div>
    </div>
</div>

<script src="admin.js?v=<?php echo filemtime(__DIR__ . '/admin.js'); ?>"></script>
</body>
</html>
