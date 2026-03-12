# 音乐排课系统启动指南

## 📋 环境要求

- Node.js >= 18
- Python >= 3.9
- MySQL >= 8.0
- npm

---

## 🚀 快速启动

**电脑开机后推荐顺序**（按依赖关系，先起数据库再起后端，最后起前端）：

| 顺序 | 服务   | 说明 |
|------|--------|------|
| ①    | MySQL  | 后端依赖数据库，必须先启动 |
| ②    | 后端   | 前端会请求 localhost:5000，建议先起后端 |
| ③    | 前端   | 最后启动，浏览器打开 http://localhost:5173 |

---

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

### 2. 启动后端服务

在**终端 1**中执行（任选一种）：

**方式 A：使用启动脚本（推荐，自动激活虚拟环境）**  
开机后建议用此方式，一条命令完成。

```bash
cd /Users/gubao/Desktop/0225/music225
./server/start_backend.sh
```

**方式 B：进入 server 目录后直接运行**  
适合已打开 server 目录或想手动激活虚拟环境时使用。

```bash
cd /Users/gubao/Desktop/0225/music225/server
source venv/bin/activate   # 先激活虚拟环境
python app.py
```

后端地址：http://localhost:5000

**教学日历导出 Word 功能** 依赖 `python-docx`。若导出报错「python-docx 未安装」，请先安装依赖并**重启后端**：

```bash
cd /Users/gubao/Desktop/0225/music225/server
source venv/bin/activate
pip install -r requirements.txt
# 然后重新执行 start_backend.sh
```

**若用方式 A 出现「无法连接」或「监听不对」**：

- 脚本已设置 `HOST=0.0.0.0`，后端会监听本机所有网卡，浏览器用 `http://localhost:5000` 或 `http://127.0.0.1:5000` 均可。
- 请先看运行 `./server/start_backend.sh` 的终端：是否打印 `Starting server on http://0.0.0.0:5000`、有无报错（如端口被占用、MySQL 连不上）。
- 在浏览器打开 http://127.0.0.1:5000 或 http://localhost:5000，能打开说明后端正常，再检查前端 `.env` 或 `.env.development` 里是否包含 `VITE_API_URL=http://localhost:5000/api` 或 `http://127.0.0.1:5000/api`。
- 若仍不行，可改用**方式 B** 在同一终端里手动执行，便于看到后端完整报错信息。

### 3. 启动前端服务

在**终端 2**中执行：

```bash
# 进入项目根目录
cd /Users/gubao/Desktop/0225/music225

# 首次运行请先安装依赖
npm install

# 启动开发服务器
npm run dev
```

前端地址：http://localhost:5173

**局域网连接前端**（手机、平板或同一 WiFi 下的另一台电脑访问本机前端）：

1. **本机**已按上面顺序启动 MySQL、后端、前端；后端已监听 `0.0.0.0:5000`（方式 A 脚本默认）。
2. 启动前端时 Vite 会监听所有网卡，终端里会多一行 **Network: http://192.168.x.x:5173**（`192.168.x.x` 为本机在当前局域网的 IP）。
3. 在**其他设备**的浏览器中打开：**http://本机局域网IP:5173**（将「本机局域网IP」换成终端里显示的地址，例如 `http://192.168.10.4:5173`）。
4. 若其他设备打开后接口请求失败（如用 110 登录出现 “failed to fetch”），请确认：
   - 本机前端已用 **`npm run dev`** 启动且终端里有 **Network: http://192.168.x.x:5173**；
   - 本机后端已启动且监听 `0.0.0.0:5000`（方式 A 脚本默认）；
   - 前端会**自动**在从局域网 IP 打开时使用相对路径 `/api`，一般**无需**改 `.env.development`。  
   若仍失败，可在 `.env.development` 中把 `VITE_API_URL`、`VITE_WS_URL` 留空后重启前端再试。

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