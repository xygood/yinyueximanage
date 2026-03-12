import { io, Socket } from 'socket.io-client';
import { STORAGE_KEYS } from './localStorage';

// WebSocket 连接地址：
// - 本地开发：默认连接到 http://localhost:5000
// - 生产环境（如 47.122.118.106）：默认走当前域名（通过 Nginx 反向代理 /socket.io），不再连 localhost:5000
const DEFAULT_WS_URL =
  typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:5000'
    : '';

const WS_URL = import.meta.env.VITE_WS_URL || DEFAULT_WS_URL;
const USE_DATABASE = import.meta.env.VITE_USE_DATABASE === 'true';

class WebSocketService {
  private socket: Socket | null = null;
  private listeners: Map<string, ((data: any) => void)[]> = new Map();
  private isConnected = false;

  connect(url: string = WS_URL): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        const options = {
          reconnection: true,
          reconnectionAttempts: 5,
          reconnectionDelay: 1000
        };

        // 如果有明确的 URL（开发环境或通过 VITE_WS_URL 配置），就用该 URL；
        // 否则使用当前页面同源（生产环境通过 Nginx 代理 /socket.io）
        if (url) {
          this.socket = io(url, options);
        } else {
          this.socket = io(options);
        }

        this.socket.on('connect', () => {
          console.log('WebSocket connected');
          this.isConnected = true;
          resolve(true);
        });

        this.socket.on('disconnect', () => {
          console.log('WebSocket disconnected');
          this.isConnected = false;
        });

        this.socket.on('error', (error) => {
          console.error('WebSocket error:', error);
          this.isConnected = false;
          resolve(false);
        });

        // 处理初始数据
        this.socket.on('initial_data', (data) => {
          this.handleInitialData(data);
        });

        // 处理课程更新
        this.socket.on('courses_updated', (data) => {
          this.handleCoursesUpdated(data);
        });

        // 处理禁排时间更新
        this.socket.on('blocked_slots_updated', (data) => {
          this.handleBlockedSlotsUpdated(data);
        });

        // 处理排课创建
        this.socket.on('schedule_created', (data) => {
          this.handleScheduleCreated(data);
        });

        // 处理排课更新
        this.socket.on('schedule_updated', (data) => {
          this.handleScheduleUpdated(data);
        });

        // 处理排课删除
        this.socket.on('schedule_deleted', (data) => {
          this.handleScheduleDeleted(data);
        });

        // 处理同步数据
        this.socket.on('sync_data', (data) => {
          this.handleSyncData(data);
        });

        // 处理在线教师更新
        this.socket.on('online_teachers_update', (data) => {
          this.handleOnlineTeachersUpdate(data);
        });

      } catch (error) {
        console.error('WebSocket connection failed:', error);
        resolve(false);
      }
    });
  }

  // 断开连接
  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.isConnected = false;
      this.listeners.clear();
    }
  }

  // 发送课程更新
  async sendCourseUpdate(courses: any[]) {
    if (this.socket && this.isConnected) {
      this.socket.emit('update_courses', courses);
    } else {
      console.warn('WebSocket not connected, cannot send course update');
    }
  }

  // 发送禁排时间更新
  async sendBlockedSlotsUpdate(slots: any[]) {
    if (this.socket && this.isConnected) {
      this.socket.emit('update_blocked_slots', slots);
    } else {
      console.warn('WebSocket not connected, cannot send blocked slots update');
    }
  }

  // 处理初始数据
  private handleInitialData(data: any) {
    if (data.scheduledCourses && data.scheduledCourses.length > 0) {
      localStorage.setItem(STORAGE_KEYS.SCHEDULED_CLASSES, JSON.stringify(data.scheduledCourses));
    }
    if (data.blockedSlots && data.blockedSlots.length > 0) {
      localStorage.setItem(STORAGE_KEYS.BLOCKED_SLOTS, JSON.stringify(data.blockedSlots));
    }
    this.notifyListeners('initial_data', data);
  }

  // 处理课程更新
  private handleCoursesUpdated(data: any) {
    if (data.scheduledCourses) {
      localStorage.setItem(STORAGE_KEYS.SCHEDULED_CLASSES, JSON.stringify(data.scheduledCourses));
    }
    if (data.blockedSlots) {
      localStorage.setItem(STORAGE_KEYS.BLOCKED_SLOTS, JSON.stringify(data.blockedSlots));
    }
    this.notifyListeners('courses_updated', data);
  }

  // 处理禁排时间更新
  private handleBlockedSlotsUpdated(slots: any[]) {
    localStorage.setItem(STORAGE_KEYS.BLOCKED_SLOTS, JSON.stringify(slots));
    this.notifyListeners('blocked_slots_updated', slots);
  }

  // 处理排课创建
  private handleScheduleCreated(data: any) {
    console.log('Schedule created:', data);
    this.notifyListeners('schedule_created', data);
  }

  // 处理排课更新
  private handleScheduleUpdated(data: any) {
    console.log('Schedule updated:', data);
    this.notifyListeners('schedule_updated', data);
  }

  // 处理排课删除
  private handleScheduleDeleted(data: any) {
    console.log('Schedule deleted:', data);
    this.notifyListeners('schedule_deleted', data);
  }

  // 处理同步数据
  private handleSyncData(data: any) {
    console.log('Sync data received:', data);
    this.notifyListeners('sync_data', data);
  }

  // 处理在线教师更新
  private handleOnlineTeachersUpdate(data: any) {
    console.log('Online teachers updated:', data);
    this.notifyListeners('online_teachers_update', data);
  }

  // 教师上线
  teacherOnline(data: { teacher_id: string; teacher_name: string; login_time: number }) {
    // 只要 socket 存在就发送，让 socket.io 在连接建立后自动冲刷缓冲区
    if (this.socket) {
      this.socket.emit('teacher_online', data);
    }
  }

  // 教师下线
  teacherOffline(teacherId: string) {
    if (this.socket) {
      this.socket.emit('teacher_offline', { teacher_id: teacherId });
    }
  }

  // 获取在线教师列表
  getOnlineTeachers() {
    if (this.socket) {
      this.socket.emit('get_online_teachers');
    }
  }

  // 添加事件监听器
  on(event: string, callback: (data: any) => void) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)?.push(callback);
  }

  // 移除事件监听器
  off(event: string, callback: (data: any) => void) {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      this.listeners.set(
        event,
        callbacks.filter(cb => cb !== callback)
      );
    }
  }

  // 通知监听器
  private notifyListeners(event: string, data: any) {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error('Error in WebSocket listener:', error);
        }
      });
    }
  }

  // 检查连接状态
  getConnectionStatus(): boolean {
    return this.isConnected;
  }
}

// 导出单例
const websocketService = new WebSocketService();
export default websocketService;