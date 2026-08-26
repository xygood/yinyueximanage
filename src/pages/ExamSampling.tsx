import React, { useState } from 'react';
import { examSamplingApi } from '../services/api';
import { Award, Download, RefreshCw, Users, BookOpen, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';

interface ExtractResult {
  results: any[];
  total: number;
  teacher_coverage: number;
  total_teachers: number;
  missing_teachers: string[];
  class_distribution: Record<string, number>;
}

export default function ExamSampling() {
  const [totalSlots, setTotalSlots] = useState(97);
  const [seed, setSeed] = useState(42);
  const [basePerTeacher, setBasePerTeacher] = useState(1);
  const [balanceTeachers, setBalanceTeachers] = useState('徐颖,王武,林琳,吴玉敏,杨柳');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ExtractResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const handleExtract = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const teachers = balanceTeachers.split(/[,，]/).map(s => s.trim()).filter(Boolean);
      const data = await examSamplingApi.extract({
        total_slots: totalSlots,
        seed,
        base_per_teacher: basePerTeacher,
        class_balance_teachers: teachers,
      });
      setResult(data);
    } catch (err: any) {
      setError(err.message || '抽取失败');
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const teachers = balanceTeachers.split(/[,，]/).map(s => s.trim()).filter(Boolean);
      const response = await examSamplingApi.exportCsv({
        total_slots: totalSlots,
        seed,
        base_per_teacher: basePerTeacher,
        class_balance_teachers: teachers,
      });
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = '考试抽查名单.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError('导出失败: ' + (err.message || '未知错误'));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <h1 className="page-title flex items-center gap-2">
          <Award className="w-6 h-6 text-purple-600" />
          考试抽查
        </h1>
      </div>

      <div className="card mb-6">
        <div className="p-6">
          <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-purple-600" />
            抽取规则配置
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">抽取总人数</label>
              <input
                type="number"
                value={totalSlots}
                onChange={(e) => setTotalSlots(parseInt(e.target.value) || 97)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                min={1}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">随机种子</label>
              <input
                type="number"
                value={seed}
                onChange={(e) => setSeed(parseInt(e.target.value) || 42)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">每教师基础名额</label>
              <input
                type="number"
                value={basePerTeacher}
                onChange={(e) => setBasePerTeacher(parseInt(e.target.value) || 1)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                min={0}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">班级均衡目标教师</label>
              <input
                type="text"
                value={balanceTeachers}
                onChange={(e) => setBalanceTeachers(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                placeholder="用逗号分隔教师姓名"
              />
            </div>
          </div>
          <div className="flex items-center gap-3 mt-2">
            <button
              onClick={handleExtract}
              disabled={loading}
              className="btn-primary flex items-center gap-2"
            >
              {loading ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Award className="w-4 h-4" />
              )}
              {loading ? '抽取中...' : '运行抽取'}
            </button>
            {result && (
              <button
                onClick={handleExport}
                disabled={exporting}
                className="btn-secondary flex items-center gap-2"
              >
                <Download className="w-4 h-4" />
                {exporting ? '导出中...' : '导出CSV'}
              </button>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className="card mb-6 bg-red-50 border-red-200">
          <div className="p-4 flex items-center gap-2 text-red-700">
            <XCircle className="w-5 h-5" />
            {error}
          </div>
        </div>
      )}

      {result && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <div className="card">
              <div className="p-4 text-center">
                <p className="text-sm text-gray-500">抽取总人数</p>
                <p className="text-3xl font-bold text-purple-600">{result.total}</p>
              </div>
            </div>
            <div className="card">
              <div className="p-4 text-center">
                <p className="text-sm text-gray-500">教师覆盖率</p>
                <p className="text-3xl font-bold text-blue-600">
                  {result.teacher_coverage}/{result.total_teachers}
                </p>
                <p className="text-xs text-gray-400">
                  {result.total_teachers > 0 ? Math.round(result.teacher_coverage / result.total_teachers * 100) : 0}%
                </p>
              </div>
            </div>
            <div className="card">
              <div className="p-4 text-center">
                <p className="text-sm text-gray-500">未覆盖教师</p>
                <p className="text-3xl font-bold text-amber-600">{result.missing_teachers.length}</p>
              </div>
            </div>
            <div className="card">
              <div className="p-4 text-center">
                <p className="text-sm text-gray-500">涉及班级</p>
                <p className="text-3xl font-bold text-green-600">
                  {Object.keys(result.class_distribution).length}
                </p>
              </div>
            </div>
          </div>

          {result.missing_teachers.length > 0 && (
            <div className="card mb-6 bg-amber-50 border-amber-200">
              <div className="p-4 flex items-start gap-2 text-amber-700">
                <AlertTriangle className="w-5 h-5 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-medium">以下教师未覆盖到：</p>
                  <p className="text-sm mt-1">{result.missing_teachers.join('、')}</p>
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            <div className="card">
              <div className="p-6">
                <h3 className="text-md font-bold text-gray-900 mb-3 flex items-center gap-2">
                  <Users className="w-4 h-4 text-purple-600" />
                  班级分布
                </h3>
                <div className="space-y-2">
                  {Object.entries(result.class_distribution).map(([cls, count]) => (
                    <div key={cls} className="flex items-center gap-3">
                      <span className="text-sm text-gray-700 w-28">{cls}</span>
                      <div className="flex-1 bg-gray-100 rounded-full h-5 overflow-hidden">
                        <div
                          className="bg-purple-500 h-full rounded-full flex items-center justify-end pr-2 text-xs text-white font-medium"
                          style={{ width: `${Math.min(100, (count / Math.max(...Object.values(result.class_distribution))) * 100)}%` }}
                        >
                          {count}人
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="card">
              <div className="p-6">
                <h3 className="text-md font-bold text-gray-900 mb-3 flex items-center gap-2">
                  <Award className="w-4 h-4 text-purple-600" />
                  抽取结果列表
                </h3>
                <div className="overflow-x-auto max-h-96 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-100 sticky top-0">
                      <tr>
                        <th className="px-3 py-2 text-center">序号</th>
                        <th className="px-3 py-2 text-left">教师</th>
                        <th className="px-3 py-2 text-left">学生姓名</th>
                        <th className="px-3 py-2 text-center">类型</th>
                        <th className="px-3 py-2 text-left">班级</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {result.results.map((r, idx) => (
                        <tr key={idx} className="hover:bg-gray-50">
                          <td className="px-3 py-2 text-center text-gray-500">{idx + 1}</td>
                          <td className="px-3 py-2">{r['教师']}</td>
                          <td className="px-3 py-2 font-medium">{r['学生姓名']}</td>
                          <td className="px-3 py-2 text-center">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${r['学生类型'] === '主项' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                              {r['学生类型']}
                            </span>
                          </td>
                          <td className="px-3 py-2">{r['班级']}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}