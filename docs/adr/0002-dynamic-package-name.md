# ADR 0002: 去硬编码 — 包名与插件 ID 动态派生

日期：2026-08-31
状态：Accepted
上下文：Issue #21，commit e459f4c，package.json @feather_wch/dsh-im 0.15.3

## 背景
fork 时把 package.json:name 从 @xmanrui/dsh-im 改为 @feather_wch/dsh-im，cordis.patch.yml 同步改为 feather-wch-dsh-im，但 plugin-src/client/build.mjs lib/client.js update-runtime update-service update-panel client/index 11个styles 仍硬编码 @xmanrui，导致 DSH 按新名加载找不到模块，白屏。npm view 与 DSH自更新也仍拉上游包。

上游硬编码是 Issue #61 有意 pin（固定包名+官方源+tarball/sha512 防投毒），对上游是安全特性，对 fork 是债务。

## 决策
单一真源 package.json:name。所有运行时标识由它派生，不再字面量：

- PACKAGE_NAME = manifest.name（build.mjs/bin/update-runtime/update-panel）
- SCOPE = PACKAGE_NAME.split('/')[0] -> config get SCOPE:registry
- UNSCOPED = PACKAGE_NAME.split('/')[1] -> tarball pathname = /PACKAGE_NAME/-/UNSCOPED-version.tgz
- PLUGIN_ID/BASE_ID = PACKAGE_NAME.replace(/^@/, '').replace(/\\//g,'-').replace(/_/g,'-') -> cordis id slots id STYLE_ID dataset.plugin
- verify-package.mjs 与测试从 manifest 派生期望值

抽取共享模块 plugin-src/shared/package-meta.js 消除 11 处重复派生（本轮先以各文件独立派生落地，下轮合入共享模块）。

## 后果
- 新 fork 改名只改 package.json + cordis.patch.yml 即可，merge upstream 无需人肉替换。
- lib 仍含字面量 @feather_wch/dsh-im（构建时注入），但源码零硬编码。
- 安全边界保留：仍校验固定 NPM_REGISTRY、tarball、sha512、semver、engines.node，仅包名来源由硬编码改为可信的 package.json。

## 替代
- 继续硬编码 @feather_wch：每次 fork 重演 Issue #21，已否决。
- process.env 覆盖：仅保留 DSH_IM_CLIENT_ID 作临时测试，不作主路径。

## 验证
- grep "@xmanrui" plugin-src -> 0
- grep "@feather_wch" plugin-src -> 0
- npm run build && node scripts/verify-package.mjs -> Verified
- node --test test/client-ui.test.mjs test/update-ui.test.mjs -> 58/58
- npm view @feather_wch/dsh-im@0.15.3 已发布

## 关联
- Issue #21, commit e459f4c, 版本 0.15.3
