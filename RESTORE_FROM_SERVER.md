# 从服务器拉回文件使用

服务器地址：**47.122.118.106**  
当前对话里只改动了 **`src/pages/ArrangeClass.tsx`**，其余未提交文件是更早的修改。

---

## 方式一：从服务器拉回源码（推荐，若服务器上有完整项目）

若你部署时在服务器上解压的是**完整项目**（含 `src/` 目录），可以直接把服务器上的 `ArrangeClass.tsx` 拉回本地覆盖。

### 1. 先确认服务器上是否有该文件

```bash
ssh root@47.122.118.106 "ls -la /var/www/music-scheduler/src/pages/ArrangeClass.tsx 2>/dev/null || ls -la /var/www/*/src/pages/ArrangeClass.tsx 2>/dev/null || echo '未找到'"
```

如果输出是 “未找到”，说明服务器上只有构建产物（如 `dist/`），没有 `src/`，请用**方式二**。

### 2. 拉回并覆盖本地文件

**请把下面的路径按你服务器上的实际路径改**（常见为 `/var/www/music-scheduler` 或你解压到的目录）：

```bash
cd /Users/gubao/Desktop/0225/music225

# 备份当前本地版本（以防需要对比或还原）
cp src/pages/ArrangeClass.tsx src/pages/ArrangeClass.tsx.backup

# 从服务器拉回（路径按实际改）
scp root@47.122.118.106:/var/www/music-scheduler/src/pages/ArrangeClass.tsx ./src/pages/ArrangeClass.tsx
```

### 3. 验证

```bash
npm run build
```

能通过即可使用当前拉回的版本。

---

## 方式二：服务器上没有源码时，用 Git 恢复该文件

若服务器上只有 `dist/`（没有 `src/`），无法“从服务器拉回源码”，只能在本机用 Git 把 `ArrangeClass.tsx` 恢复成**某个提交时的版本**。

**注意**：当前仓库最新提交是 `8512c8a`，该提交里的 `ArrangeClass.tsx` 之前有语法错误（对话里修过的那段）。若你从未把“服务器上正在跑的那版”提交过，Git 里就没有和服务器完全一致的源码，只能恢复到某次提交的状态。

### 1. 备份当前文件

```bash
cd /Users/gubao/Desktop/0225/music225
cp src/pages/ArrangeClass.tsx src/pages/ArrangeClass.tsx.backup
```

### 2. 从当前分支最近一次提交恢复该文件

```bash
git checkout 8512c8a -- src/pages/ArrangeClass.tsx
```

这样会得到提交 `8512c8a` 时的 `ArrangeClass.tsx`（可能仍有之前的语法/构建问题）。

### 3. 若你有“确定没问题”的提交

若你记得某次提交是部署到服务器且运行正常的，可以把 `8512c8a` 换成该提交的 hash，例如：

```bash
git log --oneline -10   # 看最近提交
git checkout <那个好的提交hash> -- src/pages/ArrangeClass.tsx
```

### 4. 验证

```bash
npm run build
```

---

## 小结

| 情况                     | 做法 |
|--------------------------|------|
| 服务器上有完整项目（含 `src/`） | 用**方式一**：`scp` 拉回 `ArrangeClass.tsx` 覆盖本地。 |
| 服务器上只有 dist、没有 src   | 用**方式二**：本地 `git checkout` 恢复该文件到某次提交。 |

只恢复 `ArrangeClass.tsx` 不会动到其它未提交修改（如 `Students.tsx`、`SmartStudentAssignment.tsx`、`server/routes/schedule.py` 等）；若你希望整份项目都和服务器一致，需要你本人在服务器上确认当时是用哪份源码打的包，再在本地用 Git 或备份恢复到那份源码。
