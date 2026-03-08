# 音乐排课系统启动指南

## 📋 环境要求

- Node.js >= 18
- Python >= 3.9
- MySQL >= 8.0
- npm

---

## 🚀 快速启动

### 1. 启动 MySQL 服务

```bash
sudo /usr/local/mysql/support-files/mysql.server start

# 验证 MySQL 是否运行
mysqladmin ping -h 127.0.0.1 -P 3306 -u scheduler -p
# 输入密码：Scheduler@2026，看到 mysqld is alive 即成功
```

**首次部署需创建数据库和用户**（在 `mysql -u root -p` 登录后执行）：

```sql
CREATE DATABASE IF NOT EXISTS music_scheduler
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'scheduler'@'%' IDENTIFIED BY 'Scheduler@2026';
CREATE USER IF NOT EXISTS 'scheduler'@'localhost' IDENTIFIED BY 'Scheduler@2026';
ALTER USER 'scheduler'@'%' IDENTIFIED BY 'Scheduler@2026';
ALTER USER 'scheduler'@'localhost' IDENTIFIED BY 'Scheduler@2026';
GRANT ALL PRIVILEGES ON music_scheduler.* TO 'scheduler'@'%';
GRANT ALL PRIVILEGES ON music_scheduler.* TO 'scheduler'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

### 2. 启动前端服务

在**终端 1**中执行：

```bash
# 进入项目根目录
cd /Users/gubao/Desktop/0225/music225

# 安装依赖（首次运行）
npm install

# 启动开发服务器
npm run dev
```

前端地址：http://localhost:5173

### 3. 启动后端服务

在**终端 2**中执行：

```bash
# 进入项目根目录后执行
cd /Users/gubao/Desktop/0225/music225
./server/start_backend.sh
```



后端地址：http://localhost:5000

**教学日历导出 Word 功能** 依赖 `python-docx`。若导出报错「python-docx 未安装」，请先安装依赖并**重启后端**：

```bash
cd /Users/gubao/Desktop/0225/music225/server
source venv/bin/activate
pip install -r requirements.txt
# 然后重新执行 start_backend.sh
```

---

## ⚙️ 环境配置

### 前端环境变量（/.env）

```env
VITE_USE_DATABASE=true
VITE_API_URL=http://localhost:5000/api
```

### 后端环境变量（/server/.env，可选）

后端默认使用 `scheduler` 用户连接 MySQL，无需 .env 即可运行。如需覆盖：

```env
# MySQL 配置（与 init_mysql.sql 中创建的用户一致）
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=scheduler
MYSQL_PASSWORD=Scheduler@2026
MYSQL_DATABASE=music_scheduler

# 使用 MySQL 时必须设为 production
FLASK_ENV=production
SECRET_KEY=music-scheduler-secret-key-2026
```

---

## 📁 项目结构

```
music225/
├── src/                    # 前端源码
│   ├── components/         # 组件
│   ├── pages/             # 页面
│   ├── services/          # API 服务
│   └── ...
├── server/                 # 后端源码
│   ├── models/            # 数据模型
│   ├── routes/            # API 路由
│   ├── venv/              # Python 虚拟环境
│   └── app.py             # 入口文件
├── database/              # 数据库脚本
├── docs/                  # 文档
└── ...
```

---

## 🛠️ 常用命令

### 前端命令

| 命令 | 说明 |
|------|------|
| `npm run dev` | 启动开发服务器 |
| `npm run build` | 构建生产版本 |
| `npm run preview` | 预览生产构建 |
| `npm run lint` | 运行代码检查 |

### 后端命令

| 命令 | 说明 |
|------|------|
| `python app.py` | 启动后端服务 |
| `deactivate` | 退出虚拟环境 |

### MySQL 命令

| 命令 | 说明 |
|------|------|
| `sudo /usr/local/mysql/support-files/mysql.server start` | 启动 MySQL |
| `sudo /usr/local/mysql/support-files/mysql.server stop` | 停止 MySQL |

---

## 🔍 故障排查

### 1. 端口被占用

```bash
# 查看端口占用
lsof -i :5173  # 前端端口
lsof -i :5000  # 后端端口

# 终止进程
kill -9 <PID>
```

### 2. MySQL 连接失败

```bash
sudo /usr/local/mysql/support-files/mysql.server restart
```

若报 `Access denied for user 'scheduler'@'localhost'`，需用 root 登录 MySQL 执行上文「首次部署需创建数据库和用户」中的 SQL。

若报 `'cryptography' package is required`，执行：`pip install cryptography`

### 3. 虚拟环境激活失败

```bash
# 重新创建虚拟环境
rm -rf venv
python3 -m venv venv
source venv/bin/activate
```

---

## 📝 注意事项

1. **MySQL 只需启动一次**，重启电脑后需要重新启动
2. **虚拟环境必须激活**后才能运行后端
3. **前后端需要分别在不同的终端中启动**
4. 首次运行需要安装依赖，耗时较长

---

## 🌐 访问地址

| 服务 | 地址 |
|------|------|
| 前端页面 | http://localhost:5173 |
| 后端 API | http://localhost:5000/api |
| API 文档 | http://localhost:5000/api/docs |

---

## 📌 快速命令速查

| 服务 | 命令 |
|------|------|
| MySQL | `sudo /usr/local/mysql/support-files/mysql.server start` |
| 前端 | `cd /Users/gubao/Desktop/0225/music225 && npm run dev` |
| 后端 | `/Users/gubao/Desktop/0225/music225/server/start_backend.sh` |

---

**文档版本**: 1.1  
**更新日期**: 2026-03-06