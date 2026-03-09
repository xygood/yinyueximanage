#!/bin/bash
# 在阿里云服务器 47.122.118.106 上执行，用于清理旧项目与旧数据，便于重新部署新项目。
# 用法：上传到服务器后 chmod +x clean_server.sh && ./clean_server.sh

set -e

echo "=========================================="
echo "  音乐排课系统 - 服务器清理脚本"
echo "  服务器: 47.122.118.106"
echo "=========================================="

# 1. 停止旧后端
echo ""
echo "[1/4] 停止旧后端服务..."
if [ -f "/var/www/music-scheduler/logs/server.pid" ]; then
    PID=$(cat /var/www/music-scheduler/logs/server.pid)
    kill $PID 2>/dev/null || true
    rm -f /var/www/music-scheduler/logs/server.pid
    echo "  已停止 PID: $PID"
fi
pkill -f "python.*app.py" 2>/dev/null || true
pm2 delete music-scheduler-api 2>/dev/null || true
echo "  后端进程已清理"

# 2. （可选）备份
echo ""
echo "[2/4] 是否备份当前 /var/www/music-scheduler？(y/N)"
read -r DO_BACKUP
if [ "$DO_BACKUP" = "y" ] || [ "$DO_BACKUP" = "Y" ]; then
    BACKUP_FILE="/root/backup_music_scheduler_$(date +%Y%m%d_%H%M).tar.gz"
    sudo tar -czvf "$BACKUP_FILE" /var/www/music-scheduler 2>/dev/null || true
    echo "  已备份到: $BACKUP_FILE"
else
    echo "  跳过备份"
fi

# 3. 删除旧项目目录
echo ""
echo "[3/4] 删除 /var/www/music-scheduler ..."
sudo rm -rf /var/www/music-scheduler
echo "  已删除"

# 4. MySQL 清理说明
echo ""
echo "[4/4] MySQL 数据库需手动重置（需 root 密码）。"
echo "  请以 root 登录 MySQL 后执行以下 SQL："
echo ""
echo "  DROP DATABASE IF EXISTS music_scheduler;"
echo "  CREATE DATABASE music_scheduler DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
echo "  CREATE USER IF NOT EXISTS 'scheduler'@'%' IDENTIFIED BY 'Scheduler@2026';"
echo "  CREATE USER IF NOT EXISTS 'scheduler'@'localhost' IDENTIFIED BY 'Scheduler@2026';"
echo "  GRANT ALL PRIVILEGES ON music_scheduler.* TO 'scheduler'@'%';"
echo "  GRANT ALL PRIVILEGES ON music_scheduler.* TO 'scheduler'@'localhost';"
echo "  FLUSH PRIVILEGES;"
echo "  EXIT;"
echo ""
echo "  执行方式: mysql -u root -p"
echo ""
echo "  部署新项目后，在服务器上执行建表（任选其一）："
echo "  - mysql -u root -p music_scheduler < /var/www/music-scheduler/server/init_mysql.sql"
echo "  - 或: cd /var/www/music-scheduler/server && source venv/bin/activate && python -c \"from models.database import init_db; init_db()\""
echo ""
echo "=========================================="
echo "  清理完成。请按 CLEAN_AND_DEPLOY.md 部署新项目。"
echo "=========================================="
