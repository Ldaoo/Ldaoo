<?php
ini_set('session.gc_maxlifetime', 7 * 86400);
session_set_cookie_params(7 * 86400, '/');
session_start(); 

// ==========================================
// [新增] 方案一：强制禁止主页面缓存
// 确保浏览器每次都拉取最新生成的 HTML，使底部的 CSS/JS 时间戳绝对生效
// ==========================================
header("Cache-Control: no-store, no-cache, must-revalidate, max-age=0");
header("Cache-Control: post-check=0, pre-check=0", false);
header("Pragma: no-cache");
header("Expires: 0");
// ==========================================

$dbPath = __DIR__ . '/storage/data.sqlite';
if (!file_exists($dbPath) || filesize($dbPath) === 0) {
    header("Location: install.php");
    exit;
}

try {
    $pdo = new PDO('sqlite:' . $dbPath);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_TIMEOUT, 5);
    try { $pdo->exec("PRAGMA journal_mode = WAL;"); } catch (Exception $e) {}
} catch (PDOException $e) { 
    header("Location: install.php");
    exit; 
}

// ======== 1. 鉴权与退出逻辑 ========
if (isset($_GET['action']) && $_GET['action'] == 'logout') {
    $currentUser = $_SESSION['username'] ?? '';
    $token = $_COOKIE['remember_token'] ?? '';
    
    if (empty($currentUser) && $token) {
        try {
            $stmt = $pdo->prepare("SELECT username FROM users WHERE remember_token = ?");
            $stmt->execute([$token]);
            $currentUser = $stmt->fetchColumn();
        } catch (Exception $e) {}
    }

    if ($currentUser && $currentUser !== '访客') {
        try { $pdo->prepare("UPDATE users SET remember_token = NULL WHERE username = ?")->execute([$currentUser]);
        } catch (Exception $e) {}
    }
    
    if (session_status() === PHP_SESSION_NONE) { @session_start();
    }
    $_SESSION = array();
    @session_destroy(); 
    
    setcookie('remember_token', '', time() - 3600, "/"); 
    setcookie('remember_user', '', time() - 3600, "/");
    header("Location: index.php"); 
    exit;
}

$loginUser = $_SESSION['username'] ?? '';

if (empty($loginUser) && !empty($_COOKIE['remember_token'])) {
    $token = $_COOKIE['remember_token'];
    try {
        $stmt = $pdo->prepare("SELECT username FROM users WHERE remember_token = ?");
        $stmt->execute([$token]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if ($row) {
            $loginUser = $row['username'];
            $_SESSION['username'] = $loginUser;
            setcookie('remember_token', $token, time() + 7 * 86400, '/');
        } else {
            setcookie('remember_token', '', time() - 3600, '/');
        }
    } catch (Exception $e) {}
}

if (empty($loginUser)) {
    $loginUser = $_COOKIE['remember_user'] ?? '访客';
}

if (empty($loginUser) || $loginUser === '访客') { header("Location: index.php"); exit; }
$_SESSION['username'] = $loginUser;

session_write_close();
$pdo->prepare("UPDATE users SET last_active = CURRENT_TIMESTAMP WHERE username = ?")->execute([$loginUser]);
$stmt = $pdo->prepare("SELECT id, avatar, email, signature, lobby_read_count FROM users WHERE username = ?");
$stmt->execute([$loginUser]);
$myUserRow = $stmt->fetch(PDO::FETCH_ASSOC);
if (!$myUserRow) {
    if (session_status() === PHP_SESSION_NONE) { @session_start(); }
    $_SESSION = array();
    @session_destroy();
    setcookie('remember_token', '', time() - 3600, "/");
    setcookie('remember_user', '', time() - 3600, "/");
    header("Location: index.php"); exit;
}

// 动态生成首字母默认头像
$myFirstChar = mb_substr($loginUser, 0, 1, 'UTF-8');
$mySvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#085A48"/><text x="50%" y="54%" font-family="system-ui, -apple-system, sans-serif" font-size="50" font-weight="bold" fill="#ffffff" text-anchor="middle" dominant-baseline="middle">' .
htmlspecialchars($myFirstChar) . '</text></svg>';
$defaultMyAvatar = 'data:image/svg+xml;base64,' . base64_encode($mySvg);

$myAvatar = $myUserRow['avatar'] ?: $defaultMyAvatar;
$myEmail = $myUserRow['email'] ?? '';
$mySignature = $myUserRow['signature'] ?? '';
$stmt = $pdo->query("SELECT key_value FROM configs WHERE key_name = 'admin_username'");
$adminUsernameRaw = $stmt->fetchColumn();
if ($adminUsernameRaw === false) {
    $adminUsernameRaw = 'admin'; 
}
$adminUserList = array_filter(array_map('trim', explode('#', $adminUsernameRaw)));
$isAdmin = in_array($loginUser, $adminUserList);
// ======== 2. 合并的 API 接口集 ========

if (isset($_GET['action']) && $_GET['action'] == 'get_counts') {
    header('Content-Type: application/json');
    $lobbyTotal = $pdo->query("SELECT COUNT(*) FROM messages WHERE receiver = 'all'")->fetchColumn();
    $privateUnread = [];
    $stmt = $pdo->prepare("SELECT sender, COUNT(*) as count FROM messages WHERE receiver = ? AND is_read = 0 GROUP BY sender");
    $stmt->execute([$loginUser]);
    while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) { $privateUnread[$row['sender']] = (int)$row['count']; }

    $users = [];
    $sql = "SELECT u.username, u.avatar, u.signature, MAX(m.created_at) as last_msg_time 
            FROM users u LEFT JOIN messages m ON (m.sender = u.username AND m.receiver = :me) OR (m.sender = :me AND m.receiver = u.username)
            WHERE u.username != :me AND u.role != 'admin' GROUP BY u.username ORDER BY last_msg_time DESC, u.username ASC";
    $stmt = $pdo->prepare($sql); $stmt->execute(['me' => $loginUser]);
    while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
        $users[] = [
            'name' => $row['username'], 
            'displayName' => $row['username'],
            'avatar' => $row['avatar'], 
            'signature' => $row['signature'] ?: '这个人很懒，什么都没写~',
            'firstChar' => mb_substr($row['username'], 0, 1, 'UTF-8'), 
            'lastTime' => $row['last_msg_time'] ? strtotime($row['last_msg_time']) : 0,
            'isGroup' => false
        ];
    }
    
    $groupTotals = [];
    $stmt = $pdo->prepare("SELECT g.id, g.name, g.creator FROM chat_groups g JOIN chat_group_members m ON g.id = m.group_id WHERE m.username = ?");
    $stmt->execute([$loginUser]);
    while ($r = $stmt->fetch(PDO::FETCH_ASSOC)) {
        $gidStr = 'g_' . $r['id'];
        $msgCount = $pdo->prepare("SELECT COUNT(*) FROM messages WHERE receiver = ?")->execute([$gidStr]) ?
        $pdo->query("SELECT COUNT(*) FROM messages WHERE receiver = '$gidStr'")->fetchColumn() : 0;
        $lastMsgTime = $pdo->query("SELECT MAX(created_at) FROM messages WHERE receiver = '$gidStr'")->fetchColumn();
        $avStmt = $pdo->prepare("SELECT u.avatar, u.username FROM chat_group_members m JOIN users u ON m.username = u.username WHERE m.group_id = ? ORDER BY CASE WHEN u.username = (SELECT creator FROM chat_groups WHERE id = m.group_id) THEN 0 ELSE 1 END, m.rowid ASC LIMIT 4");
        $avStmt->execute([$r['id']]);
        $groupAvatars = [];
        while ($avRow = $avStmt->fetch(PDO::FETCH_ASSOC)) {
            if ($avRow['avatar']) {
                $groupAvatars[] = ['type' => 'img', 'src' => $avRow['avatar']];
            } else {
                $groupAvatars[] = ['type' => 'text', 'text' => mb_substr($avRow['username'], 0, 1, 'UTF-8')];
            }
        }
        
        $users[] = [
            'name' => $gidStr,
            'displayName' => $r['name'],
            'groupAvatars' => $groupAvatars, 
            'signature' => '群聊',
            'firstChar' => '👥',
            'lastTime' => $lastMsgTime ? strtotime($lastMsgTime . ' UTC') * 1000 : 0,
            'isGroup' => true,
            'creator' => $r['creator']
        ];
        $groupTotals[$gidStr] = (int)$msgCount;
    }

    $notice = "";
    try { $notice = $pdo->query("SELECT key_value FROM configs WHERE key_name = 'global_notice'")->fetchColumn() ?: "";
    } catch (Exception $e) {}
    $avWidth = $pdo->query("SELECT key_value FROM configs WHERE key_name = 'avatar_max_width'")->fetchColumn() ?: 200;
    $lobbyReadCount = (int)($myUserRow['lobby_read_count'] ?? 0);
    
    echo json_encode(['lobby' => (int)$lobbyTotal, 'lobbyRead' => $lobbyReadCount, 'privateUnread' => $privateUnread, 'groupTotals' => $groupTotals, 'userList' => $users, 'notice' => $notice, 'avatar_width' => $avWidth]);
    exit;
}

if (isset($_GET['action']) && $_GET['action'] == 'update_lobby_read') {
    $count = isset($_GET['count']) ?
    (int)$_GET['count'] : $pdo->query("SELECT COUNT(*) FROM messages WHERE receiver = 'all'")->fetchColumn();
    $pdo->prepare("UPDATE users SET lobby_read_count = ? WHERE username = ?")->execute([$count, $loginUser]);
    echo json_encode(['status' => 'success']);
    exit;
}

if (isset($_GET['action']) && $_GET['action'] === 'url_meta') {
    header('Content-Type: application/json');
    $url = $_GET['url'] ?? '';
    if (!filter_var($url, FILTER_VALIDATE_URL)) {
        echo json_encode(['title' => '未知網頁', 'desc' => '無效的鏈接']); exit;
    }
    
    $context = stream_context_create([
        'http' => ['timeout' => 2, 'user_agent' => 'Mozilla/5.0'],
        'ssl' => ['verify_peer' => false, 'verify_peer_name' => false]
    ]);
    $html = @file_get_contents($url, false, $context);
    $title = ''; $desc = '';
    if ($html) {
        if (preg_match('/<title[^>]*>(.*?)<\/title>/is', $html, $matches)) {
            $title = trim(strip_tags($matches[1]));
        }
        if (preg_match('/<meta[^>]*name=["\']description["\'][^>]*content=["\']([^"\']*)["\'][^>]*>/is', $html, $matches) || 
            preg_match('/<meta[^>]*property=["\']og:description["\'][^>]*content=["\']([^"\']*)["\'][^>]*>/is', $html, $matches) ||
            preg_match('/<meta[^>]*content=["\']([^"\']*)["\'][^>]*name=["\']description["\'][^>]*>/is', $html, $matches)) {
            $desc = trim($matches[1]);
        }
    }
    
    $parsed = parse_url($url);
    $domain = $parsed['host'] ?? '網頁鏈接';
    
    if (!$title) $title = $domain;
    if (!$desc) $desc = '點擊在小窗中瀏覽網頁詳細內容...';
    
    echo json_encode([
        'title' => mb_substr(html_entity_decode($title, ENT_QUOTES, 'UTF-8'), 0, 60, 'UTF-8'),
        'desc' => mb_substr(html_entity_decode($desc, ENT_QUOTES, 'UTF-8'), 0, 100, 'UTF-8')
    ]);
    exit;
}

if (isset($_GET['action']) && $_GET['action'] == 'create_group') {
    if (!$isAdmin) exit(json_encode(['status'=>'error', 'msg'=>'无权限']));
    $name = trim($_POST['name'] ?? '');
    $members = json_decode($_POST['members'] ?? '[]');
    if (empty($name) || empty($members)) exit(json_encode(['status'=>'error', 'msg'=>'参数错误']));
    $pdo->prepare("INSERT INTO chat_groups (name, creator) VALUES (?, ?)")->execute([$name, $loginUser]);
    $gid = $pdo->lastInsertId();
    
    $members = array_unique($members);
    $members = array_values(array_diff($members, [$loginUser]));
    array_unshift($members, $loginUser); 
    
    $stmt = $pdo->prepare("INSERT INTO chat_group_members (group_id, username) VALUES (?, ?)");
    foreach($members as $m) { $stmt->execute([$gid, $m]);
    }
    
    exit(json_encode(['status'=>'success']));
}

if (isset($_GET['action']) && $_GET['action'] == 'get_group_members') {
    $gid = str_replace('g_', '', $_GET['id']);
    $stmtCreator = $pdo->prepare("SELECT creator FROM chat_groups WHERE id = ?");
    $stmtCreator->execute([$gid]);
    $creator = $stmtCreator->fetchColumn();
    $stmt = $pdo->prepare("SELECT u.username, u.avatar, u.signature FROM chat_group_members m JOIN users u ON m.username = u.username WHERE m.group_id = ? ORDER BY CASE WHEN u.username = ? THEN 0 ELSE 1 END, m.rowid ASC");
    $stmt->execute([$gid, $creator]);
    $res = [];
    while($r = $stmt->fetch(PDO::FETCH_ASSOC)) { $res[] = $r;
    }
    
    exit(json_encode(['members' => $res, 'creator' => $creator]));
}

if (isset($_GET['action']) && $_GET['action'] == 'update_group_members') {
    $gid = str_replace('g_', '', $_POST['group_id']);
    $members = json_decode($_POST['members'] ?? '[]');
    $stmt = $pdo->prepare("SELECT creator FROM chat_groups WHERE id = ?");
    $stmt->execute([$gid]);
    $creator = $stmt->fetchColumn();
    if ($creator !== $loginUser && !$isAdmin) { exit(json_encode(['status'=>'error', 'msg'=>'无权限'])); }
    
    $pdo->prepare("DELETE FROM chat_group_members WHERE group_id = ?")->execute([$gid]);
    $members = array_unique($members);
    $members = array_values(array_diff($members, [$creator]));
    array_unshift($members, $creator); 
    
    $stmt = $pdo->prepare("INSERT INTO chat_group_members (group_id, username) VALUES (?, ?)");
    foreach($members as $m) { $stmt->execute([$gid, $m]); }
    
    exit(json_encode(['status'=>'success']));
}

if (isset($_GET['action']) && $_GET['action'] == 'leave_group') {
    $gid = str_replace('g_', '', $_GET['id']);
    $pdo->prepare("DELETE FROM chat_group_members WHERE group_id = ? AND username = ?")->execute([$gid, $loginUser]);
    exit(json_encode(['status'=>'success']));
}

if (isset($_GET['action']) && $_GET['action'] == 'disband_group') {
    $gid = str_replace('g_', '', $_GET['id']);
    $stmt = $pdo->prepare("SELECT creator FROM chat_groups WHERE id = ?");
    $stmt->execute([$gid]);
    $creator = $stmt->fetchColumn();
    if ($creator === $loginUser || $isAdmin) {
        $pdo->prepare("DELETE FROM chat_groups WHERE id = ?")->execute([$gid]);
        $pdo->prepare("DELETE FROM chat_group_members WHERE group_id = ?")->execute([$gid]);
        exit(json_encode(['status'=>'success']));
    }
    exit(json_encode(['status'=>'error']));
}

if (isset($_GET['action']) && $_GET['action'] == 'save_profile') {
    $newSign = isset($_POST['signature']) ? trim($_POST['signature']) : null;
    $newEmail = isset($_POST['email']) ? trim($_POST['email']) : null;
    
    $oldPass = trim($_POST['old_password'] ?? '');
    $newPass = trim($_POST['password'] ?? '');
    $avatarData = $_POST['avatar'] ?? '';

    $updates = []; $params = [];
    $pwdChanged = false;
    if ($newSign !== null) { $updates[] = "signature = ?"; $params[] = $newSign;
    }
    if ($newEmail !== null) { $updates[] = "email = ?"; $params[] = $newEmail;
    }
    
    // ======== 核心修復區塊：強制雙向非空校驗 ========
    if ($oldPass !== '' || $newPass !== '') { 
        if ($oldPass === '') {
            echo json_encode(['status' => 'error', 'msg' => '验证失败：必须输入旧密码！']);
            exit;
        }
        if ($newPass === '') {
            echo json_encode(['status' => 'error', 'msg' => '验证失败：新密码不能为空！']);
            exit;
        }

        $stmt = $pdo->prepare("SELECT password FROM users WHERE username = ?");
        $stmt->execute([$loginUser]);
        $dbHash = $stmt->fetchColumn();

        if (!password_verify($oldPass, $dbHash) && md5($oldPass) !== $dbHash && $oldPass !== $dbHash) {
            echo json_encode(['status' => 'error', 'msg' => '验证失败：旧密码不正确！']);
            exit;
        }

        $updates[] = "password = ?"; 
        $params[] = password_hash($newPass, PASSWORD_DEFAULT);
        $updates[] = "remember_token = NULL"; 
        $pwdChanged = true;
    }
    // ===============================================
    
    $newAvatarUrl = '';
    if ($avatarData && preg_match('/^data:image\/(\w+);base64,/', $avatarData)) {
        $oldAvatar = $myUserRow['avatar'] ?? '';
        if ($oldAvatar && (strpos($oldAvatar, 'storage/files/') === 0 || strpos($oldAvatar, 'msg/') === 0) && file_exists(__DIR__ . '/' . $oldAvatar)) {
            @unlink(__DIR__ . '/' . $oldAvatar);
        }

        $data = substr($avatarData, strpos($avatarData, ',') + 1);
        $data = base64_decode($data);
        $avatarName = 'avatar_' . md5($loginUser . time()) . '.jpg'; 
        $dir = __DIR__ . '/msg/';
        if (!is_dir($dir)) @mkdir($dir, 0777, true);
        file_put_contents($dir . $avatarName, $data);
        $updates[] = "avatar = ?";
        $params[] = 'msg/' . $avatarName;
        $newAvatarUrl = 'msg/' . $avatarName;
    }
    
    if (count($updates) > 0) {
        $params[] = $loginUser;
        $sql = "UPDATE users SET " . implode(', ', $updates) . " WHERE username = ?";
        $pdo->prepare($sql)->execute($params);
    }
    
    if ($pwdChanged) {
        if (session_status() === PHP_SESSION_NONE) { @session_start();
        }
        $_SESSION = array();
        @session_destroy();
        setcookie('remember_token', '', time() - 3600, "/");
        setcookie('remember_user', '', time() - 3600, "/");
        echo json_encode(['status' => 'success', 'pwd_changed' => true]); 
        exit;
    }

    echo json_encode(['status' => 'success', 'avatar' => $newAvatarUrl]); exit;
}

if (isset($_GET['action']) && $_GET['action'] === 'get_configs') {
    header('Content-Type: application/json');
    $configs = [];
    $stmt = $pdo->query("SELECT key_name, key_value FROM configs");
    while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) { $configs[$row['key_name']] = $row['key_value'];
    }
    echo json_encode($configs); exit;
}

if (isset($_GET['action']) && $_GET['action'] === 'upload_avatar') {
    $user = $_POST['username'] ?? '';
    if ($user !== $loginUser) { echo json_encode(['status' => 'error', 'msg' => '权限错误']); exit;
    }
    if (!isset($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) { echo json_encode(['status' => 'error', 'msg' => '上传失败']); exit;
    }

    $file = $_FILES['file'];
    $mime = $file['type'];
    if (strpos($mime, 'image/') !== 0) { echo json_encode(['status' => 'error', 'msg' => '仅支持图片']); exit;
    }

    $ext = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
    $allowedExts = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
    if (!in_array($ext, $allowedExts)) { $ext = 'jpg'; } 
    
    $stmt = $pdo->prepare("SELECT avatar FROM users WHERE username = ?");
    $stmt->execute([$loginUser]);
    $oldAvatar = $stmt->fetchColumn();
    if ($oldAvatar && (strpos($oldAvatar, 'storage/files/') === 0 || strpos($oldAvatar, 'msg/') === 0) && file_exists(__DIR__ . '/' . $oldAvatar)) {
        @unlink(__DIR__ . '/' . $oldAvatar);
    }

    $filename = 'avatar_' . md5($loginUser . time()) . '.' . $ext;
    $dir = __DIR__ . '/msg/';
    if (!is_dir($dir)) mkdir($dir, 0777, true);
    
    $filepath = 'msg/' . $filename;
    move_uploaded_file($file['tmp_name'], __DIR__ . '/' . $filepath);
    $stmt = $pdo->prepare("UPDATE users SET avatar = ? WHERE username = ?");
    $stmt->execute([$filepath, $loginUser]);
    echo json_encode(['status' => 'success', 'url' => $filepath]); exit;
}

if (isset($_GET['action']) && $_GET['action'] === 'upload') {
    set_time_limit(0);
    $stmt = $pdo->query("SELECT key_value FROM configs WHERE key_name = 'upload_size_limit'");
    $ul = floatval($stmt->fetchColumn() ?: 0);
    
    $originalFileNameCheck = $_POST['fileName'] ?? ($_FILES['file']['name'] ?? 'unknown');
    $isVoiceUpload = (strpos($originalFileNameCheck, 'voice_') === 0 && strtolower(pathinfo($originalFileNameCheck, PATHINFO_EXTENSION)) === 'mp3');
    if (!$isAdmin) {
        if ($ul == 0 && !$isVoiceUpload) { echo json_encode(['status' => 'error', 'msg' => '上传已被管理员关闭']);
            exit; }
        if ($ul == 0 && $isVoiceUpload && isset($_FILES['file']) && $_FILES['file']['size'] > 5 * 1024 * 1024) { echo json_encode(['status' => 'error', 'msg' => '语音文件过大 (限制5MB内)']);
            exit; }
        
        if ($ul > 0 && isset($_FILES['file']) && ($_POST['action_type'] ?? '') !== 'chunk') {
            if ($_FILES['file']['size'] > $ul * 1024 * 1024) { echo json_encode(['status' => 'error', 'msg' => "文件大小超过限制: {$ul}MB"]);
                exit; }
        }
    }
    
    $isChunk = ($_POST['action_type'] ?? '') === 'chunk';
    $isMerge = ($_POST['action_type'] ?? '') === 'merge';

    $dir = __DIR__ . '/storage/files/';
    if (!is_dir($dir)) mkdir($dir, 0777, true);
    if ($isChunk) {
        $fileId = preg_replace('/[^a-zA-Z0-9_]/', '', $_POST['fileId']);
        $chunkIndex = (int)$_POST['chunkIndex'];
        move_uploaded_file($_FILES['file']['tmp_name'], $dir . 'chunk_' . $fileId . '_' . $chunkIndex);
        echo json_encode(['status' => 'chunk_success']);
        exit;
    }

    $user = $_POST['username'] ?? '访客';
    $to = $_POST['to'] ?? 'all';
    $thumbData = $_POST['thumb'] ?? '';
    $originalFileName = $_POST['fileName'] ?? ($_FILES['file']['name'] ?? 'unknown');
    $ext = strtolower(pathinfo($originalFileName, PATHINFO_EXTENSION));
    
    $filename = time() . '_' . rand(1000, 9999) . ($ext === '' ? '' : '.' . $ext);
    $filepath = 'storage/files/' . $filename;
    if ($isMerge) {
        $fileId = preg_replace('/[^a-zA-Z0-9_]/', '', $_POST['fileId']);
        $totalChunks = (int)$_POST['totalChunks'];
        $out = fopen(__DIR__ . '/' . $filepath, 'wb');
        for ($i = 0; $i < $totalChunks; $i++) {
            $chunkPath = $dir . 'chunk_' . $fileId . '_' . $i;
            if (file_exists($chunkPath)) {
                $in = fopen($chunkPath, 'rb');
                stream_copy_to_stream($in, $out); fclose($in); unlink($chunkPath);
            }
        }
        fclose($out);
    } else {
        if (!isset($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) { echo json_encode(['status' => 'error']);
            exit; }
        move_uploaded_file($_FILES['file']['tmp_name'], __DIR__ . '/' . $filepath);
    }

    $mime = mime_content_type(__DIR__ . '/' . $filepath) ?: 'application/octet-stream';
    $configs = [];
    $stmt = $pdo->query("SELECT key_name, key_value FROM configs");
    while ($r = $stmt->fetch(PDO::FETCH_ASSOC)) { $configs[$r['key_name']] = $r['key_value'];
    }

    $isVideo = (strpos($mime, 'video/') === 0 || $ext === 'mov' || $ext === 'mp4');
    if ($isVideo) {
        $isMov = ($ext === 'mov');
        $compressVideo = ($configs['compress_video'] ?? '0') === '1';
        $actualSize = filesize(__DIR__ . '/' . $filepath);
        if ($actualSize > 50 * 1024 * 1024) { $compressVideo = false; $isMov = false;
        }
        
        if ($compressVideo || $isMov) {
            $vMaxWidth = intval($configs['video_max_width'] ?? 720);
            $newFilename = pathinfo($filename, PATHINFO_FILENAME) . '.mp4';
            $compPath = 'storage/files/comp_' . $newFilename;
            if ($compressVideo) {
                $cmd = "ffmpeg -y -i " . escapeshellarg(__DIR__ . '/' . $filepath) . " -vf \"scale='min($vMaxWidth,iw)':-2\" -c:v libx264 -preset ultrafast -crf 28 -c:a aac -b:a 128k -movflags +faststart " . escapeshellarg(__DIR__ . '/' . $compPath) . " 2>&1";
            } else {
                $cmd = "ffmpeg -y -i " . escapeshellarg(__DIR__ . '/' . $filepath) . " -c:v libx264 -preset ultrafast -crf 28 -c:a aac -b:a 128k -movflags +faststart " . escapeshellarg(__DIR__ . '/' . $compPath) . " 2>&1";
            }
            
            @shell_exec($cmd);
            if (file_exists(__DIR__ . '/' . $compPath) && filesize(__DIR__ . '/' . $compPath) > 0) {
                @unlink(__DIR__ . '/' . $filepath);
                $filepath = $compPath; $filename = 'comp_' . $newFilename; $ext = 'mp4';
            }
        }
    }

    $size = filesize(__DIR__ . '/' . $filepath);
    $sizeStr = $size > 1048576 ? round($size/1048576, 1).'MB' : round($size/1024).'KB';

    $thumbPath = '';
    if ($thumbData && preg_match('/^data:image\/(\w+);base64,/', $thumbData)) {
        $data = substr($thumbData, strpos($thumbData, ',') + 1);
        $data = base64_decode($data);
        $thumbName = 'thumb_' . time() . '_' . rand(1000, 9999) . '.jpg';
        file_put_contents(__DIR__ . '/storage/files/' . $thumbName, $data);
        $thumbPath = 'storage/files/' . $thumbName;
    }

    if (strpos($mime, 'image/') === 0) {
        $type = 'image';
        $t = $thumbPath ? $thumbPath : $filepath;
        $content = '<div class="media-container"><img src="'.$t.'" data-original="'.$filepath.'" data-size="'.$sizeStr.'" class="media-thumb"><a href="'.$filepath.'" download="'.htmlspecialchars($originalFileName).'" class="dl-btn-overlay" onclick="event.stopPropagation();">下载('.$sizeStr.')</a></div>';
    } elseif (strpos($mime, 'video/') === 0 || $ext === 'mp4') {
        $type = 'video';
        $t = $thumbPath ? $thumbPath : 'storage/default_video.png'; 
        $content = '<div class="video-wrapper"><img src="'.$t.'" data-video="'.$filepath.'" class="media-thumb"><div class="play-overlay"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></div><a href="'.$filepath.'" download="'.htmlspecialchars($originalFileName).'" class="dl-btn-overlay" onclick="event.stopPropagation();">下载('.$sizeStr.')</a></div>';
    } elseif (strpos($mime, 'audio/') === 0 || substr($filename, -3) === 'mp3') {
        $type = 'audio';
        $content = '<audio src="'.$filepath.'" controls></audio>';
    } else {
        $type = 'file';
        $extUpper = strtoupper($ext);
        if(strlen($extUpper) > 4 || empty($extUpper)) $extUpper = 'FILE';
        $content = '<a href="'.$filepath.'" download="'.htmlspecialchars($originalFileName).'" class="file-card-inner" style="background-color: rgba(0, 0, 0, 0.1);">
            <div style="width: 32px; height: 32px; background: #F2F5F8; border-radius: 6px; border: 1px solid #E8ECEF; display: flex; flex-direction: column; align-items: center; justify-content: center; flex-shrink: 0;">
                <svg viewBox="0 0 24 24" style="width: 14px; height: 14px; fill: none; stroke: #555; stroke-width: 2;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                <span style="font-size: 8px; font-weight: bold; margin-top: 1px; color: #E67E22;">'.$extUpper.'</span>
            </div>
            <div style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px;">
                <div style="font-size: 13px; font-weight: bold; color: #333; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">'.htmlspecialchars($originalFileName).'</div>
                <div style="display: flex; flex-direction: column; gap: 4px; margin-top: 2px;">
                    <span style="font-size: 10px; color: #999;">'.$extUpper.' 文件</span>
                    <span style="background: #666; color: #fff; font-size: 9px; padding: 2px 6px; border-radius: 8px; align-self: flex-end;">下载('.$sizeStr.')</span>
                </div>
            </div>
        </a>';
    }

    $stmt = $pdo->prepare("INSERT INTO messages (sender, receiver, content, type) VALUES (?, ?, ?, ?)");
    $stmt->execute([$user, $to, $content, $type]);

    if ($to === 'all') {
        $newTotal = $pdo->query("SELECT COUNT(*) FROM messages WHERE receiver = 'all'")->fetchColumn();
        $pdo->prepare("UPDATE users SET lobby_read_count = ? WHERE username = ?")->execute([$newTotal, $user]);
    }

    echo json_encode(['status' => 'success']); exit;
}

if (isset($_GET['action']) && $_GET['action'] === 'send') {
    $to = $_GET['to'] ?? 'all';
    $msg = trim($_POST['message'] ?? '');
    if ($msg !== '') {
        $stmt = $pdo->prepare("INSERT INTO messages (sender, receiver, content, type) VALUES (?, ?, ?, 'text')");
        $stmt->execute([$loginUser, $to, $msg]);
        
        if ($to === 'all') {
            $newTotal = $pdo->query("SELECT COUNT(*) FROM messages WHERE receiver = 'all'")->fetchColumn();
            $pdo->prepare("UPDATE users SET lobby_read_count = ? WHERE username = ?")->execute([$newTotal, $loginUser]);
        }

        echo json_encode(['status' => 'success']);
    }
    exit;
}

// ==== 消息撤回 API ====
if (isset($_GET['action']) && $_GET['action'] === 'recall') {
    $msgId = (int)($_POST['msg_id'] ?? 0);
    // 获取后台配置的撤回时间
    $recallTimeConf = $pdo->query("SELECT key_value FROM configs WHERE key_name = 'recall_time'")->fetchColumn();
    $recallTime = $recallTimeConf !== false ? (int)$recallTimeConf : 3; // 默认为3分钟

    if ($recallTime <= 0) {
        echo json_encode(['status' => 'error', 'msg' => '管理员已禁用消息撤回功能']);
        exit;
    }

    // 查询消息的发送时间和发送者
    $stmt = $pdo->prepare("SELECT created_at FROM messages WHERE id = ? AND sender = ?");
    $stmt->execute([$msgId, $loginUser]);
    $msgTime = $stmt->fetchColumn();

    if ($msgTime) {
        // 限制撤回时间
        $timeDiff = time() - strtotime($msgTime . ' UTC');
        if ($timeDiff <= $recallTime * 60) {
            $pdo->prepare("DELETE FROM messages WHERE id = ?")->execute([$msgId]);
            echo json_encode(['status' => 'success']);
        } else {
            echo json_encode(['status' => 'error', 'msg' => "只能撤回 {$recallTime} 分钟内的消息"]);
        }
    } else {
        echo json_encode(['status' => 'error', 'msg' => '消息不存在或无权限']);
    }
    exit;
}

if (isset($_GET['action']) && $_GET['action'] === 'clear') {
    $to = $_GET['to'] ?? 'all';
    if ($to === 'all' && !$isAdmin) { echo json_encode(['status' => 'error', 'msg' => '无权限']); exit;
    }
    
    if ($to === 'all') { 
        $pdo->exec("DELETE FROM messages WHERE receiver = 'all'");
    } elseif (strpos($to, 'g_') === 0) {
        $gid = str_replace('g_', '', $to);
        $stmt = $pdo->prepare("SELECT creator FROM chat_groups WHERE id = ?");
        $stmt->execute([$gid]);
        $creator = $stmt->fetchColumn();
        if ($creator === $loginUser || $isAdmin) {
            $pdo->prepare("DELETE FROM messages WHERE receiver = ?")->execute([$to]);
        } else {
            echo json_encode(['status' => 'error', 'msg' => '无权限']);
            exit;
        }
    } else {
        $stmt = $pdo->prepare("DELETE FROM messages WHERE (sender = ? AND receiver = ?) OR (sender = ? AND receiver = ?)");
        $stmt->execute([$loginUser, $to, $to, $loginUser]);
    }
    echo json_encode(['status' => 'success']); exit;
}

if (isset($_GET['action']) && $_GET['action'] === 'read') {
    header('Content-Type: text/html; charset=utf-8');
    $to = $_GET['to'] ?? 'all';
    $limit = isset($_GET['limit']) ? (int)$_GET['limit'] : 30;
    if ($limit > 500) $limit = 500;
    
    $usersCache = [];
    $uStmt = $pdo->query("SELECT username, avatar, signature FROM users");
    while($u = $uStmt->fetch(PDO::FETCH_ASSOC)) {
        $uFirstChar = mb_substr($u['username'], 0, 1, 'UTF-8');
        $uSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#085A48"/><text x="50%" y="54%" font-family="system-ui, -apple-system, sans-serif" font-size="50" font-weight="bold" fill="#ffffff" text-anchor="middle" dominant-baseline="middle">' .
        htmlspecialchars($uFirstChar) . '</text></svg>';
        $uDefaultAvatar = 'data:image/svg+xml;base64,' . base64_encode($uSvg);

        $usersCache[$u['username']] = [
            'avatar' => $u['avatar'] ?: $uDefaultAvatar,
            'signature' => $u['signature'] ?: '这个人很懒，什么都没写~'
        ];
    }

    if ($to === 'all') {
        $stmt = $pdo->prepare("SELECT * FROM (SELECT * FROM messages WHERE receiver = 'all' ORDER BY created_at DESC LIMIT " . $limit . ") sub ORDER BY created_at ASC");
        $stmt->execute();
    } elseif (strpos($to, 'g_') === 0) {
        $gid = str_replace('g_', '', $to);
        $grpCheck = $pdo->prepare("SELECT 1 FROM chat_groups WHERE id = ?");
        $grpCheck->execute([$gid]);
        if (!$grpCheck->fetchColumn()) {
            echo '<div id="not-found-flag" style="display:none;">1</div>';
            exit;
        }
        
        $check = $pdo->prepare("SELECT 1 FROM chat_group_members WHERE group_id = ? AND username = ?");
        $check->execute([$gid, $loginUser]);
        if (!$check->fetchColumn()) {
            echo '<div id="kicked-flag" style="display:none;">1</div>';
            exit;
        }
        
        $stmt = $pdo->prepare("SELECT * FROM (SELECT * FROM messages WHERE receiver = ? ORDER BY created_at DESC LIMIT " . $limit . ") sub ORDER BY created_at ASC");
        $stmt->execute([$to]);
    } else {
        $stmt = $pdo->prepare("SELECT * FROM (SELECT * FROM messages WHERE (sender = ? AND receiver = ?) OR (sender = ? AND receiver = ?) ORDER BY created_at DESC LIMIT " . $limit . ") sub ORDER BY created_at ASC");
        $stmt->execute([$loginUser, $to, $to, $loginUser]);
        $up = $pdo->prepare("UPDATE messages SET is_read = 1 WHERE sender = ? AND receiver = ?");
        $up->execute([$to, $loginUser]);
    }
    
    $lastTime = 0;
    while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
        $isMe = ($row['sender'] === $loginUser);
        $msgTime = strtotime($row['created_at'] . ' UTC');
        
        if (isset($usersCache[$row['sender']])) {
            $senderAvatar = $usersCache[$row['sender']]['avatar'];
        } else {
            // 如果发送者不在缓存中，动态生成首字母头像
            $sFirstChar = mb_substr($row['sender'], 0, 1, 'UTF-8');
            $sSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#085A48"/><text x="50%" y="54%" font-family="system-ui, -apple-system, sans-serif" font-size="50" font-weight="bold" fill="#ffffff" text-anchor="middle" dominant-baseline="middle">' .
            htmlspecialchars($sFirstChar) . '</text></svg>';
            $senderAvatar = 'data:image/svg+xml;base64,' . base64_encode($sSvg);
        }
        $senderSign = $usersCache[$row['sender']]['signature'] ?? '这个人很懒，什么都没写~';
        
        $safeName = htmlspecialchars($row['sender']);
        $safeAvatar = htmlspecialchars($senderAvatar);
        $safeSign = htmlspecialchars($senderSign);
        // ==== 注入 data-ts，前端用于判断是否在撤回时效内 ====
        echo '<div class="msg-container" data-id="' . $row['id'] . '" data-ts="' . ($msgTime * 1000) . '">';
        if ($lastTime == 0 || ($msgTime - $lastTime) > 600) {
            echo '<div class="chat-time-center" data-ts="' . ($msgTime * 1000) . '"></div>';
            $lastTime = $msgTime;
        }

        echo '<div class="msg-row ' . ($isMe ? 'row-me' : 'row-other') . '">';
        if (!$isMe) { echo '<img src="'.$safeAvatar.'" class="msg-avatar" data-name="'.$safeName.'" data-avatar="'.$safeAvatar.'" data-sign="'.$safeSign.'" onclick="showUserInfoModal(this)">';
        }

        echo '<div class="msg-content-wrapper">';
        if (($to === 'all' || strpos($to, 'g_') === 0) && !$isMe) { echo '<div class="msg-name">' . $safeName . '</div>';
        }

        $bubbleClass = ($row['type'] === 'text') ? ($isMe ? 'me_talk' : 'other_talk') : ($isMe ? 'me_talk no-bubble' : 'other_talk no-bubble');
        
        $displayContent = $row['content'];
        if ($row['type'] === 'text') {
            $rawText = trim($row['content']);
            // 匹配纯 URL
            if (preg_match('/^(https?:\/\/[^\s]+)$/i', $rawText, $matches)) {
                $url = $matches[1];
                $safeUrl = htmlspecialchars($url, ENT_QUOTES, 'UTF-8');
                
                // 带有复制按钮和异步抓取标记的基础卡片
                $displayContent = '<div class="link-card" data-url="'.$safeUrl.'" onclick="openIframeModal(\''.$safeUrl.'\')">
                    <div class="lc-title">🔗 加載中...</div>
                    <div class="lc-desc">正在獲取網頁資訊...</div>
                    <div class="lc-url">'.$safeUrl.'</div>
                    <button class="lc-copy-btn" onclick="copyLinkUrl(event, \''.$safeUrl.'\')">複製</button>
                </div>';
                // 移除自带的气泡背景
                $bubbleClass = $isMe ? 'me_talk no-bubble' : 'other_talk no-bubble';
            } else {
                $displayContent = nl2br(htmlspecialchars($displayContent, ENT_QUOTES, 'UTF-8'));
            }
        }
        
        if ($isMe) {
            $dotHtml = '';
            if ($to !== 'all' && strpos($to, 'g_') !== 0) {
                $isRead = (int)$row['is_read'];
                if ($isRead === 0) { $dotHtml = '<div class="status-dot dot-unread"></div>';
                }
            }
            echo '<div class="me-msg-box"><div class="' . $bubbleClass . '">' . $dotHtml . $displayContent . '</div></div>';
        } else {
            echo '<div class="' . $bubbleClass . '">' . $displayContent . '</div>';
        }

        echo '</div>';
        if ($isMe) { echo '<img src="'.$safeAvatar.'" class="msg-avatar" data-name="'.$safeName.'" data-avatar="'.$safeAvatar.'" data-sign="'.$safeSign.'" onclick="showUserInfoModal(this)">';
        }
        
        echo '</div></div>';
    }
    exit;
}

$initTarget = $_GET['to'] ?? '';
$initError = '';
if (strpos($initTarget, 'g_') === 0) {
    $checkGid = str_replace('g_', '', $initTarget);
    $grpCheck = $pdo->prepare("SELECT 1 FROM chat_groups WHERE id = ?");
    $grpCheck->execute([$checkGid]);
    $exists = $grpCheck->fetchColumn();
    
    $isMember = false;
    if ($exists) {
        $memCheck = $pdo->prepare("SELECT 1 FROM chat_group_members WHERE group_id = ? AND username = ?");
        $memCheck->execute([$checkGid, $loginUser]);
        $isMember = $memCheck->fetchColumn();
    }
    
    if (!$exists || !$isMember) {
        $initTarget = '';
        $initError = '群组不存在或您已被移出';
    }
}

$chatThumbDisplay = 125; $chatThumbDisplayH = 125; $chatThumbActual = 125; $chatFileWidth = 220; $chatFileHeight = 50;
$avatarMaxWidth = 200; $uploadSizeLimit = 0; $disableVoice = 0;
$recallTime = 3;
// 默认3分钟

$stmt = $pdo->query("SELECT key_name, key_value FROM configs WHERE key_name IN ('chat_thumb_display', 'chat_thumb_display_h', 'chat_thumb_actual', 'chat_file_width', 'chat_file_height', 'avatar_max_width', 'upload_size_limit', 'disable_voice', 'recall_time')");
while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
    if ($row['key_name'] === 'chat_thumb_display') $chatThumbDisplay = intval($row['key_value']);
    if ($row['key_name'] === 'chat_thumb_display_h') $chatThumbDisplayH = intval($row['key_value']);
    if ($row['key_name'] === 'chat_thumb_actual') $chatThumbActual = intval($row['key_value']);
    if ($row['key_name'] === 'chat_file_width') $chatFileWidth = intval($row['key_value']);
    if ($row['key_name'] === 'chat_file_height') $chatFileHeight = intval($row['key_value']);
    if ($row['key_name'] === 'avatar_max_width') $avatarMaxWidth = intval($row['key_value']);
    if ($row['key_name'] === 'upload_size_limit') $uploadSizeLimit = floatval($row['key_value']);
    if ($row['key_name'] === 'disable_voice') $disableVoice = intval($row['key_value']);
    if ($row['key_name'] === 'recall_time') $recallTime = intval($row['key_value']);
}
?>
<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta id="viewport-meta" name="viewport" content="width=device-width, initial-scale=1.0, minimum-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
<title><?php echo htmlspecialchars($initTarget ? ($initTarget === 'all' ? '公共大厅' : $initTarget) : $loginUser); ?></title>
<link rel="stylesheet" href="chat.css?v=<?php echo filemtime(__DIR__ . '/chat.css'); ?>">
<script src="https://cdnjs.cloudflare.com/ajax/libs/lamejs/1.2.1/lame.all.min.js"></script>
<style>
    :root { 
        --chat-thumb-width: <?php echo $chatThumbDisplay; ?>px; 
        --chat-thumb-height: <?php echo $chatThumbDisplayH; ?>px;
        --chat-file-width: <?php echo $chatFileWidth; ?>px;
        --chat-file-height: <?php echo $chatFileHeight; ?>px;
    }
    html, body { touch-action: manipulation; -webkit-text-size-adjust: 100%;
    }
    
    .pwd-container { position: relative; width: 100%; margin-bottom: 10px;
    }
    .pwd-container input { padding-right: 40px !important; margin-bottom: 0 !important; width: 100%; box-sizing: border-box;
    }
    .eye-btn {
        position: absolute; right: 8px; top: 50%;
        transform: translateY(-50%); width: 30px; height: 30px;
        display: flex; align-items: center; justify-content: center; cursor: pointer; border-radius: 50%;
        transition: background 0.2s;
        color: #5f6368; user-select: none;
    }
    .eye-btn:hover { background: rgba(0,0,0,0.05); }
    .eye-btn.active { color: #085A48;
    }
    .eye-btn svg { width: 20px; height: 20px; fill: currentColor;
    }

    .msg-row.row-other { display: flex; align-items: flex-start !important; }
    .row-other .msg-content-wrapper { display: flex;
        flex-direction: column; align-items: flex-start; margin-top: -2px; }
    .msg-name { font-size: 12px; color: #888888; line-height: 1; margin-bottom: 4px; margin-left: 2px; }

    .record-btn {
        flex: 1; height: 40px; margin: 0 8px; border-radius: 6px; background: #085A48; font-size: 15px; font-weight: bold;
        color: #fff; display: flex; align-items: center; justify-content: center; user-select: none;
        -webkit-user-select: none; -webkit-touch-callout: none; touch-action: none; cursor: pointer; transition: background 0.2s;
    }
    .record-btn.active { background: #064033; color: #fff;
    }
</style>
</head>
<body>
<div id="toast-container"></div>

<div id="app-wrapper">
    <div id="view-list" class="view-panel" style="display: <?php echo $initTarget ? 'none' : 'flex'; ?>;">
        <div id="list-header">
            <div style="display:flex; align-items:center; gap:10px; flex:1; min-width:0; margin-right: 15px;">
                <img src="<?php echo $myAvatar; ?>" onclick="openProfile()" style="cursor:pointer; width:50px; height:50px; border-radius:50%; object-fit:cover; background:#fff; border:1px solid rgba(255,255,255,0.5); flex-shrink: 0;" title="点击修改个人资料">
                <div style="display: flex; flex-direction: column; overflow: hidden; min-width: 0;">
                    <div style="font-size:16px; font-weight:bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">(<?php echo htmlspecialchars($loginUser); ?>)</div>
                    <div style="font-size:12px; color:rgba(255,255,255,0.8); margin-top:2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                        <?php echo htmlspecialchars($mySignature ?: '这个人很懒，什么都没写~'); ?>
                    </div>
                </div>
            </div>
            
            <div style="display: flex; flex-direction: row; align-items: center; justify-content: flex-end; position:relative;">
                <div id="plus-btn" onclick="togglePlusMenu(event)" style="font-size:32px; font-weight:200; color:#fff; cursor:pointer; padding:0 10px; line-height:1; margin-bottom: 2px;">+</div>
                
                <div id="plus-dropdown" class="glass-dropdown" style="display:none;">
                    <div class="dd-item" onclick="openSearchModal(event)">搜索用户</div>
                    <?php if($isAdmin): ?>
                        <div class="dd-item" onclick="openCreateGroupModal()">创建群聊</div>
                    <?php endif; ?>
                    <div class="dd-item" style="cursor:default;" onclick="event.stopPropagation();">
                        消息提醒
                        <label class="sound-toggle-switch" style="margin-left: 15px;">
                            <input type="checkbox" id="sound-toggle" checked onchange="saveSoundPref()">
                            <span class="slider"></span>
                        </label>
                    </div>
                    <a href="?action=logout" class="dd-item" style="color:#FF3B30; text-decoration:none;">退出登录</a>
                </div>
            </div>
        </div>
        
        <div id="top-search-bar" class="top-search-bar">
            <div class="ts-inner">
                <input type="text" id="modal-search-input" placeholder="搜索聯繫人或群聊..." autocomplete="off" spellcheck="false" oninput="filterUsers()">
                <div class="ts-close" onclick="closeSearchModal()">取消</div>
            </div>
        </div>
        
        <div id="list-content">
            <div class="sticky-group">
                <div class="lobby-card" onclick="enterLobby()">
                    <div style="font-size:24px;margin-right:15px;">🌍</div>
                    <div style="font-weight:bold;font-size:17px;">公共大厅</div>
                    <div id="notice-container" class="notice-wrapper"><div id="notice-content" class="notice-scroll"></div></div>
                    <div id="badge-all" class="msg-badge">0</div>
                </div>
            </div>
            <div id="user-list"></div>
        </div>
    </div>

    <div id="view-chat" class="view-panel" style="display: <?php echo $initTarget ? 'flex' : 'none'; ?>;">
        <div id="chat-placeholder" style="display: <?php echo $initTarget ? 'none' : 'flex'; ?>; flex: 1; align-items: center; justify-content: center; flex-direction: column; color: #999; background: #F3F3F3;">
            <svg viewBox="0 0 24 24" style="width: 80px; height: 80px; fill: #d4cfc5; margin-bottom: 20px;"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>
            <p style="font-size: 16px; font-weight: bold; color: #aaa;">请选择一个聊天室开始对话</p>
        </div>

        <div id="chat-main" style="position: relative; display: <?php echo $initTarget ? 'flex' : 'none'; ?>; flex-direction: column; width: 100%; height: 100%;">
            <div id="chat-header">
                <a href="javascript:void(0)" class="back-btn" onclick="goBack()">
                    <svg viewBox="0 0 24 24" style="width:22px;height:22px;fill:#fff;margin-left:-2px;"><path d="M15.41 16.59L10.83 12l4.58-4.59L14 6l-6 6 6 6z"/></svg>
                </a>
                <div style="position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); display: flex; flex-direction: column; align-items: center; max-width: 60%; z-index: 1;">
                    <span id="chat-title" style="font-size: 16px; font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%;">
                        <?php echo htmlspecialchars($initTarget === 'all' ? '公共大厅' : $initTarget); ?>
                    </span>
                    <span id="chat-subtitle" style="display:none; font-size: 11px; color: rgba(255,255,255,0.8); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; margin-top: 2px;"></span>
                </div>
                
                <div style="position:relative; display:flex; align-items:center; margin-left: auto; z-index: 1000;">
                    <div id="chat-menu-btn" onclick="toggleChatMenu(event)" style="display:none; font-size:24px; color:#fff; padding:0 8px; cursor:pointer; position:relative; z-index:10; line-height:1; font-weight:bold;">⋯</div>
                    
                    <div id="chat-dropdown" class="glass-dropdown" style="display:none;">
                        <div id="dd-view-profile" class="dd-item" style="display:none;" onclick="viewCurrentProfile()">查看名片</div>
                        <div id="dd-view-members" class="dd-item" style="display:none;" onclick="viewGroupMembers()">查看群成员</div>
                        <div id="dd-clear" class="dd-item" style="color:#FF3B30; display:none;" onclick="clearHistory()">清空对话</div>
                        <div id="dd-disband" class="dd-item" style="color:#FF3B30; display:none;" onclick="disbandGroup()">解散群聊</div>
                        <div id="dd-leave" class="dd-item" style="color:#FF3B30; display:none;" onclick="leaveGroup()">退出群聊</div>
                        <div id="dd-close-chat" class="dd-item" style="display:none;" onclick="goBack()">关闭对话</div>
                    </div>
                </div>
            </div>
            
            <div id="allspace"></div>
            
            <div id="voice-overlay">
                <div class="wave-container"><div class="wave-bar"></div><div class="wave-bar" style="animation-delay:0.1s"></div><div class="wave-bar" style="animation-delay:0.2s"></div><div class="wave-bar" style="animation-delay:0.3s"></div></div>
                <p id="voice-hint" style="font-size: 12px; margin-top: 10px;">手指上滑，取消发送</p>
            </div>
            
            <div id="footer" style="position: relative;">
                <div id="emoji-panel"></div>
                <input type="file" id="imgInput" style="display:none" multiple onchange="handleMultipleUpload(this.files)">
                <button id="modeSwitchBtn" class="img-btn" onclick="switchInputMode()" style="<?php echo ($disableVoice) ? 'display:none;' : ''; ?>">🎤</button>
                <div id="text-wrapper">
                    <textarea id="text" placeholder="输入..." rows="1" enterkeyhint="send"></textarea>
                    
                    <div id="attach-inner-btn" onclick="document.getElementById('imgInput').click()" title="发送附件" style="<?php echo (!$isAdmin && $uploadSizeLimit == 0) ? 'display:none;' : ''; ?>">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>
                    </div>
                </div>
                <div id="recordBtn" class="record-btn" style="display:none;">按住 说话</div>
                <button id="emoji-btn" class="img-btn" onclick="toggleEmojiPanel(event)">😀</button>
                
                <button id="send-outer-btn" class="send-btn" onclick="sendText()" title="发送">
                    <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
                </button>
            </div>
        </div>
    </div>
</div>

<div id="profile-modal">
    <div class="modal-box">
        <div class="modal-close" onclick="document.getElementById('profile-modal').style.display='none'">×</div>
        <h3 style="position: absolute; top: 18px; left: 20px; margin: 0; font-size: 18px; color: #333;">编辑资料</h3>
        
        <input type="file" id="avatar-input" style="display:none" accept="image/*" onchange="previewAvatar(this)">
        <div style="text-align: center; margin-bottom: 20px; margin-top: 10px;">
            <img src="<?php echo $myAvatar; ?>" id="avatar-preview" onclick="viewMyAvatar()" style="width:80px; height:80px; border-radius:50%; object-fit:cover; margin:0 auto; cursor:pointer; border: 2px solid #085A48; display: block;" title="点击查看大图">
            <div onclick="document.getElementById('avatar-input').click()" style="display:inline-flex; align-items:center; justify-content:center; background:#085A48; color:#fff; border-radius:20px; padding:6px 16px; margin-top:10px; cursor:pointer; font-size:13px; font-weight:bold; box-shadow:0 2px 5px rgba(0,0,0,0.1);">📷 更换头像</div>
        </div>
        
        <input type="text" id="prof-sign" placeholder="个性签名 (限24字)" maxlength="24" value="<?php echo htmlspecialchars($mySignature); ?>">
        <input type="text" id="prof-email" placeholder="邮箱地址" maxlength="24" value="<?php echo htmlspecialchars($myEmail); ?>">
        
        <div style="border-top: 1px dashed #ddd; margin: 10px 0;"></div>
        
        <div class="pwd-container" style="margin-bottom: 10px;">
            <input type="password" id="prof-old-pass" placeholder="旧密码 (修改密码时必填)" maxlength="24">
            <div class="eye-btn" onclick="togglePwd('prof-old-pass', this)">
                <svg class="eye-open" viewBox="0 0 24 24"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>
                <svg class="eye-close" style="display:none" viewBox="0 0 24 24"><path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.82l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.74-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/></svg>
            </div>
        </div>
        
        <div class="pwd-container" style="margin-bottom: 0;">
            <input type="password" id="prof-pass" placeholder="新密码 (不修改请留空)" maxlength="24">
            <div class="eye-btn" onclick="togglePwd('prof-pass', this)">
                <svg class="eye-open" viewBox="0 0 24 24"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>
                <svg class="eye-close" style="display:none" viewBox="0 0 24 24"><path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.82l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.74-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/></svg>
            </div>
        </div>
        
        <button class="btn-save-profile" style="margin-top: 15px;" onclick="saveProfile()">保存设置</button>
    </div>
</div>

<div id="user-profile-modal" onclick="this.style.display='none'">
    <div class="upm-box" onclick="event.stopPropagation();">
        <div class="upm-close" onclick="document.getElementById('user-profile-modal').style.display='none'; event.stopPropagation();">×</div>
        <div style="position:relative; flex-shrink:0;">
            <img id="upm-avatar" src="" style="width:64px;height:64px;border-radius:12px;object-fit:cover;border:1px solid #eaeaea;cursor:pointer;" onclick="openAvatarModal(this.src); event.stopPropagation();">
            <div id="upm-avatar-edit" style="display:none; position:absolute; bottom:-5px; right:-5px; background:#085A48; color:#fff; font-size:10px; padding:2px 6px; border-radius:8px; cursor:pointer; border:1px solid #fff;" onclick="document.getElementById('avatarInput').click(); event.stopPropagation();">换头像</div>
        </div>
        <div style="flex:1; min-width:0;">
            <div id="upm-name" style="font-size:18px; font-weight:bold; color:#333; margin-bottom:4px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;"></div>
            <div id="upm-sign" style="font-size:13px; color:#888; line-height:1.4; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;"></div>
        </div>
    </div>
</div>

<div id="avatar-viewer-modal" onclick="this.style.display='none'">
    <img id="avatar-viewer-img" src="" style="max-width:90%; max-height:90%; border-radius:10px; object-fit:contain; transition:transform 0.2s; box-shadow:0 10px 30px rgba(0,0,0,0.5);">
</div>

<div id="media-modal">
    <div id="media-close-btn" onclick="closeMediaModal(); event.stopPropagation();">×</div>
    <div id="media-prev-btn" class="media-nav-btn" onclick="executeMediaSwipe(-1); event.stopPropagation();">&#10094;</div>
    <div id="media-next-btn" class="media-nav-btn" onclick="executeMediaSwipe(1); event.stopPropagation();">&#10095;</div>
    <div id="media-modal-content"></div>
    <div id="btn-load-original">加载原图</div>
</div>

<div id="cg-overlay" onclick="closeCreateGroup(); closeEditGroup(); closeIframeModal();"></div>

<div id="create-group-modal" class="slide-down-modal">
    <div class="sd-header">
        创建群聊
        <div class="sd-close" onclick="closeCreateGroup()">×</div>
    </div>
    <div class="sd-body">
        <input type="text" id="cg-name" class="cg-input" placeholder="请输入群聊名称 (例如: 工作交流群)">
        <div id="cg-user-list"></div>
    </div>
    <div class="sd-footer">
        <button class="btn-main" style="width:100%; height:48px; border-radius:12px; background:#085A48; color:#fff; font-size:16px; font-weight:bold; border:none;" onclick="submitCreateGroup()">确认创建</button>
    </div>
</div>

<div id="edit-group-modal" class="slide-down-modal">
    <div class="sd-header">
        管理群成员
        <div class="sd-close" onclick="closeEditGroup()">×</div>
    </div>
    <div class="sd-body">
        <div id="eg-user-list"></div>
    </div>
    <div class="sd-footer">
        <button class="btn-main" style="width:100%; height:48px; border-radius:12px; background:#085A48; color:#fff; font-size:16px; font-weight:bold; border:none;" onclick="submitEditGroup()">保存修改</button>
    </div>
</div>

<div id="group-members-modal" class="modal-overlay">
    <div class="modal-box" style="width:90%; max-width:380px; padding:20px;">
        <div class="modal-close" onclick="document.getElementById('group-members-modal').style.display='none'">×</div>
        <h4 style="margin-bottom:15px; color:#333; font-size:17px; text-align:left;">群成员</h4>
        <div id="gm-list" class="gm-grid"></div>
    </div>
</div>

<div id="custom-dialog-overlay">
    <div class="custom-dialog-box">
        <div class="cd-header" id="cd-title">提示</div>
        <div class="cd-body" id="cd-msg"></div>
        <div class="cd-footer">
            <button class="cd-btn cd-btn-cancel" id="cd-cancel">取消</button>
            <button class="cd-btn cd-btn-confirm" id="cd-confirm">確認</button>
        </div>
    </div>
</div>

<div id="iframe-modal" class="slide-down-modal">
    <div class="sd-header" style="border-radius: 16px 16px 0 0;">
        <div class="sd-close" onclick="closeIframeModal()">×</div>
        <span style="flex:1; text-align:center; font-size:15px; margin:0 10px;">網頁瀏覽</span>
        <div style="position:relative;">
            <div onclick="toggleIframeMenu(event)" style="font-size:24px; padding:0 5px; cursor:pointer; line-height:1; font-weight:bold;">⋯</div>
            <div id="iframe-dropdown" class="glass-dropdown" style="display:none; right:0; top:35px; width:130px; text-align:left;">
                <div class="dd-item" onclick="refreshIframe()">🔄 刷新網頁</div>
                <div class="dd-item" onclick="openIframeInBrowser()">🌐 瀏覽器打開</div>
            </div>
        </div>
    </div>
    <div class="iframe-wrapper">
        <iframe id="modal-iframe" src="" style="width:100%; height:100%; border:none;"></iframe>
    </div>
</div>

<input type="file" id="avatarInput" style="display:none" accept="image/*" onchange="uploadAvatar(this.files[0])">

<audio id="notify-sound" src="d.wav" preload="auto"></audio>

<script>
    let MY_AVATAR = <?php echo json_encode($myAvatar); ?>;
    let MY_SIGN = <?php echo json_encode($mySignature); ?>;
    const MY_NAME = <?php echo json_encode($loginUser); ?>;
    const IS_ADMIN = <?php echo $isAdmin ? 'true' : 'false'; ?>;
    let avatarMaxWidth = <?php echo $avatarMaxWidth; ?>;

    const THUMB_DISPLAY_WIDTH = <?php echo $chatThumbDisplay; ?>;
    const THUMB_ACTUAL_WIDTH = <?php echo $chatThumbActual; ?>;
    const FILE_WIDTH = <?php echo $chatFileWidth; ?>;
    const FILE_HEIGHT = <?php echo $chatFileHeight; ?>;
    const UPLOAD_SIZE_LIMIT = <?php echo $uploadSizeLimit; ?>;

    const DISABLE_VOICE = <?php echo $disableVoice ? 'true' : 'false'; ?>;
    
    // 透传后台设置的撤回时间给前端判断 (0为关闭)
    const RECALL_TIME = <?php echo $recallTime; ?>;

    let currentTarget = "<?php echo addslashes($initTarget); ?>"; 
    let initError = "<?php echo addslashes($initError); ?>";
    
    function togglePwd(id, btn) {
        const input = document.getElementById(id);
        const eyeOpen = btn.querySelector('.eye-open');
        const eyeClose = btn.querySelector('.eye-close');
        if (input.type === 'password') {
            input.type = 'text'; 
            eyeOpen.style.display = 'none'; 
            eyeClose.style.display = 'block'; 
            btn.classList.add('active');
        } else {
            input.type = 'password'; 
            eyeOpen.style.display = 'block'; 
            eyeClose.style.display = 'none'; 
            btn.classList.remove('active');
        }
    }
</script>
<script src="chat.js?v=<?php echo filemtime(__DIR__ . '/chat.js'); ?>"></script>

</body>
</html>