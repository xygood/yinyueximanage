# 阿里云服务器清理与重新部署指南

服务器地址：**47.122.118.106**

本文说明如何在已有旧文件和旧 MySQL 数据的服务器上**清理环境**，并**部署当前新项目**（音乐排课系统）。

---

## 一、整体流程概览

1. **SSH 登录服务器**
2. **停止旧服务**（后端、Nginx 可选）
3. **（可选）备份旧数据**
4. **清理旧项目文件**
5. **清理/重置 MySQL 数据库**
6. **上传并部署新项目**
7. **启动服务并验证**

---

## 二、详细步骤

### 1. SSH 登录服务器

```bash
ssh root@47.122.118.106
# 或使用你的用户名：ssh your_user@47.122.118.106
```

### 2. 停止旧服务

按你当前实际使用的方式执行其一或全部：

```bash
# 若使用 deploy/start.sh 启动的后端（通过 PID 文件）
/var/www/music-scheduler/deploy/stop.sh   # 若项目还在
# 或手动杀进程
pkill -f "python.*app.py" 2>/dev/null || true

# 若使用 PM2 管理后端
pm2 stop music-scheduler-api 2>/dev/null || true
pm2 delete music-scheduler-api 2>/dev/null || true

# Nginx 可先不关，清理和部署完成后再 reload
# sudo systemctl stop nginx   # 如需要可暂时关闭
```

### 3. （可选）备份旧数据

如需保留旧文件或数据库再做备份：

```bash
# 备份整个项目目录（若存在）
sudo tar -czvf /root/backup_music_scheduler_$(date +%Y%m%d_%H%M).tar.gz /var/www/music-scheduler 2>/dev/null || true

# 备份 MySQL 中的旧库（将 your_mysql_root_password 换成 root 密码）
mysqldump -u root -p --databases music_scheduler > /root/backup_music_scheduler_db_$(date +%Y%m%d).sql
```

### 4. 清理旧项目文件

```bash
# 删除部署目录（新项目会重新创建）
sudo rm -rf /var/www/music-scheduler

# 若 Nginx 指向了 /var/www/html，也可清空前端静态文件（可选）
# sudo rm -rf /var/www/html/*
```

### 5. 清理/重置 MySQL 数据库

**方式 A：只清理本项目的库并重新初始化（推荐）**

用 root 登录 MySQL：

```bash
mysql -u root -p
```

在 MySQL 里执行（会删除旧库并重建，供新项目使用）：

```sql
-- 删除旧库（注意：库内所有数据会丢失）
DROP DATABASE IF EXISTS music_scheduler;

-- 创建新库和用户（与新项目 server/init_mysql.sql 一致）
CREATE DATABASE music_scheduler
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS 'scheduler'@'%' IDENTIFIED BY 'Scheduler@2026';
CREATE USER IF NOT EXISTS 'scheduler'@'localhost' IDENTIFIED BY 'Scheduler@2026';
GRANT ALL PRIVILEGES ON music_scheduler.* TO 'scheduler'@'%';
GRANT ALL PRIVILEGES ON music_scheduler.* TO 'scheduler'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

然后执行项目自带的建表脚本（需先把新项目的 `server/init_mysql.sql` 传到服务器，或从本机执行）：

```bash
# 在服务器上（若已有新项目代码）
mysql -u root -p music_scheduler < /var/www/music-scheduler/server/init_mysql.sql
```

**方式 B：使用项目内的清理脚本（需先上传新代码）**

见下文「使用清理脚本」一节。

### 6. 上传并部署新项目

**方式一：本机打包上传再在服务器解压部署**

在**你本机**项目根目录执行：

```bash
cd /Users/gubao/Desktop/0225/music225

# 打包（排除 node_modules、venv、.git、__pycache__、.env 等以加快上传）
tar --exclude='node_modules' --exclude='server/venv' --exclude='.git' --exclude='dist' \
  --exclude='__pycache__' --exclude='*.pyc' --exclude='server/.env' \
  -czvf music225.tar.gz .

# 上传到服务器
scp music225.tar.gz root@47.122.118.106:/tmp/
```

在**服务器**上执行：

```bash
sudo mkdir -p /var/www/music-scheduler
sudo chown -R $USER:$USER /var/www/music-scheduler
cd /var/www/music-scheduler

# 若目录里已有旧内容需先清空（以下命令在 bash/zsh 下均可用）
find . -mindepth 1 -maxdepth 1 -exec rm -rf {} +

tar -xzvf /tmp/music225.tar.gz -C .
rm /tmp/music225.tar.gz
```

**方式二：在服务器用 Git 拉取**

```bash
sudo mkdir -p /var/www/music-scheduler
sudo chown -R $USER:$USER /var/www/music-scheduler
cd /var/www/music-scheduler
git clone <你的仓库地址> .
# 若已有仓库且只是更新：git pull
```

### 7. 在服务器上完成依赖安装与构建

```bash
cd /var/www/music-scheduler

# 1）后端
cd server
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# 环境变量（MySQL 与 STARTUP_GUIDE 一致）
cat > .env << 'EOF'
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=scheduler
MYSQL_PASSWORD=Scheduler@2026
MYSQL_DATABASE=music_scheduler
FLASK_ENV=production
SECRET_KEY=music-scheduler-production-secret-2026
PORT=5000
EOF

# 若 5 中未执行 init_mysql.sql，可用 Python 建表
python -c "from models.database import init_db; init_db()"
deactivate
cd ..

# 2）前端（需 Node.js 18+）
npm install
npm run build

# 3）Nginx 使用项目自带配置（根目录为 dist）
sudo cp deploy/nginx.conf /etc/nginx/sites-available/music-scheduler
sudo ln -sf /etc/nginx/sites-available/music-scheduler /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# 4）启动后端（二选一）
# 使用项目自带脚本：
./deploy/start.sh

# 或使用 PM2：
# pm2 start server/app.py --name music-scheduler-api --interpreter /var/www/music-scheduler/server/venv/bin/python -- --host=127.0.0.1 --port=5000
# pm2 save && pm2 startup
```

### 8. 验证

- 浏览器访问：http://47.122.118.106  
- 接口：http://47.122.118.106/api/  
- 默认管理员：工号 `110`，密码见 `server/init_mysql.sql` 或项目说明（如 `135`）。

---

## 三、使用清理脚本（可选）

项目在 `deploy/clean_server.sh` 中提供了**在服务器上执行的清理脚本**，会：

- 停止旧后端进程
- 删除 `/var/www/music-scheduler` 目录
- 提示你执行 MySQL 重置命令（不会自动输入 root 密码）

**使用步骤：**

1. 将 `deploy/clean_server.sh` 上传到服务器（或先部署代码再在服务器上执行）。
2. 在服务器上执行：

```bash
chmod +x /path/to/clean_server.sh
/path/to/clean_server.sh
```

3. 按脚本提示用 root 登录 MySQL 执行它输出的 SQL（或按本文「5. 清理/重置 MySQL」操作）。
4. 再按本文「6–7」上传新项目并部署。

---

## 四、常见问题

| 问题 | 处理 |
|------|------|
| 旧后端仍占用 5000 端口 | `pkill -f "python.*app.py"` 或 `pm2 delete music-scheduler-api` |
| MySQL 连接被拒绝 | 检查 MySQL 是否运行：`sudo systemctl status mysql`，并确认 3306 监听 |
| 前端 404 或白屏 | 确认 Nginx `root` 指向 `/var/www/music-scheduler/dist`，且已执行 `npm run build` |
| 接口 502 | 确认后端已启动且监听 127.0.0.1:5000，`curl http://127.0.0.1:5000/api/` 有响应 |

---

## 五、快速命令汇总（服务器上执行顺序）

```bash
# 1. 停服务
pkill -f "python.*app.py" 2>/dev/null || true

# 2. 删旧目录
sudo rm -rf /var/www/music-scheduler

# 3. MySQL 重置（在 mysql -u root -p 里执行）
#    DROP DATABASE IF EXISTS music_scheduler;
#    CREATE DATABASE music_scheduler DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
#    （创建用户、授权等见上文）

# 4. 上传新代码后：安装依赖 → 配置 .env → 建表 → npm run build → 配置 Nginx → 启动后端
```

按上述顺序操作即可完成「清理旧数据 + 部署新项目」。  

---

## 六、本地修改后快速更新前端（含 `Students.tsx` 等）

当只修改了前端代码（例如 `src/pages/Students.tsx`、`ArrangeClass.tsx`），后端与数据库未改动时，可按下面步骤**快速更新前端**：

### 1）本机执行

```bash
cd /Users/gubao/Desktop/0225/music225

# 重新构建前端 dist
npm run build

# 打包（包含最新 dist 与前端代码）
rm -f music225.tar.gz
tar --exclude='node_modules' --exclude='server/venv' --exclude='.git' \
  --exclude='__pycache__' --exclude='*.pyc' --exclude='server/.env' \
  --exclude='music225.tar.gz' \
  -czvf music225.tar.gz .

# 上传到云服务器（47.122.118.106）
scp music225.tar.gz root@47.122.118.106:/tmp/
```

### 2）服务器上执行（仅前端改动可只做这一步）

```bash
ssh root@47.122.118.106

cd /var/www/music-scheduler
tar -xzvf /tmp/music225.tar.gz -C .
rm /tmp/music225.tar.gz

# 仅重载 Nginx，使新前端生效（后端无需重启）
sudo nginx -t && sudo systemctl reload nginx
```

完成以上步骤后，刷新浏览器页面即可看到最新的前端逻辑（例如学生主项/副项同步到学生分配页面）。

### 3）如同时修改了后端（server 目录），需在服务器重启后端

```bash
cd /var/www/music-scheduler

# 使用项目自带脚本重启 Flask 后端
./deploy/stop.sh
./deploy/start.sh
```



```
#部署步骤
##1. 本机执行（上传包到服务器）
cd /Users/gubao/Desktop/0225/music225


# 打包（排除 node_modules、venv、.git、__pycache__、.env 等以加快上传）
tar --exclude='node_modules' --exclude='server/venv' --exclude='.git' --exclude='dist' \
  --exclude='__pycache__' --exclude='*.pyc' --exclude='server/.env' \
  -czvf music225.tar.gz .


# 上传到阿里云（会提示输入 root 密码）
scp music225.tar.gz root@47.122.118.106:/tmp/
2. 登录服务器并解压部署
# 登录服务器
ssh root@47.122.118.106
# 解压并覆盖项目目录
cd /var/www/music-scheduler
tar -xzvf /tmp/music225.tar.gz -C .
rm /tmp/music225.tar.gz
# 重载 Nginx（前端生效）
sudo nginx -t && sudo systemctl reload nginx
# 重启后端（本次有 server 目录修改）
./deploy/stop.sh
./deploy/start.sh
# 退出
exit
```


文档版本：1.2 | 更新日期：2026-03-08