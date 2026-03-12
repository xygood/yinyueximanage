import React, { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { Navigate } from 'react-router-dom';
import { scheduleService } from '../services';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export default function TeacherScheduleConflicts() {
  const { user } = useAuth();
  const isAdmin = user?.faculty_id === 'ADMIN' || user?.is_admin === true || user?.role === 'admin' || user?.teacher_id === '110' || user?.email === 'admin@music.edu.cn';

  const [semesterLabel, setSemesterLabel] = useState('2025-2026-2');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ conflicts: any[]; count: number } | null>(null);

  const runCheck = async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await scheduleService.getTeacherConflicts(semesterLabel);
      setResult(res);
    } catch (e) {
      console.error(e);
      setResult({ conflicts: [], count: -1 });
    } finally {
      setLoading(false);
    }
  };

  if (!isAdmin) {
    return <Navigate to="/" replace />;
  }

  const dayNames = ['一', '二', '三', '四', '五', '六', '日'];

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-xl font-semibold text-gray-800 flex items-center gap-2 mb-6">
        <AlertTriangle className="w-6 h-6 text-amber-600" />
        教师时间冲突检查
      </h1>
      <p className="text-sm text-gray-600 mb-4">
        检查同一教师在同一时间（同一星期几、同一节次、周次重叠）是否被排了 2 节及以上课。
      </p>

      <div className="flex flex-wrap items-center gap-3 mb-6">
        <label className="text-sm text-gray-700">学期：</label>
        <input
          type="text"
          value={semesterLabel}
          onChange={(e) => setSemesterLabel(e.target.value)}
          placeholder="如 2025-2026-2"
          className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
        />
        <button
          type="button"
          onClick={runCheck}
          disabled={loading}
          className="inline-flex items-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-md text-sm hover:bg-amber-700 disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          {loading ? '检查中...' : '开始检查'}
        </button>
      </div>

      {result !== null && (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
            <span className="font-medium text-gray-800">
              {result.count === -1 && '请求失败'}
              {result.count === 0 && '未发现冲突'}
              {result.count > 0 && `共发现 ${result.count} 处冲突`}
            </span>
            {result.count >= 0 && (
              <span className="text-gray-500 text-sm ml-2">学期：{semesterLabel}</span>
            )}
          </div>
          <div className="p-4">
            {result.count === -1 && (
              <p className="text-red-600">请检查后端是否启动、网络是否正常，或查看浏览器控制台。</p>
            )}
            {result.count === 0 && (
              <p className="text-green-700">未发现同一教师在同一时间（同一星期、同一节次、周次重叠）排 2 节及以上课。</p>
            )}
            {result.count > 0 && (
              <ul className="space-y-3">
                {result.conflicts.map((c: any, idx: number) => (
                  <li key={idx} className="border border-amber-200 rounded-lg p-4 bg-amber-50/50">
                    <div className="font-medium text-gray-800">
                      {c.teacher_name || c.teacher_id}
                      <span className="text-gray-600 font-normal ml-2">
                        周{dayNames[(c.day_of_week || 1) - 1]} 第{c.period}节
                      </span>
                    </div>
                    <div className="text-sm text-gray-600 mt-1">
                      周次重叠：第{c.week_range_i?.[0]}-{c.week_range_i?.[1]}周 与 第{c.week_range_j?.[0]}-{c.week_range_j?.[1]}周
                    </div>
                    {c.records?.length >= 2 && (
                      <div className="text-sm text-gray-500 mt-2 space-y-1">
                        <div>记录1：课程 {c.records[0].course_code || c.records[0].course_id}，学生 {c.records[0].student_id}</div>
                        <div>记录2：课程 {c.records[1].course_code || c.records[1].course_id}，学生 {c.records[1].student_id}</div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
