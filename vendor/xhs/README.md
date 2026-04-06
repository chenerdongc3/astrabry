# vendor/xhs

这里存放与小红书抓取、签名、存储适配相关的辅助模块。

整理目的：

- 把抓取侧能力与主业务 API 代码分开
- 让读者更容易识别哪些目录属于外部/辅助实现
- 降低 `astramvp/backend/` 中业务逻辑与抓取实现混放的认知成本

兼容性说明：

- 根目录仍保留 `xhsmedia`、`xhsstore`、`xhs_config.py` 的兼容入口
- 旧脚本如果沿用历史导入路径，暂时不需要修改
- 新代码在理解职责边界时，优先把这里视为 vendorized helper modules
