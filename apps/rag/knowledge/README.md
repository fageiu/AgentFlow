# 企业政策知识库语料

该目录是 RAG 服务的权威 bundled 语料，`apps/server/src/sandbox/seed.ts` 中的 Policy 仅用于旧 Trace 和 Mock 兼容。

每篇 Markdown 必须使用 UTF-8，并在 frontmatter 中声明 `policy_id`、`keyword`、`title`、`version`、`effective_date`、`status` 和 `department`。`status` 只能是 `active` 或 `archived`；普通检索默认排除 archived 文档。

`evaluation/golden_queries.json` 保存检索级评测问题。错误的 `keyword_hint` 是故意设置的难例，提示只能调整排序，不能成为过滤条件。
