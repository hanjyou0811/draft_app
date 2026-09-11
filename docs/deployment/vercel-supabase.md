# Vercel + Supabaseへのデプロイ

実装は `feat/draft-room` ブランチ、作業ディレクトリは `/home/user/draft_app/.worktrees/initial` にあります。リポジトリのmasterにはアプリがまだありません。

## 1. Supabaseのテーブルを作る

専用プロジェクト `bcvanvhqvodibxfeufqk` のSQL Editorで、`supabase/migrations/20260911000000_draft_rooms.sql` を一度実行します。

テーブルへのブラウザからの直接アクセスは禁止し、VercelのAPIだけが会議を読み書きします。Data APIが有効で、publicスキーマが公開対象になっている必要があります。

## 2. Vercelの環境変数

ProductionとPreviewで次を設定します。両方に同じ接続先を設定するとDBは共有されます。

| 名前 | 値 |
| --- | --- |
| `SUPABASE_URL` | `https://bcvanvhqvodibxfeufqk.supabase.co` |
| `SUPABASE_SECRET_KEY` | Supabase Settings → API KeysのSecret key (`sb_secret_...`) |

Secret keyはサーバー専用です。`VITE_`を付けず、ソースコードにも書き込みません。既存のservice_role JWTも使用可能です。Publishable/anonキーでは書き込めません。

## 3. デプロイ

この作業ディレクトリからCLIを使う場合:

```sh
cd /home/user/draft_app/.worktrees/initial
npx vercel login
npx vercel link
npx vercel env add SUPABASE_URL production
npx vercel env add SUPABASE_SECRET_KEY production
npx vercel --prod
```

環境変数はプロンプトに入力します。Previewも使う場合は同様に `preview` に追加します。

Git経由ならアプリを含むブランチをリモートへpushしてVercelにimportし、そのブランチをProduction Branchに指定します。Root Directoryはリポジトリルート、FrameworkはVite、Build Commandは `npm run build`、Output Directoryは `dist`、Node.jsは22.xです。`vercel.json` がAPIと招待URLの転送を設定します。

## 動作と検証

画面とAPIはVercel、保存先はSupabase Postgresです。1会議をJSONBの1行として保存し、更新番号を条件に原子的に書き換えます。競合時は最新状態から操作をやり直すため、複数のAPIインスタンスでも指名を失いません。認証と参加者別の公開ビューは既存のドメイン処理を使います。

画面は認証済みAPIを1秒間隔で取得します。通信失敗時は操作を停止し、最大5秒間隔で復帰を試みます。完了後は定期取得を止めます。Supabase Realtimeの設定は不要です。

`npm run dev` / `npm start` は従来どおりローカルSQLiteを使用します。Supabase環境変数はVercel用APIで使用します。

公開後は別々のブラウザで会議作成、招待URLの直接アクセス、参加、同時指名、重複抽選、再指名、完成、再読み込みによる復帰を確認してください。

ローカル検証: `npm test`、`npm run typecheck`、`npm run build`、`npm run test:e2e`。SupabaseアダプターのテストはHTTP応答の代替を使用します。実プロジェクトでのSQL適用と疎通は別途必要です。
