<?php
// 【核心优化】：延长后台 Session 存活时间至 7 天
ini_set('session.gc_maxlifetime', 7 * 86400);
session_set_cookie_params(7 * 86400, '/');
session_start();
header('Content-Type: text/html; charset=utf-8');
header("Cache-Control: no-store, no-cache, must-revalidate, max-age=0");
header("Pragma: no-cache");

$dbPath = __DIR__ . '/storage/data.sqlite';
$error = '';

try {
    $pdo = new PDO('sqlite:' . $dbPath);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    // 开启高并发稳定模式
    $pdo->setAttribute(PDO::ATTR_TIMEOUT, 5);
    try { $pdo->exec("PRAGMA journal_mode = WAL;"); } catch (Exception $e) {}
    
    // 为后台免登录新增独立 Token 字段，防止与前台用户顶号
    try { $pdo->exec("ALTER TABLE users ADD COLUMN admin_remember_token TEXT DEFAULT NULL"); } catch (Exception $e) {}
} catch (PDOException $e) {
    $error = "数据库连接失败，请先访问网站首页(index.php)进行初始化！";
}

// --- 7 天免登录：Cookie 检测与自动恢复 Session ---
if (empty($_SESSION['admin_auth']) && !empty($_COOKIE['admin_remember_token']) && empty($error)) {
    $token = $_COOKIE['admin_remember_token'];
    $stmt = $pdo->prepare("SELECT id FROM users WHERE admin_remember_token = ? AND role = 'admin'");
    $stmt->execute([$token]);
    if ($stmt->fetch()) {
        $_SESSION['admin_auth'] = true;
        setcookie('admin_remember_token', $token, time() + 7 * 86400, '/');
        session_write_close();
        header("Location: admin_dashboard.php");
        exit;
    } else {
        setcookie('admin_remember_token', '', time() - 3600, '/');
    }
}

// 已有登录态直接放行
if (isset($_SESSION['admin_auth']) && $_SESSION['admin_auth'] === true) {
    header("Location: admin_dashboard.php");
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST' && empty($error)) {
    $user = trim($_POST['username']);
    $pass = trim($_POST['password']);

    // 只验证 role 为 admin 的账号
    $stmt = $pdo->prepare("SELECT id, password FROM users WHERE username = ? AND role = 'admin'");
    $stmt->execute([$user]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);

    if ($row && password_verify($pass, $row['password'])) {
        $_SESSION['admin_auth'] = true;
        
        // 勾选了免登录
        if (isset($_POST['remember'])) {
            $token = bin2hex(random_bytes(32));
            $pdo->prepare("UPDATE users SET admin_remember_token = ? WHERE id = ?")->execute([$token, $row['id']]);
            setcookie('admin_remember_token', $token, time() + 7 * 86400, '/');
        } else {
            $pdo->prepare("UPDATE users SET admin_remember_token = NULL WHERE id = ?")->execute([$row['id']]);
            setcookie('admin_remember_token', '', time() - 3600, '/');
        }
        
        // 释放文件锁，防止卡死
        session_write_close();
        header("Location: admin_dashboard.php");
        exit;
    } else {
        $error = "管理员账号或密码错误，或无权限";
    }
}
?>
<!DOCTYPE html>
<html lang="zh">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=0, viewport-fit=cover">
    <title>管理员登录</title>
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
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            background-color: #EAE6DF;
            touch-action: manipulation;
        }
        
        /* 懸浮登錄卡片，自動適應剩餘高度並允許內部滾動 */
        #app-wrapper {
            width: 90%;
            max-width: 450px;
            max-height: 90dvh;
            background: #EAE6DF;
            display: flex;
            flex-direction: column;
            position: relative;
            overflow: hidden;
            border-radius: 16px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.15);
            border: 1px solid #D6D2CB;
        }
        
        #header { height: 60px; background: #085A48; color: #fff; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        #header h1 { font-size: 18px; font-weight: bold; }
        .content { flex: 1; padding: 40px 25px; overflow-y: auto; }

        .form-title { font-size: 22px; font-weight: 900; color: #333; margin-bottom: 25px; }
        
        .form-input { width: 100%; height: 50px; border: none; border-radius: 12px; padding: 0 18px; background: #fff; font-size: 16px; outline: none; box-shadow: 0 1px 3px rgba(0,0,0,0.02); margin-bottom: 20px; transition: box-shadow 0.2s; }
        .form-input:focus { box-shadow: 0 0 0 2px #085A48; }
        
        /* 密码可见切换样式 */
        .pwd-container { position: relative; width: 100%; margin-bottom: 20px; }
        .pwd-container .form-input { margin-bottom: 0; padding-right: 48px; }
        
        .eye-btn {
            position: absolute; right: 8px; top: 50%; transform: translateY(-50%); width: 36px; height: 36px;
            display: flex; align-items: center; justify-content: center; cursor: pointer; border-radius: 50%;
            transition: background 0.2s; color: #5f6368; user-select: none;
        }
        .eye-btn:hover { background: rgba(0,0,0,0.05); }
        .eye-btn.active { color: #085A48; }
        .eye-btn svg { width: 22px; height: 22px; fill: currentColor; }
        
        .remember-wrap { display: flex; align-items: center; gap: 8px; font-size: 14px; color: #5f6368; cursor: pointer; user-select: none; margin-bottom: 20px; margin-top: -5px; }
        .remember-wrap input[type="checkbox"] { width: 16px; height: 16px; accent-color: #085A48; cursor: pointer; }
        
        .btn-main { width: 100%; height: 52px; background: #085A48; color: #fff; border: none; border-radius: 12px; font-size: 17px; font-weight: bold; cursor: pointer; transition: transform 0.1s; }
        .btn-main:active { transform: scale(0.98); }
        
        .msg { padding: 12px; border-radius: 10px; font-size: 13px; margin-bottom: 20px; text-align: center; }
        .msg-error { background: #FCE8E8; color: #E55D5D; }
    </style>
</head>
<body>
<div id="app-wrapper">
    <div id="header"><h1>管理中心入口</h1></div>
    <div class="content">
        <div class="form-title">安全验证</div>
        <?php if($error): ?><div class="msg msg-error"><?php echo $error; ?></div><?php endif; ?>
        
        <form method="POST">
            <input type="text" name="username" class="form-input" placeholder="管理员账号" required>
            
            <div class="pwd-container">
                <input type="password" name="password" id="input-password" class="form-input" placeholder="安全密码" required>
                <div class="eye-btn" onclick="togglePwd('input-password', this)">
                    <svg class="eye-open" viewBox="0 0 24 24"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>
                    <svg class="eye-close" style="display:none" viewBox="0 0 24 24"><path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.82l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.74-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/></svg>
                </div>
            </div>
            
            <label class="remember-wrap">
                <input type="checkbox" name="remember" value="1" checked>
                <span>7 天内免登录</span>
            </label>
            
            <button type="submit" class="btn-main">进入控制台</button>
        </form>
    </div>
</div>

<script>
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
</body>
</html>
