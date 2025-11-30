≪目次≫
- [1. VSCode Custom Settings](#1-vscode-custom-settings)
  - [1.1. 構成](#11-構成)
    - [1.1.1. ファイル概要](#111-ファイル概要)
  - [1.2. 使い方](#12-使い方)
  - [1.3. 拡張機能例](#13-拡張機能例)
  - [1.4. ライセンス](#14-ライセンス)

# 1. VSCode Custom Settings

このリポジトリは、Visual Studio Code のカスタム設定・キーバインド・拡張機能用スタイルを管理するためのものです。

## 1.1. 構成

```
.gitignore
keybindings.json
settings.json
README.md
markdown-preview-enhanced/
  └ style.less
```

### 1.1.1. ファイル概要

- **keybindings.json**  
  VSCode のキーバインド設定。F13～F22やCtrl/Shiftとの組み合わせで多彩な操作を割り当てています。

- **settings.json**  
  エディターやターミナル、拡張機能の詳細な設定。Markdownやターミナルコマンドのカスタムコマンドも含まれています。

- **markdown-preview-enhanced/style.less**  
  [Markdown Preview Enhanced](https://shd101wyy.github.io/markdown-preview-enhanced/#/customize-css) 用のカスタムCSS。プレビューやサイドバーの幅を調整しています。

- **.gitignore**  
  Visual Studio/VSCode関連の不要ファイルを除外するための設定。

## 1.2. 使い方

1. `keybindings.json` と `settings.json` を VSCode のユーザー設定ディレクトリにコピーしてください。
2. `markdown-preview-enhanced/style.less` を拡張機能の設定で参照することで、Markdownプレビューの表示をカスタマイズできます。

## 1.3. 拡張機能例

- [Markdown Preview Enhanced](https://marketplace.visualstudio.com/items?itemName=shd101wyy.markdown-preview-enhanced)
- [Markdown All in One](https://marketplace.visualstudio.com/items?itemName=yzhang.markdown-all-in-one)
- [Markdown Table Prettify](https://marketplace.visualstudio.com/items?itemName=darkriszty.markdown-table-prettify)

## 1.4. ライセンス

このリポジトリの内容は MIT ライセンスのもとで公開されています。

---

ご質問や提案があれば Issue からご連絡ください。