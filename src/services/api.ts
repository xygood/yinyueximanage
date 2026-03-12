// 开发环境：从局域网 IP 打开时强制用相对路径 /api（走 Vite 代理），避免请求发到当前设备本机导致 failed to fetch
function getApiBaseUrl(): string {
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    const hostname = window.location.hostname;
    if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
      return '/api';
    }
  }
  const url = import.meta.env.VITE_API_URL;
  if (url !== undefined && url !== '') return url;
  return import.meta.env.DEV ? '/api' : '/api';
}
const API_BASE_URL = getApiBaseUrl();

const getAuthToken = (): string | null => {
  const userStr = sessionStorage.getItem('music_scheduler_current_user');
  if (userStr) {
    const user = JSON.parse(userStr);
    return btoa(`${user.teacher_id}:${user.password || ''}`);
  }
  return null;
};

const fetchWithAuth = async <T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> => {
  const token = getAuthToken();
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Basic ${token}` } : {}),
    ...options.headers,
  };

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    let errorMessage = `HTTP ${response.status}`;
    const text = await response.text();
    if (text) {
      try {
        const body = JSON.parse(text);
        errorMessage = body.error || body.message || errorMessage;
      } catch {
        if (text.length < 200) errorMessage = text;
      }
    }
    throw new Error(errorMessage);
  }

  return response.json();
};

export const api = {
  get: <T>(endpoint: string) => fetchWithAuth<T>(endpoint),
  post: <T>(endpoint: string, data: unknown) =>
    fetchWithAuth<T>(endpoint, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  put: <T>(endpoint: string, data: unknown) =>
    fetchWithAuth<T>(endpoint, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  delete: <T>(endpoint: string) =>
    fetchWithAuth<T>(endpoint, {
      method: 'DELETE',
    }),
};

export const teachersApi = {
  getAll: () => api.get<any[]>('/teachers'),
  getById: (id: string) => api.get<any>(`/teachers/${id}`),
  create: (data: any) => api.post<any>('/teachers', data),
  update: (id: string, data: any) => api.put<any>(`/teachers/${id}`, data),
  delete: (id: string) => api.delete(`/teachers/${id}`),
  batchCreate: (teachers: any[]) => api.post<any[]>('/teachers/batch', { teachers }),
  getRoomMappings: () => api.get<any[]>('/teachers/room-mappings'),
  assignRoom: (teacherId: string, roomId: string, facultyCode: string) =>
    api.post<any>(`/teachers/${teacherId}/rooms`, { room_id: roomId, faculty_code: facultyCode }),
  removeRoom: (teacherId: string, roomId: string) =>
    api.delete(`/teachers/${teacherId}/rooms/${roomId}`),
  importRooms: (entries: any[]) =>
    api.post<{ success: number; failed: number; errors: string[] }>('/teachers/import-rooms', entries),
};

export const studentsApi = {
  getAll: () => api.get<any[]>('/students'),
  getById: (id: string) => api.get<any>(`/students/${id}`),
  create: (data: any) => api.post<any>('/students', data),
  update: (id: string, data: any) => api.put<any>(`/students/${id}`, data),
  delete: (id: string) => api.delete(`/students/${id}`),
  batchCreate: (students: any[]) => api.post<any[]>('/students/batch', { students }),
};

export const coursesApi = {
  getAll: () => api.get<any[]>('/courses'),
  getById: (id: string) => api.get<any>(`/courses/${id}`),
  create: (data: any) => api.post<any>('/courses', data),
  update: (id: string, data: any) => api.put<any>(`/courses/${id}`, data),
  delete: (id: string) => api.delete(`/courses/${id}`),
};

export const roomsApi = {
  getAll: () => api.get<any[]>('/rooms'),
  getById: (id: string) => api.get<any>(`/rooms/${id}`),
  create: (data: any) => api.post<any>('/rooms', data),
  update: (id: string, data: any) => api.put<any>(`/rooms/${id}`, data),
  delete: (id: string) => api.delete(`/rooms/${id}`),
};

export const schedulesApi = {
  getAll: (params?: { teacher_id?: string; week_number?: number }) => {
    if (!params || Object.keys(params).length === 0) {
      return api.get<any[]>('/schedules');
    }
    const queryParts: string[] = [];
    if (params.teacher_id) queryParts.push(`teacher_id=${encodeURIComponent(params.teacher_id)}`);
    if (params.week_number !== undefined) queryParts.push(`week_number=${params.week_number}`);
    const query = queryParts.join('&');
    return api.get<any[]>(`/schedules${query ? `?${query}` : ''}`);
  },
  getById: (id: string) => api.get<any>(`/schedules/${id}`),
  create: (data: any) => api.post<any>('/schedules', data),
  update: (id: string, data: any) => api.put<any>(`/schedules/${id}`, data),
  delete: (id: string) => api.delete(`/schedules/${id}`),
  deleteMany: (ids: string[]) => api.post<{ deleted: number; ids: string[] }>('/schedules/batch-delete', { ids }),
  batchCreate: (schedules: any[]) => api.post<any[]>('/schedules/batch', { schedules }),
  getTeacherConflicts: (semester_label?: string) =>
    api.get<{ conflicts: any[]; count: number }>(`/schedules/teacher-conflicts${semester_label ? `?semester_label=${encodeURIComponent(semester_label)}` : ''}`),
};

export const blockedSlotsApi = {
  getAll: () => api.get<any[]>('/blocked-slots'),
  getById: (id: string) => api.get<any>(`/blocked-slots/${id}`),
  create: (data: any) => api.post<any>('/blocked-slots', data),
  update: (id: string, data: any) => api.put<any>(`/blocked-slots/${id}`, data),
  delete: (id: string) => api.delete(`/blocked-slots/${id}`),
  batchCreate: (blocked_slots: any[]) => api.post<any[]>('/blocked-slots/batch', { blocked_slots }),
};

export const largeClassScheduleApi = {
  getAll: () => api.get<any[]>('/large-class-schedules'),
  getById: (id: string) => api.get<any>(`/large-class-schedules/${id}`),
  create: (data: any) => api.post<any>('/large-class-schedules', data),
  update: (id: string, data: any) => api.put<any>(`/large-class-schedules/${id}`, data),
  delete: (id: string) => api.delete(`/large-class-schedules/${id}`),
  clearAll: () => api.post<{ message: string }>('/large-class-schedules/clear', {}),
};

export const classesApi = {
  getAll: () => api.get<any[]>('/classes'),
  getById: (id: string) => api.get<any>(`/classes/${id}`),
  create: (data: any) => api.post<any>('/classes', data),
  update: (id: string, data: any) => api.put<any>(`/classes/${id}`, data),
  delete: (id: string) => api.delete(`/classes/${id}`),
};

export const semesterConfigsApi = {
  getAll: () => api.get<any[]>('/semester-configs'),
  getById: (id: string) => api.get<any>(`/semester-configs/${id}`),
  getBySemester: (semesterLabel: string) => api.get<any>(`/semester-configs/semester/${semesterLabel}`),
  create: (data: any) => api.post<any>('/semester-configs', data),
  update: (id: string, data: any) => api.put<any>(`/semester-configs/${id}`, data),
  upsert: (data: any) => api.post<any>('/semester-configs/upsert', data),
};

export const authApi = {
  login: (teacherId: string, password: string) =>
    api.post<{ user: any }>('/auth/login', { teacher_id: teacherId, password }),
  register: (data: any) => api.post<{ user: any }>('/auth/register', data),
  changePassword: (teacherId: string, oldPassword: string, newPassword: string) =>
    api.post('/auth/change-password', {
      teacher_id: teacherId,
      old_password: oldPassword,
      new_password: newPassword,
    }),
};

export const syncApi = {
  getAll: () => api.get<any>('/sync/all'),
  import: (data: any) => api.post<{ message: string; results: any }>('/sync/import', data),
  clear: () => api.post('/sync/clear', {}),
};

export default {
  api,
  teachersApi,
  studentsApi,
  coursesApi,
  roomsApi,
  schedulesApi,
  blockedSlotsApi,
  classesApi,
  semesterConfigsApi,
  authApi,
  syncApi,
};
