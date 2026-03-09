#!/bin/bash

echo "=========================================="
echo "  音乐排课系统 - 服务器部署脚本"
echo "=========================================="

echo ""
echo "1. 创建项目目录..."
sudo mkdir -p /var/www/music-scheduler/{server,dist,logs}

echo ""
echo "2. 复制后端代码..."
sudo cp -r server/* /var/www/music-scheduler/server/

echo ""
echo "3. 复制前端构建产物..."
sudo cp -r dist/* /var/www/music-scheduler/dist/

echo ""
echo "4. 设置权限..."
sudo chown -R $USER:$USER /var/www/music-scheduler

echo ""
echo "5. 配置 Nginx..."
sudo cp deploy/nginx.conf /etc/nginx/sites-available/music-scheduler
sudo ln -sf /etc/nginx/sites-available/music-scheduler /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

echo ""
echo "6. 创建 Python 虚拟环境..."
cd /var/www/music-scheduler/server
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

echo ""
echo "7. 配置环境变量..."
if [ ! -f ".env" ]; then
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
fi

echo ""
echo "8. 初始化数据库..."
python -c "from models.database import init_db; init_db()"

echo ""
echo "9. 启动服务..."
cd /var/www/music-scheduler
./deploy/start.sh

echo ""
echo "=========================================="
echo "  部署完成！"
echo "  访问地址: http://47.122.118.106"
echo "=========================================="
