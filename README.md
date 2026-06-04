# AI 取名后台管理台

这个目录是运营后台管理台的静态前端。它直接调用 `ai-name` 服务暴露的 `/api/v1/admin/*` 接口。

## 使用

1. 启动 `ai-name` 服务，确认 API 可访问，例如 `http://localhost:9000/api/v1`。
2. 用任意静态服务器打开本目录，例如：

```bash
python3 -m http.server 5175
```

3. 浏览器访问 `http://localhost:5175`。
4. 在左侧填入 API Base 和 `tier=3` 管理员 JWT。

## 模块

- 用户管理：查用户、激活码、任务和结果。
- 激活码管理：批量生成、筛选、禁用、导出 CSV。
- 题目管理：类别、题组、题目维护。
- Skill 管理：编辑 `prompt.md`、`manifest.json`、`schema.json`，校验并发布。
- 知识库管理：编辑共享知识源草稿，发布后写入运行态知识库并重建索引。
