<?php
session_start();
header('Content-Type: text/html; charset=utf-8');

$dbDir = __DIR__ . '/storage';
$dbPath = $dbDir . '/data.sqlite';
$message = '';
$isInstalled = file_exists($dbPath) && filesize($dbPath) > 0;

// --- 防重复安装自动跳转逻辑 ---
if ($isInstalled && $_SERVER['REQUEST_METHOD'] !== 'POST') {
    header("Location: index.php");
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (isset($_POST['action']) && $_POST['action'] === 'install') {
        $adminPassRaw = trim($_POST['admin_pass']) ?: '123456';
        $adminPassConfirm = trim($_POST['admin_pass_confirm']) ?: '123456';

        // 增加密码确认验证逻辑
        if ($adminPassRaw !== $adminPassConfirm) {
            $message = "<div class='alert error'>❌ 初始化失败：两次输入的管理员密码不一致！</div>";
        } else {
            try {
                if (!is_dir($dbDir)) mkdir($dbDir, 0777, true);
                $pdo = new PDO('sqlite:' . $dbPath);
                $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

                // 1. 创建完整版 users 表
                $pdo->exec("CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, 
                    username TEXT UNIQUE COLLATE NOCASE NOT NULL, 
                    password TEXT NOT NULL, 
                    role TEXT DEFAULT 'user', 
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP, 
                    last_active DATETIME,
                    avatar TEXT DEFAULT '',
                    email TEXT DEFAULT '',
                    signature TEXT DEFAULT '',
                    lobby_read_count INTEGER DEFAULT 0,
                    remember_token TEXT DEFAULT NULL,
                    admin_remember_token TEXT DEFAULT NULL
                )");
                
                // 2. 创建 messages 表
                $pdo->exec("CREATE TABLE IF NOT EXISTS messages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, 
                    sender TEXT NOT NULL, 
                    receiver TEXT NOT NULL, 
                    content TEXT NOT NULL, 
                    type TEXT DEFAULT 'text', 
                    is_read INTEGER DEFAULT 0, 
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )");
                
                // 3. 创建 configs 表
                $pdo->exec("CREATE TABLE IF NOT EXISTS configs (key_name TEXT PRIMARY KEY, key_value TEXT NOT NULL)");
                
                // 4. 创建 reset_codes 表
                $pdo->exec("CREATE TABLE IF NOT EXISTS reset_codes (
                    email TEXT, 
                    code TEXT, 
                    expires_at DATETIME
                )");

                // 初始化系统默认配置
                $adminUser = trim($_POST['admin_user']) ?: 'admin';
                
                $stmt = $pdo->prepare("INSERT OR IGNORE INTO configs (key_name, key_value) VALUES (?, ?)");
                $stmt->execute(['disable_video', '0']);
                $stmt->execute(['compress_img', '1']);
                $stmt->execute(['compress_video', '1']);
                $stmt->execute(['global_notice', '']);
                $stmt->execute(['admin_username', $adminUser]); // 记录管理员账号
                
                // 【同步更新】：寫入最新添加的系統參數默認值
                $stmt->execute(['chat_thumb_display', '125']);
                $stmt->execute(['chat_thumb_display_h', '125']);
                $stmt->execute(['chat_thumb_actual', '125']);
                $stmt->execute(['chat_file_width', '220']);
                $stmt->execute(['chat_file_height', '50']);
                $stmt->execute(['chunk_upload', '1']);
                $stmt->execute(['chunk_size', '2']);
                $stmt->execute(['avatar_max_width', '200']);
                $stmt->execute(['upload_size_limit', '0']); // 默认为0，关闭普通用户上传
                $stmt->execute(['admin_thumb_display', '125']);
                $stmt->execute(['admin_thumb_display_h', '125']);

                // 创建管理员账号
                $adminPass = password_hash($adminPassRaw, PASSWORD_DEFAULT);
                $stmt = $pdo->prepare("INSERT OR IGNORE INTO users (username, password, role) VALUES (?, ?, 'admin')");
                $stmt->execute([$adminUser, $adminPass]);

                $message = "<div class='alert success'>🎉 数据库初始化成功！表结构已就绪。</div>";
                $isInstalled = true;

            } catch (PDOException $e) {
                $message = "<div class='alert error'>❌ 初始化失败：" . htmlspecialchars($e->getMessage()) . "</div>";
            }
        }
    }
}
?>
<!DOCTYPE html>
<html lang="zh">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
    <title>系统安装 - 喵喵对话</title>
    <style>
        * { margin:0; padding:0; box-sizing:border-box; -webkit-tap-highlight-color: transparent; }
        body { background: #D6CFCE; font-family: -apple-system, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; padding: 20px; }
        .install-card { background: #ffffff; width: 100%; max-width: 450px; border-radius: 20px; box-shadow: 0 8px 30px rgba(0,0,0,0.1); overflow: hidden; position: relative; }
        .header { background: #075445; padding: 25px 20px; color: #fff; display: flex; justify-content: space-between; align-items: center; }
        .header h1 { font-size: 20px; font-weight: bold; }
        .btn-gear { background: none; border: none; color: #fff; font-size: 22px; cursor: pointer; opacity: 0.8; transition: transform 0.3s; }
        .btn-gear:hover { opacity: 1; transform: rotate(90deg); }
        .content { padding: 30px 25px; background: #E8E2D9; }
        
        .section-title { font-size: 16px; font-weight: bold; color: #075445; margin-bottom: 20px; }

        .form-group { margin-bottom: 20px; }
        .form-label { display: block; font-size: 13px; color: #666; margin-bottom: 8px; font-weight: bold; }
        .form-input { width: 100%; height: 45px; border: 1px solid #DCD7CE; border-radius: 12px; padding: 0 15px; background: #fff; font-size: 15px; outline: none; transition: border 0.2s; }
        .form-input:focus { border-color: #078A71; }
        
        /* --- 密码可见切换相关样式 --- */
        .pwd-container { position: relative; width: 100%; }
        .pwd-container .form-input { padding-right: 48px; }
        .eye-btn {
            position: absolute; right: 8px; top: 50%; transform: translateY(-50%); width: 36px; height: 36px;
            display: flex; align-items: center; justify-content: center; cursor: pointer; border-radius: 50%;
            transition: background 0.2s; color: #888; user-select: none;
        }
        .eye-btn:hover { background: rgba(0,0,0,0.05); }
        .eye-btn.active { color: #078A71; }
        .eye-btn svg { width: 20px; height: 20px; fill: currentColor; }

        .btn-submit { width: 100%; height: 48px; background: #078A71; color: #fff; border: none; border-radius: 14px; font-size: 16px; font-weight: bold; cursor: pointer; margin-top: 10px; }
        .btn-submit:active { background: #066d59; }
        .btn-submit:disabled { background: #999; cursor: not-allowed; }
        .alert { padding: 12px 15px; border-radius: 10px; font-size: 13px; margin-bottom: 20px; font-weight: bold; }
        .success { background: #E2F2D1; color: #075445; border: 1px solid #D4E8BC; }
        .error { background: #FCE8E8; color: #E55D5D; border: 1px solid #FAD1D1; }

        #configModal { display: none; position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 100; align-items: center; justify-content: center; backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); }
        .modal-box { background: #fff; width: 85%; border-radius: 16px; padding: 20px; box-shadow: 0 10px 30px rgba(0,0,0,0.2); }
        .modal-title { font-size: 16px; font-weight: bold; color: #333; margin-bottom: 15px; }
        .modal-close { display: block; width: 100%; padding: 10px; text-align: center; background: #F0F0F0; border-radius: 10px; color: #666; text-decoration: none; font-weight: bold; font-size: 14px; margin-top: 15px; }
    </style>
</head>
<body>
<div class="install-card">
    <div class="header">
        <h1>系统部署</h1>
        <button class="btn-gear" onclick="toggleModal('flex')">⚙️</button>
    </div>
    
    <div class="content">
        <?php echo $message; ?>
        <div class="section-title">SQLite 数据库初始化</div>

        <form method="POST">
            <input type="hidden" name="action" value="install">
            <div class="form-group">
                <label class="form-label">管理员账号</label>
                <input type="text" name="admin_user" class="form-input" placeholder="默认为 admin" value="admin" <?php echo $isInstalled ? 'disabled' : ''; ?>>
            </div>
            
            <div class="form-group">
                <label class="form-label">管理员密码</label>
                <div class="pwd-container">
                    <input type="password" name="admin_pass" id="admin_pass" class="form-input" placeholder="请设置安全密码" required <?php echo $isInstalled ? 'disabled' : ''; ?>>
                    <div class="eye-btn" onclick="togglePwd('admin_pass', this)">
                        <svg class="eye-open" viewBox="0 0 24 24"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>
                        <svg class="eye-close" style="display:none" viewBox="0 0 24 24"><path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.82l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.74-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/></svg>
                    </div>
                </div>
            </div>

            <div class="form-group">
                <label class="form-label">确认管理员密码</label>
                <div class="pwd-container">
                    <input type="password" name="admin_pass_confirm" id="admin_pass_confirm" class="form-input" placeholder="请再次输入密码确认" required <?php echo $isInstalled ? 'disabled' : ''; ?>>
                    <div class="eye-btn" onclick="togglePwd('admin_pass_confirm', this)">
                        <svg class="eye-open" viewBox="0 0 24 24"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>
                        <svg class="eye-close" style="display:none" viewBox="0 0 24 24"><path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.82l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.74-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/></svg>
                    </div>
                </div>
            </div>

            <?php if ($isInstalled): ?>
                <button type="button" class="btn-submit" style="background:#555;" onclick="location.href='index.php'">前往登录大厅</button>
            <?php else: ?>
                <button type="submit" class="btn-submit">开始安装</button>
            <?php endif; ?>
        </form>
    </div>

    <div id="configModal">
        <div class="modal-box">
            <div class="modal-title">环境信息</div>
            <div class="form-group" style="margin-bottom:0;">
                <label class="form-label">数据库保存路径</label>
                <div style="font-size:12px; color:#888; background:#F9F9F9; padding:10px; border-radius:8px; word-break: break-all;"><?php echo $dbPath; ?></div>
            </div>
            <div class="form-group" style="margin-top:15px; margin-bottom:0;">
                <label class="form-label">读写权限状态</label>
                <div style="font-size:12px; font-weight:bold; color: <?php echo is_writable(__DIR__) ? '#078A71' : '#E55D5D'; ?>;">
                    <?php echo is_writable(__DIR__) ? '✅ 目录可读写' : '❌ 无写入权限，请检查 server 配置'; ?>
                </div>
            </div>
            <a href="javascript:void(0)" class="modal-close" onclick="toggleModal('none')">确认</a>
        </div>
    </div>
</div>

<script>
    // 弹窗控制
    function toggleModal(s) { 
        document.getElementById('configModal').style.display = s; 
    }
    
    // 密码眼睛切换逻辑
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