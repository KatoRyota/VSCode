# VSCode

## 概要
このリポジトリは、Windows 上の Visual Studio Code 用の個人設定コレクションです。主に以下のユーザー設定とキー バインド、FavoritesPanel 用のコマンド定義を含みます。

## 含まれるファイル
- settings.json — エディタやターミナル等の設定
- keybindings.json — カスタムキー割り当て
- README.md — 本ファイル

## 主な設定ポイント
- ミニマップ無効化（editor.minimap.enabled: false）
- 行ルーラー: 80, 120
- ターミナル既定プロファイル: Git Bash
- git.autofetch を有効化
- favoritesPanel にショートカット群を登録（多用する表示/編集/ターミナル操作など）
- 地域別の折りたたみ（maptz.regionfolder）設定

## インストール（Windows）
1. VS Code を閉じる。  
2. 既存の設定をバックアップ：
   - PowerShell:
     ```
     Copy-Item "$env:APPDATA\Code\User\settings.json" "$env:USERPROFILE\Desktop\settings.json.backup" -ErrorAction SilentlyContinue
     Copy-Item "$env:APPDATA\Code\User\keybindings.json" "$env:USERPROFILE\Desktop\keybindings.json.backup" -ErrorAction SilentlyContinue
     ```
3. 本リポジトリのファイルを VS Code ユーザー設定フォルダーへコピー：
   - PowerShell:
     ```
     Copy-Item "c:\Users\kator\repo\VSCode\settings.json" "$env:APPDATA\Code\User\settings.json" -Force
     Copy-Item "c:\Users\kator\repo\VSCode\keybindings.json" "$env:APPDATA\Code\User\keybindings.json" -Force
     ```
4. VS Code を再起動して設定を反映。

（Insiders 版やポータブル版を使用している場合は、対応するユーザーフォルダーへコピーしてください。）

## カスタマイズ
必要に応じて settings.json と keybindings.json を編集して個人のワークフローに合わせてください。FavoritesPanel のコマンドはシーケンス送信（ターミナル実行など）を含むため、環境変数やパスに合わせて書き換えることを推奨します。

## 貢献・注意
- 個人用設定のため、導入前に現行設定のバックアップを必ず行ってください。
- 改善提案や修正はプルリクエストで受け付けます。

## ライセンス
個人用設定リポジトリ。特に指定がない限り自由に利用して構いませんが、変更点は自己責任で適用してください。