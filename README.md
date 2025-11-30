≪目次≫
- [1. VSCode Workspace](#1-vscode-workspace)
  - [1.1. 構成](#11-構成)
  - [1.2. 主な拡張機能](#12-主な拡張機能)
  - [1.3. キーバインド例](#13-キーバインド例)
  - [1.4. Markdown プレビュー用スタイル](#14-markdown-プレビュー用スタイル)
  - [1.5. 使い方](#15-使い方)

# 1. VSCode Workspace

このリポジトリは、Visual Studio Code のカスタム設定・キーバインド・拡張機能リスト、および Markdown プレビュー用スタイルを管理するためのものです。

## 1.1. 構成

- `.gitignore`  
  Visual Studio/VSCode関連の不要ファイルを除外します。
- `extensions.txt`  
  利用している VSCode 拡張機能一覧。
- `keybindings.json`  
  独自のキーバインド設定。
- `settings.json`  
  エディターや拡張機能の詳細設定。
- `markdown-preview-enhanced/style.less`  
  [Markdown Preview Enhanced](https://shd101wyy.github.io/markdown-preview-enhanced/#/customize-css) 用のカスタム CSS。

## 1.2. 主な拡張機能

`extensions.txt` に記載された拡張機能例:
- GitHub Copilot / Copilot Chat
- Markdown Preview Enhanced
- Markdown All in One
- Markdown Table
- Githd / Git Log -- Graph
- SQL Developer / MySQL Shell
- Region Folder
- Center Editor Window
- その他便利系

## 1.3. キーバインド例

`keybindings.json` で F13～F22, Ctrl+F13～F19, Shift+F13～F22 などに各種コマンドを割り当てています。

## 1.4. Markdown プレビュー用スタイル

`markdown-preview-enhanced/style.less` でプレビューの幅やサイドバーの幅を調整しています。

## 1.5. 使い方

1. VSCode の設定フォルダに各ファイルを配置してください。
2. `extensions.txt` の内容を参考に拡張機能をインストールしてください。
3. Markdown プレビューの見た目をカスタマイズしたい場合は `style.less` を編集してください。

---

詳細は各ファイルをご参照ください。

- [settings.json](settings.json)
- [keybindings.json](keybindings.json)
- [extensions.txt](extensions.txt)
- [markdown-preview-enhanced/style.less](markdown-preview-enhanced/style.less)