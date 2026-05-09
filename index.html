<?php
ini_set('session.gc_maxlifetime', 7 * 86400);
session_set_cookie_params(7 * 86400, '/');
session_start();

if (!empty($_SESSION['username'])) {
    header("Location: chat.php");
    exit;
}

header('Content-Type: text/html; charset=utf-8');
header("Cache-Control: no-store, no-cache, must-revalidate, max-age=0");
header("Pragma: no-cache");

$dbDir = __DIR__ . '/storage';
$dbPath = $dbDir . '/data.sqlite';

if (!file_exists($dbPath) || filesize($dbPath) === 0) {
    header("Location: install.php");
    exit;
}

$disableForgot = false;
$disableRegister = false;
try {
    $pdo = new PDO('sqlite:' . $dbPath);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_TIMEOUT, 5);
    try { $pdo->exec("PRAGMA journal_mode = WAL;"); } catch (Exception $e) {}

    $stmt = $pdo->query("SELECT key_value FROM configs WHERE key_name = 'disable_forgot'");
    if ($stmt && $stmt->fetchColumn() === '1') {
        $disableForgot = true;
    }
    
    $stmt = $pdo->query("SELECT key_value FROM configs WHERE key_name = 'disable_register'");
    if ($stmt && $stmt->fetchColumn() === '1') {
        $disableRegister = true;
    }
} catch (PDOException $e) { die("數據庫連接失敗"); }

// --- 7 天免登錄：Cookie 檢測與自動登錄 ---
if (empty($_SESSION['username']) && !empty($_COOKIE['remember_token'])) {
    $token = $_COOKIE['remember_token'];
    $stmt = $pdo->prepare("SELECT username FROM users WHERE remember_token = ?");
    $stmt->execute([$token]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if ($row) {
        $_SESSION['username'] = $row['username'];
        setcookie('remember_token', $token, time() + 7 * 86400, '/');
        session_write_close();
        header("Location: chat.php"); 
        exit;
    } else {
        setcookie('remember_token', '', time() - 3600, '/');
    }
}

// --- AJAX 發送驗證碼 (集成 SMTP) ---
if (isset($_GET['action']) && $_GET['action'] === 'send_code') {
    if ($disableForgot) { echo json_encode(['status' => 'error', 'msg' => '找回密碼功能已關閉']); exit; }

    $email = trim($_GET['email'] ?? '');
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        echo json_encode(['status' => 'error', 'msg' => '郵箱格式不正確']); exit;
    }
    
    $stmt = $pdo->prepare("SELECT id FROM users WHERE email = ? AND email != ''");
    $stmt->execute([$email]);
    if (!$stmt->fetch()) {
        echo json_encode(['status' => 'error', 'msg' => '該郵箱未綁定任何帳號']); exit;
    }
    
    $code = str_pad(mt_rand(0, 999999), 6, '0', STR_PAD_LEFT);
    $expires = date('Y-m-d H:i:s', strtotime('+10 minutes'));
    $pdo->prepare("DELETE FROM reset_codes WHERE email = ?")->execute([$email]);
    $stmt = $pdo->prepare("INSERT INTO reset_codes (email, code, expires_at) VALUES (?, ?, ?)");
    $stmt->execute([$email, $code, $expires]);
    
    $configs = [];
    $stmt = $pdo->query("SELECT key_name, key_value FROM configs WHERE key_name LIKE 'smtp_%'");
    while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
        $configs[$row['key_name']] = $row['key_value'];
    }

    $host = trim($configs['smtp_host'] ?? '');
    $port = (int)($configs['smtp_port'] ?? 0);
    $user = trim($configs['smtp_user'] ?? '');
    $pass = trim($configs['smtp_pass'] ?? '');
    $crypto = $configs['smtp_crypto'] ?? '';
    $from = trim($configs['smtp_from'] ?? '');
    $name = trim($configs['smtp_from_name'] ?? '');
    $to = $email;
    $content = "您的找回密碼驗證碼是：{$code} \r\n\r\n(本驗證碼 10 分鐘內有效，请勿泄露给他人)";

    if(empty($host) || empty($port) || empty($from)){
        echo json_encode(["status" => "error", "msg" => "系統發信未配置，請聯繫管理員"]); 
        exit;
    }

    $timeout = 10;
    $host_prefix = ($crypto === 'ssl' || $port == 465) ? 'ssl://' : '';
    $fp = @fsockopen($host_prefix . $host, $port, $errno, $errstr, $timeout);
    
    if (!$fp) {
        echo json_encode(["status" => "error", "msg" => "無法連接郵件伺服器"]); exit;
    }
    
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
            fclose($fp);
            echo json_encode(["status" => "error", "msg" => "SMTP 認證失敗，请联系管理员"]); exit;
        }
    }
    
    send_smtp_cmd($fp, "MAIL FROM:<$from>");
    send_smtp_cmd($fp, "RCPT TO:<$to>");
    send_smtp_cmd($fp, "DATA");
    
    $subject = "=?UTF-8?B?".base64_encode("找回密碼驗證碼 - 喵喵對話")."?=";
    $header = "From: =?UTF-8?B?".base64_encode($name)."?= <$from>\r\n";
    $header .= "To: <$to>\r\n";
    $header .= "Subject: $subject\r\n";
    $header .= "MIME-Version: 1.0\r\n";
    $header .= "Content-Type: text/plain; charset=UTF-8\r\n\r\n";
    
    $mail_res = send_smtp_cmd($fp, $header . $content . "\r\n.");
    send_smtp_cmd($fp, "QUIT");
    fclose($fp);
    
    if (substr($mail_res, 0, 3) == '250') {
        echo json_encode(['status' => 'success', 'msg' => '驗證碼已發送至您的郵箱']);
    } else {
        echo json_encode(['status' => 'error', 'msg' => '伺服器拒絕發送']);
    }
    exit;
}

// --- 表單處理 ---
$error = ''; $success = '';
$action = $_POST['action'] ?? 'login'; 

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $userParam = trim($_POST['username'] ?? ''); 
    $pass = trim($_POST['password'] ?? '');
    $passConfirm = trim($_POST['password_confirm'] ?? '');
    $emailParam = trim($_POST['email'] ?? '');
    $vCode = trim($_POST['v_code'] ?? '');

    if ($action === 'forgot') {
        if ($disableForgot) {
            $error = "找回密碼功能已關閉";
        } elseif ($pass !== $passConfirm) { 
            $error = "兩次新密碼輸入不一致"; 
        } elseif (mb_strlen($pass) > 24) { 
            $error = "新密碼太長"; 
        } else {
            $stmt = $pdo->prepare("SELECT * FROM reset_codes WHERE email = ? AND code = ? AND expires_at > DATETIME('now', 'localtime')");
            $stmt->execute([$emailParam, $vCode]);
            if ($stmt->fetch()) {
                $newHash = password_hash($pass, PASSWORD_DEFAULT);
                $stmt = $pdo->prepare("UPDATE users SET password = ?, remember_token = NULL WHERE email = ?");
                $stmt->execute([$newHash, $emailParam]);
                $pdo->prepare("DELETE FROM reset_codes WHERE email = ?")->execute([$emailParam]);
                $success = "密碼已重置，請登錄"; $action = 'login';
            } else { $error = "驗證碼無效或已過期"; }
        }
    } elseif ($action === 'register') {
        if ($disableRegister) { $error = "註冊功能已關閉"; }
        elseif (mb_strlen($userParam) > 12) { $error = "用戶名最长12字"; }
        elseif (!preg_match('/^[\x{4e00}-\x{9fa5}a-zA-Z0-9]+$/u', $userParam)) { $error = "用戶名格式錯誤"; }
        elseif ($pass !== $passConfirm) { $error = "两碼不一致"; }
        else {
            $stmt = $pdo->prepare("SELECT id FROM users WHERE username = ? OR (email = ? AND email != '')");
            $stmt->execute([$userParam, $emailParam]);
            if ($stmt->fetch()) { $error = "帳號或郵箱已被佔用"; }
            else {
                $hash = password_hash($pass, PASSWORD_DEFAULT);
                $stmt = $pdo->prepare("INSERT INTO users (username, password, email) VALUES (?, ?, ?)");
                $stmt->execute([$userParam, $hash, $emailParam]);
                
                $_SESSION['username'] = $userParam;
                session_write_close();
                header("Location: chat.php");
                exit;
            }
        }
    } else {
        $stmt = $pdo->prepare("SELECT id, username, password FROM users WHERE username = ? OR (email = ? AND email != '')");
        $stmt->execute([$userParam, $userParam]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        
        if ($row && password_verify($pass, $row['password'])) {
            $_SESSION['username'] = $row['username'];
            
            if (isset($_POST['remember'])) {
                $token = bin2hex(random_bytes(32)); 
                $stmt = $pdo->prepare("UPDATE users SET remember_token = ? WHERE id = ?");
                $stmt->execute([$token, $row['id']]);
                setcookie('remember_token', $token, time() + 7 * 86400, '/');
            } else {
                $stmt = $pdo->prepare("UPDATE users SET remember_token = NULL WHERE id = ?");
                $stmt->execute([$row['id']]);
                setcookie('remember_token', '', time() - 3600, '/');
            }
            
            session_write_close();
            header("Location: chat.php"); exit;
        } else { $error = "帳號或密碼錯誤"; }
    }
}
?>
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0, user-scalable=no, viewport-fit=cover">
    <title>喵喵對話 - 登錄</title>
    <style>
        * { margin:0; padding:0; box-sizing:border-box; -webkit-tap-highlight-color: transparent; }
        
        /* 核心修復：使用動態視口，徹底鎖死底層防止推屏 */
        body, html {
            width: 100%;
            height: 100%;
            height: 100dvh;
            margin: 0;
            padding: 0;
            overflow: hidden;
            display: flex;
            justify-content: center;
            align-items: center;
            overscroll-behavior: none;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
            background-color: #F6F5F2;
            touch-action: manipulation;
        }
        
        /* 懸浮登錄卡片，自動適應剩餘高度並允許內部滾動 */
        #app-wrapper {
            width: 90%; 
            max-width: 450px; 
            max-height: 90dvh; 
            background: #E8E2D9; 
            display: flex; 
            flex-direction: column; 
            position: relative; 
            overflow: hidden; 
            border-radius: 16px;
            box-shadow: 0 15px 50px rgba(0,0,0,0.1);
        }
        
        #header { height: 60px; background: #085A48; color: #fff; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .content { flex: 1; padding: 30px 25px; overflow-y: auto; }
        .form-title { font-size: 24px; font-weight: 500; color: #202124; margin-bottom: 25px; text-align: center; }
        
        #form-inputs-container { display: flex; flex-direction: column; }
        .form-group { margin-bottom: 20px; position: relative; }
        
        .form-input { width: 100%; height: 52px; border: 1px solid #dadce0; border-radius: 8px; padding: 0 15px; font-size: 16px; outline: none; transition: border 0.2s; }
        .form-input:focus { border: 2px solid #085A48; padding: 0 14px; }
        
        .pwd-container { position: relative; width: 100%; }
        .pwd-container .form-input { padding-right: 48px; }
        
        .eye-btn {
            position: absolute; right: 8px; top: 50%; transform: translateY(-50%); width: 36px; height: 36px;
            display: flex; align-items: center; justify-content: center; cursor: pointer; border-radius: 50%;
            transition: background 0.2s; color: #5f6368; user-select: none;
        }
        .eye-btn:hover { background: rgba(0,0,0,0.05); }
        .eye-btn.active { color: #085A48; }
        .eye-btn svg { width: 22px; height: 22px; fill: currentColor; }

        .email-wrap { display: flex; gap: 8px; width: 100%; }
        .email-wrap .form-input { flex: 1; }
        .btn-send { height: 52px; padding: 0 15px; background: #085A48; color: #fff; border: none; border-radius: 8px; font-size: 14px; cursor: pointer; flex-shrink: 0; }
        .btn-send:disabled { background: #ccc; }

        .remember-wrap { display: flex; align-items: center; gap: 8px; font-size: 14px; color: #5f6368; cursor: pointer; user-select: none; }
        .remember-wrap input[type="checkbox"] { width: 16px; height: 16px; accent-color: #085A48; cursor: pointer; }

        .btn-main { width: 100%; height: 48px; background: #085A48; color: #fff; border: none; border-radius: 8px; font-size: 16px; font-weight: 500; cursor: pointer; margin-top: 20px; }
        .switch-mode { text-align: center; margin-top: 25px; font-size: 14px; color: #5f6368; }
        .switch-mode a { color: #085A48; text-decoration: none; font-weight: 500; margin: 0 8px; }
        .msg { padding: 12px; border-radius: 8px; font-size: 14px; margin-bottom: 20px; text-align: center; }
        .msg-error { background: #fdf4f4; color: #d93025; border: 1px solid #f5c6cb; }
        .msg-success { background: #e6f4ea; color: #137333; border: 1px solid #ceead6; }
        
        .forgot-only { display: none; }
    </style>
</head>
<body>
<div id="app-wrapper">
    <div id="header"><h1>喵喵對話</h1></div>
    <div class="content">
        <div class="form-title" id="form-title">歡迎回來</div>
        <?php if($error): ?> <div class="msg msg-error"><?php echo $error; ?></div> <?php endif; ?>
        <?php if($success): ?> <div class="msg msg-success"><?php echo $success; ?></div> <?php endif; ?>

        <form method="POST" id="main-form">
            <input type="hidden" name="action" id="action-field" value="<?php echo htmlspecialchars($action); ?>">
            
            <div id="form-inputs-container">
                <div class="form-group" id="user-group">
                    <input type="text" name="username" id="input-user" class="form-input" placeholder="用戶名或郵箱" maxlength="24">
                </div>
                
                <div class="form-group" id="email-group" style="display:none;">
                    <div class="email-wrap">
                        <input type="email" name="email" id="input-email" class="form-input" placeholder="輸入綁定的郵箱" maxlength="24">
                        <button type="button" id="btn-send-code" class="btn-send forgot-only" onclick="sendVCode()">發送驗證碼</button>
                    </div>
                </div>

                <div class="form-group forgot-only" id="vcode-group">
                    <input type="text" name="v_code" class="form-input" placeholder="輸入6位驗證碼" maxlength="6">
                </div>
                
                <div class="form-group" id="pwd-group">
                    <div class="pwd-container">
                        <input type="password" name="password" id="input-password" class="form-input" placeholder="密碼" maxlength="24" required>
                        <div class="eye-btn" onclick="togglePwd('input-password', this)">
                            <svg class="eye-open" viewBox="0 0 24 24"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>
                            <svg class="eye-close" style="display:none" viewBox="0 0 24 24"><path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.82l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.74-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/></svg>
                        </div>
                    </div>
                </div>
                
                <div class="form-group" id="confirm-group" style="display:none;">
                    <div class="pwd-container">
                        <input type="password" name="password_confirm" id="input-confirm" class="form-input" placeholder="確認密碼" maxlength="24">
                        <div class="eye-btn" onclick="togglePwd('input-confirm', this)">
                            <svg class="eye-open" viewBox="0 0 24 24"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>
                            <svg class="eye-close" style="display:none" viewBox="0 0 24 24"><path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.82l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.74-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/></svg>
                        </div>
                    </div>
                </div>

                <div class="form-group" id="remember-group" style="margin-top: -5px; margin-bottom: 10px;">
                    <label class="remember-wrap">
                        <input type="checkbox" name="remember" value="1" checked>
                        <span>7 天內免登錄</span>
                    </label>
                </div>

            </div>

            <button type="submit" class="btn-main" id="submit-btn">繼續</button>
        </form>

        <div class="switch-mode">
            <?php if (!$disableRegister): ?>
            <a href="javascript:void(0)" onclick="setMode('register')" id="link-reg">建立帳戶</a>
            <?php endif; ?>
            
            <?php if (!$disableForgot): ?>
            <a href="javascript:void(0)" onclick="setMode('forgot')" id="link-forgot">忘記密碼？</a>
            <?php endif; ?>
            
            <a href="javascript:void(0)" onclick="setMode('login')" id="link-login" style="display:none;">返回登錄</a>
        </div>
    </div>
</div>

<script>
    document.addEventListener('touchstart', function (event) { if (event.touches.length > 1) { event.preventDefault(); } }, { passive: false });
    let lastTouchEnd = 0;
    document.addEventListener('touchend', function (event) { let now = (new Date()).getTime(); if (now - lastTouchEnd <= 300) { event.preventDefault(); } lastTouchEnd = now; }, { passive: false });
    document.addEventListener('wheel', function(event) { if (event.ctrlKey || event.metaKey) { event.preventDefault(); } }, { passive: false });

    function togglePwd(id, btn) {
        const input = document.getElementById(id);
        const eyeOpen = btn.querySelector('.eye-open');
        const eyeClose = btn.querySelector('.eye-close');
        if (input.type === 'password') {
            input.type = 'text'; eyeOpen.style.display = 'none'; eyeClose.style.display = 'block'; btn.classList.add('active');
        } else {
            input.type = 'password'; eyeOpen.style.display = 'block'; eyeClose.style.display = 'none'; btn.classList.remove('active');
        }
    }

    function setMode(mode) {
        const title = document.getElementById('form-title'), 
              btn = document.getElementById('submit-btn'),
              action = document.getElementById('action-field'),
              userGrp = document.getElementById('user-group'),
              emailGrp = document.getElementById('email-group'),
              vcodeGrp = document.getElementById('vcode-group'),
              pwdGrp = document.getElementById('pwd-group'),
              confirmGrp = document.getElementById('confirm-group'),
              rememberGrp = document.getElementById('remember-group'),
              linkReg = document.getElementById('link-reg'),
              linkForgot = document.getElementById('link-forgot'),
              linkLogin = document.getElementById('link-login'),
              inputUser = document.getElementById('input-user'),
              inputEmail = document.getElementById('input-email'),
              inputPwd = document.getElementById('input-password');

        document.querySelectorAll('.forgot-only').forEach(el => el.style.display = 'none');
        userGrp.style.display = 'block';
        emailGrp.style.display = 'none';
        confirmGrp.style.display = 'none';
        rememberGrp.style.display = 'none'; 
        if (linkReg) linkReg.style.display = 'inline';
        if (linkForgot) linkForgot.style.display = 'inline';
        linkLogin.style.display = 'none';
        action.value = mode;

        if (mode === 'register') {
            title.innerText = '建立帳戶'; btn.innerText = '下一步';
            emailGrp.style.display = 'block'; confirmGrp.style.display = 'block';
            inputUser.placeholder = "用戶名 (最长12字)"; inputEmail.placeholder = "綁定郵箱 (選填)";
            if (linkReg) linkReg.style.display = 'none'; linkLogin.style.display = 'inline';
            userGrp.style.order = 1; pwdGrp.style.order = 2; confirmGrp.style.order = 3; emailGrp.style.order = 4;
            
        } else if (mode === 'forgot') {
            title.innerText = '帳戶恢复'; btn.innerText = '更新密碼';
            userGrp.style.display = 'none'; emailGrp.style.display = 'block'; confirmGrp.style.display = 'block';
            document.querySelectorAll('.forgot-only').forEach(el => el.style.display = 'block');
            inputPwd.placeholder = "設置新密碼"; inputEmail.placeholder = "輸入綁定的郵箱";
            if (linkForgot) linkForgot.style.display = 'none'; linkLogin.style.display = 'inline';
            emailGrp.style.order = 1; vcodeGrp.style.order = 2; pwdGrp.style.order = 3; confirmGrp.style.order = 4;
            
        } else {
            title.innerText = '歡迎回來'; btn.innerText = '登錄';
            inputUser.placeholder = "用戶名或郵箱"; inputPwd.placeholder = "密碼";
            userGrp.style.order = 1; pwdGrp.style.order = 2;
            
            rememberGrp.style.display = 'block';
            rememberGrp.style.order = 3;
        }
    }

    async function sendVCode() {
        const email = document.getElementById('input-email').value;
        const btn = document.getElementById('btn-send-code');
        if (!email) return alert('請先輸入郵箱');
        btn.disabled = true;
        try {
            const res = await fetch(`?action=send_code&email=${encodeURIComponent(email)}`);
            const data = await res.json();
            alert(data.msg);
            if (data.status === 'success') {
                let sec = 60;
                const timer = setInterval(() => {
                    sec--; btn.innerText = sec + 's';
                    if (sec <= 0) { clearInterval(timer); btn.disabled = false; btn.innerText = '重新發送'; }
                }, 1000);
            } else { btn.disabled = false; }
        } catch (e) { alert('網絡請求失敗'); btn.disabled = false; }
    }

    document.addEventListener('DOMContentLoaded', () => {
        const currentAction = document.getElementById('action-field').value;
        setMode(currentAction);
    });
</script>
</body>
</html>
