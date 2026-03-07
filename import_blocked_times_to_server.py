#!/usr/bin/env python3
"""
将本地存储的禁排时间数据导入到服务器 MySQL 数据库
"""

import json
import sys
import uuid
from datetime import datetime

# 读取 JSON 文件
def import_blocked_times(json_file_path):
    with open(json_file_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    print(f"读取到 {len(data)} 条禁排时间记录")
    
    # 生成 SQL 插入语句
    sql_statements = []
    
    for item in data:
        slot_id = str(uuid.uuid4())
        academic_year = item.get('academic_year', '2025-2026')
        semester_label = item.get('semester_label', '2025-2026-2')
        slot_type = 'specific'
        
        # 解析周次
        week_number = None
        weeks = item.get('weeks', [])
        if weeks:
            week_number = weeks[0] if len(weeks) == 1 else None
        
        # 解析星期和节次
        day_of_week = item.get('day', 1)
        periods = item.get('periods', [])
        start_period = min(periods) if periods else 1
        end_period = max(periods) if periods else 10
        
        # 班级关联
        class_associations = json.dumps([{
            "id": item.get('class_id', ''),
            "name": item.get('class_name', '')
        }]) if item.get('class_name') else '[]'
        
        # 原因
        reason = item.get('reason', '专业大课禁排')
        
        # 创建时间
        created_at = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        
        sql = f"""INSERT INTO blocked_slots 
(id, academic_year, semester_label, type, week_number, day_of_week, start_period, end_period, class_associations, reason, created_at, updated_at) 
VALUES 
('{slot_id}', '{academic_year}', '{semester_label}', '{slot_type}', {week_number if week_number else 'NULL'}, {day_of_week}, {start_period}, {end_period}, '{class_associations}', '{reason}', '{created_at}', '{created_at}');"""
        
        sql_statements.append(sql)
    
    # 输出 SQL 文件
    output_file = 'import_blocked_times.sql'
    with open(output_file, 'w', encoding='utf-8') as f:
        f.write('\n'.join(sql_statements))
    
    print(f"已生成 SQL 文件: {output_file}")
    print(f"共 {len(sql_statements)} 条 INSERT 语句")
    print("\n请执行以下命令导入到服务器:")
    print(f"mysql -u root -p music_scheduler < {output_file}")

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("用法: python import_blocked_times_to_server.py <json文件路径>")
        print("\n示例:")
        print("1. 在浏览器控制台执行: localStorage.getItem('music_scheduler_imported_blocked_times')")
        print("2. 将输出的 JSON 保存到文件: blocked_times.json")
        print("3. 运行: python import_blocked_times_to_server.py blocked_times.json")
        sys.exit(1)
    
    import_blocked_times(sys.argv[1])
